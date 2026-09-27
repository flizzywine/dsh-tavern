import { applyJsonChangesShared, diffJson } from './json-mutation.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const ALLOWED_ROOTS = new Set(['messages', 'variables', 'mvu', 'tavernScriptPrompts'])

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
  // The caller owns the draft and declares every touched floor. Do not scan
  // shared history to rediscover a write set that is already known.
  const rawChanges = input.messageIndices ? diffMvuChanges(input.before, input.after, input.messageIndices)
    : diffJson(input.before, input.after)
  const changes = rawChanges.filter(function (change) {
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
export function applyMvuSettlementEffect(chat, effect, scope) {
  assertIdentity(chat, effect)
  const changes = effect.changes.filter(change => ALLOWED_ROOTS.has(String(change.path?.[0])))
  if (Array.isArray(scope?.messageIndices)) {
    const allowed = new Set(scope.messageIndices)
    const byFloor = new Map(), head = []
    for (const change of changes) {
      if (change.path[0] !== 'messages') { head.push(change); continue }
      const id = change.path[1]
      if (!allowed.has(id)) throw new Error('MVU effect wrote an undeclared floor')
      if (!byFloor.has(id)) byFloor.set(id, [])
      byFloor.get(id).push({...change,path:change.path.slice(2)})
    }
    // Prepare all changed rows before publishing any, preserving failure isolation.
    const rows = [...byFloor].map(([id, edits]) => [id, applyJsonChangesShared(chat.messages[id], edits)])
    const applied = applyJsonChangesShared({...chat, messages: undefined}, head)
    for (const root of new Set(head.map(change => change.path[0]))) {
      if (Object.hasOwn(applied, root)) chat[root] = applied[root]
      else delete chat[root]
    }
    for (const [id, row] of rows) chat.messages[id] = row
    return chat
  }
  const applied = applyJsonChangesShared(chat, changes)
  for (const root of new Set(changes.map(change => change.path[0]))) {
    if (Object.hasOwn(applied, root)) chat[root] = applied[root]
    else delete chat[root]
  }
  return chat
}

/** Compare detached metadata and explicitly owned floors, never array length. */
export function diffMvuChanges(before, after, indices) {
  const {messages: beforeMessages, ...beforeHead} = before
  const {messages: afterMessages, ...afterHead} = after
  if (beforeMessages.length !== afterMessages.length) throw new Error('Scoped MVU cannot change history membership')
  const changes = diffJson(beforeHead, afterHead)
  for (const id of indices) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= beforeMessages.length) throw new Error('Invalid scoped MVU floor')
    for (const change of diffJson(beforeMessages[id], afterMessages[id])) changes.push({...change,path:['messages',id,...change.path]})
  }
  return changes
}
