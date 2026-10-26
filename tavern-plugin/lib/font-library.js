import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { pluginMediaRange } from './domain/plugin-media.js'

// The font library (docs/design/cast-presentation.md「字体库」): open-source CJK families a stage skin names by id
// (font.body / name / ui, a face's fallback). Each family is a folder <id>/ holding index.json, its font files and its
// licence. The plugin ships some in tavern-plugin/fonts/; a family installed under <dataRoot>/fonts/ with the same id
// replaces the shipped one whole.
export const FONT_ROUTE = '/api/dsh-tavern/fonts/'
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.(woff2|ttf|otf)$/
const FORMATS = { woff2: { format: 'woff2', mime: 'font/woff2' }, ttf: { format: 'truetype', mime: 'font/ttf' }, otf: { format: 'opentype', mime: 'font/otf' } }
const CATEGORIES = new Set(['sans', 'serif', 'rounded', 'hand', 'display'])

export function createFontLibrary({ dataRoot, bundledRoot = fileURLToPath(new URL('../fonts/', import.meta.url)) }) {
  const roots = [path.resolve(dataRoot, 'fonts'), ...(bundledRoot ? [path.resolve(bundledRoot)] : [])]
  async function fontRoot(id) {
    for (const root of roots) {
      try { await stat(path.join(root, id, 'index.json')); return root }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    throw new Error('Font family not found')
  }
  async function locate(id, file) {
    if (!ID.test(id) || (file !== 'index.json' && !FILE.test(file))) throw new Error('Invalid font path')
    const root = await fontRoot(id)
    const base = await realpath(root)
    const target = await realpath(path.join(root, id, file))
    const relative = path.relative(base, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Font path escapes library')
    return target
  }
  async function readFont(id) {
    const value = JSON.parse(await readFile(await locate(id, 'index.json'), 'utf8'))
    if (value.id !== id || typeof value.label !== 'string' || !value.label.trim() ||
        typeof value.family !== 'string' || !/^[a-zA-Z0-9 _-]{1,120}$/.test(value.family) ||
        !CATEGORIES.has(value.category) || !Array.isArray(value.files) || !value.files.length) throw new Error('Invalid font manifest')
    const files = []
    for (const face of value.files) {
      if (!FILE.test(face.file) || face.format !== FORMATS[path.extname(face.file).slice(1)].format || !Number.isInteger(face.weight) ||
          face.weight < 1 || face.weight > 1000 || !['normal', 'italic', 'oblique'].includes(face.style)) throw new Error('Invalid font face')
      const info = await stat(await locate(id, face.file))
      if (!info.isFile()) throw new Error('Missing font face')
      files.push({ weight: face.weight, style: face.style, file: face.file, format: face.format, bytes: info.size, url: FONT_ROUTE + id + '/' + face.file })
    }
    return { id, label: value.label, family: value.family, category: value.category,
      weights: [...new Set(files.map(face => face.weight))].sort((a, b) => a - b), files,
      url: files[0].url, license: value.license, source: value.source, coverage: value.coverage }
  }
  // RPC listFonts: every family, the installed one where both have it. A broken folder hides only itself.
  async function listFonts() {
    const ids = new Set(), fonts = []
    for (const root of roots) {
      try {
        for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory() && ID.test(entry.name)) ids.add(entry.name)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    for (const id of [...ids].sort()) {
      try { fonts.push(await readFont(id)) } catch { /* an invalid manifest hides only its family */ }
    }
    return { fonts }
  }
  // GET / HEAD <FONT_ROUTE><id>/<file>: only a file the family's index.json lists. Opened once, so the length and the
  // streamed range come from the same file.
  async function serve(req, res) {
    const rawPath = String(req.url || '').split('?')[0]
    if (!rawPath.startsWith(FONT_ROUTE)) return false
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true }
    let handle
    try {
      const segments = decodeURIComponent(rawPath.slice(FONT_ROUTE.length)).split('/')
      if (segments.length !== 2) throw new Error('Invalid font URL')
      const [id, file] = segments
      const font = await readFont(id)
      if (!font.files.some(face => face.file === file)) throw new Error('Not a listed font file')
      handle = await open(await locate(id, file), 'r')
      const info = await handle.stat(), total = info.size, request = req.headers || {}
      const etag = '"' + total.toString(16) + '-' + info.mtimeMs.toString(16) + '"'
      // A content-hashed name never changes its bytes.
      const headers = { 'Content-Type': FORMATS[path.extname(file).slice(1)].mime, 'Accept-Ranges': 'bytes', ETag: etag, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': /-[a-f0-9]{16}\.(woff2|ttf|otf)$/.test(file) ? 'private, max-age=31536000, immutable' : 'private, max-age=3600' }
      if (String(request['if-none-match'] || '').split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) { res.writeHead(304, headers); res.end(); return true }
      const range = request.range && (!request['if-range'] || request['if-range'] === etag) ? pluginMediaRange(request.range, total) || { invalid: true } : null
      if (range && range.invalid) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + total }); res.end(); return true }
      res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': range ? range.end - range.start + 1 : total, ...(range ? { 'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + total } : {}) })
      if (req.method === 'HEAD' || !total) { res.end(); return true }
      await pipeline(handle.createReadStream({ autoClose: false, ...(range || {}) }), res)
    } catch { if (res.headersSent) res.destroy(); else { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found') } }
    finally { await handle?.close() }
    return true
  }
  return Object.freeze({ listFonts, serve })
}
