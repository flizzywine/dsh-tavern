// Original geometric CC0 illustration for the local documentation fixture.
// Not AI-generated; the large DEMO label must remain visible in screenshots.
import { deflateSync } from 'node:zlib'
const width = 768, height = 432
export function demoImage(variant = 0) {
  const pixels = Buffer.alloc((width * 3 + 1) * height)
  const put = (x, y, rgb) => rgb.forEach((v, i) => { pixels[y * (width * 3 + 1) + 1 + x * 3 + i] = v })
  const rect = (x, y, w, h, color) => { for (let j = y; j < Math.min(height, y + h); j++) for (let i = x; i < Math.min(width, x + w); i++) put(i, j, color) }
  rect(0, 0, width, height, variant % 2 ? [198, 218, 222] : [221, 231, 223])
  rect(0, 275, width, 157, [70, 115, 129]); rect(0, 370, width, 62, [53, 83, 99])
  rect(125, 130, 76, 220, [244, 239, 212]); rect(113, 105, 100, 29, [166, 101, 77]); rect(133, 80, 60, 26, [242, 186, 90])
  rect(151, 180, 25, 39, [73, 93, 103]); rect(148, 289, 31, 61, [73, 93, 103])
  rect(420, 228, 190, 122, [232, 212, 181]); rect(410, 206, 210, 23, [146, 102, 88]); rect(451, 256, 42, 60, [118, 153, 144]); rect(540, 255, 43, 95, [75, 109, 112])
  rect(321, 269, 24, 24, [182, 145, 125]); rect(313, 293, 40, 49, [95, 103, 143]); rect(315, 342, 12, 30, [54, 68, 92]); rect(339, 342, 12, 30, [54, 68, 92])
  const letters = ['1111010001100011000111110', '1111110000111101000011111', '1000111011101011000110001', '0111010001100011000101110']
  letters.forEach((bits, k) => [...bits].forEach((b, i) => { if (b === '1') rect(455 + k * 60 + i % 5 * 9, 47 + Math.floor(i / 5) * 9, 8, 8, [45, 79, 89]) }))
  function crc(b) { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1 } return (c ^ 0xffffffff) >>> 0 }
  function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
