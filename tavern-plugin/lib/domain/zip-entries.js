import path from 'node:path'
import * as zlib from 'node:zlib'

const { deflateRawSync, inflateRawSync } = zlib
// zlib.crc32 arrived in Node 22.2; older hosts use the table form.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0 })
const crc32 = typeof zlib.crc32 === 'function' ? data => zlib.crc32(data) : data => { let value = 0xffffffff; for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0 }

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_EXPANDED_BYTES = 150 * 1024 * 1024
const MAX_ENTRIES = 10000
const mb = bytes => Math.round(bytes / 1048576) + ' MB'

function findEndOfCentralDirectory(buffer, fail, label) {
  const minimum = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  fail('文件不是有效的 ' + (label === 'ZIP' ? 'ZIP' : label + '/ZIP'))
}

/** Read a plain ZIP into path → bytes. Caller-provided fail() owns the error wording. */
export function readZipEntries(input, { label = 'ZIP', fail = message => { throw new Error(label + ' 解析失败：' + message) },
  maxArchiveBytes = MAX_ARCHIVE_BYTES, maxExpandedBytes = MAX_EXPANDED_BYTES } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length === 0) fail('文件为空')
  if (buffer.length > maxArchiveBytes) fail('文件超过 ' + mb(maxArchiveBytes))
  const eocd = findEndOfCentralDirectory(buffer, fail, label)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff) fail('不支持 ZIP64 ' + label)
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
    if ((flags & 1) !== 0) fail(label + ' 包含加密文件')
    if (method !== 0 && method !== 8) fail('包含不支持的压缩格式')
    expanded += uncompressedSize
    if (expanded > maxExpandedBytes) fail('解压后内容超过 ' + mb(maxExpandedBytes))
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

/** Write a plain ZIP (deflate when it helps). Entries: { path, content: string | Buffer }. */
export function writeZipEntries(entries, { readable = false, label = 'ZIP', maxArchiveBytes = MAX_ARCHIVE_BYTES, maxExpandedBytes = MAX_EXPANDED_BYTES, oversized } = {}) {
  if (readable && entries.length > MAX_ENTRIES) throw new Error(label + '文件数量过多，无法生成可导入的压缩包')
  // Report what the package actually holds next to the limit: "超过 50 MB" alone leaves the
  // player guessing which part to drop, and the number is often barely over.
  const expanded = entries.reduce((size, entry) => size + (Buffer.isBuffer(entry.content) ? entry.content.length : Buffer.byteLength(String(entry.content))), 0)
  if (readable && expanded > maxExpandedBytes) {
    throw new Error(label + '解压后 ' + mb(expanded) + '，超过 ' + mb(maxExpandedBytes) + (oversized ? oversized() : '，请减少附件或历史后重试'))
  }
  const local = [], central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path), data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content))
    const compressed = deflateRawSync(data, { level: 6 })
    const payload = compressed.length < data.length ? compressed : data
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(payload === compressed ? 8 : 0, 8)
    header.writeUInt16LE(0x21, 12) // Valid DOS date: 1980-01-01.
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42)
    local.push(header, name, payload); central.push(directory, name)
    offset += header.length + name.length + payload.length
    if (offset > 0xffffffff) throw new Error('压缩包超过 4 GB')
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  const size = offset + directory.length + end.length
  if (readable && size > maxArchiveBytes) throw new Error(label + '有 ' + mb(size) + '，超过 ' + mb(maxArchiveBytes) + (oversized ? oversized() : '，请关闭图片导出或减少附件后重试'))
  return Buffer.concat([...local, directory, end])
}
