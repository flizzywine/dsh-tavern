import { crc32 } from 'node:zlib'

const PAGE = 4096, CHECKSUM = 4
const invalid = () => Object.assign(Error('Invalid conversation snapshot range'), { code: 'CONVERSATION_SLOT_CORRUPT' })
export const rangeBytes = length => length + Math.ceil(length / PAGE) * CHECKSUM
const offsetOf = page => page * (PAGE + CHECKSUM)

function checksum(bytes, generation, page) {
 const binding = Buffer.allocUnsafe(16)
 binding.writeBigUInt64LE(BigInt(generation))
 binding.writeBigUInt64LE(BigInt(page), 8)
 return crc32(bytes, crc32(binding))
}

export function encodeSlotRanges(snapshot, generation) {
 const ranged = Buffer.allocUnsafe(rangeBytes(snapshot.length))
 for (let start = 0, page = 0; start < snapshot.length; start += PAGE, page++) {
  const data = snapshot.subarray(start, start + PAGE), offset = offsetOf(page)
  ranged.writeUInt32LE(checksum(data, generation, page), offset)
  data.copy(ranged, offset + CHECKSUM)
 }
 return ranged
}

function checkedPage(ranged, offset, length, generation, page) {
 if (offset + CHECKSUM + length > ranged.length) throw invalid()
 const data = ranged.subarray(offset + CHECKSUM, offset + CHECKSUM + length)
 if (checksum(data, generation, page) !== ranged.readUInt32LE(offset)) throw invalid()
 return data
}

export function decodeSlotRanges(ranged, length, generation) {
 if (ranged.length !== rangeBytes(length)) throw invalid()
 const snapshot = Buffer.allocUnsafe(length)
 for (let start = 0, page = 0; start < length; start += PAGE, page++) {
  checkedPage(ranged, offsetOf(page), Math.min(PAGE, length - start), generation, page).copy(snapshot, start)
 }
 return snapshot
}

export function readSlotRanges(read, length, generation) {
 const pages = new Map()
 return async (offset, size) => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || size > length - offset) throw invalid()
  if (!size) return Buffer.alloc(0)
  const first = Math.floor(offset / PAGE), last = Math.floor((offset + size - 1) / PAGE)
  const result = Buffer.allocUnsafe(size)
  for (let page = first; page <= last;) {
   if (!pages.has(page)) {
    let stop = page + 1
    while (stop <= last && !pages.has(stop)) stop++
    const startAt = offsetOf(page), stopAt = Math.min(offsetOf(stop), rangeBytes(length))
    const ranged = await read(startAt, stopAt - startAt)
    for (let i = page; i < stop; i++) pages.set(i, checkedPage(ranged, offsetOf(i) - startAt, Math.min(PAGE, length - i * PAGE), generation, i))
   }
   const start = page * PAGE, bytes = pages.get(page), from = Math.max(offset, start), to = Math.min(offset + size, start + bytes.length)
   bytes.copy(result, from - offset, from - start, to - start)
   page++
  }
  return result
 }
}
