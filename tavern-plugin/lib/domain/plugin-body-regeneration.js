import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { computeSceneTarget } from './scene-illustration.js'
import { sessionEvents } from './session-events.js'
import { isNewPlayerInput } from './session-turn-input.js'
import { regenerationProjection, applyRegenerationProjection, failedTurnReplayAvailability, surfaceTurnOfSeq } from './rollback-surface.js'
import { legacyMessageUid } from './message-uid.js'
import { assertRegenerationSourceCurrent, replaceLastRound } from './last-round-replacement.js'
import { plainReplyProse, replyProse } from './reply-prose.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { consumeScriptPrompts } from './tavern-script-prompts.js'
import { findBodyRegenerationFrame } from './body-regeneration-materials.js'
import { untilAborted } from './plugin-callback.js'
import { projectPlayerContent } from './player-input-content.js'

const text = value => typeof value === 'string' ? value : ''
const clone = value => value === undefined ? undefined : structuredClone(value)
const error = (code, message) => Object.assign(new Error(message), { code })
const INPUT_STATE_FIELDS = ['macroState', 'variables', 'tavernHelperScriptVariables', 'tavernScriptPrompts',
  'promptTemplateInput', 'runtimeInputs', 'scriptState', 'preparedWorldBookContext', 'preparedWorldBook',
  'worldBookReads', 'worldBookVirtualState', 'worldBookRandomState', 'promptTemplateInitialVariables']

function pendingSettlement(chat) {
  const operations = Object.values(chat?.timeline?.operations || {})
  const body = operations.filter(operation => operation.kind === 'body' && operation.status === 'completed'
    && operation.committedBranchId === chat.timeline.branchId)
    .sort((left, right) => Number(right.committedRevision) - Number(left.committedRevision))[0]
  return Boolean(body && body.background?.role === 'settlement' && ['pending', 'running'].includes(body.background.phase))
}

function assertCurrent(current, original, index, inputIndex, operationId) {
  if (current?.regenRecovery?.id !== operationId || current.regenRecovery?.phase !== 'prepared') {
    throw error('TAVERN_PLUGIN_STALE_VERSION', '正文重新生成操作已经失效')
  }
  if (index !== null) assertRegenerationSourceCurrent({ originalChat: original, currentChat: current, assistantIndex: index, inputIndex })
  if (current.timeline?.branchId !== original.timeline?.branchId || current.timeline?.revision !== original.timeline?.revision) {
    throw error('TAVERN_PLUGIN_STALE_VERSION', '重新生成期间剧情状态已经变化')
  }
  for (const key of ['macroState', 'variables', 'posture', 'scriptState']) {
    if (!isDeepStrictEqual(current[key], original[key])) throw error('TAVERN_PLUGIN_STALE_VERSION', '重新生成期间本轮状态已经变化')
  }
  const history = chat => chat.messages.map(row => [row?.role, row?.turn, row?.sourceText, row?.projectionText,
    row?.text, row?.swipeId, row?.tavernHidden, row?.is_hidden, row?.hidden])
  if (!isDeepStrictEqual(history(current), history(original))) throw error('TAVERN_PLUGIN_STALE_VERSION', '重新生成期间历史消息已经变化')
}

/**
 * A provider only supplies a candidate. While it runs the original story remains
 * authoritative; only a durable busy marker is written. The checkpoint rollback,
 * replacement and new body checkpoint are committed together after validation.
 */
export function createPluginBodyRegeneration(deps) {
  const { chats, sessions, timeline, queueSettlement, replyCommitted, cancelSettlement,
    sessionPatch, readRegenerationMaterials, prepareRegenerationReply, notifyRegeneration,
    recovery, pendingRegenerations, pendingRollbacks, selectTarget } = deps

  async function releasePrepared(chatId, operationId) {
    return chats.update(chatId, current => {
      if (current?.regenRecovery?.id !== operationId || current.regenRecovery?.phase !== 'prepared') return current
      delete current.regenInProgress
      delete current.regenRecovery
      delete current.bodyGenerationCandidate
      current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      return current
    }, { source: 'foreground.plugin-regen-release' })
  }

  return async function regenerateWithProvider({ gameId, sessionId = gameId, turn, textVersion, generate, prepare, providerId, validateProvider, guidance = '', signal, onPhase } = {}) {
    if (typeof generate !== 'function') throw new TypeError('generate 必须是函数')
    if (typeof readRegenerationMaterials !== 'function') throw new Error('当前宿主未提供正文重生成材料接口')
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    signal?.throwIfAborted()
    let original = await chats.forSession(sessionId)
    if (!original || !['story', 'script'].includes(original.mode || 'story')) throw new Error('请先打开游玩对话')
    const chatId = original.id
    if (pendingRegenerations.has(chatId) || pendingRollbacks.has(chatId)) throw error('TAVERN_PLUGIN_BUSY', '当前对话正在重新生成或回退')
    await recovery.recover(chatId)
    if (pendingRegenerations.has(chatId) || pendingRollbacks.has(chatId)) throw error('TAVERN_PLUGIN_BUSY', '当前对话正在重新生成或回退')
    pendingRegenerations.add(chatId)
    const operationId = randomUUID()
    let committed = false, marked = false, interruptedSettlement = null
    const phase = async value => { try { if (typeof onPhase === 'function') await onPhase(value) } catch { /* Observers never change commit semantics. */ } }
    try {
      let agent = sessions.get(sessionId)
      if (!agent?.session) throw new Error('无法访问当前 DSH 会话')
      if (agent.phase?.kind === 'running') throw error('TAVERN_PLUGIN_BUSY', '前台正在生成，请先停止')
      original = await chats.read(chatId)
      if (!original || original.regenInProgress) throw error('TAVERN_PLUGIN_BUSY', '当前对话正忙')
      const shouldResumeSettlement = typeof cancelSettlement === 'function' && pendingSettlement(original)
      if (typeof cancelSettlement === 'function') await cancelSettlement(chatId)
      original = await chats.read(chatId)
      if (shouldResumeSettlement && pendingSettlement(original)) interruptedSettlement = {
        chat: clone(original), session: agent.session, eventCount: sessionEvents(agent.session).length
      }
      signal?.throwIfAborted()
      if (!original || original.regenInProgress || agent.phase?.kind === 'running') throw error('TAVERN_PLUGIN_BUSY', '当前对话正忙')
      const session = agent.session
      const failed = failedTurnReplayAvailability({ events: sessionEvents(session), nodes: session.surface?.nodes || [], cleared: original.suppressedDshTurns || [] }).target
      const failedMode = Boolean(failed && !original.messages?.some(row => row?.role === 'assistant' && Number(row.turn) === failed.turn))
      const target = failedMode ? { oldAssistantIndex: null, oldTurn: failed.turn,
        oldSource: { kind: 'model', provider: 'dsh-tavern', model: 'plugin-regeneration' } } : await selectTarget(original, session)
      const { oldAssistantIndex: index, oldTurn, oldSeq, oldSource, saveOnly = false } = target
      const inputIndex = failedMode ? -1 : Number.isSafeInteger(target.inputIndex) ? target.inputIndex : index - 1
      const inputRow = !failedMode && inputIndex >= 0 ? original.messages[inputIndex] : null
      const targetRow = index === null ? null : original.messages[index]
      // 消息面上没有这一轮的正文（旧正文节点已经不在，或者这轮从未落地）：没有可替换
      // 的对象，这一轮改成“补写”，和失败轮一样走 append。
      const appendRound = failedMode || saveOnly || oldSeq == null
      const targetSource = oldSource || { kind: 'model', provider: 'dsh-tavern', model: 'plugin-regeneration' }
      const candidateInputSeq = Number(targetRow?.nativeAnchor?.input ?? inputRow?.nativeAnchor?.input)
      const inputSeq = saveOnly && Number.isSafeInteger(candidateInputSeq) && candidateInputSeq >= 0 &&
        (session.surface?.nodes || []).some(seq => Number(seq) === candidateInputSeq) &&
        sessionEvents(session).some(event => Number(event.seq) === candidateInputSeq && event.type === 'user/message')
        ? candidateInputSeq : undefined
      if (turn !== undefined && Number(turn) !== Number(oldTurn)) throw error('TAVERN_PLUGIN_STALE_VERSION', '只能重新生成当前最新一轮正文')
      const version = failedMode ? null : computeSceneTarget(original, oldTurn).key
      if (!failedMode && textVersion !== undefined && textVersion !== version) throw error('TAVERN_PLUGIN_STALE_VERSION', '正文版本已经变化')
      const failedOperation = failedMode ? Object.values(original.timeline?.operations || {}).reverse().find(item => item.kind === 'body' && Number(item.turn) === oldTurn) : null
      const checkpoint = failedMode ? failedOperation && { turn: oldTurn, beforeRevision: failedOperation.beforeRevision, participants: failedOperation.beforeParticipants }
        : timeline.inspect({ chat: original }).checkpointCount ? original.timeline?.checkpoints?.at(-1) : null
      if (!checkpoint || Number(checkpoint.turn) !== Number(oldTurn)) throw error('TAVERN_PLUGIN_MATERIALS_UNAVAILABLE', '找不到本轮开始前的可靠状态快照')
      const beforeChat = checkpoint.before !== undefined ? { ...clone(original), ...clone(checkpoint.before) }
        : await chats.readRevision(chatId, checkpoint.beforeRevision)
      if (!beforeChat || beforeChat.id !== chatId) throw error('TAVERN_PLUGIN_MATERIALS_UNAVAILABLE', '本轮起点快照已不可读取')
      const card = await chats.readCard(original)
      if (!card) throw new Error('人物卡不可读取')
      const frame = findBodyRegenerationFrame(original, oldTurn)
      if (!frame?.source?.regenerationState && ((original.mode || 'story') === 'script'
        || /{{|<%/.test(frame?.userInput?.sourceText || '') || frame?.userInput?.sourceText !== frame?.userInput?.projectedText
        || inputRow?.templateInputSource)) {
        throw error('TAVERN_PLUGIN_MATERIALS_UNAVAILABLE', '这条旧存档缺少本轮输入处理后的快照，无法安全重生成')
      }
      if (failedMode && failed.inputAttachments?.length || inputRow?.inputAttachments?.length) throw error('TAVERN_PLUGIN_INPUT_UNSUPPORTED', '插件正文生成目前只支持文本输入')
      const failedInput = failedMode ? text(original.userInputEdits?.[String(oldTurn)]?.text) || failed.userText : ''
      let materials = await readRegenerationMaterials({ chat: original, beforeChat, card, turn: oldTurn, assistantIndex: index, inputIndex, operationId,
        ...(failedMode ? { kind: 'failed', targetInput: { raw: failedInput } } : {}) })
      materials = { ...materials, guidance: String(guidance).trim() }
      delete materials.digest
      materials.digest = createHash('sha256').update(JSON.stringify(materials)).digest('hex')
      if (failedMode && textVersion !== undefined && textVersion !== materials.target?.textVersion) throw error('TAVERN_PLUGIN_STALE_VERSION', '失败输入版本已经变化')
      const bodyTurn = failedMode ? sessionEvents(session).reduce((highest, event) => event.type === 'turn/start' ? Math.max(highest, Number(event.data?.turn) || 0) : highest, 0) + 1 : oldTurn
      signal?.throwIfAborted()
      // Validate native replacement support before a paid request, on an isolated session.
      const projectionData = { turn: bodyTurn, step: 1, message: { id: 'tavern-plugin-regen:' + operationId, role: 'assistant',
        content: [{ type: 'text', text: failedMode || saveOnly ? '待生成正文' : text(original.messages[index].text) }],
        source: { ...targetSource, tavernStoryTurn: bodyTurn } } }
      const projection = failedMode ? { kind: 'append-round', failedTurn: oldTurn, storyTurn: bodyTurn, data: projectionData,
        input: { id: 'tavern-plugin-regen-input:' + operationId, role: 'user', content: projectPlayerContent(failed.inputAttachments, failedInput), source: { kind: 'user' } } }
        : saveOnly ? { kind: 'append-round', storyTurn: bodyTurn, data: projectionData, ...(inputSeq !== undefined ? { inputSeq } : {}) }
        : regenerationProjection({ start: oldSeq, end: oldSeq, shadowedSeqs: [oldSeq] }, projectionData, operationId)
      if (session.constructor?.fromRestore) {
        const preview = session.constructor.fromRestore(session.id, clone(sessionEvents(session)), clone(session.header), session.inheritedEventCount, 'detached')
        applyRegenerationProjection(preview, projection)
      }
      const eventStart = sessionEvents(session).length
      // The row this regeneration rewrites. The page takes the old body out while
      // the provider runs and draws the new body when the commit lands; a failed
      // candidate only ends the marker, so the old row comes back untouched.
      const replacingTurn = appendRound ? null : surfaceTurnOfSeq(sessionEvents(session), oldSeq)
      const replacedUid = index === null ? '' : legacyMessageUid(original.messages[index], index)
      await chats.update(chatId, current => {
        if (agent.phase?.kind === 'running' || current.regenInProgress) throw error('TAVERN_PLUGIN_BUSY', '当前对话正忙')
        if (index !== null) assertRegenerationSourceCurrent({ originalChat: original, currentChat: current, assistantIndex: index, inputIndex })
        else if (!isDeepStrictEqual(current.messages, original.messages)) throw error('TAVERN_PLUGIN_STALE_VERSION', '失败输入之前的历史已经变化')
        if (!isDeepStrictEqual(current.timeline, original.timeline)) throw error('TAVERN_PLUGIN_STALE_VERSION', '本轮状态已经变化')
        current.regenInProgress = true
        current.regenRecovery = { id: operationId, phase: 'prepared', detached: true,
          beforeRevision: Number(current._storageRevision || 0), sessionId, eventStart,
          temporaryReplacingTurn: replacingTurn, targetMessageUid: replacedUid }
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        return current
      }, { source: 'foreground.plugin-regen-begin' })
      marked = true
      await phase('generating')
      signal?.throwIfAborted()
      const fingerprint = createHash('sha256').update(JSON.stringify({ ...materials, digest: undefined,
        target: { ...materials.target, operationId: undefined }, providerId })).digest('hex')
      const reusable = original.bodyGenerationCandidate?.fingerprint === fingerprint && original.bodyGenerationCandidate?.providerId === providerId
        ? original.bodyGenerationCandidate : null
      const snapshot = reusable?.snapshot || await prepare?.({ gameId: sessionId, reason: failedMode ? 'retry' : 'regenerate', signal })
      await chats.update(chatId, current => {
        assertCurrent(current, original, index, inputIndex, operationId)
        current.regenRecovery.generation = { provider: providerId, snapshot: clone(snapshot), materialsDigest: materials.digest, status: 'running' }
        return current
      }, { source: 'foreground.plugin-regen-config' })
      const generation = Promise.resolve().then(() => reusable ? { text: reusable.text } : generate({ materials: clone(materials), snapshot, signal }))
      const candidate = await (signal ? untilAborted(generation, signal) : generation)
      signal?.throwIfAborted()
      const body = typeof candidate === 'string' ? candidate : candidate?.text
      if (typeof body !== 'string' || !body.trim() || body.length > 200000) throw error('TAVERN_PLUGIN_INVALID_BODY', '插件必须返回非空正文，且不能超过 200000 字符')
      await validateProvider?.()
      await chats.update(chatId, current => {
        signal?.throwIfAborted()
        assertCurrent(current, original, index, inputIndex, operationId)
        current.regenRecovery.candidate = { fingerprint, providerId, snapshot: clone(snapshot), text: body }
        return current
      }, { source: 'foreground.plugin-regen-candidate' })
      await phase('validating')
      signal?.throwIfAborted()
      // Input macros and template side effects have already run in the original
      // preparation. Restore their frozen result; never replay historical scripts.
      let draft = timeline.apply({ chat: original, intent: failedMode ? { kind: 'replacement.abort', restoreChat: beforeChat }
        : { kind: 'turn.rollback', turn: oldTurn, beforeChat } }).chat
      const inputState = frame?.source?.regenerationState
      if (inputState?.version === 1) {
        for (const key of INPUT_STATE_FIELDS) {
          if (Object.hasOwn(inputState, key)) draft[key] = clone(inputState[key])
          else delete draft[key]
        }
        consumeScriptPrompts(draft)
        delete draft.ledgerInjection
      }
      const projected = typeof prepareRegenerationReply === 'function'
        ? await prepareRegenerationReply({ chat: draft, card, turn: bodyTurn, text: body }) : null
      const prose = projected ? replyProse(projected.sourceText ?? body, projected) : plainReplyProse(body)
      if (!text(prose.text).trim()) throw error('TAVERN_PLUGIN_INVALID_BODY', '插件正文处理后为空')
      const originalUser = failedMode ? { role: 'user', text: failedInput, native: true,
        ...(failed.inputAttachments?.length ? { inputAttachments: clone(failed.inputAttachments) } : {}) }
        : inputRow ? clone(inputRow) : null
      const previousVariables = lastTavernHelperVariables(originalUser ? [originalUser] : []) ?? lastTavernHelperVariables(beforeChat.messages)
      const oldRow = failedMode ? {} : original.messages[index]
      const row = { role: 'assistant', ...prose, native: true, turn: bodyTurn, ts: Date.now(), swipeId: 0, bodyRegenerationProcessed: true,
        swipes: [prose.projectionText], ...(oldRow.nativeAnchor ? { nativeAnchor: clone(oldRow.nativeAnchor) } : {}),
        ...(oldRow.stagePageVersion ? { stagePageVersion: oldRow.stagePageVersion } : {}) }
      if (previousVariables !== undefined) row.variables = [clone(previousVariables)]
      if (draft.mvu?.enabled && draft.mvu.owner === 'official') {
        row.variables = [clone(previousVariables || {})]
        row.mvu = { pending: true, modified: false, diagnostics: [], events: [] }
      }
      // Script progression has already been prepared with this exact input.
      if ((draft.mode || 'story') === 'script') {
        const script = await deps.scripts.read(draft.cardPath)
        if (!script) throw new Error('剧本文件不可读取')
        const progressed = deps.scripts.continuity.transition({ script, state: draft.scriptState,
          event: { kind: 'commit', userText: text(originalUser?.text), nativeTurn: failedMode ? oldTurn : bodyTurn } })
        draft.scriptState = progressed.state
      }
      const begun = timeline.apply({ chat: draft, intent: { kind: 'body.begin', turn: bodyTurn, userText: text(originalUser?.text) } })
      draft = begun.chat
      const bodyOperation = draft.timeline.operations[begun.value.operationId]
      // The new checkpoint must still return to the ORIGINAL pre-turn revision,
      // never the old completed body that remained visible during generation.
      bodyOperation.beforeRevision = checkpoint.beforeRevision || 0
      bodyOperation.beforeParticipants = clone(checkpoint.participants || beforeChat.timeline?.participants || {})
      if (frame) {
        draft.foregroundFrames = { ...draft.foregroundFrames, [bodyOperation.id]: { ...clone(frame),
          frameId: 'foreground:' + chatId + ':' + draft.timeline.branchId + ':' + bodyOperation.id,
          operationId: bodyOperation.id, branchId: draft.timeline.branchId, basedOnRevision: bodyOperation.basedOn.revision,
          ...(failedMode ? { turn: bodyTurn } : {}) } }
      }
      const completed = timeline.complete({ chat: draft, operationId: bodyOperation.id, basedOn: bodyOperation.basedOn,
        outcome: { status: 'success' }, apply(current) {
          if (failedMode) current.messages = clone(original.messages).concat([originalUser, row])
          else {
            const replaced = replaceLastRound({ originalChat: original, regeneratedChat: current, replacement: row, assistantIndex: index, inputIndex })
            // A save-only row receives its new full or reply-only anchor during
            // recovery; the stale anchor of the missing body must not survive.
            if (saveOnly) delete replaced.chat.messages[index].nativeAnchor
            current.messages = replaced.chat.messages
          }
          delete current.promptTemplateInput
          current.settleStatus = 'pending'
          current.settleError = null
          current.lastSettle = null
          current.foregroundError = null
          current.presentationWarnings = clone(prose.projectionWarnings || [])
        } })
      if (completed.value.status !== 'committed') throw error('TAVERN_PLUGIN_STALE_VERSION', '正文提交条件已失效')
      draft = completed.chat
      if (failedMode) {
        draft.suppressedDshTurns = [...new Set([...(original.suppressedDshTurns || []), oldTurn])].sort((a, b) => a - b)
        draft.nativeCommits = { ...draft.nativeCommits, [String(bodyTurn)]: { turn: bodyTurn, userText: failedInput, committedAt: Date.now() } }
        if (draft.userInputEdits?.[String(oldTurn)]) { draft.userInputEdits = { ...draft.userInputEdits }; delete draft.userInputEdits[String(oldTurn)] }
      }
      if (checkpoint.before !== undefined) draft.timeline.checkpoints.at(-1).before = clone(checkpoint.before)
      projection.data.message.content = [{ type: 'text', text: prose.text }]
      signal?.throwIfAborted()
      let saved = await chats.update(chatId, async current => {
        await validateProvider?.()
        signal?.throwIfAborted()
        if (agent.phase?.kind === 'running') throw error('TAVERN_PLUGIN_STALE_VERSION', '前台已开始新一轮')
        assertCurrent(current, original, index, inputIndex, operationId)
        // 别的插件/后台写几条上下文不算本轮失效：只要玩家没有新输入、旧正文还在面上。
        if (playerInputSince(session, eventStart) || (!appendRound && !bodyStillOnSurface(session, oldSeq, oldTurn))) throw error('TAVERN_PLUGIN_STALE_VERSION', '模型会话已经变化')
        // Keep concurrent non-story settings; only story-owned fields come from
        // the detached rollback/commit. No hidden provider transcript is stored.
        for (const key of ['messages', 'timeline', 'foregroundFrames', ...INPUT_STATE_FIELDS, 'posture', 'ledger', 'candidates',
          'settleStatus', 'settleError', 'lastSettle', 'foregroundError', 'presentationWarnings', 'candidateAgent',
          ...(failedMode ? ['suppressedDshTurns', 'nativeCommits', 'userInputEdits'] : [])]) {
          if (Object.hasOwn(draft, key)) current[key] = clone(draft[key])
          else delete current[key]
        }
        current.regenRecovery = { ...current.regenRecovery, phase: 'committed', projection }
        delete current.bodyGenerationCandidate
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        return current
      }, { source: 'foreground.plugin-regen-commit' })
      committed = true
      await phase('committed')
      saved = await recovery.complete({ chatId, session, operationId }) || saved
      try { await notifyRegeneration?.(sessionId, { turn: bodyTurn }) } catch { /* The committed story must still reach settlement. */ }
      try { await replyCommitted?.(sessionId) } catch { /* Listeners do not own the story commit. */ }
      await phase('settling')
      try { await queueSettlement(chatId) }
      catch (cause) {
        await chats.update(chatId, current => {
          // A later branch must not inherit this operation's settlement failure.
          if (current.timeline?.branchId !== saved.timeline?.branchId || current.timeline?.revision !== saved.timeline?.revision) return current
          current.settleStatus = 'failed'
          current.settleError = String(cause?.message || cause)
          return current
        }, { source: 'settlement.plugin-regen-failed' })
      }
      const latest = await chats.read(chatId) || saved
      return { gameId: sessionId, turn: bodyTurn, textVersion: computeSceneTarget(latest, bodyTurn).key,
        text: prose.text, settlement: latest.settleStatus, ...(latest.settleError ? { settlementError: latest.settleError } : {}) }
    } catch (cause) {
      if (marked && !committed) await releasePrepared(chatId, operationId)
      // A rejected candidate must not leave the old body's interrupted
      // settlement holding a permanent running slot. Never recover unrelated
      // tasks or resume after a user edit, stop, new turn or branch change.
      if (!committed && interruptedSettlement) {
        try {
          const base = interruptedSettlement.chat
          let resume = false
          await chats.update(chatId, current => {
            if (!current || current.regenInProgress || sessions.get(sessionId)?.phase?.kind === 'running'
              || sessionEvents(interruptedSettlement.session).length !== interruptedSettlement.eventCount
              || !isDeepStrictEqual(current.timeline, base.timeline)
              || !isDeepStrictEqual(current.messages, base.messages)
              || [...INPUT_STATE_FIELDS, 'posture', 'settleStatus', 'settleError'].some(key => !isDeepStrictEqual(current[key], base[key]))) return current
            let next = current
            for (const operation of Object.values(base.timeline.operations || {})) {
              if (operation.kind !== 'agent' || operation.role !== 'settlement' || operation.status !== 'running') continue
              next = timeline.complete({ chat: next, operationId: operation.id, basedOn: operation.basedOn,
                outcome: { status: 'failed', stateChanged: false } }).chat
            }
            next.settleStatus = 'pending'
            next.settleError = null
            resume = true
            return next
          }, { source: 'settlement.plugin-regen-resume' })
          if (resume) void Promise.resolve(queueSettlement(chatId)).catch(failure =>
            console.warn('dsh-tavern: 原正文后台结算恢复失败:', String(failure?.message || failure)))
        } catch (failure) {
          console.warn('dsh-tavern: 原正文后台结算恢复失败:', String(failure?.message || failure))
        }
      }
      throw cause
    } finally { pendingRegenerations.delete(chatId) }
  }
}

// The session grows while a provider streams (context frames, tool results). Only a
// new player input means the round this generation belongs to is gone.
function playerInputSince(session, eventStart) {
  return sessionEvents(session).slice(eventStart).some(event => isNewPlayerInput(event))
}

// 被替换的那一行可能已经被投影/修复换了 seq：认轮，不认 seq。
function bodyStillOnSurface(session, oldSeq, oldTurn) {
  const nodes = session.surface?.nodes || []
  if (nodes.includes(oldSeq)) return true
  const events = sessionEvents(session)
  return nodes.some(seq => {
    const event = events.find(item => Number(item.seq) === Number(seq))
    if (!event || event.type !== 'assistant/message') return false
    const declared = Number(event.data?.message?.source?.tavernStoryTurn)
    return Number(event.data?.turn) === Number(oldTurn) || (Number.isSafeInteger(oldTurn) && oldTurn > 0 && declared === Number(oldTurn))
  })
}

function storyTurnOfEvent(event) {
  const original = event?.type === 'assistant/message' ? event.data?.message?.source?.tavernStoryTurn : undefined
  return Number.isSafeInteger(Number(original)) ? Number(original) : Number(event?.data?.turn)
}
