import path from 'node:path'
import { readZipEntries } from './zip-entries.js'

function fail(message) {
  throw new Error('EPUB 解析失败：' + message)
}

function unzipEntries(input) {
  return readZipEntries(input, { label: 'EPUB', fail })
}

function attribute(source, name) {
  const match = new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1', 'i').exec(source)
  return match === null ? '' : match[2]
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, function (entity, body) {
    if (body[0] !== '#') return Object.hasOwn(named, body.toLowerCase()) ? named[body.toLowerCase()] : entity
    const hexadecimal = body[1].toLowerCase() === 'x'
    const value = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity
  })
}

function htmlToText(source) {
  return decodeEntities(String(source)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:head|script|style|svg|canvas|noscript)\b[^>]*>[\s\S]*?<\/(?:head|script|style|svg|canvas|noscript)\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?(?:p|div|section|article|aside|header|footer|main|nav|h[1-6]|blockquote|pre|table|tr|ul|ol|figure|figcaption|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function resolveEntry(baseFile, href) {
  const clean = href.split('#')[0].split('?')[0]
  let decoded
  try { decoded = decodeURIComponent(clean) } catch { decoded = clean }
  return path.posix.normalize(path.posix.join(path.posix.dirname(baseFile), decoded))
}

export function extractEpubText(input) {
  const entries = unzipEntries(input)
  const container = entries.get('META-INF/container.xml')
  if (container === undefined) fail('缺少 META-INF/container.xml')
  const rootfile = /<rootfile\b[^>]*>/i.exec(container.toString('utf8'))
  const packagePath = rootfile === null ? '' : attribute(rootfile[0], 'full-path')
  if (packagePath === '' || !entries.has(path.posix.normalize(packagePath))) fail('找不到 OPF 内容清单')
  const normalizedPackagePath = path.posix.normalize(packagePath)
  const opf = entries.get(normalizedPackagePath).toString('utf8')
  const manifest = new Map()
  const manifestOrder = []
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attribute(match[0], 'id')
    const href = attribute(match[0], 'href')
    const mediaType = attribute(match[0], 'media-type').toLowerCase()
    const properties = attribute(match[0], 'properties').toLowerCase().split(/\s+/).filter(Boolean)
    if (id === '' || href === '') continue
    const entry = { id, path: resolveEntry(normalizedPackagePath, href), mediaType, properties }
    manifest.set(id, entry)
    manifestOrder.push(entry)
  }
  const spineIds = Array.from(opf.matchAll(/<itemref\b[^>]*>/gi)).map(function (match) { return attribute(match[0], 'idref') }).filter(Boolean)
  const ordered = (spineIds.length > 0 ? spineIds.map(function (id) { return manifest.get(id) }) : manifestOrder)
    .filter(function (item) {
      if (!item || item.properties.includes('nav')) return false
      return item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html' || /\.(?:xhtml?|html?)$/i.test(item.path)
    })
  const seen = new Set()
  const chapters = []
  for (const item of ordered) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    const data = entries.get(item.path)
    if (data === undefined) continue
    const text = htmlToText(data.toString('utf8'))
    if (text !== '') chapters.push(text)
  }
  const text = chapters.join('\n\n').trim()
  if (text === '') fail('没有提取到可读正文，文件可能受 DRM 保护')
  return text
}
