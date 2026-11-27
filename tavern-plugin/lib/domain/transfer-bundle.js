import { createHash } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as zlib from 'node:zlib'
import { readZipEntries, writeZipEntries } from '../domain/zip-entries.js'
import { openZipFile } from './zip-file.js'

// `.dshtransfer` is a plain ZIP: manifest.json plus parts/<kind>/… files.
// Every item is addressed by its manifest entry, so an import never guesses a path.
export const TRANSFER_SPEC = 'dsh-tavern.transfer'
export const TRANSFER_VERSION = 1
export const TRANSFER_EXTENSION = '.dshtransfer'
export const MANIFEST_ENTRY = 'manifest.json'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A safe file name for the download; never empty, never a path. */
export function safeTransferFileName(value, fallback = 'DSH酒馆备份') {
  const name = str(value)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  return name || fallback
}

/** One manifest item. Content is the exact bytes an import will read back. */
export function transferItem({ key, title, entry, content }) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  return { key: str(key), title: str(title), entry: str(entry), bytes: bytes.length, sha256: sha256(bytes) }
}

export function buildTransferManifest({ name, createdAt = Date.now(), source = {}, parts = [] }) {
  const cleaned = parts.map(function (part) {
    const items = (part.items || []).filter(function (item) { return item && item.entry })
    const bytes = items.reduce(function (sum, item) { return sum + (Number(item.bytes) || 0) }, 0)
    return { kind: str(part.kind), label: str(part.label), bytes, items: items.map(function (item) {
      return { key: item.key, title: item.title, bytes: item.bytes, sha256: item.sha256, entry: item.entry }
    }) }
  }).filter(function (part) { return part.items.length > 0 })
  return {
    spec: TRANSFER_SPEC,
    version: TRANSFER_VERSION,
    name: safeTransferFileName(name),
    createdAt: Number(createdAt) || Date.now(),
    source: { tavern: str(source.tavern), platform: str(source.platform) },
    parts: cleaned,
    totals: {
      items: cleaned.reduce(function (sum, part) { return sum + part.items.length }, 0),
      bytes: cleaned.reduce(function (sum, part) { return sum + part.bytes }, 0)
    }
  }
}

// A bundle larger than this is stored on disk and streamed to the page (rpc/transfer.js), so the
// export is not carried through a JSON reply. One game save alone runs to tens of megabytes, so
// the whole library has to fit: keeping the 50 MB ZIP default here made big saves impossible to
// export at all. The uploaded ZIP is read one entry at a time to support the same limits.
export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024
export const MAX_EXPORT_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_EXPORT_ENTRIES = 10000

const PRECOMPRESSED_ENTRY = /\.(dshsave|zip|png|webp|jpe?g|gif|webm|mp4|m4a|ogg|oga|opus|mp3|aac|flac|woff2?)$/i
const CRC_TABLE = typeof zlib.crc32 === 'function' ? null
  : Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0 })
const crc32 = typeof zlib.crc32 === 'function'
  ? data => zlib.crc32(data)
  : data => { let value = 0xffffffff; for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0 }
const mb = bytes => Math.round(bytes / 1048576) + ' MB'

async function writeFull(handle, buffer, position) {
  let written = 0
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, position + written)
    written += result.bytesWritten
  }
  return position + written
}

/**
 * 流式写入 `.dshtransfer`（标准 ZIP）：每条内容写完即落盘并释放，不在内存里攒整份归档。
 * `manifest.json` 在最后 finalize 时写入；读写双方均按中央目录按名索引，不依赖条目顺序。
 */
export async function createTransferBundleWriter(outPath, {
  maxArchiveBytes = MAX_EXPORT_BYTES,
  maxExpandedBytes = MAX_EXPORT_EXPANDED_BYTES,
  maxEntries = MAX_EXPORT_ENTRIES
} = {}) {
  const target = path.resolve(outPath)
  await mkdir(path.dirname(target), { recursive: true })
  const tmpPath = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
  const handle = await open(tmpPath, 'w')
  const central = []
  let closed = false
  let offset = 0
  let expandedBytes = 0
  let directoryBytes = 0
  let entryCount = 0

  async function abort() {
    if (!closed) {
      closed = true
      await handle.close().catch(() => {})
    }
    await unlink(tmpPath).catch(() => {})
  }

  async function addEntry(entryPath, content) {
    if (closed) throw new Error('导出包写入器已关闭')
    if (entryCount + 1 > maxEntries) {
      throw new Error('导出包文件数量过多，无法生成可导入的压缩包')
    }
    const name = Buffer.from(str(entryPath), 'utf8')
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    expandedBytes += data.length
    if (expandedBytes > maxExpandedBytes) {
      throw new Error('导出包解压后 ' + mb(expandedBytes) + '，超过 ' + mb(maxExpandedBytes) + '，请取消一部分板块后分两次导出')
    }
    let method = 0
    let payload = data
    if (data.length > 0 && !PRECOMPRESSED_ENTRY.test(entryPath)) {
      const compressed = zlib.deflateRawSync(data, { level: 6 })
      if (compressed.length < data.length) {
        method = 8
        payload = compressed
      }
    }
    const localSize = 30 + name.length + payload.length
    const centralSize = 46 + name.length
    const projected = offset + localSize + directoryBytes + centralSize + 22
    if (offset + localSize > 0xffffffff) throw new Error('压缩包超过 4 GB')
    if (projected > maxArchiveBytes) {
      throw new Error('导出包有 ' + mb(projected) + '，超过 ' + mb(maxArchiveBytes) + '，请取消一部分板块后分两次导出')
    }

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(0x21, 12) // Valid DOS date: 1980-01-01.
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    header.copy(directory, 6, 4, 30)
    directory.writeUInt32LE(offset, 42)

    offset = await writeFull(handle, header, offset)
    offset = await writeFull(handle, name, offset)
    if (payload.length > 0) offset = await writeFull(handle, payload, offset)

    central.push(directory, name)
    directoryBytes += centralSize
    entryCount += 1
    return { bytes: data.length, compressedBytes: payload.length }
  }

  async function finalize(manifest) {
    try {
      await addEntry(MANIFEST_ENTRY, JSON.stringify(manifest, null, 2) + '\n')
      if (entryCount > 0xffff) throw new Error('导出包文件数量过多，无法生成可导入的压缩包')
      const totalSize = offset + directoryBytes + 22
      if (totalSize > maxArchiveBytes) {
        throw new Error('导出包有 ' + mb(totalSize) + '，超过 ' + mb(maxArchiveBytes) + '，请取消一部分板块后分两次导出')
      }
      const cdStart = offset
      for (const chunk of central) offset = await writeFull(handle, chunk, offset)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(entryCount, 8)
      end.writeUInt16LE(entryCount, 10)
      end.writeUInt32LE(directoryBytes, 12)
      end.writeUInt32LE(cdStart, 16)
      offset = await writeFull(handle, end, offset)
      closed = true
      await handle.close()
      await rename(tmpPath, target)
      return { bytes: offset, entries: entryCount, expandedBytes }
    } catch (error) {
      await abort()
      throw error
    }
  }

  return { addEntry, finalize, abort }
}

/** Pack the manifest and its part files. The bundle is still a ZIP, so any unzip tool opens it. */
export function packTransferBundle({ manifest, files, maxArchiveBytes = MAX_EXPORT_BYTES, maxExpandedBytes = MAX_EXPORT_EXPANDED_BYTES }) {
  const entries = [{ path: MANIFEST_ENTRY, content: JSON.stringify(manifest, null, 2) + '\n' }]
  for (const [entry, content] of files) entries.push({ path: entry, content })
  return writeZipEntries(entries, {
    readable: true,
    label: '导出包',
    maxArchiveBytes,
    maxExpandedBytes,
    oversized: () => '，请取消一部分板块后分两次导出'
  })
}

function entryProblem(entry) {
  const value = str(entry).replace(/\\/g, '/')
  if (value === '' || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return '路径无效'
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized.startsWith('..') || normalized === MANIFEST_ENTRY) return '路径越界'
  if (!value.startsWith('parts/')) return '不在 parts/ 下'
  return ''
}

/**
 * Read a bundle: validate the manifest, then check every item against the bytes it claims.
 * A broken item is reported, never silently dropped: the caller decides what to skip.
 */
export function readTransferBundle(input) {
  const entries = readZipEntries(input, { label: '导出包', maxArchiveBytes: MAX_EXPORT_BYTES, maxExpandedBytes: MAX_EXPORT_EXPANDED_BYTES })
  return inspectTransferEntries(entries.get(MANIFEST_ENTRY), name => {
    const value = entries.get(name)
    return value === undefined ? undefined : { value, length: value.length, digest: () => sha256(value) }
  })
}

export async function readTransferBundleFile(file) {
  const zip = await openZipFile(file, {
    label: '导出包', maxArchiveBytes: MAX_EXPORT_BYTES, maxExpandedBytes: MAX_EXPORT_EXPANDED_BYTES, maxEntries: 10000,
  })
  try {
    const manifestEntry = zip.entries.get(MANIFEST_ENTRY)
    const manifestBytes = manifestEntry && await zip.readBuffer(manifestEntry)
    // Check every member without retaining its uncompressed bytes. Preview and apply load
    // only the members they need, one at a time, from the same private upload.
    const verified = new Map()
    for (const [name, entry] of zip.entries) {
      if (name === MANIFEST_ENTRY) continue
      const hash = createHash('sha256')
      for await (const chunk of await zip.stream(entry)) hash.update(chunk)
      const digest = hash.digest('hex')
      verified.set(name, { value: entry, length: entry.size, digest: () => digest })
    }
    const bundle = inspectTransferEntries(manifestBytes, name => verified.get(name))
    const entries = bundle.files
    return { ...bundle, bytes: zip.size, close: zip.close, files: {
      size: entries.size,
      has: name => entries.has(name),
      get: name => entries.has(name) ? zip.readBuffer(entries.get(name), MAX_EXPORT_EXPANDED_BYTES) : undefined,
    } }
  } catch (error) { await zip.close(); throw error }
}

function inspectTransferEntries(manifestBytes, lookup) {
  if (manifestBytes === undefined) throw new Error('导出包里没有 manifest.json，可能不是 DSH Tavern 的导出包')
  let manifest
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) } catch (error) { throw new Error('导出包的 manifest.json 不是有效的 JSON：' + str(error && error.message || error)) }
  if (!manifest || typeof manifest !== 'object' || JSON.stringify(manifest).length < 2) throw new Error('导出包的 manifest.json 内容无效')
  if (manifest.spec !== TRANSFER_SPEC) throw new Error('不是 DSH Tavern 导出包（spec 不符）：' + str(manifest.spec))
  if (Number(manifest.version) !== TRANSFER_VERSION) throw new Error('不支持的导出包版本：' + str(manifest.version))
  if (!Array.isArray(manifest.parts)) throw new Error('导出包没有板块列表')

  const files = new Map()
  const issues = []
  const parts = manifest.parts.map(function (part) {
    const kind = str(part && part.kind)
    const items = Array.isArray(part && part.items) ? part.items : []
    return {
      kind,
      label: str(part && part.label) || kind,
      bytes: Math.max(0, Number(part && part.bytes) || 0),
      items: items.map(function (item) {
        const key = str(item && item.key)
        const title = str(item && item.title) || key
        const entry = str(item && item.entry)
        const problem = entryProblem(entry)
        if (problem) {
          issues.push(kind + ' · ' + title + '：' + problem)
          return { key, title, entry, bytes: 0, sha256: '', usable: false }
        }
        const member = lookup(entry)
        if (member === undefined) {
          issues.push(kind + ' · ' + title + '：包内缺少 ' + entry)
          return { key, title, entry, bytes: 0, sha256: '', usable: false }
        }
        if (Number(item && item.bytes) > 0 && Number(item.bytes) !== member.length) {
          issues.push(kind + ' · ' + title + '：大小与清单不符')
          return { key, title, entry, bytes: member.length, sha256: str(item && item.sha256), usable: false }
        }
        if (str(item && item.sha256) && str(item.sha256) !== member.digest()) {
          issues.push(kind + ' · ' + title + '：内容校验失败')
          return { key, title, entry, bytes: member.length, sha256: str(item && item.sha256), usable: false }
        }
        files.set(entry, member.value)
        return { key, title, entry, bytes: member.length, sha256: str(item && item.sha256), usable: true }
      })
    }
  }).filter(function (part) { return part.items.length > 0 })

  const clean = Object.assign({}, manifest, { parts })
  clean.totals = {
    items: parts.reduce(function (sum, part) { return sum + part.items.length }, 0),
    bytes: parts.reduce(function (sum, part) { return sum + part.bytes }, 0)
  }
  return { manifest: clean, files, issues }
}
