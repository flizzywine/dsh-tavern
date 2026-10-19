// Player-facing MVU variable helpers. Pure so the status panel and Node tests
// share the same floor selection and write shape.
function mvuPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mvuClone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function mvuMessageTurn(helper, messageId) {
  const ids = helper && helper.turnMessageIds
  if (!ids || typeof ids !== 'object') return 0
  let turn = 0
  for (const [key, value] of Object.entries(ids)) {
    const number = Number(key)
    if (Number(value) === messageId && Number.isFinite(number) && number > turn) turn = number
  }
  return turn
}

function mvuFloorFromMessage(helper, messages, messageId, fallbackTurn) {
  const message = messages[messageId]
  if (!message || message.stub || message.role !== 'assistant' || message.is_hidden === true) return null
  const variables = mvuPlainObject(message.variables) ? message.variables : null
  return {
    messageId,
    turn: mvuMessageTurn(helper, messageId) || Math.max(0, Number(fallbackTurn) || 0),
    swipeId: Math.max(0, Number(message.swipe_id) || 0),
    variables,
    statData: variables && mvuPlainObject(variables.stat_data) ? variables.stat_data : null
  }
}

/** The latest story floor the MVU panel may edit, preferring the current turn. */
function readMvuVariableFloor(helper, latestTurn) {
  const messages = helper && Array.isArray(helper.messages) ? helper.messages : []
  const turn = Math.max(0, Number(latestTurn) || 0)
  const mapped = helper && helper.turnMessageIds ? Number(helper.turnMessageIds[String(turn)]) : -1
  const currentId = Number.isInteger(mapped) && mapped >= 0 && mapped < messages.length ? mapped : -1
  if (currentId >= 0) {
    const current = mvuFloorFromMessage(helper, messages, currentId, turn)
    if (current && current.statData) return current
  }
  // A failed settlement can leave the newest floor without data. Keep the most
  // recent real snapshot visible, and label its own turn rather than pretending
  // it belongs to the newest floor.
  for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
    if (messageId === currentId) continue
    const floor = mvuFloorFromMessage(helper, messages, messageId, 0)
    if (floor && floor.statData) return floor
  }
  return currentId >= 0 ? mvuFloorFromMessage(helper, messages, currentId, turn) : null
}

function parseMvuStatData(text) {
  let value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    throw new Error('状态数据不是有效 JSON：' + String(error && error.message || error))
  }
  if (!mvuPlainObject(value)) throw new Error('状态数据必须是 JSON 对象')
  return value
}

function serializeMvuStatData(value) {
  return JSON.stringify(mvuPlainObject(value) ? value : {}, null, 2)
}

/** Replace stat_data while preserving schema, display_data and any card fields. */
function mvuVariablesWithStatData(variables, statData) {
  const next = mvuPlainObject(variables) ? mvuClone(variables) : {}
  next.stat_data = mvuClone(statData)
  return next
}

/** Build the exact helper RPC payload for one floor write. */
function mvuVariablesUpdateRequest({ sessionId, floor, statData, lifecycleRevision }) {
  if (!floor || !Number.isInteger(Number(floor.messageId)) || Number(floor.messageId) < 0) throw new Error('当前楼层不可编辑')
  return {
    sessionId,
    option: { type: 'message', message_id: Number(floor.messageId), swipe_id: Math.max(0, Number(floor.swipeId) || 0) },
    variables: mvuVariablesWithStatData(floor.variables, statData),
    expectedLifecycleRevision: Math.max(0, Number(lifecycleRevision) || 0)
  }
}

/** Immutable tree edit used by the field inputs. */
function mvuSetAtPath(root, path, value) {
  if (!Array.isArray(path) || path.length === 0) return value
  const head = path[0]
  const rest = path.slice(1)
  if (head === '__proto__' || head === 'constructor' || head === 'prototype') throw new Error('不支持的变量名：' + String(head))
  const copy = Array.isArray(root) ? root.slice() : { ...(mvuPlainObject(root) ? root : {}) }
  copy[head] = mvuSetAtPath(root && typeof root === 'object' ? root[head] : undefined, rest, value)
  return copy
}

export {
  mvuPlainObject,
  readMvuVariableFloor,
  parseMvuStatData,
  serializeMvuStatData,
  mvuVariablesWithStatData,
  mvuVariablesUpdateRequest,
  mvuSetAtPath
}
