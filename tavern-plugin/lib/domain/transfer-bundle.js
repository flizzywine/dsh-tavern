import { createHash } from 'node:crypto'
import path from 'node:path'
import { readZipEntries, writeZipEntries } from '../domain/zip-entries.js'

// `.dshtransfer` is a plain ZIP: manifest.json plus parts/<kind>/… files.
// Every item is addressed by its manifest entry, so an import never guesses a path.
export const TRANSFER_SPEC = 'dsh-tavern.transfer'
export const TRANSFER_VERSION = 1
export const TRANSFER_EXTENSION = '.dshtransfer'
export const MANIFEST_ENTRY = 'manifest.json'

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024
const MAX_IMPORT_EXPANDED = 2 * 1024 * 1024 * 1024

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
// export at all. The import side keeps its own caps.
export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024
export const MAX_EXPORT_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024

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
  const entries = readZipEntries(input, { label: '导出包', maxArchiveBytes: MAX_IMPORT_BYTES, maxExpandedBytes: MAX_IMPORT_EXPANDED })
  const manifestBytes = entries.get(MANIFEST_ENTRY)
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
        const bytes = entries.get(entry)
        if (bytes === undefined) {
          issues.push(kind + ' · ' + title + '：包内缺少 ' + entry)
          return { key, title, entry, bytes: 0, sha256: '', usable: false }
        }
        if (Number(item && item.bytes) > 0 && Number(item.bytes) !== bytes.length) {
          issues.push(kind + ' · ' + title + '：大小与清单不符')
          return { key, title, entry, bytes: bytes.length, sha256: str(item && item.sha256), usable: false }
        }
        if (str(item && item.sha256) && str(item.sha256) !== sha256(bytes)) {
          issues.push(kind + ' · ' + title + '：内容校验失败')
          return { key, title, entry, bytes: bytes.length, sha256: str(item && item.sha256), usable: false }
        }
        files.set(entry, bytes)
        return { key, title, entry, bytes: bytes.length, sha256: str(item && item.sha256), usable: true }
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
