import { createHash, randomUUID } from 'node:crypto'

// Media that third-party plugins attach to a game turn. Tavern only stores and
// shows them; each item is bound to one story text version (scene target key).
const hash = value => createHash('sha256').update(String(value)).digest('hex')
const KIND = /^(?:image|video|audio|[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63})$/
const STATUSES = new Set(['pending', 'ready', 'failed'])
const MAX_ITEMS = 2000
const MAX_DATA_BYTES = 64 * 1024
const MAX_ISSUED_PER_TURN = 20
const MAX_TEXT = 500

export const PLUGIN_MEDIA_LIMITS = Object.freeze({ items: MAX_ITEMS, dataBytes: MAX_DATA_BYTES, text: MAX_TEXT })

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INVALID' }) }

function attachmentRef(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.attachmentId !== 'string' || value.attachmentId === '') throw invalid('attachment 必须是 DSH attachments 服务返回的引用')
  if (typeof value.mediaType === 'string') {
    if (!/^image\//.test(value.mediaType)) throw invalid('attachment.mediaType 不是图片类型')
    return { attachmentId: value.attachmentId, mediaType: value.mediaType, bytes: Number(value.bytes) || 0, width: Number(value.width) || 0, height: Number(value.height) || 0, ...(typeof value.name === 'string' ? { name: value.name } : {}) }
  }
  if (typeof value.name !== 'string') throw invalid('attachment 缺少 name 或 mediaType')
  return { attachmentId: value.attachmentId, name: value.name, bytes: Number(value.bytes) || 0 }
}

function optionalText(value, field) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid(field + ' 必须是字符串')
  if (value.length > MAX_TEXT) throw invalid(field + ' 不能超过 ' + MAX_TEXT + ' 个字符')
  return value
}

function pluginData(value) {
  if (value === undefined) return undefined
  let encoded
  try { encoded = JSON.stringify(value) } catch { throw invalid('data 必须能序列化为 JSON') }
  if (encoded === undefined) return undefined
  if (Buffer.byteLength(encoded) > MAX_DATA_BYTES) throw invalid('data 不能超过 64 KB')
  return JSON.parse(encoded)
}

function progressOf(value) {
  if (value === undefined || value === null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) throw invalid('progress 必须在 0 到 1 之间')
  return number
}

/** Normalize the writable fields of an item; `base` supplies values a patch leaves out. */
function itemFields(input, base = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('item 必须是对象')
  const has = key => Object.hasOwn(input, key)
  const kind = has('kind') ? input.kind : base.kind
  if (typeof kind !== 'string' || !KIND.test(kind)) throw invalid('kind 必须是 image、video、audio 或 <插件名>/<类型>')
  const status = has('status') ? input.status : base.status || 'ready'
  if (!STATUSES.has(status)) throw invalid('status 必须是 pending、ready 或 failed')
  const attachment = has('attachment') ? attachmentRef(input.attachment) : base.attachment || null
  if (status === 'ready' && ['image', 'video', 'audio'].includes(kind) && !attachment) throw invalid('ready 状态的 ' + kind + ' 必须带 attachment')
  if (kind === 'image' && attachment && !attachment.mediaType) throw invalid('image 必须使用图片附件')
  const fields = {
    kind, status, attachment,
    progress: has('progress') ? progressOf(input.progress) : base.progress ?? null,
    anchor: has('anchor') ? optionalText(input.anchor, 'anchor').trim() : base.anchor || '',
    caption: has('caption') ? optionalText(input.caption, 'caption') : base.caption || '',
    error: has('error') ? optionalText(input.error, 'error') : base.error || ''
  }
  const data = has('data') ? pluginData(input.data) : base.data
  if (data !== undefined) fields.data = data
  return fields
}

// Item ids carry their game so update/remove need no global index.
export function pluginMediaId(sessionId, unique) {
  return Buffer.from(String(sessionId), 'utf8').toString('base64url') + '.' + unique
}

export function pluginMediaSession(itemId) {
  const match = /^([A-Za-z0-9_-]+)\.[A-Za-z0-9-]+$/.exec(String(itemId || ''))
  if (!match) return ''
  try { return Buffer.from(match[1], 'base64url').toString('utf8') } catch { return '' }
}

export function publicPluginMedia(item, current) {
  return {
    id: item.id, owner: item.owner, turn: item.turn, textVersion: item.key, kind: item.kind, status: item.status,
    progress: item.progress, anchor: item.anchor, caption: item.caption, error: item.error,
    attachment: item.attachment ? { ...item.attachment } : null,
    ...(item.data !== undefined ? { data: structuredClone(item.data) } : {}),
    createdAt: item.createdAt, updatedAt: item.updatedAt,
    ...(current === undefined ? {} : { current })
  }
}

export function createPluginMedia({ store, now = Date.now, id = randomUUID }) {
  const pathFor = chatId => 'plugin-media/' + hash(chatId) + '.json'
  const empty = () => ({ version: 1, items: [], issued: {} })
  async function read(chatId) {
    const value = await store.readJson(pathFor(chatId))
    return value && value.version === 1 && Array.isArray(value.items) ? value : empty()
  }
  async function update(chatId, change) {
    let result
    await store.updateJson(pathFor(chatId), current => {
      const value = current && current.version === 1 && Array.isArray(current.items) ? current : empty()
      result = change(value)
      return value
    })
    return result
  }
  // Versions known to be recorded, so repeated reads of a turn touch no file.
  const issuedKnown = new Set()
  /** Remember a text version handed to plugins, so a late attach can still target it. */
  async function issue(chatId, turn, key) {
    const known = chatId + '\u0000' + turn + '\u0000' + key
    if (issuedKnown.has(known)) return
    const current = await read(chatId)
    if (!(current.issued[turn] || []).includes(key)) {
      await update(chatId, value => {
        const keys = (value.issued[turn] || []).filter(item => item !== key)
        value.issued[turn] = [...keys, key].slice(-MAX_ISSUED_PER_TURN)
      })
    }
    if (issuedKnown.size >= 5000) issuedKnown.clear()
    issuedKnown.add(known)
  }
  async function attach({ chatId, sessionId, owner, turn, key, currentKey, item }) {
    const fields = itemFields(item)
    return update(chatId, value => {
      if (key !== currentKey && !(value.issued[turn] || []).includes(key)) throw Object.assign(new Error('textVersion 不属于这一轮正文'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
      if (value.items.length >= MAX_ITEMS) throw invalid('这一局的插件媒体已达上限（' + MAX_ITEMS + ' 项）')
      const at = now()
      const record = { id: pluginMediaId(sessionId, id()), owner, turn, key, ...fields, createdAt: at, updatedAt: at }
      value.items.push(record)
      return record
    })
  }
  async function patch({ chatId, owner, itemId, changes }) {
    return update(chatId, value => {
      const index = value.items.findIndex(item => item.id === itemId && item.owner === owner)
      if (index < 0) throw Object.assign(new Error('媒体项不存在或不属于本插件'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      const blocked = ['id', 'owner', 'turn', 'textVersion', 'key'].find(key => Object.hasOwn(changes || {}, key))
      if (blocked) throw invalid(blocked + ' 不能修改')
      const next = { ...value.items[index], ...itemFields(changes, value.items[index]), updatedAt: now() }
      value.items[index] = next
      return next
    })
  }
  async function remove({ chatId, owner, itemId }) {
    return update(chatId, value => {
      const before = value.items.length
      value.items = value.items.filter(item => !(item.id === itemId && item.owner === owner))
      return value.items.length !== before
    })
  }
  async function list({ chatId, owner, turn }) {
    const value = await read(chatId)
    return value.items.filter(item => (owner === undefined || item.owner === owner) && (turn === undefined || item.turn === turn))
  }
  async function find(chatId, itemId) {
    return (await read(chatId)).items.find(item => item.id === itemId) || null
  }
  /** Carry a fork's visible media: items whose version maps into the new game get new ids there. */
  async function copyForFork({ sourceChatId, targetChatId, targetSessionId, keyMap }) {
    const source = await read(sourceChatId)
    const items = source.items.flatMap(item => {
      const key = keyMap.get(item.turn + '\u0000' + item.key)
      return key ? [{ ...structuredClone(item), id: pluginMediaId(targetSessionId, id()), key }] : []
    })
    if (!items.length) return 0
    await update(targetChatId, value => {
      value.items = items
      for (const item of items) value.issued[item.turn] = [item.key]
    })
    return items.length
  }
  /** Turns of a game that hold any plugin media, for building a fork's key map. */
  async function turns(chatId) { return (await read(chatId)).items.map(item => item.turn) }
  async function removeChat(chatId) {
    await store.remove(pathFor(chatId))
    for (const known of issuedKnown) if (known.startsWith(chatId + '\u0000')) issuedKnown.delete(known)
  }
  return Object.freeze({ issue, attach, patch, remove, list, find, copyForFork, turns, removeChat, pathFor })
}

const FILE_MEDIA_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac'
}

/** Served type of a stored file. Only playable media is served inline; anything else downloads. */
export function pluginFileMediaType(name) {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''))?.[1]?.toLowerCase()
  return FILE_MEDIA_TYPES[extension] || 'application/octet-stream'
}

/** Parse a single `bytes=` range; null means serve the whole file. */
export function pluginMediaRange(header, length) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!match || length <= 0 || (match[1] === '' && match[2] === '')) return null
  let start, end
  if (match[1] === '') { start = Math.max(0, length - Number(match[2])); end = length - 1 }
  else { start = Number(match[1]); end = match[2] === '' ? length - 1 : Math.min(length - 1, Number(match[2])) }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) return { invalid: true }
  return { start, end }
}

/** Yield only [start, end] of a chunked byte stream. */
export async function * slicePluginMediaStream(chunks, start, end) {
  let offset = 0
  for await (const chunk of chunks) {
    const from = Math.max(0, start - offset), to = Math.min(chunk.length, end - offset + 1)
    if (from < to) yield chunk.subarray(from, to)
    offset += chunk.length
    if (offset > end) return
  }
}
