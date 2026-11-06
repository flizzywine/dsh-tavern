// Variables changed outside a settlement (the MVU variable panel) reach the story model once:
// the next body request after that reply states the new values as current. Keyed by the reply
// the edit was made on, like the style reference, so a regenerated next turn sees it again and
// the turn after it, a rollback past the reply, or another branch does not.

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Leaf-level differences between two stat_data trees; arrays compare as one value. */
export function diffStatData(before, after, path = []) {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys.flatMap(key => diffStatData(before[key], after[key], [...path, key]))
  }
  return same(before, after) ? [] : [{ path, from: before, to: after }]
}

/** Fold a new edit into the pending one: same reply merges (first `from` kept), another reply replaces. */
export function mergeVariableUpdate(previous, { afterTurn, changes }) {
  const turn = Math.max(0, Number(afterTurn) || 0)
  const merged = new Map()
  if (previous && Number(previous.afterTurn) === turn) {
    for (const change of previous.changes || []) merged.set(JSON.stringify(change.path), change)
  }
  for (const change of changes) {
    const key = JSON.stringify(change.path)
    const from = merged.has(key) ? merged.get(key).from : change.from
    merged.set(key, { path: change.path, from, to: change.to })
  }
  const kept = [...merged.values()].filter(change => !same(change.from, change.to))
  return kept.length ? { afterTurn: turn, changes: kept } : null
}

/** The pending update this body request follows, or null. */
export function variableUpdateFor(chat) {
  const update = chat?.variableUpdate
  if (!update || !Array.isArray(update.changes) || !update.changes.length) return null
  const previous = (chat.messages || []).findLast(message => message?.role === 'assistant')
  return previous && (Number(previous.turn) || 0) === Number(update.afterTurn) ? update : null
}

function show(value) {
  if (value === undefined) return '（无）'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function variableUpdateText(update) {
  return '【变量已更新】\n以下变量已更新，以此为准：\n' + update.changes
    .map(change => '- ' + change.path.join('.') + '：' + show(change.from) + ' → ' + show(change.to)).join('\n')
}

/** Record a panel edit of one reply's stat_data on the game, for the next body request. */
export async function recordVariableUpdate({ chatForSession, updateChat }, sessionId, { afterTurn, before }, after) {
  const changes = diffStatData(isPlainObject(before) ? before : {}, isPlainObject(after) ? after : {})
  if (!changes.length) return
  const chat = await chatForSession(sessionId)
  if (!chat) return
  await updateChat(chat.id, current => {
    const next = mergeVariableUpdate(current.variableUpdate, { afterTurn, changes })
    if (same(next, current.variableUpdate ?? null)) return undefined
    if (next) current.variableUpdate = next
    else delete current.variableUpdate
    return current
  }, { source: 'mvu.variable-update' })
}
