import { createHash } from 'node:crypto'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

// A game save package carries one game to another install: the save with the history its
// rollback and regeneration need, the native session, the card it was started from and,
// optionally, its scene images. Importing always creates a new game.
export const GAME_SAVE_FORMAT = 'dsh-tavern-save'
export const GAME_SAVE_FORMAT_VERSION = 1
const MAX_REVISIONS = 400
const BLOB_MIN_CHARS = 64 * 1024
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

// Card and worldbook snapshots repeat verbatim in every revision (several MB each).
function packState(state, blobs) {
  const packed = {}
  for (const [key, value] of Object.entries(state)) {
    const json = JSON.stringify(value)
    if (json !== undefined && json.length >= BLOB_MIN_CHARS) {
      const id = sha(json)
      blobs.set(id, json)
      packed[key] = { $dshSaveBlob: id }
    } else packed[key] = value
  }
  return packed
}

function unpackState(packed, blobs) {
  const state = {}
  for (const [key, value] of Object.entries(packed)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.$dshSaveBlob === 'string') {
      if (!blobs.has(value.$dshSaveBlob)) throw new Error('存档包缺少数据块：' + value.$dshSaveBlob.slice(0, 12))
      try { state[key] = JSON.parse(blobs.get(value.$dshSaveBlob)) } catch { throw new Error('存档包已损坏：数据块无法读取') }
    } else state[key] = value
  }
  return state
}

/**
 * input: { chat, revisions: [{revision, state}], session: {header, inheritedEventCount, events},
 *   card: {path, payload} (an importCard payload), script?: {path, text}, scene?: {files: [{path, content}], worldbooks: [{digest, content}],
 *   attachments: [{attachmentId, mediaType, data}]}, plugins?: {data, media, attachments: [{attachmentId, mediaType?, name?, data}]},
 *   tavernVersion, exportedAt }
 */
export function buildGameSave(input) {
  const chat = input.chat
  const blobs = new Map()
  const entries = []
  const json = (path, value) => entries.push({ path, content: JSON.stringify(value) })
  json('chat/current.json', packState(chat, blobs))
  for (const { revision, state } of input.revisions) json('chat/revisions/' + revision + '.json', packState(state, blobs))
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
  for (const [id, value] of blobs) entries.push({ path: 'blobs/' + id + '.json', content: value })
  const assistantTurns = (chat.messages || []).filter(message => message?.role === 'assistant').length
  entries.unshift({ path: 'manifest.json', content: JSON.stringify({
    format: GAME_SAVE_FORMAT, formatVersion: GAME_SAVE_FORMAT_VERSION, tavernVersion: input.tavernVersion, exportedAt: input.exportedAt,
    source: { chatId: chat.id, sessionId: chat.sessionId, cardPath: chat.cardPath, cardName: chat.cardName, title: chat.title || '', mode: chat.mode || 'story', turns: assistantTurns },
    contents: { revisions: input.revisions.map(item => item.revision), card: Boolean(input.card?.payload), script: Boolean(input.script), sceneImages: Boolean(scene), attachments: scene ? scene.attachments.length : 0, plugins: Boolean(plugins) }
  }, null, 2) })
  return writeZipEntries(entries, { readable: true, label: '存档包' })
}

/** Parse and validate a package; returns the same shape buildGameSave takes, with states unpacked. */
export function readGameSave(buffer, { tavernVersion } = {}) {
  const files = readZipEntries(buffer, { label: '存档包' })
  const text = path => { const data = files.get(path); if (!data) throw new Error('存档包缺少 ' + path); return data.toString('utf8') }
  const parse = (value, path) => { try { return JSON.parse(value) } catch { throw new Error('存档包已损坏：' + path + ' 无法读取') } }
  const manifest = parse(text('manifest.json'), 'manifest.json')
  if (manifest?.format !== GAME_SAVE_FORMAT) throw new Error('这不是 DSH Tavern 存档包')
  if (!Number.isSafeInteger(manifest.formatVersion) || manifest.formatVersion > GAME_SAVE_FORMAT_VERSION) throw new Error('存档包格式（第 ' + manifest.formatVersion + ' 版）比当前酒馆支持的新，请先更新酒馆再导入')
  if (tavernVersion && newerVersion(manifest.tavernVersion, tavernVersion)) throw new Error('存档由更新版本的酒馆（' + manifest.tavernVersion + '）导出，当前是 ' + tavernVersion + '，请先更新酒馆再导入')
  const blobs = new Map()
  for (const [path, data] of files) if (path.startsWith('blobs/')) blobs.set(path.slice(6, -5), data.toString('utf8'))
  const revisions = manifest.contents.revisions.map(revision => ({ revision, state: unpackState(parse(text('chat/revisions/' + revision + '.json'), 'chat/revisions/' + revision + '.json'), blobs) }))
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
    chat: unpackState(parse(text('chat/current.json'), 'chat/current.json'), blobs),
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
