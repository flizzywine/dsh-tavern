import path from 'node:path'
import { inflateRawSync } from 'node:zlib'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_EXPANDED_BYTES = 150 * 1024 * 1024
const MAX_ENTRIES = 10000

function fail(message) {
  throw new Error('EPUB 解析失败：' + message)
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  fail('文件不是有效的 EPUB/ZIP')
}

function unzipEntries(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length === 0) fail('文件为空')
  if (buffer.length > MAX_ARCHIVE_BYTES) fail('文件超过 50 MB')
  const eocd = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff) fail('不支持 ZIP64 EPUB')
  if (entryCount > MAX_ENTRIES) fail('压缩包文件数量过多')
  if (offset + centralSize > buffer.length) fail('中央目录越界')

  const entries = new Map()
  let expanded = 0
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) fail('中央目录损坏')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd + extraLength + commentLength > buffer.length) fail('文件目录损坏')
    const name = buffer.subarray(offset + 46, nameEnd).toString('utf8').replace(/\\/g, '/')
    offset = nameEnd + extraLength + commentLength
    if (name.endsWith('/')) continue
    if ((flags & 1) !== 0) fail('EPUB 包含加密文件')
    if (method !== 0 && method !== 8) fail('包含不支持的压缩格式')
    expanded += uncompressedSize
    if (expanded > MAX_EXPANDED_BYTES) fail('解压后内容超过 150 MB')
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) fail('本地文件头损坏')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) fail('压缩内容越界')
    const compressed = buffer.subarray(dataStart, dataEnd)
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 1 })
    if (data.length !== uncompressedSize) fail('解压长度不一致')
    entries.set(path.posix.normalize(name), data)
  }
  return entries
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
