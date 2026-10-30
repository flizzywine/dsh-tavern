import { projectPlayerContent } from './player-input-content.js'
import { assertRescueHistoryEditable } from './chat-history-rescue.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { canUndoRollback, restoreSurface, preflightSurfaceRestore, unchangedSinceRollback } from './surface-restoration.js'
import { rewindBackgroundSurface } from './background-surface.js'
import { releaseOpeningTurn, sessionEvents, withSurfaceEditTurn } from './session-events.js'
import { randomUUID } from 'node:crypto'
import { createRegenerationRecovery, projectedReplacingTurns } from './regeneration-recovery.js'
import { isDeepStrictEqual } from 'node:util'
import { createScopedMessages, isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { rollbackAvailability, clearFailedTurnSurface, locateRegenerationSurface, planRegenerationSurface, regenerationProjection, applyRegenerationProjection, failedTurnReplayAvailability, replayableFailedTurn } from './rollback-surface.js'
import { assertRegenerationSourceCurrent, replaceLastRound } from './last-round-replacement.js'
import { diagnosticIdentity, regenerationTargetDiagnostic } from './regeneration-diagnostics.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { plainReplyProse } from './reply-prose.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// The bounded regeneration writes with an explicit revision. Anything may write
// the save between that read and its patch — a switch, a settlement, or the
// failed turn's own cleanup restoring the staged template input. Retry those
// writes instead of throwing the regeneration away: a truncated attempt keeps
// its partial body only if the following commit can still land.
const REGEN_WRITE_ATTEMPTS = 4

/**
 * The input of a regeneration attempt. The provider never sees the replaced body
 * (the request projection drops it), so without guidance this is a fresh sample
 * of the round. Guidance ("写得更长", "加快节奏") is relative to the current body,
 * so it comes with that body as the draft to revise.
 */
export function regenerationInputText(userText, guidance, rewriteBody) {
  const input = str(userText).trim(), guide = str(guidance).trim(), draft = str(rewriteBody).trim()
  if (draft !== '' && guide !== '') return input + '\n\n【当前正文】\n' + draft + '\n\n【改写要求】\n在当前正文基础上改写本轮正文：' + guide
  return input + (guide !== '' ? '\n\n【本轮补充要求】\n' + guide : '')
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

/** The round a kept partial attempt writes: an ordinary floor, marked as incomplete. */
function partialAttemptRows(input) {
  const attachments = Array.isArray(input.inputAttachments) ? input.inputAttachments : []
  const user = { role: 'user', text: str(input.userText), native: true, ...(attachments.length ? { inputAttachments: structuredClone(attachments) } : {}) }
  const assistant = { role: 'assistant', ...plainReplyProse(input.text), native: true, turn: input.turn,
    incomplete: true, incompleteReason: '这次重新生成被中断，保留了已生成的部分正文' }
  return [user, assistant]
}

export function selectRegenerationTarget(chat, session, observe) {
  const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
  const eventStart = sessionEvents(session).length
  const msgs0 = chat.messages || []
  let oldAssistantIndex = -1
  for (let i = msgs0.length - 1; i >= 0; i--) {
    const m = msgs0[i]
    if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
      oldAssistantIndex = i
      break
    }
  }
  function report(reason, target) {
    if (typeof observe !== 'function') return
    try { observe(regenerationTargetDiagnostic(chat, session, { reason, assistantIndex: oldAssistantIndex, target })) } catch { /* Diagnostics never change selection. */ }
  }
  if (oldAssistantIndex < 1 || msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' || msgs0[oldAssistantIndex - 1].role !== 'user') {
    report(oldAssistantIndex < 0 ? 'no-non-greeting-assistant' : oldAssistantIndex === 0 ? 'assistant-at-start'
      : msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' ? 'previous-message-invalid' : 'previous-message-not-user')
    throw new Error('没有可重新生成的玩家输入与正文组合')
  }
  const target = locateRegenerationSurface({ events: sessionEvents(session), nodes, turn: msgs0[oldAssistantIndex].turn,
    // A projected reply may store the edit turn; its body still identifies it.
    texts: [msgs0[oldAssistantIndex].text, msgs0[oldAssistantIndex].sourceText, msgs0[oldAssistantIndex].projectionText] })
  if (target === null) { report('native-target-missing'); throw Object.assign(new Error('原生消息流中找不到与当前剧情轮次对应的正文消息'), { code: 'NATIVE_TARGET_MISSING' }) }
  report('selected', target)
  const oldSeq = target.assistantSeq
  const oldTurn = target.turn
  const oldSource = target.source
  return { nodes, eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource }
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

export function createRoundHistory({ chats, sessions, scripts, timeline, queueSettlement, replyCommitted, cancelSettlement, present, diagnostics, sessionPatch, repairNative }) {
  const { read: readChat, forSession: chatForSession, readCard: readChatCard,
    readRevision: readChatRevision, write: writeChat, update: updateChat } = chats
  const { read: readScript, continuity: scriptContinuity } = scripts
  const tavernScriptHostAdapter = scripts
  const storyTimeline = timeline
  const view = present
  const pendingRollbacks = new Set()
  const pendingRegenerations = new Set()
  const pendingReplays = new Set()
  const regenerationRecovery = createRegenerationRecovery({ chats, sessions, timeline, isActive: id => pendingRegenerations.has(id), repair: (sessionId, session) => repairSurface(sessionId, session) })
  // The save is the truth (Wiki「设计：native-session-repair」): when the native
  // surface no longer shows the round the save has, rewrite its tail from the save
  // instead of refusing. Repair reports its own failure and leaves a retry marker.
  async function repairSurface(sessionId, session) {
    if (typeof repairNative === 'function') await repairNative(sessionId, session)
  }
  async function selectRepairedTarget(chat, session, observe) {
    try { return selectRegenerationTarget(chat, session, observe) }
    catch (error) {
      if (error?.code !== 'NATIVE_TARGET_MISSING' || typeof repairNative !== 'function') throw error
      await repairSurface(chat.sessionId, session)
      return selectRegenerationTarget(chat, session, observe)
    }
  }

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
    // Identity only; each regeneration path reads the story it changes.
    const chat = str(chatId) === '' ? await (chats.stateForSession || chatForSession)(sessionId) : await (chats.readState || readChat)(chatId)
    if (!chat) throw new Error('聊天不存在: ' + chatId)
    if (pendingReplays.has(chat.id)) throw new Error('正在重放失败回合，请等待完成')
    if (pendingRegenerations.has(chat.id) || pendingRollbacks.has(chat.id)) throw new Error('正文正在重新生成，请等待完成')
    await regenerationRecovery.recover(chat.id)
    if (pendingReplays.has(chat.id)) throw new Error('正在重放失败回合，请等待完成')
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
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    if (agent.phase?.kind === 'running') throw new Error('前台正在生成，请完成或停止后再重新生成')
    const session = agent.session
    let selection, evidence
    try { selection = await selectRepairedTarget(chat, session, diagnostics ? value => { evidence = value } : undefined) }
    finally {
      if (evidence) {
        try { await diagnostics.record(chat.sessionId, { stage: 'regeneration-target', diagnosticId: randomUUID(),
          outcome: evidence.reason === 'selected' ? 'selected' : 'rejected', ...evidence,
          guidanceProvided: typeof guidance === 'string' && guidance.trim().length > 0,
          binding: { requested: diagnosticIdentity(sessionId), stored: diagnosticIdentity(storedSessionId), effective: diagnosticIdentity(chat.sessionId),
            overridden: Boolean(sessionId && sessionId !== storedSessionId) },
          agent: { phase: ['running', 'idle'].includes(agent.phase?.kind) ? agent.phase.kind : 'other', lastTurn: Number.isFinite(agent.phase?.lastTurn) ? agent.phase.lastTurn : null } }) }
        catch { /* Recording failure must not affect regeneration or replace its error. */ }
      }
    }
    const { eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource } = selection
    // V3 hosts may reject assistant replacements. Check an isolated copy before
    // rolling back the Chat, cancelling settlement or paying for a new reply.
    if (session.header?.version >= 3) {
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
    }
    const originalUserText = str(msgs0[oldAssistantIndex - 1].text).trim()
    let originalChat = structuredClone(chat)
    const operationId = randomUUID()
    async function restoreFailedRegen() {
      await regenerationRecovery.abort({ chatId: chat.id, originalChat, session, eventStart, operationId })
    }
    let legacyBefore = null
    if (storyTimeline.inspect({ chat }).checkpointCount === 0) {
      let rollbackCommit = null
      if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
        // The round's own commit, by its turn; text matching is only for rows saved before turns were recorded.
        rollbackCommit = commitOfRound(chat.nativeCommits, msgs0[oldAssistantIndex], originalUserText)
      }
      const before = rollbackCommit && rollbackCommit.before && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : {}
      legacyBefore = {
        messages: msgs0.slice(0, oldAssistantIndex - 1), posture: str(before.posture), ledger: before.ledger || null, scriptState: chat.scriptState,
        candidates: null, settleStatus: 'idle', settleError: null, lastSettle: null,
        preparedWorldBookContext: str(before.preparedWorldBookContext),
        preparedWorldBook: before.preparedWorldBook || null,
        participants: {}
      }
      if ((chat.mode || 'story') === 'script') {
        const script = await readScript(chat.cardPath)
        if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法重新生成正文')
        const revision = before.scriptRevision && typeof before.scriptRevision === 'object' ? before.scriptRevision : null
        const reference = rollbackCommit && rollbackCommit.scriptReference && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
        legacyBefore.scriptState = scriptContinuity.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision, reference } }).state
      }
    }
    const rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: oldTurn, legacyBefore })
    const lifecycleRevision = Math.max(0, Number(originalChat.tavernHelperLifecycleRevision) || 0) + 1
    chat = await updateChat(chat.id, function (current) {
      if (agent.phase?.kind === 'running' || current.regenInProgress) throw new Error('前台正在生成，请完成或停止后再重新生成')
      assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: oldAssistantIndex })
      originalChat = structuredClone(current)
      const next = storyTimeline.apply({ chat: current, intent: rollbackIntent }).chat
      next.regenRecovery = { id: operationId, beforeRevision: Number(current._storageRevision || 0),
        ...(Number(current._storageRevision || 0) ? {} : { before: structuredClone(current) }),
        sessionId: chat.sessionId, eventStart }
      next.tavernHelperLifecycleRevision = lifecycleRevision
      next.regenInProgress = true
      // 生成期间先把被重做的旧正文藏起来：否则旧的正文一直挂在页面上，看上去
      // 像"没有在生成、只是把新内容叠上去"。只藏正文，玩家输入是他自己发的，
      // 留着才看得见这条在等谁的回复——所以走 replacingDshTurns，别混进
      // suppressedDshTurns（那是"整轮作废"，会连输入一起收掉）。
      const replacingBefore = Array.isArray(next.replacingDshTurns) ? next.replacingDshTurns : []
      const alreadyReplacing = replacingBefore.some(function (turn) { return Number(turn) === Number(oldTurn) })
      next.regenRecovery.temporaryReplacingTurn = alreadyReplacing ? null : oldTurn
      if (!alreadyReplacing) next.replacingDshTurns = Array.from(new Set(replacingBefore.concat([oldTurn]))).sort(function (left, right) { return left - right })
      return next
    }, { source: 'rollback.regen' })
    const rolledMessageCount = (chat.messages || []).length
    const guide = str(guidance).trim()
    const syntheticText = regenerationInputText(originalUserText, guide, replyTextOf(msgs0[oldAssistantIndex]))
    releaseOpeningTurn(agent.session, agent)
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    let committedChat, body, syntheticTurn, keptStreamed = false
    try {
      if (activeRound !== undefined && typeof cancelSettlement === 'function') await cancelSettlement(chat.id)
      if (agent.phase?.kind === 'running') throw new Error('前台正在生成，未启动重新生成')
      const ready = await readChat(chat.id)
      if (ready?.regenRecovery?.id !== operationId || agent.phase?.kind === 'running') throw new Error('重新生成操作已失效或前台正在生成')
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: projectPlayerContent(msgs0[oldAssistantIndex - 1].inputAttachments, syntheticText),
        source: { kind: 'plugin:dsh-tavern-regen', regenerationId: operationId }
      })
      // A stopped, blocked or truncated attempt fails the wait, but the text it
      // already streamed stays in the log. Keep going and adopt that text.
      let generationError = null
      try { await agent.whenIdle() } catch (error) { generationError = error }
      syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
      let latest = await readChat(chat.id)
      if (latest === undefined) {
        throw new Error('聊天不存在: ' + chat.id)
      }
      let latestMsgs = latest.messages || []
      if (latestMsgs.length < rolledMessageCount + 2) {
        const streamed = streamedAttemptText(session, syntheticTurn, eventStart)
        if (streamed === '') {
          if (generationError !== null) throw generationError
          throw new Error('这次重新生成没有完成（可能被内容审核拦截或已停止），正文保持原样，可以再试一次')
        }
        await updateChat(chat.id, function (current) {
          if (current?.regenRecovery?.id !== operationId) throw new Error('重新生成操作已失效')
          const messages = Array.isArray(current.messages) ? current.messages : []
          if (messages.length >= rolledMessageCount + 2) return
          current.messages = messages.concat(partialAttemptRows({ turn: syntheticTurn, userText: syntheticText,
            inputAttachments: msgs0[oldAssistantIndex - 1].inputAttachments, text: streamed }))
          // The host's own commit for this turn must not append the round twice if
          // its stop hook lands after this write; the commit drops this record.
          current.nativeCommits = current.nativeCommits !== null && typeof current.nativeCommits === 'object' ? current.nativeCommits : {}
          current.nativeCommits[String(syntheticTurn)] = { turn: syntheticTurn, userText: syntheticText, committedAt: Date.now(), partial: true }
          return current
        }, { source: 'foreground.regen-partial' })
        latest = await readChat(chat.id)
        if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
        latestMsgs = latest.messages || []
        keptStreamed = true
      }
      const regeneratedUser = latestMsgs[latestMsgs.length - 2]
      const newAssistant = latestMsgs[latestMsgs.length - 1]
      if (regeneratedUser === null || typeof regeneratedUser !== 'object' || regeneratedUser.role !== 'user' ||
          newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant' || Number(newAssistant.turn) !== syntheticTurn) {
        throw new Error('重新生成流程未产生正文')
      }
      body = str(newAssistant.text).trim()
      if (body === '') {
        throw new Error('重新生成失败：模型返回空文本')
      }
      // The persisted intent must only reference events already on disk.
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      let projection = null
      committedChat = await updateChat(latest.id, function (current) {
        if (current?.regenRecovery?.id !== operationId) throw new Error('重新生成操作已失效')
        const currentMessages = Array.isArray(current && current.messages) ? current.messages : []
        const currentUser = currentMessages[currentMessages.length - 2]
        const currentAssistant = currentMessages[currentMessages.length - 1]
        if (currentMessages.length < rolledMessageCount + 2 || currentUser === null || typeof currentUser !== 'object' || currentUser.role !== 'user' ||
            currentAssistant === null || typeof currentAssistant !== 'object' || currentAssistant.role !== 'assistant' || Number(currentAssistant.turn) !== syntheticTurn) throw new Error('重新生成流程的正文已被另一项操作修改')
        // The attempt's row is the truth by the time this write runs: the failed
        // turn's own cleanup may have re-projected it while the marker was set.
        // Comparing it with the text read before this write threw the whole
        // regeneration away, partial body included.
        const landed = str(currentAssistant.text).trim()
        if (landed === '') throw new Error('重新生成失败：模型返回空文本')
        body = landed
        projection = placeRegeneration(session, oldSeq, eventStart, { turn: oldTurn, step: 1, message: { id: 'tavern-regen:' + operationId,
          role: 'assistant', content: [{ type: 'text', text: body }], source: { ...oldSource, tavernStoryTurn: oldTurn } } }, operationId)
        const merged = replaceLastRound({ originalChat, regeneratedChat: current, assistantIndex: oldAssistantIndex })
        const next = merged.chat
        if (next.nativeCommits !== null && typeof next.nativeCommits === 'object') delete next.nativeCommits[String(syntheticTurn)]
        next.nativeCommits = next.nativeCommits && typeof next.nativeCommits === 'object' ? structuredClone(next.nativeCommits) : {}
        if (originalChat.nativeCommits && originalChat.nativeCommits[String(oldTurn)]) next.nativeCommits[String(oldTurn)] = structuredClone(originalChat.nativeCommits[String(oldTurn)])
        next.regenInProgress = true
        next.regenRecovery = { ...current.regenRecovery, phase: 'committed', projection }
        next.settleStatus = 'pending'
        next.settleError = null
        next.tavernHelperLifecycleRevision = lifecycleRevision + 1
        // 旧正文的临时隐藏留到投影写入时（regenerationRecovery.complete）才撤：此刻日志里还没有
        // 投影，行计划会把旧轮和生成轮都画出来，同一段正文显示两份（#312）。
        next.suppressedDshTurns = Array.from(new Set((Array.isArray(next.suppressedDshTurns) ? next.suppressedDshTurns : []).concat([syntheticTurn]))).sort(function (left, right) { return left - right })
        next.regeneratedDshTurns = next.regeneratedDshTurns && typeof next.regeneratedDshTurns === 'object' && !Array.isArray(next.regeneratedDshTurns)
          ? structuredClone(next.regeneratedDshTurns) : {}
        next.regeneratedDshTurns[String(oldTurn)] = syntheticTurn
        return next
      }, { source: 'foreground.regen-commit' })
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    committedChat = await regenerationRecovery.complete({ chatId: chat.id, session, operationId }) || committedChat
    replyCommitted?.(committedChat.sessionId)
    let settledChat = committedChat
    try {
      await queueSettlement(committedChat.id)
      settledChat = await readChat(committedChat.id) || committedChat
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
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn }
    if (keptStreamed) result.regenerationWarning = '这次重新生成没有完成（可能被内容审核拦截或已停止），已保留生成到的部分正文。'
    return result
  }

  // Native saves regenerate from their recent floors. The temporary rollback and
  // the final commit are revision-checked patches: floors changed since the
  // checkpoint are restored for generation, then every floor changed since the
  // original revision returns to its original value around the new round, as
  // replaceLastRound would build it. Undefined (before any visible effect) leaves
  // legacy checkpoints and unreadable revisions to the complete path.
  async function regenRecent(chatId, guidance, sessionId) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    if (![chats.readRecent, chats.patch, chats.changedSince, chats.rowsAt].every(fn => typeof fn === 'function')) return undefined
    let chat = await chats.readRecent(chatId)
    if (!chat || !isScopedMessages(chat.messages)) return undefined
    assertRescueHistoryEditable(chat)
    const { messages: _rows, ...originalHeader } = chat
    const target = storyTimeline.rollbackTarget({ chat: { ...originalHeader, messages: [] } })
    if (target === null) return undefined
    const revision = chat._storageRevision
    const sinceCheckpoint = await chats.changedSince(chat.id, target.beforeRevision)
    if (!sinceCheckpoint || sinceCheckpoint.revision !== revision) return undefined
    const checkpointHead = await chats.rowsAt(chat.id, target.beforeRevision, [])
    if (!checkpointHead || checkpointHead.chat._storageRevision !== target.beforeRevision || checkpointHead.messageCount > chat.messages.length) return undefined
    const rolledMessageCount = checkpointHead.messageCount
    const checkpointIndices = sinceCheckpoint.indices.filter(index => index < rolledMessageCount)
    const checkpointRows = checkpointIndices.length ? await chats.rowsAt(chat.id, target.beforeRevision, checkpointIndices) : { chat: checkpointHead.chat, denseMessages: true }
    if (!checkpointRows?.denseMessages) return undefined
    const activeRound = Object.values(storyTimeline.inspect({ chat: originalHeader }).operations || {}).find(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'completed' &&
        operation.background && ['pending', 'running'].includes(str(operation.background.phase))
    })
    if (chat.regenInProgress === true) throw new Error('正文正在重新生成，请等待完成')
    const card = await readChatCard(chat)
    const storedSessionId = chat.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    if (agent.phase?.kind === 'running') throw new Error('前台正在生成，请完成或停止后再重新生成')
    const session = agent.session
    let selection, evidence
    try { selection = await selectRepairedTarget(chat, session, diagnostics ? value => { evidence = value } : undefined) }
    finally {
      if (evidence) {
        try { await diagnostics.record(chat.sessionId, { stage: 'regeneration-target', diagnosticId: randomUUID(),
          outcome: evidence.reason === 'selected' ? 'selected' : 'rejected', ...evidence,
          guidanceProvided: typeof guidance === 'string' && guidance.trim().length > 0,
          binding: { requested: diagnosticIdentity(sessionId), stored: diagnosticIdentity(storedSessionId), effective: diagnosticIdentity(chat.sessionId),
            overridden: Boolean(sessionId && sessionId !== storedSessionId) },
          agent: { phase: ['running', 'idle'].includes(agent.phase?.kind) ? agent.phase.kind : 'other', lastTurn: Number.isFinite(agent.phase?.lastTurn) ? agent.phase.lastTurn : null } }) }
        catch { /* Recording failure must not affect regeneration or replace its error. */ }
      }
    }
    const { eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource } = selection
    if (!Object.hasOwn(msgs0, String(oldAssistantIndex - 1))) throw new Error('没有可重新生成的玩家输入与正文组合')
    if (session.header?.version >= 3) {
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
    }
    const originalUser = structuredClone(msgs0[oldAssistantIndex - 1])
    const originalAssistant = structuredClone(msgs0[oldAssistantIndex])
    const originalUserText = str(originalUser.text).trim()
    const operationId = randomUUID()
    const lifecycleRevision = Math.max(0, Number(originalHeader.tavernHelperLifecycleRevision) || 0) + 1
    const headerChanges = (before, after) => diffJson({ ...before, messages: [] }, { ...after, messages: [] })
      .filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
    // 1) The checkpoint state, marked as a recoverable regeneration.
    const { messages: _checkpointRows, ...checkpointHeader } = checkpointRows.chat
    const rolled = storyTimeline.apply({ chat: { ...originalHeader, messages: [] }, intent: { kind: 'turn.rollback', turn: oldTurn, beforeChat: { ...checkpointHeader, messages: [] } } }).chat
    rolled.regenRecovery = { id: operationId, beforeRevision: revision, sessionId: chat.sessionId, eventStart }
    rolled.tavernHelperLifecycleRevision = lifecycleRevision
    rolled.regenInProgress = true
    // 同上（完整路径）：生成期间只藏被重做的旧正文，玩家输入留着。
    const rolledReplacingBefore = Array.isArray(rolled.replacingDshTurns) ? rolled.replacingDshTurns : []
    const rolledAlreadyReplacing = rolledReplacingBefore.some(function (turn) { return Number(turn) === Number(oldTurn) })
    rolled.regenRecovery.temporaryReplacingTurn = rolledAlreadyReplacing ? null : oldTurn
    if (!rolledAlreadyReplacing) rolled.replacingDshTurns = Array.from(new Set(rolledReplacingBefore.concat([oldTurn]))).sort(function (left, right) { return left - right })
    const rollbackChanges = headerChanges(originalHeader, rolled)
    if (rollbackChanges.some(change => change.path[0] === 'messages' || change.path[0] === 'id')) return undefined
    if (msgs0.length > rolledMessageCount) rollbackChanges.push({ op: 'splice', path: ['messages'], index: rolledMessageCount, deleteCount: msgs0.length - rolledMessageCount, items: [] })
    checkpointIndices.forEach((index, offset) => rollbackChanges.push({ op: 'set', path: ['messages', index], value: checkpointRows.chat.messages[offset] }))
    if (agent.phase?.kind === 'running') throw new Error('前台正在生成，请完成或停止后再重新生成')
    const rolledSaved = await chats.patch(chat.id, revision, rollbackChanges, { source: 'rollback.regen' })
    if (!rolledSaved) return undefined
    async function restoreFailedRegen() {
      // Rare error path: the complete abort restores the exact original revision.
      const originalChat = await readChatRevision(chat.id, revision)
      await regenerationRecovery.abort({ chatId: chat.id, originalChat, session, eventStart, operationId })
    }
    const guide = str(guidance).trim()
    const syntheticText = regenerationInputText(originalUserText, guide, replyTextOf(msgs0[oldAssistantIndex]))
    releaseOpeningTurn(agent.session, agent)
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    let committedChat, body, syntheticTurn, keptStreamed = false
    try {
      if (activeRound !== undefined && typeof cancelSettlement === 'function') await cancelSettlement(chat.id)
      if (agent.phase?.kind === 'running') throw new Error('前台正在生成，未启动重新生成')
      const ready = await chats.readRecent(chat.id)
      if (ready?.regenRecovery?.id !== operationId || agent.phase?.kind === 'running') throw new Error('重新生成操作已失效或前台正在生成')
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: projectPlayerContent(originalUser.inputAttachments, syntheticText),
        source: { kind: 'plugin:dsh-tavern-regen', regenerationId: operationId }
      })
      // 同上（完整路径）：中断的尝试仍把已生成的正文留在日志里，接着用它。
      let generationError = null
      try { await agent.whenIdle() } catch (error) { generationError = error }
      syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
      let latest = await chats.readRecent(chat.id)
      if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
      let latestMsgs = latest.messages
      let adoptedPartial = false
      if (latestMsgs.length < rolledMessageCount + 2) {
        const streamed = streamedAttemptText(session, syntheticTurn, eventStart)
        if (streamed === '') {
          if (generationError !== null) throw generationError
          throw new Error('这次重新生成没有完成（可能被内容审核拦截或已停止），正文保持原样，可以再试一次')
        }
        // 被截断的尝试写进存档之后，宿主和插件的失败轮清理还会各写一次（例如
        // 还原 promptTemplateInput）。用读到的 revision 只写一次就作废，会把刚
        // 保留下的部分正文连同整轮一起撤回——所以拿最新 revision 重试。
        for (let attempt = 0; attempt < REGEN_WRITE_ATTEMPTS && !adoptedPartial; attempt++) {
          const commits = latest.nativeCommits !== null && typeof latest.nativeCommits === 'object' ? structuredClone(latest.nativeCommits) : {}
          // 同上（完整路径）：宿主自己的提交若随后到达，不能把这一轮再追加一次。
          const partialCommit = { turn: syntheticTurn, userText: syntheticText, committedAt: Date.now(), partial: true }
          const written = await chats.patch(chat.id, latest._storageRevision, [{ op: 'splice', path: ['messages'], index: latestMsgs.length, deleteCount: 0,
            items: partialAttemptRows({ turn: syntheticTurn, userText: syntheticText, inputAttachments: originalUser.inputAttachments, text: streamed }) },
          { op: 'set', path: ['nativeCommits'], value: { ...commits, [String(syntheticTurn)]: partialCommit } }],
          { source: 'foreground.regen-partial' })
          latest = await chats.readRecent(chat.id)
          if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
          if (latest.regenRecovery?.id !== operationId) throw new Error('重新生成操作已失效')
          latestMsgs = latest.messages
          adoptedPartial = Boolean(written)
          // 宿主自己把这一轮提交上来了：用它，不再追加。
          if (!adoptedPartial && latestMsgs.length >= rolledMessageCount + 2) break
        }
        if (!adoptedPartial && latestMsgs.length < rolledMessageCount + 2) throw new Error('重新生成流程的正文已被另一项操作修改')
        keptStreamed = adoptedPartial
      }
      // 2) The original floors around the new round. Floors changed since the
      // original revision (the temporary rollback included) return to it.
      let committed = null
      for (let attempt = 0; attempt < REGEN_WRITE_ATTEMPTS && committed === null; attempt++) {
        if (attempt > 0) {
          latest = await chats.readRecent(chat.id)
          if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
          latestMsgs = latest.messages
        }
        if (latest.regenRecovery?.id !== operationId) throw new Error('重新生成操作已失效')
        const regeneratedUser = latestMsgs[latestMsgs.length - 2]
        const newAssistant = latestMsgs[latestMsgs.length - 1]
        if (regeneratedUser === null || typeof regeneratedUser !== 'object' || regeneratedUser.role !== 'user' ||
            newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant' || Number(newAssistant.turn) !== syntheticTurn) {
          throw new Error('重新生成流程未产生正文')
        }
        // 与完整路径同理：这一轮的行就是事实，重算投影时用它的正文。
        body = str(newAssistant.text).trim()
        if (body === '') throw new Error('重新生成失败：模型返回空文本')
        const projection = placeRegeneration(session, oldSeq, eventStart, { turn: oldTurn, step: 1, message: { id: 'tavern-regen:' + operationId,
          role: 'assistant', content: [{ type: 'text', text: body }], source: { ...oldSource, tavernStoryTurn: oldTurn } } }, operationId)
        if (typeof sessions.flush === 'function') await sessions.flush(session)
        const { messages: _latestRows, ...latestHeader } = latest
        const merged = replaceLastRound({ originalChat: { messages: [originalUser, originalAssistant] }, regeneratedChat: { ...latestHeader, messages: [regeneratedUser, newAssistant] }, assistantIndex: 1 })
        const next = merged.chat
        if (next.nativeCommits !== null && typeof next.nativeCommits === 'object') delete next.nativeCommits[String(syntheticTurn)]
        next.nativeCommits = next.nativeCommits && typeof next.nativeCommits === 'object' ? structuredClone(next.nativeCommits) : {}
        if (originalHeader.nativeCommits && originalHeader.nativeCommits[String(oldTurn)]) next.nativeCommits[String(oldTurn)] = structuredClone(originalHeader.nativeCommits[String(oldTurn)])
        next.regenInProgress = true
        next.regenRecovery = { ...latest.regenRecovery, phase: 'committed', projection }
        next.settleStatus = 'pending'
        next.settleError = null
        next.tavernHelperLifecycleRevision = lifecycleRevision + 1
        // 旧正文的临时隐藏留到投影写入时（regenerationRecovery.complete）才撤：此刻日志里还没有
        // 投影，行计划会把旧轮和生成轮都画出来，同一段正文显示两份（#312）。
        next.suppressedDshTurns = Array.from(new Set((Array.isArray(next.suppressedDshTurns) ? next.suppressedDshTurns : []).concat([syntheticTurn]))).sort(function (left, right) { return left - right })
        next.regeneratedDshTurns = next.regeneratedDshTurns && typeof next.regeneratedDshTurns === 'object' && !Array.isArray(next.regeneratedDshTurns)
          ? structuredClone(next.regeneratedDshTurns) : {}
        next.regeneratedDshTurns[String(oldTurn)] = syntheticTurn
        const prefix = oldAssistantIndex - 1
        const sinceOriginal = await chats.changedSince(chat.id, revision)
        if (!sinceOriginal || sinceOriginal.revision !== latest._storageRevision) continue
        const restoreIndices = sinceOriginal.indices.filter(index => index < prefix)
        const originalRows = restoreIndices.length ? await chats.rowsAt(chat.id, revision, restoreIndices) : { chat: {}, denseMessages: true }
        if (!originalRows?.denseMessages) throw new Error('找不到重新生成前的存档恢复点')
        const commitChanges = headerChanges(latestHeader, next)
        restoreIndices.forEach((index, offset) => commitChanges.push({ op: 'set', path: ['messages', index], value: originalRows.chat.messages[offset] }))
        commitChanges.push({ op: 'splice', path: ['messages'], index: prefix, deleteCount: latestMsgs.length - prefix, items: merged.chat.messages })
        const saved = await chats.patch(chat.id, latest._storageRevision, commitChanges, { source: 'foreground.regen-commit' })
        if (!saved) continue
        committed = { ...next, _storageRevision: saved._storageRevision, updatedAt: saved.updatedAt, messages: createScopedMessages(prefix + 2) }
      }
      if (committed === null) throw new Error('重新生成流程的正文已被另一项操作修改')
      committedChat = committed
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    committedChat = await completeRecent(committedChat, session, operationId)
    replyCommitted?.(committedChat.sessionId)
    let settledChat = committedChat
    try {
      await queueSettlement(committedChat.id)
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
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn }
    if (keptStreamed) result.regenerationWarning = '这次重新生成没有完成（可能被内容审核拦截或已停止），已保留生成到的部分正文。'
    return result
  }

  // Project the committed body onto the native surface, then clear the recovery
  // marker with a header patch. A moved revision uses the complete completion.
  async function completeRecent(chat, session, operationId) {
    const saved = chat.regenRecovery
    if (saved?.phase !== 'committed' || saved.id !== operationId || saved.sessionId !== session.id || !saved.projection || saved.projection.unplaced) {
      return await regenerationRecovery.complete({ chatId: chat.id, session, operationId }) || chat
    }
    try {
      applyRegenerationProjection(session, saved.projection)
      if (typeof sessions.flush === 'function') await sessions.flush(session)
    } catch {
      // The complete completion retries once, then ends the marker and repairs from the save.
      return await regenerationRecovery.complete({ chatId: chat.id, session, operationId }) || chat
    }
    const replacing = projectedReplacingTurns(chat)
    const head = await chats.patch(chat.id, chat._storageRevision, [{ op: 'delete', path: ['regenRecovery'] }, { op: 'delete', path: ['regenInProgress'] },
      replacing ? { op: 'set', path: ['replacingDshTurns'], value: replacing } : { op: 'delete', path: ['replacingDshTurns'] }], { source: 'foreground.regen-projected' })
    if (head) {
      const { regenRecovery: _recovery, regenInProgress: _flag, replacingDshTurns: _replacing, ...rest } = chat
      return { ...rest, ...(replacing ? { replacingDshTurns: replacing } : {}), _storageRevision: head._storageRevision, updatedAt: head.updatedAt }
    }
    return await regenerationRecovery.complete({ chatId: chat.id, session, operationId }) || chat
  }

  // ---------- 重放失败回合（移除被中断的回复，原样重发本轮输入） ----------
  // A failed turn never commits to the story, so there is nothing to roll back
  // and nothing to replace. Clearing its residue restores the exact request
  // prefix the provider already cached; replaying the same input then only pays
  // for the completion that was interrupted.
  async function replayFailedTurn(chatId, sessionId) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined || chat === null) throw new Error('聊天不存在: ' + chatId)
    if (pendingReplays.has(chat.id)) throw new Error('正在重放失败回合，请等待完成')
    await settleStaleRegeneration(chat)
    if (pendingRollbacks.has(chat.id)) throw new Error('正在回退本轮，请等待完成')
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    if (agent.phase !== undefined && agent.phase !== null && agent.phase.kind === 'running') throw new Error('正在生成，请先停止后再重新生成')
    const session = agent.session
    const events = sessionEvents(session)
    const replay = failedTurnReplayAvailability({ events, nodes: session.surface?.nodes || [], cleared: chat.suppressedDshTurns || [] })
    const target = replay.target
    if (target === null) throw new Error(replay.reason)
    // Read the card before spending a generation: a broken card must fail here,
    // not after the new turn has already committed.
    pendingReplays.add(chat.id)
    try {
      // A blank workbench can retry the very request that creates its first card.
      const card = chat.mode === 'card' && str(chat.cardPath) === '' ? null : await readChatCard(chat)
      // 1) 移除被中断的内容：清掉失败回合留在原生消息面上的节点。清理钩子
      // 正常已在失败时执行过，此处重复调用对已清理的回合是无操作。
      const cleared = clearFailedTurnSurface({ session, turn: target.turn })
      if (cleared > 0 && typeof sessions.flush === 'function') await sessions.flush(session)
      // 2) 同步隐藏该回合残留的正文与错误提示，再原样重发本轮输入。
      await updateChat(chat.id, function (current) {
        if (current === null || typeof current !== 'object') return current
        const next = {
          ...current,
          suppressedDshTurns: Array.from(new Set([...(Array.isArray(current.suppressedDshTurns) ? current.suppressedDshTurns : []), target.turn]))
            .sort(function (left, right) { return left - right }),
          updatedAt: Date.now()
        }
        if (current.userInputEdits && typeof current.userInputEdits === 'object' && Object.hasOwn(current.userInputEdits, String(target.turn))) {
          const edits = { ...current.userInputEdits }
          delete edits[String(target.turn)]
          next.userInputEdits = edits
        }
        return next
      }, { source: 'replay.failed-turn' })
      // The replay input is a first-class turn input so the normal foreground
      // prepare/finalize pipeline commits it exactly like a typed message. Its
      // source must stay kind 'user': hosts render anything else as a context
      // node, which would hide the player's text instead of resending it.
      // A failed input may have been edited as a Chat overlay. Retry with that
      // text; the failed turn itself is cleared and resent below.
      const edited = chat.userInputEdits && typeof chat.userInputEdits === 'object' ? chat.userInputEdits[String(target.turn)] : null
      const inputText = edited && typeof edited.text === 'string' ? edited.text : target.userText
      releaseOpeningTurn(agent.session, agent)
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: projectPlayerContent(target.inputAttachments, inputText),
        source: target.source
      })
      await agent.whenIdle()
      const latest = await readChat(chat.id) || chat
      const result = await view(latest, card)
      result.replayed = { turn: target.turn, userText: inputText, cleared }
      return result
    } finally {
      pendingReplays.delete(chat.id)
    }
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
  function surfaceShowsLatest(chat, availability) {
    const target = availability.target
    if (!target) return false
    const turn = latestStoryTurn(chat)
    return !(turn > 0) || target.turn === turn || target.turn === Number(chat.regeneratedDshTurns?.[String(turn)])
  }

  async function rollbackTurn(sessionId, chatId, expectedTurn) {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    // Identity and task flags only; rollbackChat reads the story it changes.
    const chat = str(chatId) === '' ? await (chats.stateForSession || chatForSession)(sessionId) : await (chats.readState || readChat)(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    if (pendingReplays.has(chat.id)) throw new Error('正在重放失败回合，请等待完成')
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
    if (pendingReplays.has(chat.id)) throw new Error('正在重放失败回合，请等待完成')
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
    if (pendingReplays.has(state.id)) throw new Error('正在重放失败回合，请等待完成')
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
    const originalChat = structuredClone(chat)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agent = sessions.get(chat.sessionId) || (restoredAgent?.session?.id === chat.sessionId ? restoredAgent : undefined)
    const session = agent?.session || sessions.getSession?.(chat.sessionId)
    if (!session) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    let availability = rollbackAvailability(chat, { events: sessionEvents(session), nodes: session.surface?.nodes || [] })
    if (!availability.failedTurns.length && !surfaceShowsLatest(chat, availability)) {
      await repairSurface(chat.sessionId, session)
      availability = rollbackAvailability(chat, { events: sessionEvents(session), nodes: session.surface?.nodes || [] })
    }
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
    // Still not on the surface after repair: roll the save back; repair follows it afterwards.
    const rollbackSurface = surfaceShowsLatest(chat, availability) ? availability.target : null
    if (rollbackSurface === null && typeof repairNative !== 'function') throw new Error(availability.target ? '该轮已不在当前模型上下文中，不能直接回退；历史正文仍可通过 history_recall 检索' : availability.reason)
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
    // The complete path repairs a surface that shows another round.
    if (expectedTurn > 0 && hiddenTurn !== expectedTurn && hiddenTurn !== Number(regeneratedDshTurns[String(expectedTurn)])) return undefined
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
      // The save has rolled back; bring the model context after it instead of undoing the story.
      if (typeof repairNative !== 'function') {
        // Keep append-only history intact. A rejected surface replacement must not consume the story checkpoint.
        try {
          await abort()
        } catch (restoreError) {
          throw new Error('回退失败且剧情恢复未完成：' + str(error?.message || error) + '；' + str(restoreError?.message || restoreError), { cause: error })
        }
        throw error
      }
      await repairSurface(chat.sessionId, session)
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
      let repairForeground = false
      try { preflightSurfaceRestore(session, saved.foreground.nodes, saved.foreground.formatVersion || 3) }
      catch (error) { if (typeof repairNative !== 'function') throw error; repairForeground = true; targets.shift() }
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
      if (repairForeground) await repairSurface(chat.sessionId, session)
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

  return Object.freeze({ regenerate, replayFailed: replayFailedTurn, recover: regenerationRecovery.recover, rollback: rollbackTurn, rollbackTo: rollbackToTurn, interrupt: interruptTurn, undoRollback })
}
