import { createHash } from 'node:crypto'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

// Asset packs (Wiki「设计：dsh-card-format」): what a DSH card carries besides its text, kept as
// opaque data. Every file is stored once by its SHA-256; a pack is an index of path → file, named
// by its id and content hash. Tavern never interprets a pack's contents; the plugin that reads its
// `format` does. Files are served by a type allowlist so nothing in a pack runs in Tavern's page.

const PACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const HASH = /^[0-9a-f]{64}$/
// Media types served inline; everything else is a download that never renders in the page.
const INLINE_TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  json: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8'
})

/** How a pack file is served: inline with its type, or as an inert download. */
export function packMediaType(file) {
  const extension = path.posix.extname(String(file)).slice(1).toLowerCase()
  return Object.hasOwn(INLINE_TYPES, extension) ? { mediaType: INLINE_TYPES[extension], inline: true } : { mediaType: 'application/octet-stream', inline: false }
}

export function validPackId(value) { return typeof value === 'string' && PACK_ID.test(value) }

/** A relative path inside a pack: no absolute paths, no `.`/`..` or hidden parts, no backslashes. */
export function validPackPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 && !value.includes('\\') && !value.startsWith('/')
    && value.split('/').every(part => part && !part.startsWith('.'))
}

/** A pack's content hash when it does not bring one: over its sorted path and file digests. */
export function packContentHash(files) {
  const hash = createHash('sha256')
  for (const file of Object.keys(files).sort()) hash.update(file + '\u0000' + files[file].sha256 + '\n')
  return hash.digest('hex')
}

export function createAssetPacks({ store, mediaStore }) {
  const indexPath = (id, contentHash) => 'asset-packs/packs/' + id + '/' + contentHash + '.json'

  /** Store a stream as a blob; preserve the existing upload error contract. */
  async function putBlob(source, { maxBytes = Infinity } = {}) {
    try { return await mediaStore.put(source, { maxBytes }) }
    catch (error) {
      if (error.code === 'LIMIT_EXCEEDED') throw Object.assign(new Error('素材文件超过 ' + Math.round(maxBytes / 1048576) + ' MB'), { code: 'TAVERN_PACK_TOO_LARGE' })
      throw error
    }
  }

  async function readPack(id, contentHash) {
    if (!validPackId(id) || !HASH.test(String(contentHash))) return null
    const value = await store.readJson(indexPath(id, contentHash)).catch(() => undefined)
    return value && value.id === id && value.contentHash === contentHash ? value : null
  }

  /**
   * Import one pack from an open ZIP (zip-file.js): every entry under `prefix`.
   * Packs already stored with the same id and content hash are reused, not read again.
   */
  async function importFromZip(zip, { prefix, id, contentHash, format = '', title = '', credits = [], maxFileBytes = 512 * 1024 * 1024 } = {}) {
    if (!validPackId(id)) throw Object.assign(new Error('素材包 id 无效：' + id), { code: 'TAVERN_PACK_INVALID' })
    if (contentHash !== undefined && !HASH.test(String(contentHash))) throw Object.assign(new Error('素材包摘要无效：' + id), { code: 'TAVERN_PACK_INVALID' })
    if (contentHash) { const known = await readPack(id, contentHash); if (known) return { pack: known, reused: true } }
    const files = {}
    for (const entry of zip.entries.values()) {
      if (!entry.path.startsWith(prefix)) continue
      const stored = await putBlob(await zip.stream(entry), { maxBytes: maxFileBytes })
      files[entry.path.slice(prefix.length)] = stored
    }
    if (!Object.keys(files).length) throw Object.assign(new Error('素材包是空的：' + id), { code: 'TAVERN_PACK_INVALID' })
    return await publish(id, contentHash || packContentHash(files), { format, title, credits, files })
  }

  async function publish(id, hash, { format, title, credits, files }) {
    const known = await readPack(id, hash)
    if (known) return { pack: known, reused: true }
    const pack = { id, contentHash: hash, format: String(format).slice(0, 80), title: String(title).slice(0, 120),
      credits: credits.filter(file => typeof file === 'string' && Object.hasOwn(files, file)), files, importedAt: Date.now() }
    await store.writeJson(indexPath(id, hash), pack)
    return { pack, reused: false }
  }

  /** A pack from loose files [{ path, data }] (a plugin building one); same storage as a card's packs. */
  async function importFiles(entries, { id, format = '', title = '', credits = [], maxFileBytes = 512 * 1024 * 1024 } = {}) {
    if (!validPackId(id)) throw Object.assign(new Error('素材包 id 无效：' + id), { code: 'TAVERN_PACK_INVALID' })
    if (!Array.isArray(entries) || !entries.length) throw Object.assign(new Error('素材包是空的：' + id), { code: 'TAVERN_PACK_INVALID' })
    const files = {}
    for (const entry of entries) {
      const relative = String(entry?.path || '')
      if (!validPackPath(relative)) throw Object.assign(new Error('素材包内的路径无效：' + relative.slice(0, 200)), { code: 'TAVERN_PACK_INVALID' })
      if (Object.hasOwn(files, relative)) throw Object.assign(new Error('素材包内的路径重复：' + relative), { code: 'TAVERN_PACK_INVALID' })
      if (!(entry.data instanceof Uint8Array)) throw Object.assign(new Error('素材文件 ' + relative + ' 的 data 必须是 Uint8Array 或 Buffer'), { code: 'TAVERN_PACK_INVALID' })
      files[relative] = await putBlob(Readable.from([Buffer.from(entry.data)]), { maxBytes: maxFileBytes })
    }
    return await publish(id, packContentHash(files), { format, title, credits, files })
  }

  /** A pack file on disk, with how to serve it; undefined when the pack or file is unknown. */
  async function file(id, contentHash, relative) {
    const pack = await readPack(id, contentHash)
    const entry = pack && Object.hasOwn(pack.files, String(relative)) ? pack.files[relative] : null
    if (!entry || !HASH.test(entry.sha256)) return undefined
    const resolved = await mediaStore.resolve(entry)
    if (!resolved) return undefined
    return { path: resolved.absolutePath, size: entry.size, sha256: entry.sha256, ...packMediaType(relative) }
  }

  return Object.freeze({ readPack, importFromZip, importFiles, file, putBlob })
}
