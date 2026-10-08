import { createImmutableTurnFields } from './freeze-json.js'
import { createMvuReceiptIndex } from './mvu-receipt-index.js'
import { copyJsonTree } from './copy-json-tree.js'
import { copyLazyHistoryHeader } from './lazy-history-read.js'
import { rollbackAvailability, hasRollbackMessages, failedTurnReplayAvailability, foregroundSuppressedTurns, supersededRegenerationErrorTurns } from './rollback-surface.js'
import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { canUndoRollback } from './surface-restoration.js'
import { failedErrorTurnStates } from './failed-error-visibility.js'

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
    'cardName', 'requestMode', 'statusBarPlacement', 'webSearchEnabled', 'candidates', 'taskMailbox', 'regenInProgress',
    'settleError', 'scriptState', 'hiddenDshErrorTurns', 'suppressedDshTurns', 'regeneratedDshTurns', 'tavernHelperLifecycleRevision']) {
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
      turn: saved.turn, foreground: { afterCount: saved.foreground?.afterCount }
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
  function rollbackViewFields(chat, evidence = evidenceOf(chat.sessionId), changes) {
    const mappings = normalizedMappings(chat, changes)
    if (sharedMappings && !mappingIds.has(mappings)) mappingIds.set(mappings, ++mappingSequence)
    const session = evidence.session, events = evidence.events
    const nodes = session?.surface?.nodes
    // Only the native immutable-log contract supplies a reliable O(1) stamp.
    // Legacy mutable evidence always runs the original inspection.
    const generation = session?.surface?.replaceGeneration
    const native = session?.header?.version >= 3 && typeof session.snapshotEvents === 'function'
      && Array.isArray(events) && Object.isFrozen(events) && Array.isArray(nodes) && Number.isSafeInteger(generation)
    const key = native ? JSON.stringify([chat.sessionId,chat.messages?.length,chat.tavernHelperLifecycleRevision,
      chat.importHistory?.rescue,chat.importHistory?.operationId,chat.hiddenDshErrorTurns,chat.suppressedDshTurns,sharedMappings ? mappingIds.get(mappings) : chat.regeneratedDshTurns,
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
    const result = {
      hiddenDshErrorTurns: chat.hiddenDshErrorTurns || [],
      suppressedDshTurns: foregroundSuppressedTurns(chat, evidence.events || []),
      regeneratedDshTurns: mappings,
      suppressedDshErrorTurns: supersededRegenerationErrorTurns({ events: evidence.events || [], suppressedDshTurns: chat.suppressedDshTurns }),
      staleDshErrorTurns: failures.staleTurns,
      filteredFailureStreak: failures.filteredStreak,
      canRegenerate: hasRound && !isRescuedHistoryMessage(chat, chat.messages?.findLast(message => message.role === 'assistant')),
      canEditBody: hasRound,
      rollbackTargetTurn: settlementTurn(chat),
      canReplayFailedTurn: replayTarget !== null,
      replayFailedTurn: replayTarget === null ? null : replayTarget.turn,
      canRollback: rollbackState.canRollback,
      canClearIncompleteReply: rollbackState.canClearIncompleteReply,
      undoRollbackTurn: canUndoRollback(chat, evidence.session) ? chat.rollbackUndo.turn : null,
      rollbackUnavailableReason: rollbackState.reason
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
    'backgroundModelSelection', 'backgroundModelRevision', 'imageModelSelection', 'backgroundTasks', 'webSearchEnabled', 'sceneImagesEnabled', 'cardContextRevision']) {
    if (Object.hasOwn(chat, key)) selected[key] = chat[key]
  }
  selected.backgroundSessionStatus = chat.timeline?.participants?.background?.status
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
    sceneImagesEnabled: chat.sceneImagesEnabled,
    messages: (chat.messages || []).map(message => ({
      role: message.role, turn: message.turn, greeting: message.greeting,
      text: message.text, sourceText: message.sourceText, swipeId: message.swipeId,
      // Keep indices stable: only the active swipe participates in scene identity.
      swipes: Array.isArray(message.swipes) ? message.swipes.map((text, index) =>
        index === Math.max(0, Number(message.swipeId) || 0) ? text : null) : undefined
    }))
  })
}
