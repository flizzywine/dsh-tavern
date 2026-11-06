import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// A card cover has to be a PNG (the card rides in its text chunks). PNGs pass through untouched;
// JPEG and WebP are decoded and re-encoded as PNG at their own size.
const require = createRequire(import.meta.url)
let codecs

async function wasm(file) { return await WebAssembly.compile(await readFile(require.resolve(file))) }

async function loadCodecs() {
  const [png, jpeg, webp] = await Promise.all([import('@jsquash/png/encode.js'), import('@jsquash/jpeg/decode.js'), import('@jsquash/webp/decode.js')])
  await png.init(await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
  await jpeg.init(await wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))
  await webp.init(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm'))
  return { 'image/jpeg': jpeg.default, 'image/webp': webp.default, encode: png.default }
}

export function coverImageType(data) {
  if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png'
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/** Image bytes → PNG bytes; throws for anything that is not PNG, JPEG or WebP. */
export async function coverImageAsPng(data) {
  const type = coverImageType(data)
  if (!type) throw new Error('封面只支持 PNG、JPG、WebP 图片')
  if (type === 'image/png') return data
  codecs ??= loadCodecs().catch(error => { codecs = undefined; throw error })
  const loaded = await codecs
  const pixels = await loaded[type](data)
  return Buffer.from(await loaded.encode(pixels))
}
