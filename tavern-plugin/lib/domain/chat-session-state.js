import { createImmutableTurnFields } from './freeze-json.js'
import { createMvuReceiptIndex } from './mvu-receipt-index.js'
import { copyJsonTree } from './copy-json-tree.js'
import { copyLazyHistoryHeader } from './lazy-history-read.js'
import { rollbackAvailability, hasRollbackMessages, failedTurnReplayAvailability, foregroundSuppressedTurns, supersededRegenerationErrorTurns, supersededRegenerationTurns, projectedReplyTurns, regenerationInputTurns, keptPlayerInputTurns } from './rollback-surface.js'
import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { canUndoRollback } from './surface-restoration.js'
import { failedErrorTurnStates } from './failed-error-visibility.js'
import { surfaceTurns } from './host-turn-rail.js'

export function pendingMvuSettlementState(chat) {
  if (Object.hasOwn(chat, 'pendingMvuSettlement')) return chat.pendingMvuSettlement
  // Retry eligibility needs only the newest pending assistant and two flags,
  // never the saved command, prepared effect, or historical variable snapshots.
  const pending = (Array.isArray(chat.messages) ? chat.messages : []).findLast(message =>
    message?.role === 'assistant' && message.mvu?.pending === true)
  return pending ? {
    hasSubmission: Boolean(pending.mvu.pendingSubmission),
    prepared: Boolean(pending.mvu.delivery?.prepared)
  } : null
}

// Detached inputs for session activity, retry eligibility and cache-hit view fields.
// This is not a writable Chat or a source for rebuilding history projections.
export function projectChatSessionState(chat, options = {}) {
  const pendingMvuSettlement = Object.hasOwn(options,"pendingMvuSettlement") ? options.pendingMvuSettlement : pendingMvuSettlementState(chat)
  // Legacy timeline inspection migrates a foreground body using its full text.
  if (Object.values(chat.timeline?.operations || {}).some(operation =>
    operation?.kind === 'body' && operation.status === 'foreground-completed')) return { ...copyJsonTree(chat), pendingMvuSettlement }
  const selected = { pendingMvuSettlement }
  for (const key of ['id', 'sessionId', '_storageRevision', 'mode', 'cardPath', 'cardContextRevision',
    'backgroundConfigVersion', 'conversationFeaturesVersion', 'disabledWritingSkills', 'contextCompaction', 'updatedAt', 'timeline', 'candidateAgent',
    'cardName', 'requestMode', 'statusBarPlacement', 'statusSections', 'webSearchEnabled', 'candidates', 'taskMailbox', 'regenInProgress',
    'settleError', 'scriptState', 'hiddenDshErrorTurns', 'suppressedDshTurns', 'replacingDshTurns', 'regeneratedDshTurns', 'userInputEdits', 'tavernHelperLifecycleRevision']) {
    if (Object.hasOwn(chat, key)) selected[key] = chat[key]
  }
  if (chat.importHistory) selected.importHistory = {
    rescue: Boolean(chat.importHistory.rescue), operationId: chat.importHistory.operationId
  }
  if (chat.rollbackUndo) {
    const saved = chat.rollbackUndo
    selected.rollbackUndo = {
      version: saved.version, ready: saved.ready, branchId: saved.branchId, revision: saved.revision,
      lifecycleRevision: saved.lifecycleRevision, storageRevision: saved.storageRevision,
      turn: saved.turn, foreground: { afterCount: saved.foreground?.afterCount,
        ...(saved.foreground?.formatVersion ? { formatVersion: saved.foreground.formatVersion } : {}),
        ...(saved.foreground?.sessionId ? { sessionId: saved.foreground.sessionId } : {}) },
      ...(saved.background ? { background: saved.background.map(checkpoint => ({ sessionId: checkpoint.sessionId, formatVersion: checkpoint.formatVersion })) } : {})
    }
  }
  if (options.messages) return {...copyLazyHistoryHeader(selected),messages:options.messages}
  selected.messages = (Array.isArray(chat.messages) ? chat.messages : []).map(projectSessionMessage)
  return copyJsonTree(selected)
}

export function projectSessionMessage(message) {
  if (!message || typeof message !== 'object') return message
  return {
    role: message.role, turn: message.turn, greeting: message.greeting,
    ...(message.importSource ? {importSource:{operationId:message.importSource.operationId}} : {}),
    ...(message.mvu ? {mvu:{receipt:message.mvu.receipt,diagnostics:message.mvu.diagnostics,
      pending:message.mvu.pending,modified:message.mvu.modified}} : {})
  }
}

export function settlementTurn(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message && message.role === 'assistant' && Number.isFinite(Number(message.turn))) return Number(message.turn)
    }
    return 0
  }

export function createSessionStateView({ activity: activityOf, evidence: evidenceOf, sharedReceipts = false, sharedMappings = false }) {
  const receiptIndex = createMvuReceiptIndex({shared:sharedReceipts})
  const rollbackCache = new Map()
  const mappingCache = new Map(), mappingIds = new WeakMap(), mappingFields = createImmutableTurnFields()
  let mappingSequence = 0
  function normalizedMappings(chat, changes) {
    const previous = sharedMappings && mappingCache.get(chat.id)
    const revision = chat._storageRevision
    if (previous && Number.isSafeInteger(revision) && (previous.revision === revision
      || previous.revision === changes?.baseRevision && Array.isArray(changes?.changedHeaderFields)
        && !changes.changedHeaderFields.includes('regeneratedDshTurns'))) {
      if (revision >= previous.revision) previous.revision = revision
      return previous.value
    }
    const source = chat.regeneratedDshTurns
    const normalized = Object.fromEntries(Object.entries(source && typeof source === 'object' && !Array.isArray(source) ? source : {})
      .map(([turn, visibleTurn]) => [String(Number(turn)), Number(visibleTurn)])
      .filter(([turn, visibleTurn]) => Number.isSafeInteger(Number(turn)) && Number(turn) > 0 && Number.isSafeInteger(visibleTurn) && visibleTurn > 0))
    const value = sharedMappings ? mappingFields.from(normalized) : normalized
    if (sharedMappings && chat.id && Number.isSafeInteger(revision) && mappingFields.bytes(value) <= 8*1024*1024
      && (!previous || revision >= previous.revision)) {
      mappingCache.delete(chat.id); mappingCache.set(chat.id, { revision, value })
      while (mappingCache.size > 8) mappingCache.delete(mappingCache.keys().next().value)
    }
    return value
  }
  function copyRollback(value) {
    return sharedMappings ? { ...copyJsonTree({...value,regeneratedDshTurns:undefined}), regeneratedDshTurns:value.regeneratedDshTurns } : copyJsonTree(value)
  }

  function mvuReceiptsOf(chat, changes) { return receiptIndex(chat,activityOf(chat),changes) }
  // Rounds whose old reply is being replaced right now. Only the reply is hidden;
  // the player's own input stays visible, otherwise the page reads as if the
  // message he just sent was deleted. `suppressedDshTurns` is the other thing:
  // a whole turn that is void (failed residue, rolled-back surface).
  function replacingDshTurnsOf(chat) {
    const turns = new Set((Array.isArray(chat.replacingDshTurns) ? chat.replacingDshTurns : [])
      .map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))
    // A save interrupted mid-regeneration keeps the marker in its recovery record.
    if (chat.regenInProgress === true) {
      const temporary = Number(chat.regenRecovery?.temporaryReplacingTurn)
      if (Number.isSafeInteger(temporary) && temporary > 0) turns.add(temporary)
    }
    return [...turns].sort((left, right) => left - right)
  }
  // The mapping feeds the cache key below, so it runs on every read: remember it per
  // immutable log and surface, or a variable-only revision rescans the whole history.
  const projectedCache = new WeakMap()
  function projectedOf(events, nodes, generation) {
    if (!Array.isArray(nodes) || !Array.isArray(events)) return new Map()
    const frozen = Object.isFrozen(events) && Number.isSafeInteger(generation)
    const stamp = frozen ? JSON.stringify([nodes.length, nodes[0], nodes.at(-1), generation]) : null
    const known = frozen ? projectedCache.get(events) : undefined
    if (known && known.stamp === stamp) return known.value
    const value = projectedReplyTurns({ events, nodes })
    if (frozen) projectedCache.set(events, { stamp, value })
    return value
  }
  function rollbackViewFields(chat, evidence = evidenceOf(chat.sessionId), changes) {
    const session = evidence.session, events = evidence.events
    const nodes = session?.surface?.nodes
    // The save records the synthetic generation turn, but the committed body is
    // projected AFTER the commit, into an edit turn of its own. Hiding by the
    // saved number therefore leaves the obsolete turn on screen next to the new
    // body — two replies for one round, and a reload cannot help because both
    // numbers are in the log. The projection event knows where the body really
    // is (it carries the story turn), so the log wins over the header here.
    const projected = projectedOf(events, nodes, session?.surface?.replaceGeneration)
    const savedMappings = normalizedMappings(chat, changes)
    // Reuse the shared object whenever the log agrees with the header: building a
    // fresh map on every read would defeat the shared-mapping cache.
    const stale = [...projected].some(([story, turn]) => Number(savedMappings[String(story)]) !== Number(turn))
    const mappings = stale ? { ...savedMappings, ...Object.fromEntries(projected) } : savedMappings
    if (sharedMappings && !mappingIds.has(mappings)) mappingIds.set(mappings, ++mappingSequence)
    // Only the native immutable-log contract supplies a reliable O(1) stamp.
    // Legacy mutable evidence always runs the original inspection.
    const generation = session?.surface?.replaceGeneration
    const native = session?.header?.version >= 3 && typeof session.snapshotEvents === 'function'
      && Array.isArray(events) && Object.isFrozen(events) && Array.isArray(nodes) && Number.isSafeInteger(generation)
    const key = native ? JSON.stringify([chat.sessionId,chat.messages?.length,chat.tavernHelperLifecycleRevision,
      chat.importHistory?.rescue,chat.importHistory?.operationId,chat.hiddenDshErrorTurns,chat.suppressedDshTurns,
      chat.replacingDshTurns, chat.regenInProgress, chat.regenRecovery?.temporaryReplacingTurn,
      sharedMappings ? mappingIds.get(mappings) : chat.regeneratedDshTurns,
      nodes.length,nodes[0],nodes.at(-1),generation]) : null
    const previous = rollbackCache.get(chat.id)
    if (native && changes?.layoutChanged === false && previous?.session.deref() === session
      && previous.events.deref() === events && previous.key === key
      && (previous.revision === chat._storageRevision || previous.revision === changes.baseRevision)) {
      previous.revision = chat._storageRevision
      return {...copyRollback(previous.value),undoRollbackTurn:canUndoRollback(chat,session) ? chat.rollbackUndo.turn : null}
    }
    const rollbackState = Array.isArray(nodes) ? rollbackAvailability(chat, { events: evidence.events, nodes }) : {
      canRollback: false, canClearIncompleteReply: false,
      reason: '当前会话的消息流尚未加载，请重新打开对话后重试；历史正文仍保留。'
    }
    const replayTarget = Array.isArray(nodes) ? failedTurnReplayAvailability({ events: evidence.events || [], nodes, cleared: chat.suppressedDshTurns || [] }).target : null
    const hasRound = hasRollbackMessages(chat.messages)
    const failures = failedErrorTurnStates(evidence.events || [], chat.suppressedDshTurns)
    const replacingTurns = replacingDshTurnsOf(chat)
    // Native turns whose body was replaced by a projection. The host keeps painting
    // the rows it already built for them, so the page shows the old body next to
    // the new one until these turns are hidden. Read from the log, not from a
    // transient marker: a reload must hide them too.
    const supersededTurns = Array.isArray(nodes) ? supersededRegenerationTurns({ events: evidence.events || [], nodes, keepTurns: Object.values(mappings || {}) }) : []
    // Regeneration attempts, found by their input rather than by the number the save
    // stored (a renumbering turn repair shifts that number onto the next turn). One
    // still settling stays visible until its body is mapped: hiding it earlier would
    // blank the round between generation and commit.
    const shownTurns = new Set(Object.values(mappings || {}).map(Number))
    const attemptTurns = regenerationInputTurns(evidence.events || [])
      .filter(turn => shownTurns.has(turn) || chat.regenInProgress !== true)
    const suppressedDshTurns = [...new Set([...foregroundSuppressedTurns(chat, evidence.events || []), ...attemptTurns])]
      .filter(turn => !replacingTurns.includes(turn)).sort((left, right) => left - right)
    // A failed input can be adopted by a retry: its native turn stays suppressed while
    // the drawn body lives in another turn. Keep the player's nearest message visible
    // for the last reply and for the attempt now running, so the page still shows what
    // the round is answering. Older failed residue keeps the existing hiding rules.
    const replyTurns = new Set(shownTurns)
    for (const message of chat.messages || []) {
      if (message?.role === 'assistant' && message.greeting !== true && Number(message.turn) > 0) replyTurns.add(Number(message.turn))
    }
    for (const turn of supersededTurns) replyTurns.delete(Number(turn))
    for (const turn of replacingTurns) replyTurns.delete(Number(turn))
    let openTurn = null
    if (chat.regenInProgress === true) {
      for (const event of evidence.events || []) if (event?.type === 'turn/start') openTurn = Number(event.data?.turn)
    }
    if (openTurn > 0) replyTurns.add(openTurn)
    const keptInputTurns = keptPlayerInputTurns({ events: evidence.events || [], replyTurns: [...replyTurns], suppressed: suppressedDshTurns, openTurn })
    const result = {
      hiddenDshErrorTurns: chat.hiddenDshErrorTurns || [],
      suppressedDshTurns,
      keptInputTurns,
      replacingDshTurns: replacingTurns,
      supersededDshTurns: supersededTurns,
      regeneratedDshTurns: mappings,
      suppressedDshErrorTurns: supersededRegenerationErrorTurns({ events: evidence.events || [], suppressedDshTurns: chat.suppressedDshTurns }),
      staleDshErrorTurns: failures.staleTurns,
      filteredFailureStreak: failures.filteredStreak,
      // 对话右侧的轮次导航按轮次画刻度：正文表面里还有内容的那几轮才该出现（重试留下的空轮不算）。
      // 会话还没挂上（读不到表面）时不写这一栏：不知道就别筛，免得把能跳的轮次一起藏掉。
      ...(Array.isArray(nodes) && Array.isArray(events) ? { railTurns: surfaceTurns({ events, nodes }) } : {}),
      canRegenerate: hasRound && !isRescuedHistoryMessage(chat, chat.messages?.findLast(message => message.role === 'assistant')),
      canEditBody: hasRound,
      rollbackTargetTurn: settlementTurn(chat),
      canReplayFailedTurn: replayTarget !== null,
      replayFailedTurn: replayTarget === null ? null : replayTarget.turn,
      // The save decides: a round the native surface lost is repaired, not refused.
      canRollback: rollbackState.canRollback || hasRound,
      canClearIncompleteReply: rollbackState.canClearIncompleteReply,
      undoRollbackTurn: canUndoRollback(chat, evidence.session) ? chat.rollbackUndo.turn : null,
      rollbackUnavailableReason: rollbackState.canRollback || hasRound ? '' : rollbackState.reason
    }
    if (native && chat.id && Number.isSafeInteger(chat._storageRevision)
      && key.length + (sharedMappings ? JSON.stringify({...result,regeneratedDshTurns:undefined}).length + mappingFields.bytes(mappings) : JSON.stringify(result).length) < 1024*1024) {
      rollbackCache.delete(chat.id)
      rollbackCache.set(chat.id,{key,revision:chat._storageRevision,session:new WeakRef(session),events:new WeakRef(events),value:copyRollback(result)})
      while(rollbackCache.size>8)rollbackCache.delete(rollbackCache.keys().next().value)
    }
    return result
  }

  // Cache hits receive projectChatSessionState; keep its inputs in sync with
  // these readers (including rollback and MVU receipts), not full history.
  function volatileSessionViewFields(chat, activity, changes) {
    let scriptProgress = null
    const rollback = rollbackViewFields(chat,undefined,changes)
    return {
      ...rollback,
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      settleError: activity.reason === 'interrupted' ? '后台结算已中断，请重试结算。' : (chat.settleError || null),
      settlementTurn: rollback.rollbackTargetTurn,
      scriptProgress,
      statusBarPlacement: chat.statusBarPlacement === 'body' ? 'body' : 'sidebar',
      updatedAt: chat.updatedAt || 0,
      // Compaction writes only this header field; cached views must not keep a stale notice.
      contextCompaction: chat.contextCompaction || null,
      mvuReceipts: mvuReceiptsOf(chat, changes)
    }
  }

  function status(chat) {
    if (!chat) return null
    const activity = activityOf(chat)
    return {
      chatId: chat.id,
      phase: activity.phase,
      busy: activity.busy,
      role: activity.role,
      operationId: activity.operationId,
      basedOn: activity.basedOn,
      updatedAt: activity.updatedAt || chat.updatedAt || 0
    }
  }
  return Object.freeze({ status, receipts: mvuReceiptsOf, rollback: rollbackViewFields, volatile: volatileSessionViewFields })
}

// Read-only capture input. Infer legacy turns from user messages and detach
// only the selected diagnostic payload.
export function projectDisplayRuntimeState(chat, requestedTurn) {
  let inferred = 1, messageIndex = -1, latestTurn = 1
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message?.role === 'user') inferred++
    if (message?.role !== 'assistant') continue
    latestTurn = Math.max(latestTurn, Math.max(1, Number(message.turn) || 1))
    if (messageIndex < 0 && Math.max(1, Number(message.turn) || (message.greeting === true ? 1 : inferred)) === requestedTurn) messageIndex = index
  }
  return structuredClone({
    id: chat.id, sessionId: chat.sessionId, mode: chat.mode, _storageRevision: chat._storageRevision,
    backgroundConfigVersion: chat.backgroundConfigVersion, conversationFeaturesVersion: chat.conversationFeaturesVersion,
    updatedAt: chat.updatedAt, messageIndex, latestTurn,
    displayRuntime: messageIndex < 0 ? undefined : messages[messageIndex].displayRuntime,
    rollbackUndo: chat.rollbackUndo ? { ready: chat.rollbackUndo.ready, storageRevision: chat.rollbackUndo.storageRevision } : undefined
  })
}

// Task startup configuration is independent of message and operation history.
export function projectChatBackgroundConfig(chat) {
  const selected = {}
  for (const key of ['id', 'sessionId', 'mode', 'backgroundConfigVersion', 'conversationFeaturesVersion',
    'backgroundModelSelection', 'backgroundModelRevision', 'backgroundTasks','worldbookStrategy', 'webSearchEnabled', 'disabledForegroundTools', 'cardContextRevision']) {
    if (Object.hasOwn(chat, key)) selected[key] = chat[key]
  }
  selected.backgroundSessionStatus = chat.timeline?.participants?.background?.status
  if (chat.mvu) selected.mvu = { enabled: chat.mvu.enabled, owner: chat.mvu.owner }
  return structuredClone(selected)
}

// A checkpoint callback may edit its target message, never unrelated history.
// Legacy foreground migration requires the full Chat and uses the old path.
export function projectSettlementCheckpoint(chat, messageId, operationId) {
  if (chat.timeline?.schemaVersion !== 1 || !Number.isSafeInteger(messageId) || messageId < 0
    || !chat.messages?.[messageId] || Object.values(chat.timeline.operations || {}).some(operation =>
      operation?.kind === 'body' && operation.status === 'foreground-completed')) return undefined
  const operation = chat.timeline.operations?.[operationId]
  return { chat: structuredClone({
    id: chat.id, sessionId: chat.sessionId, _storageRevision: chat._storageRevision,
    tavernHelperLifecycleRevision: chat.tavernHelperLifecycleRevision,
    timeline: { schemaVersion: 1, branchId: chat.timeline.branchId, revision: chat.timeline.revision,
      operations: operation ? { [operationId]: operation } : {} },
    messages: [chat.messages[messageId]]
  }) }
}

// Scene identity needs story text, but never MVU snapshots, card data or display artifacts.
export function projectSceneImageState(chat) {
  return copyJsonTree({
    id: chat.id, sessionId: chat.sessionId, mode: chat.mode,
    backgroundConfigVersion: chat.backgroundConfigVersion,
    conversationFeaturesVersion: chat.conversationFeaturesVersion,
    messages: (chat.messages || []).map(message => ({
      role: message.role, turn: message.turn, greeting: message.greeting,
      text: message.text, sourceText: message.sourceText, swipeId: message.swipeId,
      // Keep indices stable: only the active swipe participates in scene identity.
      swipes: Array.isArray(message.swipes) ? message.swipes.map((text, index) =>
        index === Math.max(0, Number(message.swipeId) || 0) ? text : null) : undefined
    }))
  })
}
