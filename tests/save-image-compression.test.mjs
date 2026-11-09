import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'
import { compressSaveImage } from '../tavern-plugin/lib/domain/save-image-compression.js'

const require = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
const size = 256
// A smooth picture with fine noise, like a generated illustration.
const pixels = new Uint8ClampedArray(size * size * 4)
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4, noise = (x * 7919 + y * 104729) % 23
  pixels[i] = x + noise; pixels[i + 1] = y + noise; pixels[i + 2] = (x + y) / 2; pixels[i + 3] = 255
}

function png(extraChunks = []) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
    return Buffer.concat([length, Buffer.from(type), data, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  const rows = []
  for (let y = 0; y < size; y++) rows.push(Buffer.from([0]), Buffer.from(pixels.buffer, y * size * 4, size * 4))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    ...extraChunks.map(([type, data]) => chunk(type, data)), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

test('导出存档时 PNG、JPEG 转成更小的 WebP', async () => {
  const source = png()
  const result = await compressSaveImage({ attachmentId: 'a', mediaType: 'image/png', data: source })
  assert.equal(result.mediaType, 'image/webp')
  assert.equal(result.attachmentId, 'a')
  assert.equal(result.data.toString('ascii', 8, 12), 'WEBP')
  assert.ok(result.data.length < source.length / 3, source.length + ' → ' + result.data.length)

  const jpegEncode = await import(pathToFileURL(require.resolve('@jsquash/jpeg/encode.js')).href)
  await jpegEncode.init(await WebAssembly.compile(await readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))))
  const jpeg = Buffer.from(await jpegEncode.default({ data: pixels, width: size, height: size }, { quality: 95 }))
  const fromJpeg = await compressSaveImage({ attachmentId: 'b', mediaType: 'image/jpeg', data: jpeg })
  assert.equal(fromJpeg.mediaType, 'image/webp')
  assert.ok(fromJpeg.data.length < jpeg.length, jpeg.length + ' → ' + fromJpeg.data.length)
})

test('动图、无法识别或解不开的图片原样保留', async () => {
  for (const image of [
    { attachmentId: 'apng', mediaType: 'image/png', data: png([['acTL', Buffer.alloc(8)]]) },
    { attachmentId: 'gif', mediaType: 'image/gif', data: Buffer.from('GIF89a......') },
    { attachmentId: 'broken', mediaType: 'image/png', data: Buffer.concat([png().subarray(0, 40), Buffer.alloc(20)]) },
    { attachmentId: 'webp', mediaType: 'image/webp', data: Buffer.from('RIFF\0\0\0\0WEBPVP8 ') }
  ]) assert.equal(await compressSaveImage(image), image, image.attachmentId)
})
