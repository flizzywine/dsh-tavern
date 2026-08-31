import { isDeepStrictEqual } from 'node:util'

// These fields describe host-owned messages, not plugin storage. In particular,
// accepting a new is_system/name field must not pretend to change prompt semantics.
const reserved = new Set(['message_id', 'message', 'mes', 'role', 'is_user', 'is_system', 'name', 'send_date', 'swipe_id', 'swipes', 'swipes_data', 'variables', 'pluginData', 'original_avatar', 'force_avatar'])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export function assertPluginJson(value, label = '插件数据') {
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (!item || typeof item !== 'object') throw new Error(label + '必须是 JSON 数据')
    for (const [key, child] of Object.entries(item)) {
      if (key === '__proto__') throw new Error(label + '包含不安全字段')
      visit(child)
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + '必须是 JSON 对象')
  visit(value)
}

export function validateChatPluginRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.chatId !== 'string' || !request.chatId
    || !Number.isSafeInteger(request.lifecycleRevision) || request.lifecycleRevision < 0 || !Array.isArray(request.messages)) throw new Error('插件存档请求不合法')
  if (Object.keys(request).some(key => !['chatId', 'lifecycleRevision', 'messages', 'metadata'].includes(key))) throw new Error('插件存档不接受聊天正文或历史操作')
  const seen = new Set()
  for (const row of request.messages) {
    if (!row || !Number.isSafeInteger(row.message_id) || row.message_id < 0 || seen.has(row.message_id)
      || Object.keys(row).some(key => !['message_id', 'stateRevision', 'data'].includes(key))) throw new Error('插件消息存档编号无效或重复')
    seen.add(row.message_id)
    assertPluginJson(row.data)
    if (Object.keys(row.data).some(key => reserved.has(key))) throw new Error('saveChat 只保存插件数据，不支持修改正文、身份或消息版本')
  }
  if (request.metadata !== undefined) {
    if (!request.metadata || Object.keys(request.metadata).some(key => !['stateRevision', 'data'].includes(key))) throw new Error('聊天元数据请求不合法')
    assertPluginJson(request.metadata.data, '聊天元数据')
  }
  const revisions = [...request.messages, ...(request.metadata ? [request.metadata] : [])].map(row => row.stateRevision)
  if (revisions.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('插件存档缺少已保存的读取版本，请刷新后重试')
  return [...new Set(revisions)]
}

function mergeData(base = {}, latest = {}, desired, label) {
  const next = structuredClone(latest)
  for (const key of new Set([...Object.keys(base), ...Object.keys(desired)])) {
    if (own(base, key) === own(desired, key) && isDeepStrictEqual(base[key], desired[key])) continue
    const unchanged = own(base, key) === own(latest, key) && isDeepStrictEqual(base[key], latest[key])
    const alreadySaved = own(desired, key) === own(latest, key) && isDeepStrictEqual(desired[key], latest[key])
    if (!unchanged && !alreadySaved) throw new Error(label + '已被其他操作修改，请重新读取后重试: ' + key)
    if (own(desired, key)) Object.defineProperty(next, key, { value: structuredClone(desired[key]), enumerable: true, writable: true, configurable: true })
    else delete next[key]
  }
  return next
}

function messageIdentity(message) {
  if (!message) return null
  return [message.id ?? null, message.role, message.turn ?? null, message.greeting === true,
    message.sourceText ?? message.text ?? '', message.swipeId ?? 0, message.swipes ?? []]
}

/** Only storage namespaces change; never writes model text, Frames, or Session. */
export function applyChatPluginData(current, baselines, request) {
  if (current.id !== request.chatId || (current.tavernHelperLifecycleRevision || 0) !== request.lifecycleRevision) throw new Error('聊天已切换或历史版本已变化，插件数据未保存')
  const next = structuredClone(current)
  function baseline(revision) {
    const value = baselines.get(revision)
    if (!value || value._storageRevision !== revision || value.id !== request.chatId || (value.tavernHelperLifecycleRevision || 0) !== request.lifecycleRevision) throw new Error('插件存档读取版本已过期，请刷新后重试')
    return value
  }
  for (const row of request.messages) {
    const previous = baseline(row.stateRevision).messages?.[row.message_id]
    const latest = next.messages?.[row.message_id]
    if (!previous || !latest || !isDeepStrictEqual(messageIdentity(previous), messageIdentity(latest))) throw new Error('消息不存在、尚未保存或版本已变化，插件数据未保存')
    latest.tavernPluginData = mergeData(previous.tavernPluginData, latest.tavernPluginData, row.data, '消息插件数据')
  }
  if (request.metadata) {
    const previous = baseline(request.metadata.stateRevision)
    next.tavernPluginMetadata = mergeData(previous.tavernPluginMetadata, next.tavernPluginMetadata, request.metadata.data, '聊天元数据')
  }
  return next
}
