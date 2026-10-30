import { inflateRawSync } from 'node:zlib'

const fail = () => { throw new Error('NovelAI 返回的图片 ZIP 无效或超过大小限制') }
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

/** Read one raster image in memory. Never extract provider filenames to disk.
 * Only stored/deflate, single-volume ZIPs are accepted; directory sizes alone
 * are not trusted as a decompression bound. The attachment service subsequently
 * decodes the image itself. ZIP metadata is not imported into game state. */
export function sceneImageFromZip(input, maxBytes) {
  const zip = Buffer.from(input)
  if (zip.length < 22 || zip.length > maxBytes + 65536) fail()
  let end = -1
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length) { end = offset; break }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) fail()
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16)
  if (!count || count > 32 || zip.readUInt16LE(end + 8) !== count || start + size !== end) fail()
  let offset = start, expanded = 0, image
  const names = new Set(), ranges = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || zip.readUInt32LE(offset) !== 0x02014b50) fail()
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10)
    const crc = zip.readUInt32LE(offset + 16), compressed = zip.readUInt32LE(offset + 20), length = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32)
    const local = zip.readUInt32LE(offset + 42), nameStart = offset + 46, next = nameStart + nameLength + extraLength + commentLength
    if (next > end || flags & ~0x80e || ![0, 8].includes(method) || method === 0 && flags & 6 || zip.readUInt16LE(offset + 34)) fail()
    const nameBytes = zip.subarray(nameStart, nameStart + nameLength), name = nameBytes.toString('utf8')
    if (!name || name.includes('\0') || /^(?:\/|\\|[a-z]:)/i.test(name) || name.split(/[\\/]/).includes('..') || names.has(name)) fail()
    names.add(name)
    expanded += length
    if (expanded > maxBytes + 65536 || compressed > maxBytes + 65536 || local + 30 > start || zip.readUInt32LE(local) !== 0x04034b50) fail()
    const localNameLength = zip.readUInt16LE(local + 26), localExtraLength = zip.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed
    if (dataEnd > start || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method || !zip.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) fail()
    if (!(flags & 8) && (zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== compressed || zip.readUInt32LE(local + 22) !== length)) fail()
    if (ranges.some(([begin, stop]) => local < stop && dataEnd > begin)) fail()
    ranges.push([local, dataEnd])
    if (/\.(?:png|jpe?g|webp)$/i.test(name)) {
      if (image || !length || length > maxBytes) fail()
      const bytes = zip.subarray(dataStart, dataEnd)
      try { image = method === 0 ? Buffer.from(bytes) : inflateRawSync(bytes, { maxOutputLength: Math.min(maxBytes, length) }) }
      catch { fail() }
      if (image.length !== length || crc32(image) !== crc) fail()
    }
    offset = next
  }
  if (offset !== end || !image) fail()
  return image
}
