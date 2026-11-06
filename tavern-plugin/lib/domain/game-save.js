import { createHash } from 'node:crypto'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

// A game save package carries one game to another install: the save with the history its
// rollback and regeneration need, the native session, the card it was started from and,
// optionally, its scene images. Importing always creates a new game.
export const GAME_SAVE_FORMAT = 'dsh-tavern-save'
export const GAME_SAVE_FORMAT_VERSION = 2
const MAX_REVISIONS = 400
// Saves carry whole histories and every scene image, so they get more room than other archives.
// The archive travels as one base64 string each way; 256 MB stays well under V8's string limit.
export const GAME_SAVE_LIMITS = { maxArchiveBytes: 256 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024 }
const SIZE_PARTS = [['对话与回退历史', /^(chat|nodes|session)\//], ['图片', /^(scene|plugins)\/attachments\//], ['角色卡与世界书', /^(card|script|scene\/worldbooks)\//]]
const sha = value => createHash('sha256').update(value).digest('hex')
const safeSegment = value => String(value).replace(/[^a-zA-Z0-9_.-]/g, '_')

/** Revisions reachable through rollback checkpoints, including those of earlier states. */
export async function collectSaveRevisions(chat, readRevision) {
  const states = new Map()
  const pending = [chat]
  while (pending.length) {
    const state = pending.pop()
    for (const checkpoint of state?.timeline?.checkpoints || []) {
      const revision = Number(checkpoint?.beforeRevision)
      if (!Number.isSafeInteger(revision) || revision < 0 || states.has(revision)) continue
      if (states.size >= MAX_REVISIONS) throw new Error('这局的回退历史过长，暂不能导出')
      // History older than the kept window was cleaned up; export what remains.
      let value
      try { value = await readRevision(chat.id, revision) } catch (error) { if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') continue; throw error }
      if (!value || value._storageRevision !== revision) continue
      states.set(revision, value)
      pending.push(value)
    }
  }
  return [...states.entries()].sort((a, b) => a[0] - b[0]).map(([revision, state]) => ({ revision, state }))
}

// Revisions repeat almost everything: the card and worldbook snapshots, and every message but the
// last few. Format 2 stores each JSON subtree of at least NODE_MIN_CHARS once, by content hash,
// so a long history costs about one copy of the game instead of one per rollback point.
// Format 1 only shared whole top-level values ($dshSaveBlob); its packages still read.
const NODE_MIN_CHARS = 1024
const NODE_PACK_CHARS = 8 * 1024 * 1024

// Returns the packed JSON text of value, built bottom-up so each level is serialized once.
function packValue(value, nodes, root = false) {
  let json
  if (Array.isArray(value)) json = '[' + value.map(item => packValue(item, nodes) ?? 'null').join(',') + ']'
  else if (value && typeof value === 'object' && typeof value.toJSON !== 'function') {
    const parts = []
    for (const [key, item] of Object.entries(value)) { const packed = packValue(item, nodes); if (packed !== undefined) parts.push(JSON.stringify(key) + ':' + packed) }
    json = '{' + parts.join(',') + '}'
  } else return JSON.stringify(value)
  if (root || json.length < NODE_MIN_CHARS) return json
  const id = sha(json)
  nodes.set(id, json)
  return '{"$dshSaveNode":"' + id + '"}'
}

function unpackValue(value, store) {
  if (Array.isArray(value)) return value.map(item => unpackValue(item, store))
  if (!value || typeof value !== 'object') return value
  const keys = Object.keys(value)
  if (keys.length === 1 && typeof value.$dshSaveNode === 'string') return unpackValue(parseStored(store.nodes, value.$dshSaveNode), store)
  if (keys.length === 1 && typeof value.$dshSaveBlob === 'string') return parseStored(store.blobs, value.$dshSaveBlob)
  const result = {}
  for (const key of keys) result[key] = unpackValue(value[key], store)
  return result
}

function parseStored(map, id) {
  if (!map.has(id)) throw new Error('存档包缺少数据块：' + id.slice(0, 12))
  try { return JSON.parse(map.get(id)) } catch { throw new Error('存档包已损坏：数据块无法读取') }
}

// One node per line ("<sha256> <json>"; serialized JSON has no raw newlines), a few MB per file.
function nodeFiles(nodes) {
  const files = []
  let lines = [], size = 0
  const flush = () => { if (lines.length) files.push({ path: 'nodes/' + files.length + '.txt', content: lines.join('\n') }); lines = []; size = 0 }
  for (const [id, json] of nodes) { if (size && size + json.length > NODE_PACK_CHARS) flush(); lines.push(id + ' ' + json); size += json.length + 66 }
  flush()
  return files
}

/**
 * input: { chat, revisions: [{revision, state}], session: {header, inheritedEventCount, events},
 *   card: {path, payload} (an importCard payload), script?: {path, text}, scene?: {files: [{path, content}], worldbooks: [{digest, content}],
 *   attachments: [{attachmentId, mediaType, data}]}, plugins?: {data, media, attachments: [{attachmentId, mediaType?, name?, data}]},
 *   tavernVersion, exportedAt }
 */
export function buildGameSave(input, limits = GAME_SAVE_LIMITS) {
  const chat = input.chat
  const nodes = new Map()
  const entries = []
  const json = (path, value) => entries.push({ path, content: JSON.stringify(value) })
  entries.push({ path: 'chat/current.json', content: packValue(chat, nodes, true) })
  for (const { revision, state } of input.revisions) entries.push({ path: 'chat/revisions/' + revision + '.json', content: packValue(state, nodes, true) })
  json('session/foreground.json', input.session)
  if (input.card?.payload) json('card/payload.json', input.card.payload)
  if (input.script) json('script/script.json', input.script)
  const scene = input.scene
  if (scene) {
    for (const file of scene.files) entries.push({ path: 'scene/files/' + safeSegment(file.path), content: file.content })
    for (const book of scene.worldbooks) entries.push({ path: 'scene/worldbooks/' + safeSegment(book.digest) + '.json', content: book.content })
    scene.attachments.forEach((attachment, index) => entries.push({ path: 'scene/attachments/' + index + '.bin', content: attachment.data }))
    json('scene/attachments.json', scene.attachments.map((attachment, index) => ({ attachmentId: attachment.attachmentId, mediaType: attachment.mediaType, file: 'scene/attachments/' + index + '.bin' })))
  }
  // Plugin data and media (docs/plugin-api.md): the plugin files as they are, files they point at beside them.
  const plugins = input.plugins
  if (plugins) {
    json('plugins/data.json', plugins.data ?? null)
    json('plugins/media.json', plugins.media ?? null)
    plugins.attachments.forEach((attachment, index) => entries.push({ path: 'plugins/attachments/' + index + '.bin', content: attachment.data }))
    json('plugins/attachments.json', plugins.attachments.map((attachment, index) => ({ attachmentId: attachment.attachmentId,
      ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}), ...(attachment.name ? { name: attachment.name } : {}), file: 'plugins/attachments/' + index + '.bin' })))
  }
  entries.push(...nodeFiles(nodes))
  const assistantTurns = (chat.messages || []).filter(message => message?.role === 'assistant').length
  entries.unshift({ path: 'manifest.json', content: JSON.stringify({
    format: GAME_SAVE_FORMAT, formatVersion: GAME_SAVE_FORMAT_VERSION, tavernVersion: input.tavernVersion, exportedAt: input.exportedAt,
    source: { chatId: chat.id, sessionId: chat.sessionId, cardPath: chat.cardPath, cardName: chat.cardName, title: chat.title || '', mode: chat.mode || 'story', turns: assistantTurns },
    contents: { revisions: input.revisions.map(item => item.revision), card: Boolean(input.card?.payload), script: Boolean(input.script), sceneImages: Boolean(scene), attachments: scene ? scene.attachments.length : 0, plugins: Boolean(plugins) }
  }, null, 2) })
  return writeZipEntries(entries, { readable: true, label: '存档包', ...limits, oversized: () => '（' + describeSize(entries) + '）' })
}

// Which part made the save too big: raw sizes per part, largest first.
function describeSize(entries) {
  const totals = new Map()
  for (const entry of entries) {
    const part = SIZE_PARTS.find(([, pattern]) => pattern.test(entry.path))?.[0] || '其他'
    totals.set(part, (totals.get(part) || 0) + (Buffer.isBuffer(entry.content) ? entry.content.length : Buffer.byteLength(String(entry.content))))
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([part, bytes]) => part + ' ' + (bytes / 1048576).toFixed(1) + ' MB').join('，')
}

/** Parse and validate a package; returns the same shape buildGameSave takes, with states unpacked. */
export function readGameSave(buffer, { tavernVersion, limits = GAME_SAVE_LIMITS } = {}) {
  const files = readZipEntries(buffer, { label: '存档包', ...limits })
  const text = path => { const data = files.get(path); if (!data) throw new Error('存档包缺少 ' + path); return data.toString('utf8') }
  const parse = (value, path) => { try { return JSON.parse(value) } catch { throw new Error('存档包已损坏：' + path + ' 无法读取') } }
  const manifest = parse(text('manifest.json'), 'manifest.json')
  if (manifest?.format !== GAME_SAVE_FORMAT) throw new Error('这不是 DSH Tavern 存档包')
  if (!Number.isSafeInteger(manifest.formatVersion) || manifest.formatVersion > GAME_SAVE_FORMAT_VERSION) throw new Error('存档包格式（第 ' + manifest.formatVersion + ' 版）比当前酒馆支持的新，请先更新酒馆再导入')
  if (tavernVersion && newerVersion(manifest.tavernVersion, tavernVersion)) throw new Error('存档由更新版本的酒馆（' + manifest.tavernVersion + '）导出，当前是 ' + tavernVersion + '，请先更新酒馆再导入')
  const store = { blobs: new Map(), nodes: new Map() }
  for (const [path, data] of files) {
    if (path.startsWith('blobs/')) store.blobs.set(path.slice(6, -5), data.toString('utf8'))
    else if (path.startsWith('nodes/')) for (const line of data.toString('utf8').split('\n')) if (line) store.nodes.set(line.slice(0, 64), line.slice(65))
  }
  const state = path => unpackValue(parse(text(path), path), store)
  const revisions = manifest.contents.revisions.map(revision => ({ revision, state: state('chat/revisions/' + revision + '.json') }))
  let scene = null
  if (manifest.contents.sceneImages) {
    scene = {
      files: [...files].filter(([path]) => path.startsWith('scene/files/')).map(([path, data]) => ({ path: path.slice('scene/files/'.length), content: data })),
      worldbooks: [...files].filter(([path]) => path.startsWith('scene/worldbooks/')).map(([path, data]) => ({ digest: path.slice('scene/worldbooks/'.length, -5), content: data })),
      attachments: JSON.parse(text('scene/attachments.json')).map(item => ({ attachmentId: item.attachmentId, mediaType: item.mediaType, data: files.get(item.file) }))
    }
  }
  // Packages from before plugin data was saved simply have none.
  const plugins = manifest.contents.plugins && files.has('plugins/attachments.json') ? {
    data: parse(text('plugins/data.json'), 'plugins/data.json'),
    media: parse(text('plugins/media.json'), 'plugins/media.json'),
    attachments: parse(text('plugins/attachments.json'), 'plugins/attachments.json').map(item => ({ attachmentId: item.attachmentId, mediaType: item.mediaType, name: item.name, data: files.get(item.file) }))
  } : null
  return {
    manifest, plugins,
    chat: state('chat/current.json'),
    revisions,
    session: parse(text('session/foreground.json'), 'session/foreground.json'),
    card: files.has('card/payload.json') ? { path: manifest.source.cardPath, payload: JSON.parse(text('card/payload.json')) } : null,
    script: files.has('script/script.json') ? JSON.parse(text('script/script.json')) : null,
    scene
  }
}

function newerVersion(left, right) {
  const parts = value => String(value || '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0)
  const a = parts(left), b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0)
  return false
}

/** Last native title shared by save export naming and imported game naming. */
export function sessionTitleOf(events) {
  const title = [...(events || [])].reverse().find(event => event?.type === 'session/title')?.data?.title
  return title == null ? '' : String(title).trim()
}
