import { applyJsonChanges, diffJson } from './json-mutation.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const ALLOWED_ROOTS = new Set(['messages', 'variables', 'mvu'])

function assertIdentity(chat, effect) {
  if (!effect || effect.version !== 1 || str(effect.operationId) === '') throw new Error('MVU Settlement Effect 不合法')
  if (str(chat && chat.id) !== str(effect.chatId) || str(chat && chat.sessionId) !== str(effect.sessionId)) throw new Error('MVU Settlement Effect 对话目标已变化')
  const timeline = chat && chat.timeline
  if (timeline && (str(timeline.branchId) !== str(effect.branchId) || Number(timeline.revision) !== Number(effect.basedOnRevision))) {
    const error = new Error('MVU Settlement Effect 剧情版本已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
  if (Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) !== Number(effect.expectedLifecycleRevision)) {
    const error = new Error('MVU Settlement Effect 脚本生命周期已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
  const message = Array.isArray(chat && chat.messages) ? chat.messages[Number(effect.messageId)] : null
  if (!message || Math.max(0, Number(message.swipeId) || 0) !== Number(effect.swipeId)) {
    const error = new Error('MVU Settlement Effect Swipe 已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
}

/** Create a serializable, operation-scoped effect without persisting Chat state. */
export function createMvuSettlementEffect(input = {}) {
  const changes = diffJson(input.before, input.after).filter(function (change) {
    return Array.isArray(change.path) && ALLOWED_ROOTS.has(String(change.path[0] || ''))
  })
  return {
    version: 1,
    operationId: str(input.operationId),
    chatId: str(input.chatId),
    sessionId: str(input.sessionId),
    branchId: str(input.branchId),
    basedOnRevision: Number(input.basedOnRevision),
    expectedLifecycleRevision: Math.max(0, Number(input.expectedLifecycleRevision) || 0),
    messageId: Number(input.messageId),
    swipeId: Number(input.swipeId),
    changes: structuredClone(changes)
  }
}

/** Apply one effect at the Story Timeline commit seam while preserving unrelated projections. */
export function applyMvuSettlementEffect(chat, effect) {
  assertIdentity(chat, effect)
  const applied = applyJsonChanges(chat, effect.changes)
  for (const root of ALLOWED_ROOTS) {
    if (Object.hasOwn(applied, root)) chat[root] = structuredClone(applied[root])
    else delete chat[root]
  }
  return chat
}
