import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

// Standalone read-path experiment. These bytes are not a live chat format.
const MAGIC = Buffer.from('DSHFLR01')
const HEADER = 24, FRAME = 8, INDEX = 8, RECENT = 50
const DEFLATED = 0x80000000, MAX_FRAME_BYTES = DEFLATED - 1
const damaged = () => Object.assign(Error('Invalid floor window bytes'), { code: 'CONVERSATION_WINDOW_CORRUPT' })

function floorFrame(floor, compress) {
 const plain = Buffer.from(JSON.stringify(floor))
 const packed = compress ? deflateRawSync(plain, { level: 1 }) : plain
 const compressed = packed.length < plain.length, payload = compressed ? packed : plain
 if (payload.length > MAX_FRAME_BYTES) throw RangeError('Floor window frame too large')
 const header = Buffer.alloc(FRAME)
 header.writeUInt32LE(payload.length + (compressed ? DEFLATED : 0))
 header.writeUInt32LE(crc32(payload, crc32(header.subarray(0, 4))), 4)
 return Buffer.concat([header, payload])
}
function offsetChecksum(offset, ordinal) {
 return crc32(offset, ordinal)
}

export function encodeFloorWindow(floors, { compress = false } = {}) {
 const count = floors.length, frames = floors.map(floor => floorFrame(floor, compress)), index = Buffer.alloc((count + 1) * INDEX)
 let offset = HEADER
 for (let i = 0; i <= count; i++) {
  const entry = index.subarray(i * INDEX, (i + 1) * INDEX)
  entry.writeUInt32LE(offset)
  entry.writeUInt32LE(offsetChecksum(entry.subarray(0, 4), i), 4)
  if (i !== count) offset += frames[i].length
 }
 const header = Buffer.alloc(HEADER)
 MAGIC.copy(header)
 header.writeUInt32LE(count, 8)
 header.writeUInt32LE(offset, 12)
 header.writeUInt32LE(index.readUInt32LE(Math.max(0, count - RECENT) * INDEX), 16)
 header.writeUInt32LE(crc32(header.subarray(0, 20)), 20)
 return Buffer.concat([header, ...frames, index])
}

export async function readFloorWindow(readRange, { before, limit = RECENT } = {}) {
 if (!Number.isSafeInteger(limit) || limit < 0) throw RangeError('Invalid floor window limit')
 async function exact(offset, length) {
  const bytes = await readRange(offset, length)
  if (bytes.length !== length) throw damaged()
  return bytes
 }
 const header = await exact(0, HEADER)
 if (!header.subarray(0, 8).equals(MAGIC) || crc32(header.subarray(0, 20)) !== header.readUInt32LE(20)) throw damaged()
 const count = header.readUInt32LE(8), floorEnd = header.readUInt32LE(12), tailStart = header.readUInt32LE(16)
 if (tailStart < HEADER || tailStart > floorEnd) throw damaged()
 const end = before ?? count
 if (!Number.isSafeInteger(end) || end < 0 || end > count) throw RangeError('Invalid floor window cursor')
 const from = Math.max(0, end - limit), floors = []
 if (from === end) return { count, from, floors }
 async function offsetAt(ordinal) {
  const indexed = await exact(floorEnd + ordinal * INDEX, INDEX)
  if (offsetChecksum(indexed.subarray(0, 4), ordinal) !== indexed.readUInt32LE(4)) throw damaged()
  return indexed.readUInt32LE(0)
 }
 const [left, right] = await Promise.all([
  from === 0 ? HEADER : from === count - RECENT ? tailStart : offsetAt(from),
  end === count ? floorEnd : offsetAt(end),
 ])
 if (left < HEADER || right > floorEnd || right <= left) throw damaged()
 // A cold recent-50 view uses only the fixed header and one contiguous data read.
 const bytes = await exact(left, right - left)
 let offset = 0
 for (let ordinal = from; ordinal < end; ordinal++) {
  if (offset + FRAME >= bytes.length) throw damaged()
  const tag = bytes.readUInt32LE(offset), size = tag & MAX_FRAME_BYTES, start = offset + FRAME, stop = start + size
  if (!size || stop > bytes.length) throw damaged()
  const payload = bytes.subarray(start, stop)
  if (crc32(payload, crc32(bytes.subarray(offset, offset + 4))) !== bytes.readUInt32LE(offset + 4)) throw damaged()
  floors.push(JSON.parse(tag >= DEFLATED ? inflateRawSync(payload) : payload))
  offset = stop
 }
 if (offset !== bytes.length) throw damaged()
 return { count, from, floors }
}
