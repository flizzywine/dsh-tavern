import { createLedgerItem } from './background-pipeline.js'
import { beginOrQueue } from './background-task-coordinator.js'
import { LEDGER_RULES, LEDGER_SUBMIT_TOOL, applyLedgerDelta, createLedgerSubmission, ledgerContext, readLedger } from './story-ledger.js'

// One request reads at most this much story text; longer backlogs continue on the next click.
export const LEDGER_BATCH_CHARS = 40000

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Story rounds after the last consolidation, oldest first, bounded by a character budget. */
export function ledgerBacklog(chat, limit = LEDGER_BATCH_CHARS) {
  const from = Math.max(0, Number(readLedger(chat.ledger).consolidatedTurn) || 0)
  const turns = new Map()
  for (const message of chat.messages || []) {
    if (message?.role !== 'user' && message?.role !== 'assistant') continue
    const turn = Number(message.turn) || 0
    if (turn <= from) continue
    const text = str(message.sourceText ?? message.text).trim()
    if (!text) continue
    if (!turns.has(turn)) turns.set(turn, [])
    turns.get(turn).push((message.role === 'user' ? '[玩家]\n' : '[正文]\n') + text)
  }
  const ordered = [...turns.keys()].sort((a, b) => a - b)
  const included = []
  let size = 0
  for (const turn of ordered) {
    const block = '【第 ' + turn + ' 轮】\n' + turns.get(turn).join('\n\n')
    // Always take at least one round so a single oversized round still progresses.
    if (included.length && size + block.length > limit) break
    included.push({ turn, block })
    size += block.length
  }
  return {
    from,
    through: included.length ? included[included.length - 1].turn : from,
    remaining: ordered.length - included.length,
    text: included.map(item => item.block).join('\n\n')
  }
}

// The retired per-round rules assumed a settlement that also submits posture/variables.
const MANUAL_RULES = LEDGER_RULES.replace('先完成台账，再提交姿势或变量；不要创建其他 Agent。', '不要创建其他 Agent。')
const LEDGER_ITEM = createLedgerItem({ rules: MANUAL_RULES })

/**
 * Player-triggered ledger consolidation. The ledger is a memo for the player; after
 * a consolidation the next story turn reads it once (see ledgerFrameInputs), so the
 * story sees fresh facts without carrying the ledger in every request.
 */
export function createManualLedger({ store, runAgent, selection, beginTask, ensureSession = async () => {}, replaceLedger = async () => null, onError = error => console.error('台账整理保存状态失败', error) }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.ledgerTask || { status: 'idle' }
    // Runs on every session view (which may carry only a window of messages):
    // rounds are numbered, so the latest turn alone gives the backlog size.
    const from = Math.max(0, Number(readLedger(chat.ledger).consolidatedTurn) || 0)
    let latest = 0
    for (const message of chat.messages || []) latest = Math.max(latest, Number(message?.turn) || 0)
    const view = { ...state, consolidatedTurn: from, pendingRounds: Math.max(0, latest - from) }
    return ['running', 'queued'].includes(state.status) && !jobs.has(chat.id) ? { ...view, status: 'failed', error: '台账整理已中断，请重试。' } : view
  }
  const setTask = (chatId, status, backlog, error) => store.updateChat(chatId, draft => {
    draft.ledgerTask = { status, from: backlog.from, through: backlog.through, error: error ? String(error.message || error) : '' }
    return draft
  })
  async function start({ sessionId }) {
    const chat = await store.chatForSession(sessionId)
    if (!chat || chat.mode === 'card') throw new Error('当前没有游玩对话')
    if (jobs.has(chat.id)) throw new Error('台账正在整理中')
    const backlog = ledgerBacklog(chat)
    if (!backlog.text) throw new Error('上次整理之后还没有新的剧情')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    jobs.set(chat.id, true)
    let started
    try { started = await beginOrQueue(onQueued => beginTask(chat, sessionId, onQueued)) }
    catch (error) { jobs.delete(chat.id); throw error }
    if (!started.queued) {
      try { await setTask(chat.id, 'running', backlog) }
      catch (error) { jobs.delete(chat.id); await started.taskRun.fail(); throw error }
      jobs.set(chat.id, execute(chat, backlog, model, sessionId, started.taskRun).catch(onError).finally(() => jobs.delete(chat.id)))
      return { status: 'running', through: backlog.through, remaining: backlog.remaining }
    }
    // 书记 is busy with another task: the click returns now; the consolidation starts once it frees.
    jobs.set(chat.id, (async () => {
      await setTask(chat.id, 'queued', backlog).catch(onError)
      let taskRun
      try {
        taskRun = await started.begun
        // Rounds that arrived while it waited join this consolidation.
        const fresh = await store.chatForSession(sessionId) || chat
        const latest = ledgerBacklog(fresh).text ? ledgerBacklog(fresh) : backlog
        await setTask(chat.id, 'running', latest)
        await execute(fresh, latest, model, sessionId, taskRun)
      } catch (error) {
        if (taskRun) await taskRun.fail().catch(onError)
        await setTask(chat.id, 'failed', backlog, error)
      }
    })().catch(onError).finally(() => jobs.delete(chat.id)))
    return { status: 'queued', through: backlog.through, remaining: backlog.remaining }
  }
  async function execute(chat, backlog, model, sessionId, taskRun) {
    let result
    const submission = createLedgerSubmission({ enabled: true, current: chat.ledger, turn: backlog.through })
    try {
      // A plugin may take the consolidation over (tavern.replaceLedger); its delta goes
      // through the same validation and commit, and Tavern's own run is the fallback.
      const replaced = await replaceLedger({ gameId: sessionId, from: backlog.from + 1, through: backlog.through, text: backlog.text,
        ledger: readLedger(chat.ledger), rules: MANUAL_RULES, tool: LEDGER_SUBMIT_TOOL,
        apply: delta => applyLedgerDelta(chat.ledger, delta, backlog.through) })
      if (replaced) submission.execute({ arguments: replaced.delta })
      else {
        await ensureSession(sessionId)
        result = await runAgent({
          task: 'ledger', persistent: true,
          persistentSessionId: taskRun.participantRequest.sessionId,
          rewindTo: taskRun.participantRequest.rewindTo,
          rewindFormatVersion: taskRun.participantRequest.formatVersion,
          onPersistentSessionReady: id => taskRun.bindSession(id), sessionId, chatId: chat.id, selection: model,
          backgroundTasks: { variables: false, posture: false, characterDesign: false },
          system: LEDGER_ITEM.system({ from: backlog.from + 1, through: backlog.through }),
          messages: [{ role: 'user', content: [{ type: 'text', text: ledgerContext(chat.ledger) + '\n\n【待整理剧情】\n' + backlog.text }] }],
          tools: [LEDGER_SUBMIT_TOOL],
          maxToolCalls: 4,
          temperature: 0.2,
          stopToolsWhen: () => submission.result !== null,
          acceptWithoutText: () => submission.result !== null,
          onToolCall: async call => call?.name === LEDGER_SUBMIT_TOOL.name
            ? submission.execute(call)
            : JSON.stringify({ ok: false, retryable: true, error: '本任务只允许调用 ledger_submit' })
        })
      }
      if (submission.result === null) throw new Error('模型未调用 ledger_submit 提交台账，本次未保存。请重试；若持续出现，请检查后台模型是否支持工具调用。')
      const completed = await taskRun.commit({ participant: taskRun.participant(result), stateChanged: true, apply: current => {
        // A manual edit or another consolidation since this request started wins.
        if (JSON.stringify(readLedger(current.ledger)) !== JSON.stringify(readLedger(chat.ledger))) throw new Error('台账已被修改，本次整理未保存，请重试。')
        current.ledger = { ...submission.result, consolidatedTurn: backlog.through }
        current.ledgerTask = { status: 'done', from: backlog.from, through: backlog.through, error: '' }
        current.ledgerInjection = { through: backlog.through }
        return current
      } })
      if (completed.status !== 'committed') throw new Error('剧情已变化，本次整理未保存，请重试。')
    } catch (error) {
      await taskRun.fail(result)
      await store.updateChat(chat.id, current => {
        current.ledgerTask = { status: 'failed', from: backlog.from, through: backlog.through, error: String(error.message || error) }
        return current
      })
    }
  }
  return { start, project, wait: chatId => jobs.get(chatId) }
}
