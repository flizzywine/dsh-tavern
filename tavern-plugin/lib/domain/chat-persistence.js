import { isDeepStrictEqual } from 'node:util'

const STORAGE_REVISION = '_storageRevision'
const MISSING = Symbol('missing')

function clone(value) {
  // Preserve the merge sentinel so the parent omits deleted fields.
  return value === undefined || value === MISSING ? value : structuredClone(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function same(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return isDeepStrictEqual(left, right)
}

function conflict(chatId, path) {
  const error = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：' + (path || '<root>'))
  error.code = 'DSH_TAVERN_CHAT_CONFLICT'
  error.chatId = chatId
  error.path = path
  return error
}

function withoutDisplayCapture(messages) {
  return messages.map(function ({ displayRuntime: _capture, ...message }) { return message })
}

function sameCaptureTarget(left, right) {
  if (!object(left) || !object(right)) return false
  for (const key of ['id', 'role', 'turn', 'greeting']) if (!same(left[key], right[key])) return false
  if (Number(left.swipeId || 0) !== Number(right.swipeId || 0)) return false
  for (const key of ['text', 'sourceText', 'projectionText', 'sessionText', 'displayText']) {
    if (!same(left[key] ?? left.text, right[key] ?? right.text)) return false
  }
  return same(left.swipes ?? [left.text], right.swipes ?? [right.text])
}

function captureOf(message) {
  return object(message) && Object.hasOwn(message, 'displayRuntime') ? message.displayRuntime : MISSING
}

function mergeMessages(base, latest, desired, chatId) {
  // Display captures are observational data, not competing story edits. Keep
  // the authoritative array atomic: two distinct story/variable edits still
  // conflict, even when they affect different messages or also carry captures.
  const before = withoutDisplayCapture(base)
  const current = withoutDisplayCapture(latest)
  const proposed = withoutDisplayCapture(desired)
  let chosen, other
  if (same(proposed, before)) { chosen = latest; other = desired }
  else if (same(current, before) || same(current, proposed)) { chosen = desired; other = latest }
  else throw conflict(chatId, 'messages')
  const result = clone(chosen)
  for (let index = 0; index < result.length; index++) {
    const previousCapture = captureOf(base[index])
    const otherCapture = captureOf(other[index])
    if (same(otherCapture, previousCapture) || !same(captureOf(chosen[index]), previousCapture)) continue
    // Never attach a late capture to a replacement, reordered message or swipe.
    if (!sameCaptureTarget(base[index], chosen[index]) || !sameCaptureTarget(other[index], chosen[index])) continue
    if (otherCapture === MISSING) delete result[index].displayRuntime
    else result[index].displayRuntime = clone(otherCapture)
  }
  return result
}

function mergeValue(base, latest, desired, path, chatId) {
  if (same(desired, base)) return clone(latest)
  if (same(latest, base) || same(latest, desired)) return clone(desired)
  if (path === 'messages' && [base, latest, desired].every(value => Array.isArray(value) && value.every(object))) {
    return mergeMessages(base, latest, desired, chatId)
  }
  if (object(base) && object(latest) && object(desired)) {
    const result = {}
    const keys = new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(desired)])
    for (const key of keys) {
      if (path === '' && (key === STORAGE_REVISION || key === 'updatedAt')) continue
      const childPath = path === '' ? key : path + '.' + key
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(latest, key) ? latest[key] : MISSING,
        Object.prototype.hasOwnProperty.call(desired, key) ? desired[key] : MISSING,
        childPath,
        chatId
      )
      if (value !== MISSING) result[key] = value
    }
    return result
  }
  throw conflict(chatId, path)
}

/**
 * Persist the authoritative Tavern Chat with optimistic three-way merging.
 * Callers keep a small read/write interface; revision tracking, stale-write
 * rejection and locality-preserving merges stay inside this implementation.
 */
export function createChatPersistence(options = {}) {
  const data = options.data
  const store = options.store
  const normalize = typeof options.normalize === 'function' ? options.normalize : function (value) { return value }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const baselines = new Map()

  function relative(chatId) {
    const id = String(chatId || '')
    if (id === '' || id.includes('/') || id.includes('\\')) throw new Error('Tavern Chat ID 不合法')
    return 'chats/' + id + '.json'
  }

  const records = store || (data && typeof data.readJson === 'function' && typeof data.updateJson === 'function' && typeof data.remove === 'function' ? {
    async read(chatId) { return await data.readJson(relative(chatId)) },
    async update(chatId, updater) { return await data.updateJson(relative(chatId), updater) },
    async remove(chatId) { await data.remove(relative(chatId)) },
    async version(chatId) { return typeof data.version === 'function' ? await data.version(relative(chatId)) : '' }
  } : null)
  if (records === null || typeof records.read !== 'function' || typeof records.update !== 'function' || typeof records.remove !== 'function') {
    throw new Error('Chat Persistence 缺少 Chat Store adapter')
  }

  function remember(chat) {
    if (!chat || typeof chat !== 'object') return chat
    const revision = Math.max(0, Number(chat[STORAGE_REVISION]) || 0)
    chat[STORAGE_REVISION] = revision
    baselines.set(chat.id + ':' + revision, clone(chat))
    return chat
  }

  async function read(chatId) {
    const value = await records.read(chatId)
    if (value === undefined) return undefined
    return remember(normalize(value))
  }

  async function write(input, metadata = {}) {
    if (!input || typeof input !== 'object' || String(input.id || '') === '') throw new Error('不能保存没有 id 的 Tavern Chat')
    const desired = clone(input)
    const chatId = String(desired.id)
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const basedOn = Math.max(0, Number(desired[STORAGE_REVISION]) || 0)
    const baseline = baselines.get(chatId + ':' + basedOn)
    const saved = await records.update(chatId, function (stored) {
      if (stored === undefined) {
        if (basedOn !== 0) throw conflict(chatId, '<deleted>')
        desired[STORAGE_REVISION] = 1
        desired.updatedAt = touchUpdatedAt ? Math.max(Number(desired.updatedAt) || 0, now()) : Math.max(0, Number(desired.updatedAt) || 0)
        return desired
      }
      const latest = normalize(clone(stored))
      const latestRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      let next
      if (latestRevision === basedOn) {
        next = desired
      } else {
        if (baseline === undefined) throw conflict(chatId, '<baseline>')
        next = mergeValue(baseline, latest, desired, '', chatId)
      }
      next[STORAGE_REVISION] = latestRevision + 1
      next.updatedAt = touchUpdatedAt
        ? Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0, now())
        : Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0)
      return next
    }, metadata)
    const normalized = remember(normalize(clone(saved)))
    input[STORAGE_REVISION] = normalized[STORAGE_REVISION]
    input.updatedAt = normalized.updatedAt
    return normalized
  }

  async function update(chatId, mutation, metadata = {}) {
    if (typeof mutation !== 'function') throw new Error('Chat Persistence 缺少 mutation')
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const saved = await records.update(chatId, async function (stored) {
      if (stored === undefined) return undefined
      const latest = normalize(clone(stored))
      const currentRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      const result = await mutation(latest)
      if (result === undefined) return undefined
      const next = result === latest ? latest : normalize(result)
      next[STORAGE_REVISION] = currentRevision + 1
      next.updatedAt = touchUpdatedAt ? Math.max(Number(next.updatedAt) || 0, now()) : Math.max(0, Number(next.updatedAt) || 0)
      return next
    }, metadata)
    return saved === undefined ? undefined : remember(normalize(clone(saved)))
  }

  async function readRevision(chatId, revision) {
    if (typeof records.readRevision !== 'function') throw new Error('当前 Chat Store 不支持按 revision 读取')
    const value = await records.readRevision(chatId, revision)
    return value === undefined ? undefined : normalize(clone(value))
  }

  async function version(chatId) {
    return typeof records.version === 'function' ? await records.version(chatId) : ''
  }

  async function remove(chatId) {
    baselines.forEach(function (_value, key) { if (key.startsWith(String(chatId) + ':')) baselines.delete(key) })
    await records.remove(chatId)
  }

  return Object.freeze({ read, readRevision, write, update, version, remove })
}
