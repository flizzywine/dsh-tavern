import {crc32} from 'node:zlib'

export function withCardCover(png, raw) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Cover must be PNG')
  const parts = [png.subarray(0, 8)]
  let ended = false
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), end = offset + size + 12
    if (end > png.length) throw Error('Truncated cover PNG')
    if (type === 'IEND') {
      const data = Buffer.from('chara\0' + Buffer.from(JSON.stringify(raw)).toString('base64'))
      const chunk = Buffer.alloc(data.length + 12)
      chunk.writeUInt32BE(data.length); chunk.write('tEXt', 4); data.copy(chunk, 8)
      chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4)
      parts.push(chunk); ended = true
    }
    if (!['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(type)) parts.push(png.subarray(offset, end))
    offset = end
    if (ended) break
  }
  if (!ended) throw Error('Cover PNG has no IEND')
  return Buffer.concat(parts)
}
