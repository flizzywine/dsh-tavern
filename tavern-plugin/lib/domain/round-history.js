import { projectPlayerContent } from './player-input-content.js'
import { assertRescueHistoryEditable } from './chat-history-rescue.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { canUndoRollback, restoreSurface, preflightSurfaceRestore, unchangedSinceRollback } from './surface-restoration.js'
import { rewindBackgroundSurface } from './background-surface.js'
import { releaseOpeningTurn, sessionEvents, withSurfaceEditTurn } from './session-events.js'
import { randomUUID } from 'node:crypto'
import { createRegenerationRecovery } from './regeneration-recovery.js'
import { isDeepStrictEqual } from 'node:util'
import { createScopedMessages, isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { rollbackAvailability, clearFailedTurnSurface, locateRegenerationSurface, planRegenerationSurface, regenerationProjection, replayableFailedTurn, anchoredToSaveRow, unansweredTailIndex, surfaceTurnOfSeq } from './rollback-surface.js'

// Both regeneration paths (native and plugin) read the same tail rule.
export { unansweredTailIndex }
import { assertRegenerationSourceCurrent, replaceLastRound } from './last-round-replacement.js'
import { diagnosticIdentity, regenerationTargetDiagnostic } from './regeneration-diagnostics.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { plainReplyProse, replyProse } from './reply-prose.js'
import { createPluginBodyRegeneration } from './plugin-body-regeneration.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { legacyMessageUid } from './message-uid.js'
import { consumeScriptPrompts } from './tavern-script-prompts.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// A provider that keeps moderating or cutting a regeneration short can often be
// worked around by dropping the foreground tool calls the player enabled for this
// game: 本局设置 → 高级 → 前台工具.
const FOREGROUND_TOOL_HINT = '也可以试试在「本局设置 → 高级 → 前台工具」关掉前台工具后再发一次。'

// 重新生成等结算的时长上限：超过就先交回已提交的正文。等待结算不该决定这轮
// 正文什么时候出现在页面上；结算完成/失败仍经存档与活动视图回来。
const REGEN_SETTLEMENT_WAIT_MS = 8000

const INPUT_STATE_FIELDS = ['macroState', 'variables', 'tavernHelperScriptVariables', 'tavernScriptPrompts',
  'promptTemplateInput', 'runtimeInputs', 'scriptState', 'preparedWorldBookContext', 'preparedWorldBook',
  'worldBookReads', 'worldBookVirtualState', 'worldBookRandomState', 'promptTemplateInitialVariables']

// Whether a host accepts replacing an existing assistant message is a property of
// the session, not of the round being regenerated: a host that refuses refuses
// every turn of it, and one that accepts accepts the next. Probe once per session.
// The probe clones the whole event log and folds its surface again, which on a
// long session costs more than the replacement it is checking for.
const replacementVerified = new WeakSet()

/**
 * The input of a regeneration attempt. The provider never sees the replaced body
 * (the request projection drops it), so without guidance this is a fresh sample
 * of the round. Guidance ("写得更长", "加快节奏") is relative to the current body,
 * so it comes with that body as the draft to revise.
 */
/**
 * A bounded window's `messages` is a Proxy facade (scoped-messages.js) and
 * structuredClone refuses any Proxy: materialize the visible rows first, then
 * clone the Chat like any other save.
 */
function cloneChat(value) {
  if (value === null || typeof value !== 'object') return value
  return structuredClone(isScopedMessages(value.messages) ? { ...value, messages: Array.from(value.messages) } : value)
}

export function regenerationInputText(userText, guidance, rewriteBody) {
  const input = str(userText).trim(), guide = str(guidance).trim(), draft = str(rewriteBody).trim()
  if (draft !== '' && guide !== '') return input + '\n\n【当前正文】\n' + draft + '\n\n【改写要求】\n在当前正文基础上改写本轮正文：' + guide
  return input + (guide !== '' ? '\n\n【本轮补充要求】\n' + guide : '')
}

/**
 * A regeneration frame is persisted as JSON, so a value `structuredClone` refuses
 * (a function a provider or plugin left in the request plan) must not abort the
 * regeneration: fall back to the JSON view the save keeps anyway.
 */
function cloneFrame(value) {
  try { return structuredClone(value) }
  catch { return JSON.parse(JSON.stringify(value === undefined ? null : value)) }
}

/**
 * Build the regeneration request from the live save at send time. The previous
 * body's frozen frame is not a request recipe: preset, worldbook, card and state
 * may all have changed since it was written.
 */
async function candidateRegenerationFrame(chat, operationId, nativeTurn, inputText, prepareFrame) {
  if (typeof prepareFrame !== 'function') throw new Error('当前宿主未提供正文重新生成准备接口')
  const prepared = await prepareFrame({
    sessionId: chat.sessionId,
    turn: nativeTurn,
    requestId: 'regeneration:' + operationId,
    userText: inputText,
    userContent: { role: 'user', content: [{ type: 'text', text: inputText }] }
  })
  const built = prepared?.frame
  if (!built || built.kind !== 'foreground' || !Array.isArray(built.contributions)) {
    throw new Error('重新生成没有取得当前请求材料')
  }
  const frame = cloneFrame(built)
  const branchId = str(chat.timeline?.branchId || frame.branchId) || 'main'
  frame.frameId = 'foreground:' + chat.id + ':' + branchId + ':' + operationId
  frame.chatId = chat.id
  frame.branchId = branchId
  frame.basedOnRevision = Math.max(0, Number(chat.timeline?.revision) || 0)
  frame.operationId = operationId
  frame.turn = nativeTurn
  frame.userInput = { ...(frame.userInput || {}), sourceText: inputText, projectedText: str(prepared.userText) || inputText, source: { stage: 'player-input' } }
  return frame
}

function assertCandidateStoryCurrent(original, current, assistantIndex, inputIndex, operationId, syntheticTurn) {
  if (current?.regenRecovery?.id !== operationId || current.regenRecovery?.phase !== 'prepared') {
    throw new Error('重新生成操作已失效')
  }
  const originalMessages = Array.isArray(original.messages) ? original.messages : []
  const currentMessages = Array.isArray(current?.messages) ? current.messages : []
  const unchanged = isDeepStrictEqual(currentMessages, originalMessages)
  const appended = !unchanged && currentMessages.length === originalMessages.length + 2 &&
    isDeepStrictEqual(currentMessages.slice(0, originalMessages.length), originalMessages) &&
    currentMessages.at(-2)?.role === 'user' && currentMessages.at(-1)?.role === 'assistant' &&
    Number(currentMessages.at(-1)?.turn) === Number(syntheticTurn)
  if (!unchanged && !appended) throw new Error('重新生成期间剧情或后续输入已经变化')
  assertRegenerationSourceCurrent({ originalChat: original, currentChat: appended
    ? { ...current, messages: currentMessages.slice(0, originalMessages.length) } : current, assistantIndex, inputIndex })
  if (!isDeepStrictEqual(current.timeline, original.timeline)) {
    // Compatibility with a host that still finalized the native candidate into
    // one temporary round. Original timeline entries must remain byte-equivalent;
    // only that candidate's completed body operation/checkpoint may be added.
    const originalOperations = original.timeline?.operations || {}
    const currentOperations = current.timeline?.operations || {}
    const originalIntact = Object.entries(originalOperations).every(([id, operation]) => isDeepStrictEqual(currentOperations[id], operation))
    const extras = Object.entries(currentOperations).filter(([id]) => !Object.hasOwn(originalOperations, id))
    const originalCheckpoints = original.timeline?.checkpoints || []
    const checkpointsIntact = isDeepStrictEqual((current.timeline?.checkpoints || []).slice(0, originalCheckpoints.length), originalCheckpoints)
    if (!appended || (original.timeline?.branchId && current.timeline?.branchId !== original.timeline.branchId) || !originalIntact || !checkpointsIntact ||
        extras.length !== 1 || extras[0][1]?.kind !== 'body' || extras[0][1]?.status !== 'completed' || Number(extras[0][1]?.turn) !== Number(syntheticTurn)) {
      throw new Error('重新生成期间剧情状态已经变化')
    }
  }
  for (const key of ['macroState', 'variables', 'posture', 'scriptState']) {
    if (!isDeepStrictEqual(current[key], original[key])) throw new Error('重新生成期间本轮状态已经变化')
  }
}

// What the model saw of a stored reply (same precedence as the body editor).
function replyTextOf(message) { return str(message && (message.projectionText ?? message.sourceText ?? message.text)) }

/**
 * Text a streamed attempt had written when its turn ended badly. A turn the
 * provider failed, the player stopped or content moderation cut short often
 * never writes an `assistant/message` at all — but the durable
 * `assistant/attempt` record keeps its chunks, which is exactly what the player
 * watched arrive. Rebuild the text blocks from those chunks.
 */
export function attemptStreamText(events, eventStart, turn) {
  let stream = null
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.type !== 'assistant/attempt' || Number(event.seq) < Number(eventStart)) continue
    if (Number.isSafeInteger(turn) && turn > 0 && Number(event.data?.turn) !== turn) continue
    stream = event.data?.stream
  }
  if (!Array.isArray(stream)) return ''
  const blocks = new Map(), order = []
  function bucket(index) {
    const key = String(index ?? 0)
    if (!blocks.has(key)) { blocks.set(key, { kind: 'text', text: '', closed: '' }); order.push(key) }
    return blocks.get(key)
  }
  for (const entry of stream) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.type === 'chunk') {
      const chunk = entry.chunk
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'block-start') { const item = bucket(chunk.index); if (typeof chunk.blockType === 'string') item.kind = chunk.blockType }
      else if (chunk.type === 'text-delta') { const item = bucket(chunk.index); if (item.closed === '') item.text += str(chunk.text) }
      else if (chunk.type === 'reasoning-delta') bucket(chunk.index).kind = 'reasoning'
      else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') { const item = bucket(chunk.index); item.closed = str(chunk.block.text) }
    } else if (entry.type === 'text-chunks') {
      const item = bucket(entry.index)
      if (item.closed === '' && Array.isArray(entry.texts)) item.text += entry.texts.map(str).join('')
    } else if (entry.type === 'text-delta') {
      const item = bucket(entry.index)
      if (item.closed === '') item.text += str(entry.text)
    }
  }
  return order.map(key => blocks.get(key)).filter(item => item.kind !== 'reasoning').map(item => item.closed !== '' ? item.closed : item.text).join('').trim()
}

/**
 * A regeneration the host never finished still streams its reply into the log
 * before the turn ends (stop, provider error, safety block, truncation). The
 * save only receives a round once the host commits it, so read the streamed text
 * back here and keep it instead of dropping a body the player already saw.
 */
function streamedAttemptText(session, turn, eventStart) {
  if (!Number.isSafeInteger(turn) || turn <= 0) return ''
  try {
    const events = sessionEvents(session)
    const result = assistantResultForTurn(session, turn)
    // The attempt owns its own events: a reply already in the log belongs to the
    // round being replaced, never to this try.
    if (result !== null && str(result.text).trim() !== '' && Number(result.event?.seq) >= Number(eventStart)) return result.text.trim()
    // A failed turn may have numbered its own turn (or not advanced the phase):
    // the stream that started with this attempt is still the one to keep.
    return attemptStreamText(events, eventStart, turn) || attemptStreamText(events, eventStart, 0)
  } catch { return '' }
}

function failedTailSelection(chat, session, inputIndex) {
  return { failedTail: true, eventStart: sessionEvents(session).length, msgs0: Array.isArray(chat.messages) ? chat.messages : [],
    oldAssistantIndex: -1, inputIndex, oldSeq: null, oldTurn: 0, oldSource: null }
}


/**
 * Where an answered tail's reply already sits in the native log. Nothing is
 * replaced there, so the round only needs its anchors: the input the attempt was
 * sent as and the reply the model produced for it.
 */
export function attemptNativeAnchor(session, eventStart, turn) {
  const events = sessionEvents(session)
  let input = null, reply = null
  for (const event of events) {
    if (!event || Number(event.seq) < Number(eventStart)) continue
    if (event.type === 'user/message' && input === null) input = event
    else if (event.type === 'assistant/message' && event.data?.message?.source?.kind === 'model') reply = event
  }
  if (input === null || reply === null) return null
  return { formatVersion: 4, turn: Number(turn) || Number(reply.data?.turn) || 0, input: Number(input.seq), reply: Number(reply.seq) }
}

/**
 * The save kept its unanswered tail while the attempt ran. The host may have
 * finalized the attempt as its own temporary round; anything else is a change
 * this commit must not overwrite.
 */
function assertUnansweredTailCurrent(original, current, operationId, syntheticTurn) {
  const saved = current?.regenRecovery
  if (saved?.id !== operationId || saved?.phase !== 'prepared') throw new Error('重新生成操作已失效')
  const before = Array.isArray(original?.messages) ? original.messages : []
  const messages = Array.isArray(current?.messages) ? current.messages : []
  const unchanged = isDeepStrictEqual(messages, before)
  const appended = !unchanged && messages.length === before.length + 2 &&
    isDeepStrictEqual(messages.slice(0, before.length), before) &&
    messages.at(-2)?.role === 'user' && messages.at(-1)?.role === 'assistant' &&
    Number(messages.at(-1)?.turn) === Number(syntheticTurn)
  if (!unchanged && !appended) throw new Error('重新生成期间剧情或后续输入已经变化')
  const originalOperations = original?.timeline?.operations || {}
  const currentOperations = current?.timeline?.operations || {}
  const originalIntact = Object.entries(originalOperations).every(([id, operation]) => isDeepStrictEqual(currentOperations[id], operation))
  const extras = Object.entries(currentOperations).filter(([id]) => !Object.hasOwn(originalOperations, id))
  const originalCheckpoints = original?.timeline?.checkpoints || []
  const checkpointsIntact = isDeepStrictEqual((current?.timeline?.checkpoints || []).slice(0, originalCheckpoints.length), originalCheckpoints)
  const timelineKept = isDeepStrictEqual(current?.timeline, original?.timeline) ||
    (originalIntact && checkpointsIntact && extras.length === 1 && extras[0][1]?.kind === 'body' &&
      extras[0][1]?.status === 'completed' && Number(extras[0][1]?.turn) === Number(syntheticTurn))
  if (!timelineKept) throw new Error('重新生成期间剧情状态已经变化')
  for (const key of ['macroState', 'variables', 'posture', 'scriptState']) {
    if (!isDeepStrictEqual(current[key], original[key])) throw new Error('重新生成期间本轮状态已经变化')
  }
}

export function selectRegenerationTarget(chat, session, observe) {
  const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
  const events = sessionEvents(session)
  const eventStart = events.length
  const msgs0 = chat.messages || []
  let oldAssistantIndex = -1
  function report(reason, selected, resolvedInputIndex) {
    if (typeof observe !== 'function') return
    try { observe(regenerationTargetDiagnostic(chat, session, { reason, assistantIndex: oldAssistantIndex, inputIndex: resolvedInputIndex, target: selected })) } catch { /* Diagnostics never change selection. */ }
  }
  // The save owns the target: regeneration always means its latest committed
  // assistant body. A page id cannot name another row, and native turns cannot
  // move the target when the two numberings differ.
  for (let i = msgs0.length - 1; i >= 0; i--) {
    const message = msgs0[i]
    if (message === null || typeof message !== 'object' || message.role !== 'assistant' || message.greeting === true) continue
    // A placeholder row is a round that never committed a body (a failed turn):
    // there is nothing to replace, so regeneration falls through to the last real reply.
    if (message.placeholder === true) continue
    oldAssistantIndex = i
    break
  }
  if (oldAssistantIndex < 0) {
    report('no-non-greeting-assistant')
    throw new Error('没有可重新生成的正文')
  }
  // The round's input is the nearest earlier player row. A save may end with two
  // assistant rows (a repair, or an input the player cleared): that shape must not
  // hide or refuse regeneration — the body is still the thing being replaced.
  let inputIndex = oldAssistantIndex - 1
  while (inputIndex >= 0 && !(msgs0[inputIndex] !== null && typeof msgs0[inputIndex] === 'object' && msgs0[inputIndex].role === 'user')) inputIndex -= 1
  if (inputIndex < 0) report('input-missing')
  else if (inputIndex !== oldAssistantIndex - 1) report('input-recovered')
  // 存档行自己记着这一轮正文在消息面上的事件号；只有它过期了才退回去扫。
  // 轮号只是保存下来的编号，命中与否都不该决定能不能重新生成。
  const row = msgs0[oldAssistantIndex]
  const storedSeq = Number(row?.nativeAnchor?.reply)
  const target = locateRegenerationSurface({ events, nodes,
    seq: Number.isSafeInteger(storedSeq) && storedSeq > 0 ? storedSeq : undefined, turn: row.turn,
    // A projected reply may store the edit turn; its body still identifies it.
    texts: [row.text, row.sourceText, row.projectionText] })
  const oldTurn = target !== null && Number.isSafeInteger(Number(target.turn)) && Number(target.turn) > 0
    ? Number(target.turn) : Number(row.turn) || 0
  const oldSource = target !== null ? target.source
    : { kind: 'model', provider: 'dsh-tavern', model: 'plugin-regeneration' }
  // 消息面上没有这一轮的正文不是拒绝理由：没有旧正文可替换，就把正文补写上去。
  // 以前这里直接抛「原生消息流中找不到…」，于是一次被截断的重新生成之后，
  // 这一轮就再也无法重新生成。
  const saveOnly = target === null
  report(saveOnly ? 'save-only' : 'selected', target, inputIndex)
  return { nodes, eventStart, msgs0, oldAssistantIndex, inputIndex, oldSeq: saveOnly ? null : target.assistantSeq,
    oldTurn, oldSource, saveOnly }
}

/**
 * Own replacement/rollback ordering across stored story, DSH surface and scripts.
 * Timeline owns revisions; this module owns the workflow, including aborts.
 * Callers supply host adapters, never intermediate rollback or swipe state.
 */
/** Key of a round's commit record: its turn, else (rows saved before turns were recorded) the newest commit with the same input text. */
function commitKeyOfRound(commits, assistant, userText) {
  if (!commits || typeof commits !== 'object') return ''
  const turn = Number(assistant?.turn)
  if (turn > 0 && commits[String(turn)] && typeof commits[String(turn)] === 'object') return String(turn)
  const keys = Object.keys(commits).map(Number).filter(Number.isFinite).sort((a, b) => b - a)
  const key = keys.find(key => str(commits[String(key)]?.userText).trim() === userText)
  return key === undefined ? '' : String(key)
}

function commitOfRound(commits, assistant, userText) {
  const key = commitKeyOfRound(commits, assistant, userText)
  return key ? commits[key] : null
}

export function createRoundHistory({ chats, sessions, scripts, timeline, queueSettlement, replyCommitted, cancelSettlement, present, diagnostics, sessionPatch,
  readRegenerationMaterials, prepareRegenerationFrame, prepareRegenerationReply, notifyRegeneration }) {
  const { read: readChat, forSession: chatForSession, readCard: readChatCard,
    readRevision: readChatRevision, write: writeChat, update: updateChat } = chats
  const { read: readScript, continuity: scriptContinuity } = scripts
  const tavernScriptHostAdapter = scripts
  const storyTimeline = timeline
  const view = present
  const pendingRollbacks = new Set()
  const pendingRegenerations = new Set()
  const regenerationRecovery = createRegenerationRecovery({ chats, sessions, timeline, isActive: id => pendingRegenerations.has(id) })
  const regenerateWithProvider = createPluginBodyRegeneration({ chats, sessions, scripts, timeline, queueSettlement, replyCommitted, cancelSettlement,
    sessionPatch, readRegenerationMaterials, prepareRegenerationReply, notifyRegeneration,
    recovery: regenerationRecovery, pendingRegenerations, pendingRollbacks, selectTarget: selectRegenerationTarget })

  // The save adopts the new body even when the native surface cannot place it
  // (ownership mismatch, old body gone): completion then repairs the native tail
  // from the save instead of refusing the regeneration.
  function placeRegeneration(session, oldAssistantSeq, eventStart, data, operationId) {
    try {
      const replacement = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq, eventStart })
      return regenerationProjection(replacement, data, operationId)
    } catch (error) { return { unplaced: str(error?.message || error) || '原生位置对不上' } }
  }

  async function regenerate(chatId, guidance, sessionId) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    // Regeneration replaces one stored body: it needs the story rows, including the
    // turn the caller picked, not the header-only activity view.
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (!chat) throw new Error('聊天不存在: ' + chatId)
    if (pendingRegenerations.has(chat.id) || pendingRollbacks.has(chat.id)) throw new Error('正文正在重新生成，请等待完成')
    await regenerationRecovery.recover(chat.id)
    if (pendingRegenerations.has(chat.id) || pendingRollbacks.has(chat.id)) throw new Error('正文正在重新生成，请等待完成')
    pendingRegenerations.add(chat.id)
    try { return await regenRecent(chat.id, guidance, sessionId) ?? await regenBody(chat.id, guidance, sessionId) }
    finally { pendingRegenerations.delete(chat.id) }
  }

  async function stopRollbackGeneration(chat) {
    const agent = sessions.get(chat.sessionId)
    if (agent?.phase?.kind !== 'running') return
    if (typeof agent.cancel !== 'function') throw new Error('当前宿主不支持停止生成，请先停止后再回退')
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  }

  function rollbackBodyMessages(chat) {
    return (chat.messages || []).map(({ role, turn, text, sourceText, content, inputAttachments, greeting, swipes, swipeId }) => ({ role, turn, text, sourceText, content, inputAttachments, greeting, swipes, swipeId }))
  }

  function assertRollbackSnapshot(current, expected) {
    if (!isDeepStrictEqual(current, expected)) throw new Error('回退期间聊天已被其他操作修改，请刷新后重试')
  }

  async function prepareRollbackIntent(chat, intent) {
    const target = storyTimeline.rollbackTarget({ chat })
    if (target === null) return intent
    const beforeChat = await readChatRevision(chat.id, target.beforeRevision)
    if (beforeChat === undefined) throw new Error('找不到剧情 checkpoint 对应的历史 Chat revision: ' + target.beforeRevision)
    return Object.assign({}, intent, { beforeChat })
  }
  async function regenBody(chatId, guidance, sessionId) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    let chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    assertRescueHistoryEditable(chat)
    const activeRound = Object.values(storyTimeline.inspect({ chat }).operations || {}).find(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'completed' &&
        operation.background && ['pending', 'running'].includes(str(operation.background.phase))
    })
    if (chat.regenInProgress === true) throw new Error('正文正在重新生成，请等待完成')
    const card = await readChatCard(chat)
    const storedSessionId = chat.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const effectiveSessionId = chat.sessionId
    const agent = sessions.get(effectiveSessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + effectiveSessionId)
    if (agent.phase?.kind === 'running') throw new Error('前台正在生成，请完成或停止后再重新生成')
    const session = agent.session
    // A tail the round never answered is a failed turn, not a round: there is no
    // body to replace there, so regenerating it must produce the missing body.
    // Selecting the previous reply instead replays an older input and leaves the
    // newest one unanswered — the reply the player asked to redo never happens.
    const unansweredIndex = unansweredTailIndex(chat)
    let selection, evidence
    try {
      if (unansweredIndex >= 0) {
        selection = failedTailSelection(chat, session, unansweredIndex)
        if (diagnostics) evidence = regenerationTargetDiagnostic(chat, session, { reason: 'unanswered-tail', assistantIndex: -1, inputIndex: unansweredIndex, target: null })
      } else selection = await selectRegenerationTarget(chat, session, diagnostics ? value => { evidence = value } : undefined)
    }
    finally {
      if (evidence) {
        try { await diagnostics.record(effectiveSessionId, { stage: 'regeneration-target', diagnosticId: randomUUID(),
          outcome: ['selected', 'unanswered-tail'].includes(evidence.reason) ? 'selected' : 'rejected', ...evidence,
          guidanceProvided: typeof guidance === 'string' && guidance.trim().length > 0,
          binding: { requested: diagnosticIdentity(sessionId), stored: diagnosticIdentity(storedSessionId), effective: diagnosticIdentity(effectiveSessionId),
            overridden: Boolean(sessionId && sessionId !== storedSessionId) },
          agent: { phase: ['running', 'idle'].includes(agent.phase?.kind) ? agent.phase.kind : 'other', lastTurn: Number.isFinite(agent.phase?.lastTurn) ? agent.phase.lastTurn : null } }) }
        catch { /* Recording failure must not affect regeneration or replace its error. */ }
      }
    }
    const { eventStart, msgs0, oldAssistantIndex, inputIndex, oldSeq, oldTurn, oldSource, failedTail = false, saveOnly = false } = selection
    // 面上没有这一轮的正文：没有可替换的位置，这一轮按「补写」处理，和失败尾一样是普通 append。
    const appending = failedTail || saveOnly
    // Only a replacement needs the host's replace primitive; producing the body
    // of an unanswered tail is an ordinary append and works on every host.
    if (!appending && session.header?.version >= 3 && !replacementVerified.has(session)) {
      const preview = session.constructor.fromRestore(session.id, structuredClone(sessionEvents(session)), structuredClone(session.header), session.inheritedEventCount, 'detached')
      try {
        replaceSessionSurface(preview, 'assistant/message', {
          turn: oldTurn, step: 1,
          message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: msgs0[oldAssistantIndex].text }], source: oldSource }
        }, { start: oldSeq, end: oldSeq, sourceEventSeqs: [oldSeq] })
      } catch (error) {
        if (sessionPatch?.status === 'failed') throw new Error(sessionPatch.reason, { cause: error })
        if (sessionPatch?.serverReady) throw error
        throw new Error('当前 DSH 不支持正文替换，未启动重新生成。' + str(error?.message || error), { cause: error })
      }
      replacementVerified.add(session)
    }

    // Stop settlement before the immutable source snapshot. No story row is
    // removed here; after this point failure only releases the native candidate.
    if (activeRound !== undefined && typeof cancelSettlement === 'function') await cancelSettlement(chat.id)
    chat = await readChat(chat.id)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    chat.sessionId = effectiveSessionId
    if (agent.phase?.kind === 'running' || chat.regenInProgress) throw new Error('前台正在生成，请完成或停止后再重新生成')
    if (failedTail) {
      // The unanswered input is the round's start point: it must still be the
      // tail of the save, and no story row may have changed around it.
      if (!isDeepStrictEqual(chat.messages, msgs0)) throw new Error('重新生成前剧情已经变化，请刷新后重试')
    } else assertRegenerationSourceCurrent({ originalChat: { ...chat, messages: msgs0 }, currentChat: chat, assistantIndex: oldAssistantIndex, inputIndex })

    const inputRow = inputIndex >= 0 ? msgs0[inputIndex] : null
    const originalUserText = str(inputRow?.text).trim()
    const originalChat = cloneChat(chat)
    const operationId = randomUUID()
    const guide = str(guidance).trim()
    // There is no body to revise on an unanswered tail, so guidance is only an
    // extra instruction on the same input.
    const syntheticText = regenerationInputText(originalUserText, guide, failedTail ? '' : replyTextOf(msgs0[oldAssistantIndex]))
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    const candidateTurn = beforeLastTurn + 1
    const candidateFrame = await candidateRegenerationFrame(originalChat, operationId, candidateTurn, syntheticText, prepareRegenerationFrame)
    const targetMessageUid = failedTail ? '' : legacyMessageUid(msgs0[oldAssistantIndex], oldAssistantIndex)
    let legacyBefore = null
    if (!failedTail && storyTimeline.inspect({ chat: originalChat }).checkpointCount === 0) {
      let rollbackCommit = null
      if (originalChat.nativeCommits !== null && typeof originalChat.nativeCommits === 'object') {
        rollbackCommit = commitOfRound(originalChat.nativeCommits, msgs0[oldAssistantIndex], originalUserText)
      }
      const before = rollbackCommit && rollbackCommit.before && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : {}
      legacyBefore = {
        messages: msgs0.slice(0, inputIndex >= 0 ? inputIndex : oldAssistantIndex), posture: str(before.posture), ledger: before.ledger || null, scriptState: originalChat.scriptState,
        candidates: null, settleStatus: 'idle', settleError: null, lastSettle: null,
        preparedWorldBookContext: str(before.preparedWorldBookContext),
        preparedWorldBook: before.preparedWorldBook || null,
        participants: {}
      }
      if ((originalChat.mode || 'story') === 'script') {
        const script = await readScript(originalChat.cardPath)
        if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法重新生成正文')
        const revision = before.scriptRevision && typeof before.scriptRevision === 'object' ? before.scriptRevision : null
        const reference = rollbackCommit && rollbackCommit.scriptReference && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
        legacyBefore.scriptState = scriptContinuity.transition({ script, state: originalChat.scriptState, event: { kind: 'restore', revision, reference } }).state
      }
    }
    const rollbackIntent = failedTail ? null : await prepareRollbackIntent(originalChat, { kind: 'turn.rollback', turn: oldTurn, legacyBefore })
    // The unanswered input never became a round, so this round starts from the
    // state the generation begins on: that revision is the rollback baseline.
    const roundBaselineRevision = Number(originalChat._storageRevision || 0)
    // Greeting rows carry turn 1 without being a round: number the new round
    // above every stored turn so the row never shares a turn with history.
    const storyTurn = failedTail ? Math.max(0, ...msgs0.map(message => Number(message?.turn) || 0)) + 1 : oldTurn
    // The native row whose body this attempt will rewrite: the page takes the old
    // reply away while the request runs and brings it back (with the new text) when
    // the commit lands. Hiding by the story turn would miss it whenever the two
    // numberings differ.
    const replacingTurn = appending ? null : surfaceTurnOfSeq(sessionEvents(session), oldSeq)
    const lifecycleRevision = Math.max(0, Number(originalChat.tavernHelperLifecycleRevision) || 0) + 1
    let marked = false, committed = false
    await updateChat(chat.id, function (current) {
      if (agent.phase?.kind === 'running' || current.regenInProgress) throw new Error('前台正在生成，请完成或停止后再重新生成')
      if (!failedTail) assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: oldAssistantIndex, inputIndex })
      if (!isDeepStrictEqual(current.messages, originalChat.messages) || !isDeepStrictEqual(current.timeline, originalChat.timeline)) {
        throw new Error('重新生成前剧情已经变化，请刷新后重试')
      }
      current.regenRecovery = { id: operationId, phase: 'prepared', detached: true,
        beforeRevision: Number(current._storageRevision || 0), sessionId: effectiveSessionId,
        eventStart, candidateTurn, candidateFrame, targetMessageUid, temporaryReplacingTurn: replacingTurn,
        ...(failedTail ? { unansweredTail: true, storyTurn } : {}) }
      current.regenInProgress = true
      current.tavernHelperLifecycleRevision = lifecycleRevision
      return current
    }, { source: 'foreground.regen-begin', worldSelection: { preserveDetachedWorld: true } })
    marked = true

    let committedChat, body = '', syntheticTurn = candidateTurn, keptStreamed = false
    try {
      releaseOpeningTurn(agent.session, agent)
      const ready = await readChat(chat.id)
      if (ready?.regenRecovery?.id !== operationId || agent.phase?.kind === 'running') throw new Error('重新生成操作已失效或前台正在生成')
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: projectPlayerContent(inputRow?.inputAttachments, syntheticText),
        source: { kind: 'plugin:dsh-tavern-regen', regenerationId: operationId }
      })
      let generationError = null
      try { await agent.whenIdle() } catch (error) { generationError = error }
      const ownStart = sessionEvents(session).slice(eventStart).find(event => event?.type === 'turn/start')
      if (ownStart) syntheticTurn = Number(ownStart.data?.turn) || syntheticTurn
      else if (Number.isFinite(Number(agent.phase?.lastTurn))) syntheticTurn = Number(agent.phase.lastTurn)
      body = streamedAttemptText(session, syntheticTurn, eventStart).trim()
      if (body === '') {
        if (generationError !== null) throw generationError
        throw new Error('这次重新生成没有完成（可能被内容审核拦截或已停止），正文保持原样，可以再试一次。' + FOREGROUND_TOOL_HINT)
      }
      keptStreamed = generationError !== null
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      const storedCandidate = await readChat(chat.id)
      const nativeCandidateRow = storedCandidate?.messages?.at(-1)?.role === 'assistant' &&
        Number(storedCandidate.messages.at(-1).turn) === Number(syntheticTurn) ? storedCandidate.messages.at(-1) : null

      // The checkpoint rollback exists only on this detached draft. It becomes
      // visible together with the validated replacement in one commit below.
      let draft = failedTail ? structuredClone(originalChat)
        : storyTimeline.apply({ chat: structuredClone(originalChat), intent: rollbackIntent }).chat
      const inputState = candidateFrame.source?.regenerationState
      if (inputState?.version === 1) {
        for (const key of INPUT_STATE_FIELDS) {
          if (Object.hasOwn(inputState, key)) draft[key] = structuredClone(inputState[key])
          else delete draft[key]
        }
        consumeScriptPrompts(draft)
        delete draft.ledgerInjection
      }
      const projectedReply = typeof prepareRegenerationReply === 'function'
        ? await prepareRegenerationReply({ chat: draft, card, turn: storyTurn, text: body }) : null
      const prose = projectedReply ? replyProse(projectedReply.sourceText ?? body, projectedReply) : plainReplyProse(body)
      if (!str(prose.text).trim()) throw new Error('重新生成失败：模型返回空文本')
      const originalUser = inputRow ? structuredClone(originalChat.messages[inputIndex]) : null
      const beforeMessages = rollbackIntent?.beforeChat?.messages || legacyBefore?.messages || []
      const previousVariables = lastTavernHelperVariables(originalUser ? [originalUser] : []) ?? lastTavernHelperVariables(beforeMessages)
      const oldRow = oldAssistantIndex >= 0 ? originalChat.messages[oldAssistantIndex] : null
      const row = { role: 'assistant', ...prose, native: true, turn: storyTurn, ts: Date.now(), swipeId: 0,
        bodyRegenerationProcessed: true, swipes: [prose.projectionText],
        ...(oldRow?.nativeAnchor ? { nativeAnchor: structuredClone(oldRow.nativeAnchor) } : {}),
        ...(keptStreamed ? { incomplete: true, incompleteReason: '这次重新生成被中断，保留了已生成的部分正文' } : {}) }
      const candidateVariables = Array.isArray(nativeCandidateRow?.variables) ? nativeCandidateRow.variables[0] : previousVariables
      if (candidateVariables !== undefined) row.variables = [structuredClone(candidateVariables)]
      if (draft.mvu?.enabled && draft.mvu.owner === 'official') {
        row.variables = [structuredClone(candidateVariables || {})]
        row.mvu = { pending: true, modified: false, diagnostics: [], events: [] }
      }
      if ((draft.mode || 'story') === 'script') {
        const script = await readScript(draft.cardPath)
        if (!script) throw new Error('剧本文件不可读取')
        draft.scriptState = scriptContinuity.transition({ script, state: draft.scriptState,
          event: { kind: 'commit', userText: str(originalUser?.text), nativeTurn: storyTurn } }).state
      }
      const begun = storyTimeline.apply({ chat: draft, intent: { kind: 'body.begin', turn: storyTurn, userText: str(originalUser?.text) } })
      draft = begun.chat
      const bodyOperation = draft.timeline.operations[begun.value.operationId]
      const checkpoint = !failedTail && storyTimeline.inspect({ chat: originalChat }).checkpointCount ? originalChat.timeline?.checkpoints?.at(-1) : null
      const oldOperation = Object.values(originalChat.timeline?.operations || {}).find(operation =>
        operation?.kind === 'body' && Number(operation.turn) === Number(oldTurn))
      bodyOperation.beforeRevision = failedTail ? roundBaselineRevision : (checkpoint?.beforeRevision ?? oldOperation?.beforeRevision ?? 0)
      bodyOperation.beforeParticipants = failedTail ? structuredClone(originalChat.timeline?.participants || {})
        : structuredClone(checkpoint?.participants || oldOperation?.beforeParticipants || rollbackIntent?.beforeChat?.timeline?.participants || {})
      draft.foregroundFrames = { ...draft.foregroundFrames, [bodyOperation.id]: { ...cloneFrame(candidateFrame),
        frameId: 'foreground:' + chat.id + ':' + draft.timeline.branchId + ':' + bodyOperation.id,
        operationId: bodyOperation.id, branchId: draft.timeline.branchId,
        basedOnRevision: bodyOperation.basedOn.revision, turn: storyTurn } }
      // An unanswered tail already holds the player's row: the round adds the
      // reply it never produced, and nothing is replaced or replayed.
      const merged = failedTail ? { chat: { ...draft, messages: [...structuredClone(originalChat.messages), row] } }
        : replaceLastRound({ originalChat, regeneratedChat: draft, replacement: row, assistantIndex: oldAssistantIndex, inputIndex })
      const completed = storyTimeline.complete({ chat: merged.chat, operationId: bodyOperation.id, basedOn: bodyOperation.basedOn,
        outcome: { status: 'success' }, apply(current) {
          delete current.promptTemplateInput
          current.settleStatus = 'pending'
          current.settleError = null
          current.lastSettle = null
          current.foregroundError = null
          current.presentationWarnings = structuredClone(prose.projectionWarnings || [])
        } })
      if (completed.value.status !== 'committed') throw new Error('正文提交条件已失效')
      const next = completed.chat
      next.nativeCommits = originalChat.nativeCommits && typeof originalChat.nativeCommits === 'object' ? structuredClone(originalChat.nativeCommits) : {}
      if (saveOnly) {
        // 这一轮在模型视野里本来就缺正文，新正文由这次尝试自己补上：它不是被替换掉的
        // 旧回复，不能隐藏，也不能往前映射。只记剧情轮号到新宿主轮号的对应即可。
        next.suppressedDshTurns = Array.isArray(originalChat.suppressedDshTurns) ? [...originalChat.suppressedDshTurns] : []
        next.regeneratedDshTurns = originalChat.regeneratedDshTurns && typeof originalChat.regeneratedDshTurns === 'object' && !Array.isArray(originalChat.regeneratedDshTurns)
          ? structuredClone(originalChat.regeneratedDshTurns) : {}
        next.regeneratedDshTurns[String(oldTurn)] = syntheticTurn
      } else if (failedTail) {
        // Nothing native was replaced: the attempt's own reply is the body, so no
        // turn is hidden and no earlier body is remapped.
        next.suppressedDshTurns = Array.isArray(originalChat.suppressedDshTurns) ? [...originalChat.suppressedDshTurns] : []
        next.regeneratedDshTurns = originalChat.regeneratedDshTurns && typeof originalChat.regeneratedDshTurns === 'object' && !Array.isArray(originalChat.regeneratedDshTurns)
          ? structuredClone(originalChat.regeneratedDshTurns) : {}
      } else {
        delete next.nativeCommits[String(syntheticTurn)]
        next.suppressedDshTurns = Array.from(new Set((Array.isArray(originalChat.suppressedDshTurns) ? originalChat.suppressedDshTurns : []).concat([syntheticTurn]))).sort((left, right) => left - right)
        next.regeneratedDshTurns = originalChat.regeneratedDshTurns && typeof originalChat.regeneratedDshTurns === 'object' && !Array.isArray(originalChat.regeneratedDshTurns)
          ? structuredClone(originalChat.regeneratedDshTurns) : {}
        next.regeneratedDshTurns[String(oldTurn)] = syntheticTurn
      }
      // A replacement rewrites the old reply in place; the answered tail only has
      // to record where its reply already landed.
      const projection = appending
        ? { kind: 'append-round', storyTurn, native: attemptNativeAnchor(session, eventStart, syntheticTurn) }
        : placeRegeneration(session, oldSeq, eventStart, { turn: storyTurn, step: 1,
          message: { id: 'tavern-regen:' + operationId, role: 'assistant', content: [{ type: 'text', text: prose.text }],
            source: { ...oldSource, tavernStoryTurn: storyTurn } } }, operationId)

      committedChat = await updateChat(chat.id, function (current) {
        if (failedTail) assertUnansweredTailCurrent(originalChat, current, operationId, syntheticTurn)
        else assertCandidateStoryCurrent(originalChat, current, oldAssistantIndex, inputIndex, operationId, syntheticTurn)
        if (agent.phase?.kind === 'running') throw new Error('前台已开始新一轮，本次候选已作废')
        for (const key of ['messages', 'timeline', 'foregroundFrames', ...INPUT_STATE_FIELDS, 'tavernPluginMetadata', 'posture', 'ledger', 'candidates',
          'settleStatus', 'settleError', 'lastSettle', 'foregroundError', 'presentationWarnings', 'candidateAgent',
          'nativeCommits', 'suppressedDshTurns', 'regeneratedDshTurns']) {
          if (Object.hasOwn(next, key)) current[key] = structuredClone(next[key])
          else delete current[key]
        }
        current.regenInProgress = true
        current.regenRecovery = { ...current.regenRecovery, phase: 'committed', projection }
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        return current
      }, { source: 'foreground.regen-commit', worldSelection: { preserveDetachedWorld: true } })
      committed = true
      const bodyIndex = failedTail ? (committedChat.messages?.length || 1) - 1 : oldAssistantIndex
      body = str(committedChat.messages?.[bodyIndex]?.text || prose.text).trim()
    } catch (error) {
      if (marked && !committed) await regenerationRecovery.abort({ chatId: chat.id, originalChat, session, eventStart, operationId })
      throw error
    }
    committedChat = await regenerationRecovery.complete({ chatId: chat.id, session, operationId }) || committedChat
    replyCommitted?.(committedChat.sessionId)
    // The body is already the save's truth; settlement is a background task. Waiting
    // for it unbounded held the whole response open, so the page sat on
    // 「正在重新生成正文…」 long after the reply was written and the replacement's
    // view never reached the transcript. A failed or slow settlement must not keep
    // the new body off the page: report what has been committed, and let the
    // settlement's own state (settleStatus / activity) arrive through the save.
    let settledChat = committedChat
    const settlement = Promise.resolve(queueSettlement(committedChat.id))
    try {
      const finished = await Promise.race([
        settlement.then(() => true),
        new Promise(function (resolve) { setTimeout(finished => resolve(finished), REGEN_SETTLEMENT_WAIT_MS, false) })
      ])
      if (finished) settledChat = await readChat(committedChat.id) || committedChat
      else void settlement.catch(async error => {
        const message = str(error?.message || error) || '后台结算失败'
        try {
          await updateChat(committedChat.id, function (current) {
            if (!current || typeof current !== 'object') return current
            current.settleStatus = 'failed'
            current.settleError = message
            return current
          }, { source: 'settlement.regen-failed' })
        } catch (failure) { console.warn('dsh-tavern: 重新生成结算失败状态未保存', str(failure?.message || failure)) }
      })
    } catch (error) {
      const message = str(error?.message || error) || '后台结算失败'
      settledChat = await updateChat(committedChat.id, function (current) {
        if (!current || typeof current !== 'object') return current
        current.settleStatus = 'failed'
        current.settleError = message
        return current
      }, { source: 'settlement.regen-failed' })
    }
    const result = await view(settledChat, card)
    result.adopted = { text: body, guidance: guide, hiddenTurn: failedTail ? storyTurn : oldTurn, syntheticTurn }
    if (keptStreamed) result.regenerationWarning = '这次重新生成没有完成（可能被内容审核拦截或已停止），已保留生成到的部分正文。' + FOREGROUND_TOOL_HINT
    return result
  }

  // The former bounded path rolled back a checkpoint before generation and
  // restored later floors on failure. Both full and scoped saves now share the
  // candidate-first transaction: story rows stay authoritative until one commit.
  async function regenRecent(chatId, guidance, sessionId) {
    return await regenBody(chatId, guidance, sessionId)
  }

  // ---------- 回退本轮（删除最近一次用户输入 + LLM 输出） ----------
  function latestStoryRow(chat) {
    return (chat.messages || []).findLast(m => m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true)
  }
  function latestStoryTurn(chat) { return Number(latestStoryRow(chat)?.turn) || 0 }
  function hasRollbackRound(chat) {
    const msgs = chat.messages || []
    const index = msgs.findLastIndex(m => m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true)
    return index > 0 && msgs[index - 1]?.role === 'user'
  }
  // The native target is the save's latest round (directly or as its regenerated turn).
  // 投影/修复写回的正文会带着别的剧情轮号，轮号对不上就改按正文认。
  function surfaceShowsLatest(chat, availability, events) {
    const target = availability.target
    if (!target) return false
    const turn = latestStoryTurn(chat)
    if (!(turn > 0) || target.turn === turn || target.turn === Number(chat.regeneratedDshTurns?.[String(turn)])) return true
    return anchoredToSaveRow(target, latestStoryRow(chat))
  }

  async function rollbackTurn(sessionId, chatId, expectedTurn) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    // Identity and task flags only; rollbackChat reads the story it changes.
    const chat = str(chatId) === '' ? await (chats.stateForSession || chatForSession)(sessionId) : await (chats.readState || readChat)(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    await settleStaleRegeneration(chat)
    if (pendingRollbacks.has(chat.id)) throw new Error('正在回退本轮，请等待完成')
    pendingRollbacks.add(chat.id)
    let restoredHandle
    try {
      if (!sessions.get(chat.sessionId)?.session && !sessions.getSession?.(chat.sessionId) && typeof sessions.resume === 'function') {
        restoredHandle = await sessions.resume(chat.sessionId)
      }
      return await rollbackChat(chat, expectedTurn, restoredHandle?.agent)
    } finally {
      try { await restoredHandle?.dispose?.() }
      finally { pendingRollbacks.delete(chat.id) }
    }
  }

  // 回退到某一轮：逐轮执行与「回退本轮」相同的回退，直到该轮成为最新一轮。
  // 中途无法继续（如更早的轮次已被上下文压缩）时保留已退回的轮次并提示用分叉。
  // 一次撤销恢复全部轮次：撤销点取第一步的回退前状态与最后一步的回退后状态。
  // ---------- 打断本轮（舞台的「停止」）：停止前台生成，正文未提交时撤回本轮输入 ----------
  // A stopped reply never committed, so it is a failed tail: the rollback's own clearing hides its residue and hands
  // the input back; Story Timeline, checkpoints and the previous round's candidates stay. A body that committed before
  // the stop took effect is a Round, and an interruption never undoes a Round: the result then says `withdrawn: false`.
  async function interruptTurn(sessionId, chatId) {
    const chat = str(chatId) === '' ? await (chats.stateForSession || chatForSession)(sessionId) : await (chats.readState || readChat)(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    // A regeneration in flight only has its run stopped; it restores the original round itself.
    if (pendingRegenerations.has(chat.id) || chat.regenInProgress) {
      await stopRollbackGeneration(chat)
      const latest = await readChat(chat.id)
      return Object.assign(await view(latest, await readChatCard(latest)), { withdrawn: false })
    }
    if (pendingRollbacks.has(chat.id)) throw new Error('正在回退本轮，请等待完成')
    pendingRollbacks.add(chat.id)
    try {
      await stopRollbackGeneration(chat)
      const latest = await readChat(chat.id)
      const session = sessions.get(latest.sessionId)?.session || sessions.getSession?.(latest.sessionId)
      const failed = session ? rollbackAvailability(latest, { events: sessionEvents(session), nodes: session.surface?.nodes || [] }).failedTurns : []
      if (!failed.length) return Object.assign(await view(latest, await readChatCard(latest)), { withdrawn: false })
      return Object.assign(await rollbackChat(latest, null), { withdrawn: true })
    } finally {
      pendingRollbacks.delete(chat.id)
    }
  }

  // A marker no live regeneration owns is a leftover: recovery always ends it, so
  // it can never keep rollback away. Only a regeneration still running refuses.
  async function settleStaleRegeneration(chat) {
    if (pendingRegenerations.has(chat.id)) throw new Error('正文正在重新生成，请先完成恢复或生成')
    if (!chat.regenInProgress) return
    await regenerationRecovery.recover(chat.id)
    const state = chats.readState ? await chats.readState(chat.id) : await readChat(chat.id)
    if (state?.regenInProgress) throw new Error('正文正在重新生成，请先完成恢复或生成')
  }

  async function rollbackToTurn(sessionId, chatId, targetTurn) {
    const target = Number(targetTurn)
    if (!Number.isSafeInteger(target) || target < 1) throw new Error('回退目标轮次无效')
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    const state = str(chatId) === '' ? await (chats.stateForSession || chatForSession)(sessionId) : await (chats.readState || readChat)(chatId)
    if (state === undefined) throw new Error('聊天不存在: ' + chatId)
    await settleStaleRegeneration(state)
    if (pendingRollbacks.has(state.id)) throw new Error('正在回退本轮，请等待完成')
    pendingRollbacks.add(state.id)
    let restoredHandle
    try {
      if (!sessions.get(state.sessionId)?.session && !sessions.getSession?.(state.sessionId) && typeof sessions.resume === 'function') {
        restoredHandle = await sessions.resume(state.sessionId)
      }
      const recent = async () => chats.readRecent ? await chats.readRecent(state.id) : await readChat(state.id)
      const latestOf = async () => latestStoryTurn(await recent())
      let latest = await latestOf()
      if (!(latest > target)) throw new Error('第 ' + target + ' 轮已经是最新一轮')
      let result, first, removed = 0, stopped = ''
      while (latest > target) {
        try { result = await rollbackChat(state, null, restoredHandle?.agent) }
        catch (error) { if (!removed) throw error; stopped = str(error?.message || error); break }
        const next = await latestOf()
        if (!result.clearedIncompleteTurns && !(next < latest)) { stopped = '回退没有前进'; break }
        if (result.rolledBack) removed += 1
        first ||= (await recent())?.rollbackUndo
        latest = next
      }
      if (removed > 1 && first) result = await mergeRollbackUndo(state.id, first, recent) || result
      if (stopped) result.rollbackWarning = [result.rollbackWarning, '已回退 ' + removed + ' 轮，停在第 ' + latest + ' 轮：更早的轮次已不在模型上下文中，不能原地回退（' + stopped + '）。想回到第 ' + target + ' 轮，请在那一轮的消息上点「从这一轮分叉」。'].filter(Boolean).join('；')
      result.rolledBackTo = { target, latest, removed }
      return result
    } finally {
      try { await restoredHandle?.dispose?.() }
      finally { pendingRollbacks.delete(state.id) }
    }
  }

  // The last step's undo point, widened to the state before the first step.
  async function mergeRollbackUndo(chatId, first, recent) {
    const chat = await recent()
    const last = chat?.rollbackUndo
    if (!first?.ready || !last?.ready) return undefined
    const background = new Map()
    for (const checkpoint of [...first.background, ...last.background]) {
      const earlier = background.get(checkpoint.sessionId)
      background.set(checkpoint.sessionId, earlier ? { ...earlier, afterCount: checkpoint.afterCount } : checkpoint)
    }
    const merged = { ...last, turn: first.turn, beforeRevision: first.beforeRevision,
      foreground: { ...last.foreground, nodes: first.foreground.nodes }, background: [...background.values()] }
    if (first.before) merged.before = first.before
    else delete merged.before
    const revision = Number(chat._storageRevision || 0)
    const head = typeof chats.patch === 'function'
      ? await chats.patch(chatId, revision, [{ op: 'set', path: ['rollbackUndo'], value: { ...merged, storageRevision: revision + 1 } }], { source: 'rollback.undo-point' })
      : undefined
    const saved = head ? { ...chat, ...head, messages: chat.messages } : await updateChat(chatId, current => {
      if (!isDeepStrictEqual(current.rollbackUndo, last)) return current
      current.rollbackUndo = { ...merged, storageRevision: Number(current._storageRevision || 0) + 1 }
      return current
    }, { source: 'rollback.undo-point' })
    return await view(saved, await readChatCard(saved))
  }

  async function rollbackChat(chat, requestedTurn, restoredAgent) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    await stopRollbackGeneration(chat)
    const bounded = await rollbackRecent(chat, requestedTurn, restoredAgent)
    if (bounded !== undefined) return bounded
    chat = await readChat(chat.id)
    const originalChat = cloneChat(chat)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agent = sessions.get(chat.sessionId) || (restoredAgent?.session?.id === chat.sessionId ? restoredAgent : undefined)
    const session = agent?.session || sessions.getSession?.(chat.sessionId)
    if (!session) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    let availability = rollbackAvailability(chat, { events: sessionEvents(session), nodes: session.surface?.nodes || [] })
    const events = sessionEvents(session)
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const failedTurns = availability.failedTurns
    if (failedTurns.length) {
      for (const turn of availability.unclearedTurns) clearFailedTurnSurface({ session, turn })
      chat = await updateChat(chat.id, current => {
        // Clearing only hides uncommitted residue. The failed turn's own deferred
        // bookkeeping may still be landing in the timeline; only story text must hold.
        assertRollbackSnapshot(rollbackBodyMessages(current), rollbackBodyMessages(originalChat))
        const next = { ...current, suppressedDshTurns: [...new Set([...(current.suppressedDshTurns || []), ...failedTurns])].sort((a, b) => a - b), updatedAt: Date.now() }
        if (current.userInputEdits && typeof current.userInputEdits === 'object' && !Array.isArray(current.userInputEdits)) {
          const edits = { ...current.userInputEdits }
          let changed = false
          for (const turn of failedTurns) if (Object.hasOwn(edits, String(turn))) { delete edits[String(turn)]; changed = true }
          if (changed) next.userInputEdits = edits
        }
        return next
      }, { source: 'rollback.interrupted' })
      const result = await view(chat, card)
      result.clearedIncompleteTurns = failedTurns
      // The failed input never reached the story; hand it back so the player can edit and resend it.
      // A failed-turn edit is stored as a Chat overlay; return that text when present.
      const tail = replayableFailedTurn({ events })
      if (tail && failedTurns.includes(tail.turn)) result.clearedInput = chat.userInputEdits && typeof chat.userInputEdits === 'object'
        && chat.userInputEdits[String(tail.turn)] && typeof chat.userInputEdits[String(tail.turn)].text === 'string'
        ? chat.userInputEdits[String(tail.turn)].text : tail.userText
      return result
    }
    if (!hasRollbackRound(chat)) throw new Error(availability.reason || '当前没有可回退的已提交轮次')
    // The native surface must still show the round: nothing is rewritten to make it.
    const rollbackSurface = surfaceShowsLatest(chat, availability, events) ? availability.target : null
    if (rollbackSurface === null) throw new Error(availability.target ? '该轮已不在当前模型上下文中，不能直接回退；历史正文仍可通过 history_recall 检索' : availability.reason)
    const hiddenTurn = rollbackSurface ? rollbackSurface.turn : latestStoryTurn(chat)
    const shadowedSeqs = rollbackSurface ? rollbackSurface.shadowedSeqs : []
    const regeneratedDshTurns = originalChat.regeneratedDshTurns && typeof originalChat.regeneratedDshTurns === 'object' && !Array.isArray(originalChat.regeneratedDshTurns)
      ? originalChat.regeneratedDshTurns : {}
    const regeneratedVisibleTurn = Number(regeneratedDshTurns[String(hiddenTurn)])

    // 1) 定位要回退的最后一组 user + assistant
    const msgs = chat.messages || []
    let assistantIndex = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        assistantIndex = i
        break
      }
    }
    if (assistantIndex < 0 || assistantIndex - 1 < 0) throw new Error('没有可回退的用户输入与正文组合')
    if (msgs[assistantIndex - 1] === null || typeof msgs[assistantIndex - 1] !== 'object' || msgs[assistantIndex - 1].role !== 'user') throw new Error('最后一组消息不是用户输入 + 正文')
    const expectedTurn = Number(msgs[assistantIndex].turn)
    if (Number(requestedTurn) > 0 && Number(requestedTurn) !== expectedTurn) throw new Error('回退目标已经变化，请刷新后确认实际轮次')
    const removedUserText = str(msgs[assistantIndex - 1].text).trim()
    const removedAssistantText = str(msgs[assistantIndex].text).trim()
    // 2) 旧对话从 native commit 生成一次性迁移 checkpoint；新对话直接使用权威 checkpoint
    let rollbackCommit = null
    let rollbackCommitKey = ''
    if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
      rollbackCommitKey = commitKeyOfRound(chat.nativeCommits, msgs[assistantIndex], removedUserText)
      rollbackCommit = rollbackCommitKey ? chat.nativeCommits[rollbackCommitKey] : null
    }
    const before = rollbackCommit !== null && rollbackCommit.before !== null && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : null
    const legacyBefore = {
      messages: msgs.slice(0, assistantIndex - 1),
      posture: before !== null && typeof before.posture === 'string' ? before.posture : '',
      ledger: before?.ledger || null,
      scriptState: chat.scriptState,
      candidates: null,
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      participants: {}
    }
    if (mode === 'script' && storyTimeline.inspect({ chat }).checkpointCount === 0) {
      const script = await readScript(chat.cardPath)
      if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法回退剧本状态')
      const revision = before !== null && before.scriptRevision !== null && typeof before.scriptRevision === 'object'
        ? before.scriptRevision
        : (before !== null && before.scriptState !== null && typeof before.scriptState === 'object' ? before.scriptState : null)
      const reference = rollbackCommit !== null && rollbackCommit.scriptReference !== null && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
      legacyBefore.scriptState = scriptContinuity.transition({ script: script, state: chat.scriptState, event: { kind: 'restore', revision: revision, reference: reference } }).state
    }
    let rollbackWarning = ''
    let rollbackIntent
    try {
      rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: hiddenTurn, legacyBefore })
    } catch (error) {
      rollbackWarning = '正文已回退，后台历史快照不可用，保留当前状态：' + str(error?.message || error)
      rollbackIntent = { kind: 'turn.rollback', turn: hiddenTurn, legacyBefore: { ...chat, messages: msgs.slice(0, assistantIndex - 1), candidates: null, settleStatus: 'idle', settleError: null }, allowMissingHistory: true }
    }
    await stopRollbackGeneration(chat)
    if (typeof cancelSettlement === 'function') {
      try { await cancelSettlement(chat.id, { wait: false }) }
      catch (error) { rollbackWarning = '正文已回退，后台停止请求失败：' + str(error?.message || error) }
    }
    for (const participant of Object.values(storyTimeline.inspect({ chat }).participants || {})) {
      const worker = sessions.get(participant.sessionId)
      if (worker && worker !== agent && typeof worker.cancel === 'function') {
        try { worker.cancel({ kind: 'parent' }) } catch { /* Old results are rejected by the new branch. */ }
      }
    }
    const undo = {
      version: 1, id: randomUUID(), ready: false, turn: expectedTurn || hiddenTurn,
      beforeRevision: Number(originalChat._storageRevision || 0),
      ...(Number(originalChat._storageRevision || 0) ? {} : { before: structuredClone(originalChat) }),
      foreground: { formatVersion: 4, sessionId: session.id || chat.sessionId, nodes: [...nodes] }, background: []
    }
    if (undo.before) delete undo.before.rollbackUndo
    const rolled = storyTimeline.apply({ chat, intent: rollbackIntent })
    chat = rolled.chat
    chat.rollbackUndo = undo
    chat.regenInProgress = false
    delete chat.regenRecovery
    if (rollbackCommitKey !== '') delete chat.nativeCommits[rollbackCommitKey]
    chat.tavernHelperLifecycleRevision = Math.max(0, Number(chat.tavernHelperLifecycleRevision) || 0) + 1
    chat.suppressedDshTurns = Array.from(new Set((Array.isArray(chat.suppressedDshTurns) ? chat.suppressedDshTurns : []).concat(
      [hiddenTurn], Number.isSafeInteger(regeneratedVisibleTurn) && regeneratedVisibleTurn > 0 ? [regeneratedVisibleTurn] : []))).sort(function (left, right) { return left - right })
    chat.regeneratedDshTurns = chat.regeneratedDshTurns && typeof chat.regeneratedDshTurns === 'object' && !Array.isArray(chat.regeneratedDshTurns)
      ? structuredClone(chat.regeneratedDshTurns) : {}
    delete chat.regeneratedDshTurns[String(hiddenTurn)]
    // 写入方有两种口径（剧情轮号 / 原生轮号）；删的时候两种都清，免得留下过期映射把别的轮认成本轮。
    for (const [key, value] of Object.entries(chat.regeneratedDshTurns)) {
      if (Number(value) === Number(hiddenTurn)) delete chat.regeneratedDshTurns[key]
    }
    chat.updatedAt = Date.now()
    chat = await updateChat(chat.id, current => {
      if (!isDeepStrictEqual(rollbackBodyMessages(current), rollbackBodyMessages(originalChat)) || current.timeline?.branchId !== originalChat.timeline?.branchId) throw new Error('回退期间正文已被其他操作修改，请刷新后重试')
      return chat
    }, { source: 'rollback' })
    return await finishRollback({ chat, card, agent, session, rollbackSurface, shadowedSeqs, undo, rollbackWarning, hiddenTurn, removedUserText, removedAssistantText,
      messageCount: (chat.messages || []).length, dispatchChat: chat,
      abort: () => updateChat(chat.id, current => {
        assertRollbackSnapshot(current, chat)
        return storyTimeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: originalChat } }).chat
      }, { source: 'rollback.abort' }),
      saveUndoPoint: () => updateChat(chat.id, current => {
        if (current.timeline?.branchId !== chat.timeline?.branchId || current.timeline?.revision !== chat.timeline?.revision) return current
        current.rollbackUndo = { ...undo, ready: true, branchId: current.timeline.branchId, revision: current.timeline.revision,
          lifecycleRevision: Number(current.tavernHelperLifecycleRevision || 0),
          storageRevision: Number(current._storageRevision || 0) + 1,
          foreground: { ...undo.foreground, afterCount: sessionEvents(session).length } }
        return current
      }, { source: 'rollback.undo-point' }) })
  }

  // Native saves roll back the latest round from their recent floors: the floors
  // changed since the checkpoint are restored as they were then and the floors
  // added after it are dropped, in one revision-checked patch. Undefined hands the
  // decision to the complete path before any visible effect: failed turns, legacy
  // checkpoints, unreadable revisions or change records, or a moved revision.
  async function rollbackRecent(reference, requestedTurn, restoredAgent) {
    if (![chats.readRecent, chats.patch, chats.changedSince, chats.rowsAt].every(fn => typeof fn === 'function')) return undefined
    const chat = await chats.readRecent(reference.id)
    if (!chat || !isScopedMessages(chat.messages) || !['story', 'script'].includes(chat.mode || 'story')) return undefined
    const agent = sessions.get(chat.sessionId) || (restoredAgent?.session?.id === chat.sessionId ? restoredAgent : undefined)
    const session = agent?.session || sessions.getSession?.(chat.sessionId)
    if (!session) return undefined
    const events = sessionEvents(session)
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const availability = rollbackAvailability(chat, { events, nodes })
    if (availability.failedTurns.length || availability.target === null) return undefined
    const { messages: msgs, ...header } = chat
    const target = storyTimeline.rollbackTarget({ chat: { ...header, messages: [] } })
    if (target === null) return undefined
    const rollbackSurface = availability.target
    const hiddenTurn = rollbackSurface.turn
    const regeneratedDshTurns = header.regeneratedDshTurns && typeof header.regeneratedDshTurns === 'object' && !Array.isArray(header.regeneratedDshTurns) ? header.regeneratedDshTurns : {}
    const regeneratedVisibleTurn = Number(regeneratedDshTurns[String(hiddenTurn)])
    const assistantIndex = msgs.findLastIndex(m => m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true)
    const user = assistantIndex > 0 ? msgs[assistantIndex - 1] : undefined
    if (assistantIndex < 0 || !Object.hasOwn(msgs, String(assistantIndex - 1))) return undefined
    if (user === null || typeof user !== 'object' || user.role !== 'user') throw new Error('最后一组消息不是用户输入 + 正文')
    const expectedTurn = Number(msgs[assistantIndex].turn)
    if (Number(requestedTurn) > 0 && Number(requestedTurn) !== expectedTurn) throw new Error('回退目标已经变化，请刷新后确认实际轮次')
    // The complete path repairs a surface that shows another round. 正文相同就还是这一轮：
    // 投影/修复写回的条目可能带着别的剧情轮号。
    if (expectedTurn > 0 && hiddenTurn !== expectedTurn && hiddenTurn !== Number(regeneratedDshTurns[String(expectedTurn)])
      && !anchoredToSaveRow(rollbackSurface, msgs[assistantIndex])) return undefined
    const removedUserText = str(user.text).trim()
    const removedAssistantText = str(msgs[assistantIndex].text).trim()
    let rollbackCommitKey = ''
    if (header.nativeCommits !== null && typeof header.nativeCommits === 'object') {
      rollbackCommitKey = commitKeyOfRound(header.nativeCommits, msgs[assistantIndex], removedUserText)
    }
    // The checkpoint state: its header, its floor count, and the floors changed since.
    const revision = chat._storageRevision, count = msgs.length
    const changed = await chats.changedSince(chat.id, target.beforeRevision)
    if (!changed || changed.revision !== revision) return undefined
    const checkpointHead = await chats.rowsAt(chat.id, target.beforeRevision, [])
    if (!checkpointHead || checkpointHead.chat._storageRevision !== target.beforeRevision || checkpointHead.messageCount > count) return undefined
    const restoredCount = checkpointHead.messageCount
    const restoredIndices = changed.indices.filter(index => index < restoredCount)
    const restoredRows = restoredIndices.length ? await chats.rowsAt(chat.id, target.beforeRevision, restoredIndices) : { chat: checkpointHead.chat, denseMessages: true }
    if (!restoredRows?.denseMessages) return undefined
    const { messages: _checkpointRows, ...checkpointHeader } = checkpointHead.chat
    const card = await readChatCard(chat)
    let rollbackWarning = ''
    if (typeof cancelSettlement === 'function') {
      try { await cancelSettlement(chat.id, { wait: false }) }
      catch (error) { rollbackWarning = '正文已回退，后台停止请求失败：' + str(error?.message || error) }
    }
    for (const participant of Object.values(storyTimeline.inspect({ chat: header }).participants || {})) {
      const worker = sessions.get(participant.sessionId)
      if (worker && worker !== agent && typeof worker.cancel === 'function') {
        try { worker.cancel({ kind: 'parent' }) } catch { /* Old results are rejected by the new branch. */ }
      }
    }
    const undo = {
      version: 1, id: randomUUID(), ready: false, turn: expectedTurn || hiddenTurn, beforeRevision: revision,
      foreground: { formatVersion: 4, sessionId: session.id || chat.sessionId, nodes: [...nodes] }, background: []
    }
    const rolled = storyTimeline.apply({ chat: { ...header, messages: [] }, intent: { kind: 'turn.rollback', turn: hiddenTurn, beforeChat: { ...checkpointHeader, messages: [] } } }).chat
    rolled.rollbackUndo = undo
    rolled.regenInProgress = false
    delete rolled.regenRecovery
    if (rollbackCommitKey !== '') delete rolled.nativeCommits[rollbackCommitKey]
    rolled.tavernHelperLifecycleRevision = Math.max(0, Number(rolled.tavernHelperLifecycleRevision) || 0) + 1
    rolled.suppressedDshTurns = Array.from(new Set((Array.isArray(rolled.suppressedDshTurns) ? rolled.suppressedDshTurns : []).concat(
      [hiddenTurn], Number.isSafeInteger(regeneratedVisibleTurn) && regeneratedVisibleTurn > 0 ? [regeneratedVisibleTurn] : []))).sort(function (left, right) { return left - right })
    rolled.regeneratedDshTurns = structuredClone(regeneratedDshTurns)
    delete rolled.regeneratedDshTurns[String(hiddenTurn)]
    const changes = diffJson({ ...header, messages: [] }, rolled).filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
    if (changes.some(change => change.path[0] === 'messages' || change.path[0] === 'id')) return undefined
    if (count > restoredCount) changes.push({ op: 'splice', path: ['messages'], index: restoredCount, deleteCount: count - restoredCount, items: [] })
    restoredIndices.forEach((index, offset) => changes.push({ op: 'set', path: ['messages', index], value: restoredRows.chat.messages[offset] }))
    const saved = await chats.patch(chat.id, revision, changes, { source: 'rollback' })
    if (!saved) return undefined
    // Header only: rows stay unread holes so presentation reads its own window.
    const committed = { ...rolled, _storageRevision: saved._storageRevision, updatedAt: saved.updatedAt, messages: createScopedMessages(restoredCount) }
    return await finishRollback({ chat: committed, card, agent, session, rollbackSurface, shadowedSeqs: rollbackSurface.shadowedSeqs, undo, rollbackWarning,
      hiddenTurn, removedUserText, removedAssistantText, messageCount: restoredCount, dispatchChat: undefined,
      abort: async () => {
        // Rare error path: restore the exact pre-rollback Chat as the complete path does.
        const original = await readChatRevision(chat.id, revision)
        await updateChat(chat.id, current => {
          if (current._storageRevision !== saved._storageRevision) throw new Error('回退期间聊天已被其他操作修改，请刷新后重试')
          return storyTimeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: original } }).chat
        }, { source: 'rollback.abort' })
      },
      saveUndoPoint: async () => {
        const point = { ...undo, ready: true, branchId: committed.timeline.branchId, revision: committed.timeline.revision,
          lifecycleRevision: Number(committed.tavernHelperLifecycleRevision || 0), storageRevision: saved._storageRevision + 1,
          foreground: { ...undo.foreground, afterCount: sessionEvents(session).length } }
        const head = await chats.patch(chat.id, saved._storageRevision, [{ op: 'set', path: ['rollbackUndo'], value: point }], { source: 'rollback.undo-point' })
        if (head) return { ...committed, ...head, messages: committed.messages }
        return updateChat(chat.id, current => {
          if (current.timeline?.branchId !== committed.timeline.branchId || current.timeline?.revision !== committed.timeline.revision) return current
          current.rollbackUndo = { ...point, storageRevision: Number(current._storageRevision || 0) + 1 }
          return current
        }, { source: 'rollback.undo-point' })
      } })
  }

  // The pre-rollback state for a bounded undo: its header, and the row changes
  // that bring the current floors back to it. Undefined reads everything instead.
  async function undoPoint(chat, saved) {
    const count = chat.messages.length
    const changed = await chats.changedSince(chat.id, saved.beforeRevision)
    if (!changed || changed.revision !== chat._storageRevision) return undefined
    const head = await chats.rowsAt(chat.id, saved.beforeRevision, [])
    if (!head || head.chat._storageRevision !== saved.beforeRevision || head.messageCount < count) return undefined
    const indices = [...new Set([...changed.indices.filter(index => index < count), ...Array.from({ length: head.messageCount - count }, (_, offset) => count + offset)])].sort((a, b) => a - b)
    const rows = indices.length ? await chats.rowsAt(chat.id, saved.beforeRevision, indices) : { chat: head.chat, denseMessages: true }
    if (!rows?.denseMessages) return undefined
    const changes = []
    const restoredRows = indices.map((index, offset) => [index, rows.chat.messages[offset]])
    for (const [index, row] of restoredRows) if (index < count) changes.push({ op: 'set', path: ['messages', index], value: row })
    const appended = restoredRows.filter(([index]) => index >= count).map(([, row]) => row)
    if (appended.length) changes.push({ op: 'splice', path: ['messages'], index: count, deleteCount: 0, items: appended })
    const { messages: _rows, ...header } = head.chat
    return { header: { ...header, messages: [] }, changes, count: head.messageCount }
  }

  // After the story commit: hide the round on the native surface (aborting the
  // commit if the host refuses), rewind background contexts, notify scripts and
  // publish the undo point. Shared by the complete and the bounded rollback.
  async function finishRollback({ chat, card, agent, session, rollbackSurface, shadowedSeqs, undo, hiddenTurn, removedUserText, removedAssistantText, messageCount, dispatchChat, abort, saveUndoPoint, ...state }) {
    let rollbackWarning = state.rollbackWarning
    // 3) 原生消息面：用空消息替换最近一轮的所有 surface 节点（模型不再看到），UI 由客户端隐藏对应 turn tail
    try {
      if (rollbackSurface === null) throw Object.assign(new Error('原生上下文中找不到这一轮'), { code: 'NATIVE_TARGET_MISSING' })
      // A rollback runs between turns, and the replacement is read at the log
      // tail: give it a turn of its own when none is open, so the archive keeps
      // loading instead of failing "does not match an open turn and step."
      withSurfaceEditTurn(session, agent, (turn, step) => replaceSessionSurface(session, 'assistant/message', {
        turn,
        step,
        message: {
          id: randomUUID(),
          role: 'assistant',
          content: [],
          source: rollbackSurface.source
        }
      }, { start: rollbackSurface.userSeq, end: rollbackSurface.endSeq, sourceEventSeqs: shadowedSeqs }))
    } catch (error) {
      // Keep append-only history intact. A rejected surface replacement must not
      // consume the story checkpoint, and nothing is rewritten behind the save.
      try {
        await abort()
      } catch (restoreError) {
        throw new Error('回退失败且剧情恢复未完成：' + str(error?.message || error) + '；' + str(restoreError?.message || restoreError), { cause: error })
      }
      throw error
    }
    // The Chat commit above already hides this round. Persist its model-side
    // shadow now, not on the host's delayed live buffer behind slower background
    // and script steps: a crash in between would leave the round in the context.
    if (typeof sessions.flush === 'function') {
      try { await sessions.flush(session) }
      catch (error) { rollbackWarning = [rollbackWarning, '正文已回退，模型上下文保存失败：' + str(error?.message || error)].filter(Boolean).join('；') }
    }
    // Rewind immediately after the foreground commit; retain the timeline's retry
    // boundary so the next task can safely retry if this best-effort step fails.
    for (const participant of Object.values(storyTimeline.inspect({ chat }).participants || {})) {
      if (participant.status !== 'needs-rewind' || !participant.sessionId) continue
      let restoredHandle
      try {
        let worker = sessions.get(participant.sessionId)
        let background = worker?.session || sessions.getSession?.(participant.sessionId)
        if (!background && typeof sessions.resume === 'function') {
          restoredHandle = await sessions.resume(participant.sessionId)
          worker = restoredHandle.agent
          background = worker?.session
        }
        if (!background) throw new Error('后台会话尚未加载，将在下次后台任务启动时重试')
        if (worker?.phase?.kind === 'running') {
          worker.cancel({ kind: 'parent' })
        }
        if (typeof worker?.whenIdle === 'function') {
          let timeout
          try {
            await Promise.race([worker.whenIdle(), new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('后台尚未停止，将在下次任务启动时重试')), 3000)
            })])
          } finally { clearTimeout(timeout) }
        }
        if (typeof sessions.flush !== 'function') throw new Error('当前宿主未提供后台会话保存接口')
        const checkpoint = { formatVersion: 4, sessionId: participant.sessionId, nodes: [...background.surface.nodes] }
        rewindBackgroundSurface(background, participant.rewindTo, worker, participant.formatVersion || 3)
        checkpoint.afterCount = sessionEvents(background).length
        undo.background.push(checkpoint)
        await sessions.flush(background)
      } catch (error) {
        rollbackWarning = [rollbackWarning, '正文已回退，后台上下文回退未完成：' + str(error?.message || error)].filter(Boolean).join('；')
      } finally {
        if (restoredHandle) {
          try { await restoredHandle.dispose() }
          catch (error) { rollbackWarning = [rollbackWarning, '后台回退临时会话释放失败：' + str(error?.message || error)].filter(Boolean).join('；') }
        }
      }
    }
    // Notify scripts only after both authoritative story and native surface have committed.
    try {
      await tavernScriptHostAdapter.dispatchEvent({ sessionId: chat.sessionId, ...(dispatchChat ? { chat: dispatchChat } : { recent: true }), name: 'MESSAGE_DELETED', args: [messageCount] })
    } catch (error) { rollbackWarning = '回退已完成，但脚本联动失败：' + str(error?.message || error) }
    try {
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      chat = await saveUndoPoint()
    } catch (error) { rollbackWarning = [rollbackWarning, '回退已完成，但撤销恢复点保存失败：' + str(error?.message || error)].filter(Boolean).join('；') }
    const result = await view(chat, card)
    if (rollbackWarning !== '') result.rollbackWarning = rollbackWarning
    result.rolledBack = { hiddenTurn: hiddenTurn, removedUserText: removedUserText, removedAssistantText: removedAssistantText }
    return result
  }

  async function undoRollback(sessionId, chatId) {
    const id = str(chatId) || (chats.stateForSession ? (await chats.stateForSession(sessionId))?.id : '')
    // Recent floors carry the undo point; old saves and legacy points read everything.
    let chat = id && chats.readRecent ? await chats.readRecent(id) : undefined
    const bounded = chat?.rollbackUndo?.version === 1 && chat.rollbackUndo.before === undefined
      && [chats.patch, chats.changedSince, chats.rowsAt].every(fn => typeof fn === 'function') ? await undoPoint(chat, chat.rollbackUndo) : undefined
    if (!bounded) chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (!chat || pendingRollbacks.has(chat.id)) throw new Error('没有可撤销的回退，或正在处理回退')
    pendingRollbacks.add(chat.id)
    const handles = []
    const changed = []
    let committed = false
    try {
      let agent = sessions.get(chat.sessionId)
      let session = agent?.session || sessions.getSession?.(chat.sessionId)
      if (!session && typeof sessions.resume === 'function') {
        const handle = await sessions.resume(chat.sessionId)
        handles.push(handle)
        agent = handle.agent
        session = agent?.session
      }
      if (agent?.phase?.kind === 'running' || !canUndoRollback(chat, session)) throw new Error('撤销回退已失效：对话已有新操作，请刷新页面')
      const saved = chat.rollbackUndo
      const before = bounded ? bounded.header : saved.before || await readChatRevision(chat.id, saved.beforeRevision)
      if (!before || before.id !== chat.id) throw new Error('找不到回退前的恢复点')
      const targets = [{ session, saved: saved.foreground }]
      for (const checkpoint of saved.background) {
        let worker = sessions.get(checkpoint.sessionId)
        let background = worker?.session || sessions.getSession?.(checkpoint.sessionId)
        if (!background && sessions.resume) {
          const handle = await sessions.resume(checkpoint.sessionId)
          handles.push(handle); worker = handle.agent; background = worker?.session
        }
        if (!background || worker?.phase?.kind === 'running' || !unchangedSinceRollback(background, checkpoint.afterCount, checkpoint.formatVersion || 3)) throw new Error('后台上下文已有变化，不能撤销回退')
        targets.push({ session: background, saved: checkpoint })
      }
      // The foreground context comes back from the save if its saved nodes cannot be restored.
      try { preflightSurfaceRestore(session, saved.foreground.nodes, saved.foreground.formatVersion || 3) }
      catch (error) { throw error }
      for (const target of targets) if (target.session !== session) preflightSurfaceRestore(target.session, target.saved.nodes, target.saved.formatVersion || 3)
      for (const target of targets) {
        changed.push({ session: target.session, nodes: [...target.session.surface.nodes] })
        restoreSurface(target.session, target.saved.nodes, target.saved.formatVersion || 3)
        if (sessions.flush) await sessions.flush(target.session)
      }
      const undo = current => {
        const result = storyTimeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: before } }).chat
        delete result.rollbackUndo
        result.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        for (const participant of Object.values(result.timeline.participants)) {
          const target = targets.find(item => item.saved.sessionId === participant.sessionId)
          if (target) Object.assign(participant, { status: 'current', syncedRevision: result.timeline.revision,
            boundary: target.session.surface.nodes.at(-1) ?? -1, formatVersion: 4, rewindTo: null })
        }
        return result
      }
      let restored
      if (bounded) {
        // Same story intent on the header; the rows the rollback replaced or
        // dropped come back from the undo point's revision. Any concurrent change
        // fails the revision check, as the complete path's snapshot check would.
        const { messages: _rows, ...header } = chat
        const result = undo({ ...header, messages: [] })
        const changes = diffJson({ ...header, messages: [] }, result).filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
        if (changes.some(change => change.path[0] === 'messages' || change.path[0] === 'id')) throw new Error('找不到回退前的恢复点')
        changes.push(...bounded.changes)
        const head = await chats.patch(chat.id, chat._storageRevision, changes, { source: 'rollback.undo' })
        if (!head) throw new Error('回退期间聊天已被其他操作修改，请刷新后重试')
        restored = { ...result, ...head, messages: createScopedMessages(bounded.count) }
      } else {
        restored = await updateChat(chat.id, current => {
          assertRollbackSnapshot(current, chat)
          return undo(current)
        }, { source: 'rollback.undo' })
      }
      committed = true
      const result = await view(restored, await readChatCard(restored))
      result.undoneRollback = { turn: saved.turn }
      return result
    } catch (error) {
      if (committed) throw new Error('已撤销回退，但界面刷新失败：' + str(error?.message || error), { cause: error })
      // A rejected Chat write must not leave the model on the restored branch.
      for (const target of changed.reverse()) {
        restoreSurface(target.session, target.nodes)
        if (sessions.flush) await sessions.flush(target.session)
      }
      throw error
    } finally {
      pendingRollbacks.delete(chat.id)
      for (const handle of handles) await handle.dispose()
    }
  }

  return Object.freeze({ regenerate, regenerateWithProvider, recover: regenerationRecovery.recover, rollback: rollbackTurn, rollbackTo: rollbackToTurn, interrupt: interruptTurn, undoRollback })
}
