// 惰性加载：JPEG 封面只编译 JPEG 解码器，WebP 封面只编译 WebP 解码器，PNG 封面一个都不编译；
// 存档压缩同理，且 WebP 编码器只编译一次被两种格式共用。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'

import { codecLoadState, coverImageAsPng, coverImageType } from '../tavern-plugin/lib/domain/card-cover-image.js'
import { codecLoadState as saveCodecLoadState, compressSaveImage } from '../tavern-plugin/lib/domain/save-image-compression.js'

const require = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
const size = 128
// 平滑图 + 细噪声，和 save-image-compression.test.mjs 用同一类素材：WebP 明显小于 PNG/JPEG。
const pixels = new Uint8ClampedArray(size * size * 4)
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4, noise = (x * 7919 + y * 104729) % 23
  pixels[i] = x + noise; pixels[i + 1] = y + noise; pixels[i + 2] = (x + y) / 2; pixels[i + 3] = 255
}

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
  return Buffer.concat([length, Buffer.from(type), data, crc])
}

function pngBytes(extra = []) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  const rows = []
  for (let y = 0; y < size; y++) rows.push(Buffer.from([0]), Buffer.from(pixels.buffer, y * size * 4, size * 4))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    ...extra.map(([type, data]) => chunk(type, data)), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

let fixtures
async function encoded() {
  fixtures ??= (async () => {
    const wasm = async file => WebAssembly.compile(await readFile(require.resolve(file)))
    const [jpeg, webp] = await Promise.all([import('@jsquash/jpeg/encode.js'), import('@jsquash/webp/encode.js')])
    await jpeg.init(await wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
    await webp.init(await wasm('@jsquash/webp/codec/enc/webp_enc.wasm'))
    const source = { width: size, height: size, data: pixels.slice(), colorSpace: 'srgb' }
    return { jpeg: Buffer.from(await jpeg.default(source, { quality: 95 })), webp: Buffer.from(await webp.default(source)) }
  })()
  return fixtures
}

const state = view => ({ decoders: [...view.decoders].sort(), encoder: view.encoder, compiles: view.compiles })

test('封面：PNG 原样透传，不编译任何 codec', async () => {
  const png = pngBytes()
  assert.equal(coverImageType(png), 'image/png')
  assert.equal(await coverImageAsPng(png), png)
  assert.deepEqual(state(codecLoadState()), { decoders: [], encoder: false, compiles: { jpeg: 0, webp: 0, encoder: 0 } })
})

test('封面：JPEG 只编译 JPEG 解码器与 PNG 编码器', async () => {
  const { jpeg } = await encoded()
  assert.equal(coverImageType(jpeg), 'image/jpeg')
  const out = await coverImageAsPng(jpeg)
  assert.equal(out.readUInt32BE(0), 0x89504e47)
  assert.equal(coverImageType(out), 'image/png')
  assert.deepEqual(state(codecLoadState()), { decoders: ['jpeg'], encoder: true, compiles: { jpeg: 1, webp: 0, encoder: 1 } })
})

test('封面：WebP 只补 WebP 解码器，PNG 编码器不重编', async () => {
  const { webp } = await encoded()
  assert.equal(coverImageType(webp), 'image/webp')
  const out = await coverImageAsPng(webp)
  assert.equal(coverImageType(out), 'image/png')
  assert.deepEqual(state(codecLoadState()), { decoders: ['jpeg', 'webp'], encoder: true, compiles: { jpeg: 1, webp: 1, encoder: 1 } })
})

test('封面：第二张 JPEG 复用已编译的解码器与编码器', async () => {
  const { jpeg } = await encoded()
  assert.equal(coverImageType(await coverImageAsPng(jpeg)), 'image/png')
  assert.deepEqual(state(codecLoadState()).compiles, { jpeg: 1, webp: 1, encoder: 1 })
  await assert.rejects(coverImageAsPng(Buffer.from('not an image')), /封面只支持 PNG、JPG、WebP/)
})

test('存档：动画 PNG 与不支持的字节原样返回，一个 codec 都不编译', async () => {
  const animated = { attachmentId: 'anim', mediaType: 'image/png', data: pngBytes([['acTL', Buffer.alloc(8)]]) }
  assert.equal(await compressSaveImage(animated), animated)
  const other = { attachmentId: 'txt', mediaType: 'image/png', data: Buffer.from('nothing to see') }
  assert.equal(await compressSaveImage(other), other)
  assert.deepEqual(state(saveCodecLoadState()), { decoders: [], encoder: false, compiles: { png: 0, jpeg: 0, encoder: 0 } })
})

test('存档：PNG 只编译 PNG 解码器与 WebP 编码器', async () => {
  const source = pngBytes()
  const result = await compressSaveImage({ attachmentId: 'a', mediaType: 'image/png', data: source })
  assert.equal(result.mediaType, 'image/webp')
  assert.equal(result.data.toString('ascii', 8, 12), 'WEBP')
  assert.ok(result.data.length < source.length * 0.9, source.length + ' → ' + result.data.length)
  assert.deepEqual(state(saveCodecLoadState()), { decoders: ['png'], encoder: true, compiles: { png: 1, jpeg: 0, encoder: 1 } })
})

test('存档：JPEG 只补 JPEG 解码器，WebP 编码器共用', async () => {
  const { jpeg } = await encoded()
  const result = await compressSaveImage({ attachmentId: 'b', mediaType: 'image/jpeg', data: jpeg })
  assert.equal(result.mediaType, 'image/webp')
  assert.ok(result.data.length < jpeg.length, jpeg.length + ' → ' + result.data.length)
  assert.deepEqual(state(saveCodecLoadState()), { decoders: ['jpeg', 'png'], encoder: true, compiles: { png: 1, jpeg: 1, encoder: 1 } })
})

test('存档：解不出来的图片原样返回，已编译的 codec 保持不变', async () => {
  const broken = { attachmentId: 'broken', mediaType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]) }
  assert.equal(await compressSaveImage(broken), broken)
  assert.deepEqual(state(saveCodecLoadState()).compiles, { png: 1, jpeg: 1, encoder: 1 })
})
