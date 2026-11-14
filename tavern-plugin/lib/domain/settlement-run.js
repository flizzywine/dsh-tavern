import { runPipelineStages } from './background-pipeline.js'
import { createSettlementProgressGuard } from './settlement-progress-guard.js'
import { readSettlementInput } from './settlement-input.js'
import { applySettlement } from './settlement-turn.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// A settlement that commits no floor (the plain engine, a plugin-replaced posture)
// writes header fields only: the posture, the settlement status and its last run.
// Naming them lets the commit read and patch the header instead of materializing
// every floor to diff one posture — on a long save that read was the bulk of a
// background settlement.
const SETTLEMENT_HEADER_FIELDS = Object.freeze(['posture', 'settleStatus', 'settleError', 'lastSettle'])

// One turn's background work (Wiki「设计：background-task-pipeline」): plugin tasks before,
// the main settlement with plugin tasks alongside, plugin tasks after, then "turn settled".
// The main settlement reads its input, lets the MVU or the plain engine settle, and commits;
// a stale commit runs again, a failure is recorded. Manual plugin tasks run here too.
// `deps` is read on each call, so a test may swap a service after creation.
export function createSettlementRun(deps) {
  async function runSettlement(chatId, signal) {
    const { backgroundTasks, chatPersistence, mvuSettlementEngine, readChat, readChatCard, worldBookScanDepth } = deps
    const retryStale = createSettlementProgressGuard({ backgroundTasks, onStopped: ({ operationId, error }) => {
      console.error('dsh-tavern: 结算连续三次未能提交且剧情状态未前进，已停止，可重新结算', chatId, operationId, str(error?.message || error || '提交已过期'))
    } })
    while (true) {
      signal?.throwIfAborted()
      let snapshot = await readSettlementInput(chatId, {readWindow:chatPersistence.readWindow,readChat,scanDepth:worldBookScanDepth})
      signal?.throwIfAborted()
      if (snapshot === undefined) return
      const taskRun = await backgroundTasks.begin(snapshot, 'settlement', { reuseSnapshot: true, queue: true, signal })
      snapshot = taskRun.chat
      const trace = { sessionId: str(taskRun.participantRequest.sessionId), boundary: null }
      try {
        signal?.throwIfAborted()
        if (deps.pluginApi?.hostBehavior && !(await deps.pluginApi.hostBehavior.forGame(snapshot.sessionId)).backgroundAgents) {
          const completed = await taskRun.commit({ stateChanged: false, headerFields: SETTLEMENT_HEADER_FIELDS,
            apply(draft) {
              draft.settleStatus = 'done'; draft.settleError = null
              draft.lastSettle = { ts: Date.now(), posture: false, raw: '', skipped: 'plugin-host-behavior' }
            } })
          if (completed.status === 'stale') continue
          return
        }
        const card = await readChatCard(snapshot)
        signal?.throwIfAborted()
        const engine = await runSettlementEngine({ snapshot, taskRun, card, signal, trace })
        if (engine.deferred) return
        const { text, result, mvuResult, mvuTarget, backgroundTasksSettings } = engine
        signal?.throwIfAborted()
        let stat = { postureUpdated: false }
        const mvuCompletion = mvuSettlementEngine.completion({ mvuTarget, mvuResult, backgroundTasksSettings })
        const completion = {
          ...(mvuCompletion.messageIndices ? { messageIndices: mvuCompletion.messageIndices } : { headerFields: SETTLEMENT_HEADER_FIELDS }),
          stateChanged: mvuCompletion.stateChanged || str(result && result.posture).trim() !== '',
          participant: taskRun.participant({ sessionId: trace.sessionId, boundary: trace.boundary }),
          apply(draft, scope) {
            mvuCompletion.apply(draft, scope)
            stat = applySettlement(draft, result)
            draft.settleStatus = 'done'
            draft.settleError = null
            draft.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 200) }
          }
        }
        if (deps.settlementParticipants) {
          const participate = await deps.settlementParticipants.capture(snapshot, mvuTarget, mvuResult)
          const apply = completion.apply
          completion.apply = (draft, ...args) => { apply(draft, ...args); participate(draft) }
        }
        const completed = await taskRun.commit(completion)
        if (completed.status === 'missing') return
        if (completed.status === 'stale') {
          signal?.throwIfAborted()
          if (await retryStale(completed.chat)) continue
          return
        }
        if (mvuTarget) deps.settlementParticipants?.settled(snapshot, completed.chat, mvuTarget, mvuResult)
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 200))
        return
      } catch (err) {
        if (signal?.aborted) return
        const failedSessionId = str(err && err.traceSessionId)
        if (failedSessionId && failedSessionId !== trace.sessionId) {
          trace.sessionId = failedSessionId
          trace.boundary = null
        }
        if (trace.boundary === null && Number.isSafeInteger(err && err.traceBoundary)) trace.boundary = err.traceBoundary
        const message = str(err && err.message || err) || '后台结算失败'
        const failed = await taskRun.commit({
          status: 'failed',
          stateChanged: false,
          participant: taskRun.participant({ sessionId: trace.sessionId, boundary: trace.boundary }),
          apply(draft) {
            // Close the delivery and the public settlement status in the same CAS
            // that records the round's settledRevision. A second whole-Chat write
            // would leave that revision pointing at a still-pending snapshot.
            mvuSettlementEngine.recordFailure(draft, err, message)
            draft.settleStatus = 'failed'
            draft.settleError = message
          }
        })
        if (failed.status === 'missing') return
        if (failed.status === 'stale') {
          signal?.throwIfAborted()
          console.warn('dsh-tavern: 结算失败结果已过期', chatId, str(err?.message || err))
          if (await retryStale(failed.chat, err)) continue
          return
        }
        console.error('dsh-tavern: 结算失败', chatId, str(err && err.message || err))
        return
      }
    }
  }
  // The main settlement's engine: official MVU variables carry the posture in their
  // own run; every other game settles the plain way.
  // `trace` carries the background session the run used, also when it throws.
  async function runSettlementEngine({ snapshot, taskRun, card, signal, trace }) {
    const { mvuSettlementEngine, plainSettlementEngine } = deps
    const backgroundTasksSettings = mvuSettlementEngine.settings(snapshot)
    const mvuTarget = mvuSettlementEngine.target(snapshot)
    if (mvuSettlementEngine.runs(mvuTarget, backgroundTasksSettings)) {
      const settled = await mvuSettlementEngine.run({ snapshot, taskRun, card, signal, trace, backgroundTasksSettings, mvuTarget })
      if (settled.deferred) return settled
      return { text: settled.text, result: { posture: settled.posture }, mvuResult: settled.mvuResult, mvuTarget, backgroundTasksSettings }
    }
    const { text, result } = await plainSettlementEngine.run({ snapshot, taskRun, card, signal, trace, backgroundTasksSettings })
    return { text, result, mvuResult: null, mvuTarget, backgroundTasksSettings }
  }
  async function runSettlementCycle(chatId, signal) {
    const { backgroundTasks, pluginApi, pluginSettlementProgress, taskStateReader } = deps
    const state = await taskStateReader.read(chatId).catch(() => null)
    const gameId = str(state?.sessionId)
    if (gameId && pluginApi.hostBehavior && !(await pluginApi.hostBehavior.forGame(gameId)).backgroundAgents) {
      deps.backgroundAgentRunner?.cancel(gameId)
      await deps.backgroundAgentRunner?.releaseFor(gameId)
      await runSettlement(chatId, signal)
      return
    }
    const onStart = label => pluginSettlementProgress.begin(gameId, label)
    const activity = state ? backgroundTasks.activity(state) : null
    const turnPending = () => Boolean(gameId) && activity?.role === 'settlement' && ['pending', 'running'].includes(activity.phase)
    // A new turn may have replaced versions plugins are still working on.
    if (gameId) await pluginApi.checkVersions(gameId).catch(() => {})
    // The turn's pipeline (Wiki「设计：background-task-pipeline」): before-tasks, the main settlement
    // with the parallel tasks running alongside it, after-tasks.
    await runPipelineStages([
      { id: 'before', when: turnPending,
        run: () => pluginApi.runSettlementTasks({ gameId, phase: 'before', signal, onStart }) },
      { id: 'settle', run: async () => {
        const alongside = turnPending() && !signal?.aborted ? pluginApi.runSettlementTasks({ gameId, phase: 'parallel', signal, onStart })
          .catch(error => console.warn('dsh-tavern: 插件并行任务失败:', str(error?.message || error))) : null
        try { await runSettlement(chatId, signal) } finally { await alongside }
      } },
      // Tavern's settlement is committed by now: a plugin-task operation keeps the game busy (and stoppable).
      { id: 'after', when: () => Boolean(gameId) && !signal?.aborted,
        run: () => pluginApi.runSettlementTasks({ gameId, phase: 'after', signal, onStart, around: work => inPluginTaskOperation(chatId, work) }) }
    ])
  }
  async function inPluginTaskOperation(chatId, work) {
    const { backgroundTasks, taskStateReader } = deps
    const taskRun = await backgroundTasks.begin(await taskStateReader.read(chatId), 'plugin-task', { queue: true })
    try { await work(taskRun.operationId) }
    finally { await taskRun.commit({ stateChanged: false }).catch(error => console.warn('dsh-tavern: 插件任务收尾失败:', str(error?.message || error))) }
  }

  const pluginTaskJobs = new Map()
  // A manual plugin task: an exclusive background task, like the ledger; returns once started.
  async function startPluginTask(sessionId, key, input) {
    const { agentRegistry, backgroundTasks, pluginApi, pluginSettlementProgress, taskStateReader } = deps
    const chat = await taskStateReader.forSession(str(sessionId))
    if (!chat || !['story', 'script'].includes(chat.mode)) throw new Error('当前没有游玩对话')
    if (pluginApi.hostBehavior && !(await pluginApi.hostBehavior.forGame(chat.sessionId)).backgroundAgents) throw new Error('本局插件已关闭后台任务，请使用前台对话')
    if (agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw new Error('请等待正文生成完成后再运行插件任务')
    if (pluginTaskJobs.has(chat.id)) throw new Error('已有插件任务在运行，请等它完成')
    await pluginApi.manualTaskFor(chat.sessionId, key, input)
    const taskRun = await backgroundTasks.begin(chat, 'plugin-task')
    const job = pluginApi.runManualTask({ gameId: chat.sessionId, key, input, operationId: taskRun.operationId, signal: new AbortController().signal,
      onStart: label => pluginSettlementProgress.begin(chat.sessionId, label) })
      .catch(error => console.warn('dsh-tavern: 插件任务失败:', str(error?.message || error)))
      .finally(async () => {
        pluginTaskJobs.delete(chat.id)
        await taskRun.commit({ stateChanged: false }).catch(error => console.warn('dsh-tavern: 插件任务收尾失败:', str(error?.message || error)))
      })
    pluginTaskJobs.set(chat.id, job)
    return { started: true }
  }
  async function onSettlementSettled(chatId, signal) {
    const { chatPersistence, storyEvents } = deps
    let latest, turn
    try {
      const head = await chatPersistence.readSlice(chatId, [], ['_storageRevision', 'sessionId', 'cardName', 'mode', 'plotCompass', 'backgroundTasks'])
      latest = head?.chat
      // The turn just settled, so what follows 本轮结算完 (needs, outputs) knows which turn it is.
      if (Number.isSafeInteger(head?.messageCount) && head.messageCount > 0) {
        const last = (await chatPersistence.readSlice(chatId, [head.messageCount - 1]))?.chat?.messages?.at(-1)
        if (last?.role === 'assistant' && Number.isSafeInteger(Number(last.turn)) && Number(last.turn) > 0) turn = Number(last.turn)
      }
    } catch { latest = latest ?? null }
    if (!signal.aborted && latest !== undefined) storyEvents.emit('turn-settled', { chatId, latest, ...(turn ? { turn } : {}) })
  }

  return Object.freeze({ runSettlement, runCycle: runSettlementCycle, onSettled: onSettlementSettled, startPluginTask, pluginTaskJob: chatId => pluginTaskJobs.get(chatId) })
}
