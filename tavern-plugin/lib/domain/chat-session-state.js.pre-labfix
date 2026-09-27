import { rollbackAvailability, hasRollbackMessages, failedTurnReplayAvailability, foregroundSuppressedTurns, supersededRegenerationErrorTurns } from './rollback-surface.js'
import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { canUndoRollback } from './surface-restoration.js'
const str = value => String(value ?? '')

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
export function projectChatSessionState(chat) {
  const pendingMvuSettlement = pendingMvuSettlementState(chat)
  // Legacy timeline inspection migrates a foreground body using its full text.
  if (Object.values(chat.timeline?.operations || {}).some(operation =>
    operation?.kind === 'body' && operation.status === 'foreground-completed')) return { ...structuredClone(chat), pendingMvuSettlement }
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
  selected.messages = (Array.isArray(chat.messages) ? chat.messages : []).map(message => {
    if (!message || typeof message !== 'object') return message
    return {
      role: message.role, turn: message.turn, greeting: message.greeting,
      ...(message.importSource ? { importSource: { operationId: message.importSource.operationId } } : {}),
      ...(message.mvu ? { mvu: {
        receipt: message.mvu.receipt, diagnostics: message.mvu.diagnostics,
        pending: message.mvu.pending, modified: message.mvu.modified
      } } : {})
    }
  })
  return structuredClone(selected)
}

export function settlementTurn(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message && message.role === 'assistant' && Number.isFinite(Number(message.turn))) return Number(message.turn)
    }
    return 0
  }

export function createSessionStateView({ activity: activityOf, evidence: evidenceOf }) {
  function mvuReceiptsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const receipts = []
    const activity = activityOf(chat)
    const latest = messages.findLast(function (message) { return message && message.role === 'assistant' })
    for (const message of messages) {
      if (!message || message.role !== 'assistant' || !message.mvu) continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const stored = message.mvu.receipt
      const diagnostics = Array.isArray(message.mvu.diagnostics) ? message.mvu.diagnostics : []
      const receipt = stored && typeof stored === 'object' ? structuredClone(stored) : {
        version: 1,
        status: message.mvu.pending === true ? 'pending' : (diagnostics.length > 0 ? 'error' : (message.mvu.modified === true ? 'updated' : 'unchanged')),
        summary: '',
        changes: [],
        failures: diagnostics.map(function (item) { return { command: str(item.command), message: str(item.message) } })
      }
      if (message === latest && activity.reason === 'interrupted' && activity.role === 'settlement') {
        receipt.status = 'interrupted'
        receipt.summary = '后台结算因服务重启或异常退出而中断，请重试结算；正文和已保存变量保留。'
      }
      receipts.push({ turn, receipt })
    }
    // Keep recent history short on the wire; always retain actionable statuses.
    const notable = new Set(['pending', 'error', 'interrupted', 'partial', 'stale'])
    const notableRows = []
    const quietRows = []
    for (const row of receipts) {
      if (notable.has(str(row.receipt && row.receipt.status))) notableRows.push(row)
      else quietRows.push(row)
    }
    const byTurn = new Map()
    for (const row of notableRows.concat(quietRows.slice(-3))) byTurn.set(row.turn, row)
    return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
  }
  function rollbackViewFields(chat, evidence = evidenceOf(chat.sessionId)) {
    const nodes = evidence.session?.surface?.nodes
    const rollbackState = Array.isArray(nodes) ? rollbackAvailability(chat, { events: evidence.events, nodes }) : {
      canRollback: false, canClearIncompleteReply: false,
      reason: '当前会话的消息流尚未加载，请重新打开对话后重试；历史正文仍保留。'
    }
    const replayTarget = Array.isArray(nodes) ? failedTurnReplayAvailability({ events: evidence.events || [], nodes }).target : null
    const hasRound = hasRollbackMessages(chat.messages)
    return {
      hiddenDshErrorTurns: chat.hiddenDshErrorTurns || [],
      suppressedDshTurns: foregroundSuppressedTurns(chat, evidence.events || []),
      regeneratedDshTurns: Object.fromEntries(Object.entries(chat.regeneratedDshTurns && typeof chat.regeneratedDshTurns === 'object' && !Array.isArray(chat.regeneratedDshTurns) ? chat.regeneratedDshTurns : {})
        .map(([turn, visibleTurn]) => [String(Number(turn)), Number(visibleTurn)])
        .filter(([turn, visibleTurn]) => Number.isSafeInteger(Number(turn)) && Number(turn) > 0 && Number.isSafeInteger(visibleTurn) && visibleTurn > 0)),
      suppressedDshErrorTurns: supersededRegenerationErrorTurns({ events: evidence.events || [], suppressedDshTurns: chat.suppressedDshTurns }),
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
  }

  // Cache hits receive projectChatSessionState; keep its inputs in sync with
  // these readers (including rollback and MVU receipts), not full history.
  function volatileSessionViewFields(chat, activity) {
    let scriptProgress = null
    return {
      ...rollbackViewFields(chat),
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      settleError: activity.reason === 'interrupted' ? '后台结算已中断，请重试结算。' : (chat.settleError || null),
      settlementTurn: settlementTurn(chat),
      scriptProgress,
      statusBarPlacement: chat.statusBarPlacement === 'body' ? 'body' : 'sidebar',
      updatedAt: chat.updatedAt || 0,
      mvuReceipts: mvuReceiptsOf(chat)
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

// Read-only capture input. Locate legacy turns with the same inferred-turn rule
// as assistantMessageAtTurn, but detach only the selected diagnostic payload.
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
    'backgroundModelSelection', 'backgroundModelRevision', 'backgroundTasks', 'webSearchEnabled', 'sceneImagesEnabled', 'cardContextRevision']) {
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
  return structuredClone({
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
