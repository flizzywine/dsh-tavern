import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import * as zlib from 'node:zlib'

// A ZIP read from disk without loading it: the central directory up front, each entry streamed
// on demand. ZIP64 archives and entries are supported (DSH cards may be several hundred MB).

const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 50000
const UINT32 = 0xffffffff
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0 })
// Running CRC-32: zlib's when it takes a starting value (Node 22.2+), else the table form.
const crcUpdate = typeof zlib.crc32 === 'function'
  ? (value, data) => zlib.crc32(data, value)
  : (value, data) => { let crc = (value ^ 0xffffffff) >>> 0; for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0 }

function fail(label, message) { throw Object.assign(new Error(label + ' 解析失败：' + message), { code: 'TAVERN_ZIP_INVALID' }) }

/** A safe relative path inside the archive, or null for directories and unsafe names. */
export function zipEntryPath(name) {
  const value = String(name).replace(/\\/g, '/')
  if (!value || value.endsWith('/') || value.startsWith('/') || /^[a-z]:/i.test(value)) return null
  const normalized = path.posix.normalize(value)
  if (normalized === '.' || normalized.startsWith('../') || normalized.split('/').some(part => part === '..' || part === '')) return null
  return normalized
}

async function read(handle, position, length) {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return buffer.subarray(0, bytesRead)
}

/**
 * Open a ZIP file. Returns { entries: Map<path, entry>, readBuffer(entry, limit), stream(entry), close() }.
 * Entries: { path, size, compressedSize, method, crc, localOffset }.
 */
export async function openZipFile(file, { label = 'ZIP', allowEncrypted = false } = {}) {
  const handle = await open(file, 'r')
  try {
    const { size: fileSize } = await handle.stat()
    if (fileSize < 22) fail(label, '文件太小')
    const tailLength = Math.min(fileSize, 65557 + 20)
    const tail = await read(handle, fileSize - tailLength, tailLength)
    let eocd = -1
    for (let offset = tail.length - 22; offset >= 0; offset--) if (tail.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
    if (eocd < 0) fail(label, '不是有效的 ZIP')
    let count = tail.readUInt16LE(eocd + 10), directorySize = tail.readUInt32LE(eocd + 12), directoryOffset = tail.readUInt32LE(eocd + 16)
    // Generic ZIP readers also support prepended bytes, including self-extracting archives.
    const eocdAt = fileSize - tail.length + eocd
    let prefix = 0
    // ZIP64: the locator sits right before the end record and points at the ZIP64 end record.
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const declared = Number(tail.readBigUInt64LE(eocd - 20 + 8))
      let record = await read(handle, declared, 56)
      if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50) {
        // With bytes in front, the record is where it always is: right before the locator.
        const at = eocdAt - 20 - 56
        record = at >= 0 ? await read(handle, at, 56) : Buffer.alloc(0)
        prefix = at - declared
      }
      if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50 || prefix < 0) fail(label, 'ZIP64 目录损坏')
      count = Number(record.readBigUInt64LE(32)); directorySize = Number(record.readBigUInt64LE(40)); directoryOffset = Number(record.readBigUInt64LE(48))
    } else {
      prefix = eocdAt - (directoryOffset + directorySize)
      if (prefix < 0) fail(label, '中央目录越界')
    }
    directoryOffset += prefix
    if (count > MAX_ENTRIES) fail(label, '文件数量过多')
    if (directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize > fileSize) fail(label, '中央目录越界')
    const directory = await read(handle, directoryOffset, directorySize)
    const entries = new Map()
    let offset = 0
    for (let index = 0; index < count; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) fail(label, '中央目录损坏')
      const flags = directory.readUInt16LE(offset + 8), method = directory.readUInt16LE(offset + 10), crc = directory.readUInt32LE(offset + 16)
      let compressedSize = directory.readUInt32LE(offset + 20), size = directory.readUInt32LE(offset + 24)
      const nameLength = directory.readUInt16LE(offset + 28), extraLength = directory.readUInt16LE(offset + 30), commentLength = directory.readUInt16LE(offset + 32)
      let localOffset = directory.readUInt32LE(offset + 42)
      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'utf8')
      const extra = directory.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength)
      for (let at = 0; at + 4 <= extra.length;) {
        const id = extra.readUInt16LE(at), length = extra.readUInt16LE(at + 2)
        if (id === 0x0001) {
          let field = at + 4
          if (size === UINT32) { size = Number(extra.readBigUInt64LE(field)); field += 8 }
          if (compressedSize === UINT32) { compressedSize = Number(extra.readBigUInt64LE(field)); field += 8 }
          if (localOffset === UINT32) { localOffset = Number(extra.readBigUInt64LE(field)) }
        }
        at += 4 + length
      }
      offset += 46 + nameLength + extraLength + commentLength
      const entryPath = zipEntryPath(name)
      if (!entryPath) continue
      const encrypted = (flags & 1) !== 0
      if (encrypted && !allowEncrypted) fail(label, '包含加密文件')
      if (method !== 0 && method !== 8 && !(encrypted && allowEncrypted && method === 99)) fail(label, '包含不支持的压缩格式：' + entryPath)
      entries.set(entryPath, { path: entryPath, size, compressedSize, method, crc, localOffset: localOffset + prefix, ...(encrypted ? { encrypted: true } : {}) })
    }

    async function dataRange(entry) {
      const header = await read(handle, entry.localOffset, 30)
      if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50) fail(label, '本地文件头损坏：' + entry.path)
      const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      if (start + entry.compressedSize > fileSize) fail(label, '压缩内容越界：' + entry.path)
      return { start, end: start + entry.compressedSize }
    }

    /** One entry's bytes, checked against its size and CRC; refused above `limit`. */
    async function readBuffer(entry, limit = 32 * 1024 * 1024) {
      if (entry.size > limit) fail(label, entry.path + ' 超过 ' + Math.round(limit / 1048576) + ' MB')
      const chunks = []
      for await (const chunk of await stream(entry)) chunks.push(chunk)
      return Buffer.concat(chunks)
    }

    /** One entry as a stream of its uncompressed bytes; errors on a size or CRC mismatch. */
    async function stream(entry) {
      if (entry.encrypted) fail(label, '加密文件需要使用人物卡密码导入入口')
      const { start, end } = await dataRange(entry)
      const raw = entry.compressedSize === 0 ? null : createReadStream(file, { start, end: end - 1 })
      let crc = 0, seen = 0
      const check = new Transform({
        transform(chunk, _encoding, done) {
          seen += chunk.length
          if (seen > entry.size) { done(Object.assign(new Error(label + ' 解析失败：解压长度超出 ' + entry.path), { code: 'TAVERN_ZIP_INVALID' })); return }
          crc = crcUpdate(crc, chunk)
          done(null, chunk)
        },
        flush(done) {
          if (seen !== entry.size) done(Object.assign(new Error(label + ' 解析失败：解压长度不一致 ' + entry.path), { code: 'TAVERN_ZIP_INVALID' }))
          else if (crc !== entry.crc) done(Object.assign(new Error(label + ' 解析失败：校验和不一致 ' + entry.path), { code: 'TAVERN_ZIP_INVALID' }))
          else done()
        }
      })
      if (!raw) { check.end(); return check }
      const source = entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw
      source.on('error', error => check.destroy(error))
      raw.on('error', error => check.destroy(error))
      return source.pipe(check)
    }

    // prefix: how many bytes come before the archive (0 for a plain ZIP).
    return { entries, readBuffer, stream, size: fileSize, prefix, close: () => handle.close() }
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}
