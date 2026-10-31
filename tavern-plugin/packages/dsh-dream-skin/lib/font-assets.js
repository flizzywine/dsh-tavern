// Only this shipped catalog may initiate downloads. Installed family manifests are local-only.
import { readFileSync, constants } from 'node:fs'
import { readFile, mkdir, realpath, lstat, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FONT_CATALOG = JSON.parse(readFileSync(new URL('./font-catalog.json', import.meta.url), 'utf8'))
export const MAX_FONT_BYTES = 20_000_000
const defaultBundle = fileURLToPath(new URL('../fonts/', import.meta.url))
const flights = new Map(), failures = new Map()
let active = 0
const waiting = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (base, target) => { const relative = path.relative(base, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }
for (const family of FONT_CATALOG.families) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(family.id)) throw new Error('Invalid shipped font id')
  for (const face of family.files) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.(woff2|ttf|otf)$/.test(face.file) || !/^[a-f0-9]{64}$/.test(face.sha256) || !Number.isSafeInteger(face.bytes) || face.bytes <= 0 || face.bytes >= MAX_FONT_BYTES) throw new Error('Invalid shipped font asset')
    Object.freeze(face)
  }
  Object.freeze(family.files); Object.freeze(family)
}
if (!/^[a-f0-9]{40}$/.test(FONT_CATALOG.revision)) throw new Error('Invalid font source revision')
Object.freeze(FONT_CATALOG.families); Object.freeze(FONT_CATALOG)

async function verified(file, face) {
  let handle
  try {
    if (!(await lstat(file)).isFile()) return null
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const info = await handle.stat()
    if (!info.isFile() || info.size !== face.bytes) return null
    const bytes = await handle.readFile()
    return bytes.length === face.bytes && hash(bytes) === face.sha256 ? bytes : null
  } catch { return null }
  finally { await handle?.close() }
}
async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let handle
  try { handle = await open(directory, 'r'); await handle.sync() }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error }
  finally { await handle?.close() }
}
async function cacheDirectory(dataRoot) {
  await mkdir(dataRoot, { recursive: true })
  const base = await realpath(dataRoot)
  await syncDirectory(path.dirname(base))
  let dir = base
  for (const part of ['cache', 'fonts']) {
    dir = path.join(dir, part)
    try { await mkdir(dir) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const info = await lstat(dir)
    if (!info.isDirectory() || !inside(base, await realpath(dir))) throw new Error('Font cache escapes data directory')
    await syncDirectory(path.dirname(dir))
  }
  return dir
}
async function store(dir, face, bytes) {
  const target = path.join(dir, face.sha256), temporary = target + '.' + randomUUID() + '.tmp'
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null
    await rename(temporary, target)
    await syncDirectory(dir)
    return target
  } finally { await handle?.close(); await unlink(temporary).catch(() => {}) }
}
async function bundled(face, id, roots) {
  for (const root of roots) {
    try {
      const base = await realpath(root), file = path.join(base, id, face.file)
      if (!inside(base, await realpath(file))) continue
      const bytes = await verified(file, face)
      if (bytes) return bytes
    } catch { /* Missing or invalid legacy files are never trusted or deleted. */ }
  }
  return null
}
async function slot(work) {
  if (active >= 2) {
    if (waiting.length >= 32) throw new Error('Font download queue full')
    await new Promise((resolve, reject) => {
      const entry = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => {
        const index = waiting.indexOf(entry)
        if (index >= 0) waiting.splice(index, 1)
        reject(new Error('Font download queue timeout'))
      }, 12_000)
      waiting.push(entry)
    })
  } else active++
  try { return await work() }
  finally { const next = waiting.shift(); if (next) next(); else active-- }
}
async function download(id, face, fetchImpl) {
  const suffix = `flizzywine/dsh-tavern@${FONT_CATALOG.revision}/tavern-plugin/fonts/${id}/${face.file}`
  const urls = [`https://cdn.jsdelivr.net/gh/${suffix}`, `https://raw.githubusercontent.com/flizzywine/dsh-tavern/${FONT_CATALOG.revision}/tavern-plugin/fonts/${id}/${face.file}`]
  for (const url of urls) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000)
    // Node's fetch does not fail a pending body read on abort; the deadline races every read.
    const deadline = new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Font download timed out')), { once: true }))
    deadline.catch(() => {})
    let reader
    try {
      // Redirects are deliberately rejected: no user-controlled hosts or cross-origin forwarding.
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', credentials: 'omit' })
      if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error('Font source rejected')
      const length = response.headers.get('content-length')
      if (length !== null && Number(length) !== face.bytes) throw new Error('Font size mismatch')
      reader = response.body.getReader()
      let size = 0; const chunks = []
      while (true) {
        const { done, value } = await Promise.race([reader.read(), deadline])
        if (done) break
        size += value.byteLength
        if (size > face.bytes || size >= MAX_FONT_BYTES) throw new Error('Font exceeds expected size')
        chunks.push(Buffer.from(value))
      }
      const bytes = Buffer.concat(chunks)
      if (bytes.length !== face.bytes || hash(bytes) !== face.sha256) throw new Error('Font integrity mismatch')
      return bytes
    } catch { /* One bounded fallback to the same immutable Git revision. */ }
    finally { clearTimeout(timer); reader?.cancel().catch(() => {}); controller.abort() }
  }
  throw new Error('Font unavailable; use system fallback')
}
export function createFontAssets({ dataRoot, bundledRoots = [defaultBundle], fetchImpl = globalThis.fetch } = {}) {
  async function ensure(id, file, { offline = false } = {}) {
    const family = FONT_CATALOG.families.find(item => item.id === id)
    const face = family?.files.find(item => item.file === file)
    if (!face) throw new Error('Unknown shipped font')
    const dir = await cacheDirectory(dataRoot), target = path.join(dir, face.sha256)
    if (await verified(target, face)) return target
    const key = target
    if (flights.has(key)) return flights.get(key)
    const promise = (async () => {
      const legacy = await bundled(face, id, bundledRoots)
      if (legacy) return store(dir, face, legacy)
      if (offline || (failures.get(key) || 0) > Date.now()) throw new Error('Font not cached')
      try { return await slot(async () => store(dir, face, await download(id, face, fetchImpl))) }
      catch (error) { failures.set(key, Date.now() + 60_000); throw error }
    })()
    flights.set(key, promise)
    try { return await promise } finally { flights.delete(key) }
  }
  return Object.freeze({ ensure })
}
export async function adoptBundledFonts({ dataRoot, bundledRoots }) {
  let dir, adopted = 0
  for (const family of FONT_CATALOG.families) for (const face of family.files) {
    const legacy = await bundled(face, family.id, bundledRoots)
    if (!legacy) continue
    // A valid old file must be durable before an updater may remove its old tree.
    dir ||= await cacheDirectory(dataRoot)
    if (!await verified(path.join(dir, face.sha256), face)) await store(dir, face, legacy)
    adopted++
  }
  return adopted
}
