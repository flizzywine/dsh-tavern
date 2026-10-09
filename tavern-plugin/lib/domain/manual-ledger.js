import { LEDGER_RULES, LEDGER_SUBMIT_TOOL, createLedgerSubmission, ledgerContext, readLedger } from './story-ledger.js'

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

/**
 * Player-triggered ledger consolidation. The ledger is a memo for the player; after
 * a consolidation the next story turn reads it once (see ledgerFrameInputs), so the
 * story sees fresh facts without carrying the ledger in every request.
 */
export function createManualLedger({ store, runAgent, selection, beginTask, ensureSession = async () => {}, onError = error => console.error('台账整理保存状态失败', error) }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.ledgerTask || { status: 'idle' }
    // Runs on every session view (which may carry only a window of messages):
    // rounds are numbered, so the latest turn alone gives the backlog size.
    const from = Math.max(0, Number(readLedger(chat.ledger).consolidatedTurn) || 0)
    let latest = 0
    for (const message of chat.messages || []) latest = Math.max(latest, Number(message?.turn) || 0)
    const view = { ...state, consolidatedTurn: from, pendingRounds: Math.max(0, latest - from) }
    return state.status === 'running' && !jobs.has(chat.id) ? { ...view, status: 'failed', error: '台账整理已中断，请重试。' } : view
  }
  async function start({ sessionId }) {
    const chat = await store.chatForSession(sessionId)
    if (!chat || chat.mode === 'card') throw new Error('当前没有游玩对话')
    if (jobs.has(chat.id)) throw new Error('台账正在整理中')
    const backlog = ledgerBacklog(chat)
    if (!backlog.text) throw new Error('上次整理之后还没有新的剧情')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    jobs.set(chat.id, true)
    let taskRun
    try {
      taskRun = await beginTask(chat, sessionId)
      await store.updateChat(chat.id, draft => {
        draft.ledgerTask = { status: 'running', from: backlog.from, through: backlog.through, error: '' }
        return draft
      })
    } catch (error) {
      jobs.delete(chat.id)
      if (taskRun) await taskRun.fail()
      throw error
    }
    const task = execute(chat, backlog, model, sessionId, taskRun).catch(onError).finally(() => jobs.delete(chat.id))
    jobs.set(chat.id, task)
    return { status: 'running', through: backlog.through, remaining: backlog.remaining }
  }
  async function execute(chat, backlog, model, sessionId, taskRun) {
    let result
    const submission = createLedgerSubmission({ enabled: true, current: chat.ledger, turn: backlog.through })
    try {
      await ensureSession(sessionId)
      result = await runAgent({
        task: 'ledger', persistent: true,
        persistentSessionId: taskRun.participantRequest.sessionId,
        rewindTo: taskRun.participantRequest.rewindTo,
        onPersistentSessionReady: id => taskRun.bindSession(id), sessionId, chatId: chat.id, selection: model,
        backgroundTasks: { variables: false, posture: false, characterDesign: false },
        system: '本次执行玩家手动发起的台账整理。台账是给玩家查阅的备忘录，整理后下一轮正文会参考一次。阅读给出的剧情（第 '
          + (backlog.from + 1) + '–' + backlog.through + ' 轮），对照当前台账，调用一次 ledger_submit 提交这些剧情带来的增量；没有变化也提交 {}。不得改写正文、变量或姿势。\n\n' + MANUAL_RULES,
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
