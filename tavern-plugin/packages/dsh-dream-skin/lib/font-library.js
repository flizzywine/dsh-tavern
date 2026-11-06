import {serveAssetFile} from './http-file.js'
import { FONT_CATALOG, createFontAssets } from './font-assets.js'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FONT_ROUTE = '/dream-skin/fonts/'
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.(woff2|ttf|otf)$/
const FORMATS = { woff2: { format: 'woff2', mime: 'font/woff2' }, ttf: { format: 'truetype', mime: 'font/ttf' }, otf: { format: 'opentype', mime: 'font/otf' } }
const CATEGORIES = new Set(['sans', 'serif', 'rounded', 'hand', 'display'])

export function createFontLibrary({ dataRoot, bundledRoot = fileURLToPath(new URL('../fonts/', import.meta.url)), fetchImpl } = {}) {
  const roots = [path.resolve(dataRoot, 'fonts'), ...(bundledRoot ? [path.resolve(bundledRoot)] : [])]
  const assets = createFontAssets({ dataRoot, bundledRoots: bundledRoot ? [bundledRoot] : [], fetchImpl })
  async function shipped(id) {
    if (!bundledRoot || !ID.test(id)) return null
    try { await stat(path.join(roots[0], id, 'index.json')); return null }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return FONT_CATALOG.families.find(font => font.id === id) || null
  }
  async function fontRoot(id) {
    // An installed family is authoritative; bundled faces only fill an absent family.
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
    const trusted = await shipped(id)
    const value = trusted || JSON.parse(await readFile(await locate(id, 'index.json'), 'utf8'))
    if (value.id !== id || typeof value.label !== 'string' || !value.label.trim() ||
        typeof value.family !== 'string' || !/^[a-zA-Z0-9 _-]{1,120}$/.test(value.family) ||
        !CATEGORIES.has(value.category) || !Array.isArray(value.files) || !value.files.length) throw new Error('Invalid font manifest')
    const files = []
    for (const face of value.files) {
      if (!FILE.test(face.file) || face.format !== FORMATS[path.extname(face.file).slice(1)].format || !Number.isInteger(face.weight) ||
          face.weight < 1 || face.weight > 1000 || !['normal', 'italic', 'oblique'].includes(face.style)) throw new Error('Invalid font face')
      const info = trusted ? { size: face.bytes, isFile: () => true } : await stat(await locate(id, face.file))
      if (!info.isFile()) throw new Error('Missing font face')
      files.push({ weight: face.weight, style: face.style, file: face.file, format: face.format, bytes: info.size,
        url: FONT_ROUTE + id + '/' + face.file })
    }
    return { id, label: value.label, family: value.family, category: value.category,
      weights: [...new Set(files.map(face => face.weight))].sort((a, b) => a - b), files,
      url: files[0].url, license: value.license, source: value.source, coverage: value.coverage }
  }
  async function listFonts() {
    const ids = new Set(bundledRoot ? FONT_CATALOG.families.map(font => font.id) : []), fonts = []
    for (const root of roots) {
      try {
        for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory() && ID.test(entry.name)) ids.add(entry.name)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    for (const id of [...ids].sort()) {
      // One incomplete/manual install must not hide every other family.
      try { fonts.push(await readFont(id)) } catch { /* Ignore invalid manifests. */ }
    }
    return { fonts }
  }
  async function serve(req, res) {
    const rawPath = String(req.url || '').split('?')[0]
    if (!rawPath.startsWith(FONT_ROUTE)) return false
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true }
    try {
      const segments = decodeURIComponent(rawPath.slice(FONT_ROUTE.length)).split('/')
      if (segments.length !== 2) throw new Error('Invalid font URL')
      const [id, file] = segments
      const font = await readFont(id)
      if (!font.files.some(face => face.file === file)) throw new Error('Not a listed font file')
      let target
      if (await shipped(id)) {
        try { target = await assets.ensure(id, file) }
        catch { res.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' }); res.end('font unavailable'); return true }
      } else target = await locate(id, file)
      await serveAssetFile(req, res, target, FORMATS[path.extname(file).slice(1)].mime, /-[a-f0-9]{16}\.(woff2|ttf|otf)$/.test(file) ? 'private, max-age=31536000, immutable' : 'private, max-age=3600')
    } catch { if (res.headersSent) res.destroy(); else { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found') } }
    return true
  }
  return Object.freeze({ listFonts, serve })
}
