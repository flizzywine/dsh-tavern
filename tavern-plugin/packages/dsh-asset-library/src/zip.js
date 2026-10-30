// bounded, streaming classic ZIP (no ZIP64).
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw, createInflateRaw, crc32 } from 'node:zlib'

import { PACK_BUDGET } from './pack-v2/budget.js'

const U32 = 0xffffffff
const STORED = /\.(png|webp|jpe?g|gif|ogg|mp3|m4a|opus|flac)$/i
export const ZIP_LIMITS = Object.freeze({ entries: 20000, entrySize: 512 * 1024 ** 2, totalSize: PACK_BUDGET.totalSize, ratio: 200 })
export function zipPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(s => !s || s === '.' || s === '..' || /[\x00-\x1f\x7f:<>"|?*]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) throw new Error('Invalid ZIP path: ' + name)
  return name
}
function extraFields(bytes) {
  for (let p = 0; p < bytes.length;) {
    if (p + 4 > bytes.length || p + 4 + bytes.readUInt16LE(p + 2) > bytes.length) throw new Error('Invalid ZIP extra field')
    if (bytes.readUInt16LE(p) === 1) throw new Error('ZIP64 is not supported')
    p += 4 + bytes.readUInt16LE(p + 2)
  }
}
async function bytesAt(handle, size, position) {
  const bytes = Buffer.alloc(size)
  let n = 0
  while (n < size) { const result = await handle.read(bytes, n, size - n, position + n); if (!result.bytesRead) throw new Error('Truncated ZIP'); n += result.bytesRead }
  return bytes
}
export async function writeZip(filename, entries) {
  if (entries.length > 65535) throw new Error('ZIP entry limit: 65535 (ZIP64 is not supported)')
  const out = await open(filename, 'wx'), central = [], names = new Set()
  let position = 0, totalSize = 0
  async function put(bytes) {
    if (position + bytes.length >= U32) throw new Error('ZIP exceeds 4 GB; ZIP64 is not supported')
    let n = 0
    while (n < bytes.length) { const result = await out.write(bytes, n, bytes.length - n, position); n += result.bytesWritten; position += result.bytesWritten }
  }
  try {
    for (const entry of entries) {
      const name = Buffer.from(zipPath(entry.path), 'utf8'), key = entry.path.toLowerCase()
      if (name.length > 65535 || names.has(key)) throw new Error('Duplicate or overlong ZIP path')
      names.add(key)
      let size = 0, crc = 0, method = STORED.test(entry.path) ? 0 : 8
      const spool = filename + '.' + randomUUID() + '.tmp'
      const source = () => entry.file ? createReadStream(entry.file) : Readable.from([Buffer.from(entry.data)])
      const meter = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length; crc = crc32(chunk, crc)
        callback(size >= U32 || totalSize + size >= U32 ? new Error('ZIP exceeds 4 GB; ZIP64 is not supported') : null, chunk)
      } })
      try {
        await pipeline(source(), meter, ...(method ? [createDeflateRaw()] : []), createWriteStream(spool, { flags: 'wx' }))
        let compressedSize = (await stat(spool)).size
        // Do not produce archives that our anti-bomb limits would reject.
        if (method && (compressedSize >= size || size > Math.max(1, compressedSize) * ZIP_LIMITS.ratio)) { method = 0; compressedSize = size }
        const offset = position, header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8)
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressedSize, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26)
        await put(header); await put(name)
        const content = method === 0 && !STORED.test(entry.path) ? createReadStream(spool).compose(createInflateRaw()) : createReadStream(spool)
        for await (const chunk of content) await put(chunk)
        const cd = Buffer.alloc(46)
        cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(method, 10)
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressedSize, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42)
        central.push(Buffer.concat([cd, name])); totalSize += size
      } finally { await unlink(spool).catch(() => {}) }
    }
    const start = position
    for (const bytes of central) await put(bytes)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(position - start, 12); end.writeUInt32LE(start, 16)
    await put(end)
    return { size: position, entries: entries.length, uncompressedSize: totalSize }
  } catch (error) { await out.close(); await unlink(filename).catch(() => {}); throw error }
  finally { await out.close() }
}

export async function openZip(filename, limits = ZIP_LIMITS) {
  limits = { ...ZIP_LIMITS, ...limits }
  const handle = await open(filename, 'r')
  try {
    const length = (await handle.stat()).size
    if (length >= U32) throw new Error('ZIP64 / archives over 4 GB are not supported')
    const tail = await bytesAt(handle, Math.min(length, 65557), Math.max(0, length - 65557))
    let end = -1
    for (let p = tail.length - 22; p >= 0; p--) if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) { end = p; break }
    if (end < 0) throw new Error('ZIP end record is missing')
    const count = tail.readUInt16LE(end + 10), cdSize = tail.readUInt32LE(end + 12), cdStart = tail.readUInt32LE(end + 16)
    if (count === 65535 || cdSize === U32 || cdStart === U32 || (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50)) throw new Error('ZIP64 is not supported')
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) throw new Error('Multi-disk ZIP is not supported')
    if (count > limits.entries) throw new Error('ZIP entry count exceeds limit')
    const cdEnd = length - tail.length + end
    if (cdStart + cdSize !== cdEnd) throw new Error('Invalid ZIP central directory')
    const entries = [], names = new Set(), ranges = []
    let cursor = cdStart, totalSize = 0
    for (let i = 0; i < count; i++) {
      const cd = await bytesAt(handle, 46, cursor)
      if (cd.readUInt32LE(0) !== 0x02014b50) throw new Error('Invalid ZIP central entry')
      const flags = cd.readUInt16LE(8), method = cd.readUInt16LE(10), crc = cd.readUInt32LE(16), compressedSize = cd.readUInt32LE(20), size = cd.readUInt32LE(24), nameSize = cd.readUInt16LE(28), extraSize = cd.readUInt16LE(30), commentSize = cd.readUInt16LE(32), offset = cd.readUInt32LE(42)
      if (flags & (1 | 64 | 8192)) throw new Error('Encrypted ZIP entries are not supported')
      if (flags & ~(0x800 | 8 | 6)) throw new Error('Unsupported ZIP flags')
      if (![0, 8].includes(method)) throw new Error('Unsupported ZIP method')
      if (cd.readUInt16LE(34) || [compressedSize, size, offset].includes(U32)) throw new Error('ZIP64 / multi-disk ZIP is not supported')
      const attributes = cd.readUInt32LE(38)
      const rawName = await bytesAt(handle, nameSize, cursor + 46)
      if (!(flags & 0x800) && rawName.some(b => b > 127)) throw new Error('Non-ASCII ZIP names require UTF-8 flag')
      const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName), directory = name.endsWith('/')
      // the shared file reader rejects Windows reparse and Unix special entries.
      const type = (attributes >>> 16) & 0xf000
      if ((attributes & 0x400) || ![0, directory ? 0x4000 : 0x8000].includes(type)) throw new Error('ZIP reparse/special file rejected')
      zipPath(directory ? name.slice(0, -1) : name)
      const key = name.replace(/\/$/, '').toLowerCase()
      if (names.has(key)) throw new Error('Duplicate ZIP path')
      names.add(key)
      extraFields(await bytesAt(handle, extraSize, cursor + 46 + nameSize))
      cursor += 46 + nameSize + extraSize + commentSize
      totalSize += size
      if (size > limits.entrySize || totalSize > limits.totalSize) throw new Error('ZIP uncompressed size exceeds limit')
      if (size > Math.max(1, compressedSize) * limits.ratio) throw new Error('ZIP compression ratio exceeds limit')
      if (method === 0 && size !== compressedSize || directory && size) throw new Error('Invalid ZIP entry size')
      const local = await bytesAt(handle, 30, offset)
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method) throw new Error('ZIP local header mismatch')
      const localNameSize = local.readUInt16LE(26), localExtraSize = local.readUInt16LE(28)
      if (!(await bytesAt(handle, localNameSize, offset + 30)).equals(rawName)) throw new Error('ZIP local name mismatch')
      extraFields(await bytesAt(handle, localExtraSize, offset + 30 + localNameSize))
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== size)) throw new Error('ZIP local size / CRC mismatch')
      const start = offset + 30 + localNameSize + localExtraSize
      if (start + compressedSize > cdStart) throw new Error('ZIP entry overlaps directory')
      ranges.push([offset, start + compressedSize])
      entries.push({ path: name, directory, size, compressedSize, crc, method, start })
    }
    if (cursor !== cdEnd) throw new Error('ZIP directory size mismatch')
    ranges.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw new Error('Overlapping ZIP entries')
    async function consume(entry, destination) {
      let size = 0, crc = 0
      const input = entry.compressedSize ? createReadStream(filename, { start: entry.start, end: entry.start + entry.compressedSize - 1 }) : Readable.from([])
      const check = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length; crc = crc32(chunk, crc)
        callback(size > entry.size ? new Error('ZIP expanded size exceeds declaration') : null, chunk)
      }, flush(callback) { callback(size !== entry.size || crc !== entry.crc ? new Error('ZIP size / CRC verification failed') : null) } })
      await pipeline(input, ...(entry.method === 8 ? [createInflateRaw()] : []), check, destination)
    }
    return { entries, totalSize, consume, async read(entry) {
      const chunks = []
      await consume(entry, new Transform({ transform(chunk, enc, cb) { chunks.push(chunk); cb() } }))
      return Buffer.concat(chunks)
    } }
  } finally { await handle.close() }
}
