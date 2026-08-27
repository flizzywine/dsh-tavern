const STORAGE_REVISION = '_storageRevision'
const MISSING = Symbol('missing')

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function same(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function conflict(chatId, path) {
  const error = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：' + (path || '<root>'))
  error.code = 'DSH_TAVERN_CHAT_CONFLICT'
  error.chatId = chatId
  error.path = path
  return error
}

function mergeValue(base, latest, desired, path, chatId) {
  if (same(desired, base)) return clone(latest)
  if (same(latest, base) || same(latest, desired)) return clone(desired)
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
  const normalize = typeof options.normalize === 'function' ? options.normalize : function (value) { return value }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const baselines = new Map()
  if (!data || typeof data.readJson !== 'function' || typeof data.updateJson !== 'function' || typeof data.remove !== 'function') {
    throw new Error('Chat Persistence 缺少 Profile Data adapter')
  }

  function relative(chatId) {
    const id = String(chatId || '')
    if (id === '' || id.includes('/') || id.includes('\\')) throw new Error('Tavern Chat ID 不合法')
    return 'chats/' + id + '.json'
  }

  function remember(chat) {
    if (!chat || typeof chat !== 'object') return chat
    const revision = Math.max(0, Number(chat[STORAGE_REVISION]) || 0)
    chat[STORAGE_REVISION] = revision
    baselines.set(chat.id + ':' + revision, clone(chat))
    return chat
  }

  async function read(chatId) {
    const value = await data.readJson(relative(chatId))
    if (value === undefined) return undefined
    return remember(normalize(value))
  }

  async function write(input) {
    if (!input || typeof input !== 'object' || String(input.id || '') === '') throw new Error('不能保存没有 id 的 Tavern Chat')
    const desired = clone(input)
    const chatId = String(desired.id)
    const basedOn = Math.max(0, Number(desired[STORAGE_REVISION]) || 0)
    const baseline = baselines.get(chatId + ':' + basedOn)
    const saved = await data.updateJson(relative(chatId), function (stored) {
      if (stored === undefined) {
        if (basedOn !== 0) throw conflict(chatId, '<deleted>')
        desired[STORAGE_REVISION] = 1
        desired.updatedAt = Math.max(Number(desired.updatedAt) || 0, now())
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
      next.updatedAt = Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0, now())
      return next
    })
    const normalized = remember(normalize(clone(saved)))
    input[STORAGE_REVISION] = normalized[STORAGE_REVISION]
    input.updatedAt = normalized.updatedAt
    return normalized
  }

  async function update(chatId, mutation) {
    if (typeof mutation !== 'function') throw new Error('Chat Persistence 缺少 mutation')
    const saved = await data.updateJson(relative(chatId), async function (stored) {
      if (stored === undefined) return undefined
      const latest = normalize(clone(stored))
      const currentRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      const result = await mutation(latest)
      if (result === undefined) return undefined
      const next = result === latest ? latest : normalize(result)
      next[STORAGE_REVISION] = currentRevision + 1
      next.updatedAt = Math.max(Number(next.updatedAt) || 0, now())
      return next
    })
    return saved === undefined ? undefined : remember(normalize(clone(saved)))
  }

  async function remove(chatId) {
    baselines.forEach(function (_value, key) { if (key.startsWith(String(chatId) + ':')) baselines.delete(key) })
    await data.remove(relative(chatId))
  }

  return Object.freeze({ read, write, update, remove })
}
