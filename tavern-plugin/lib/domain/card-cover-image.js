import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// A card cover has to be a PNG (the card rides in its text chunks). PNGs pass through untouched;
// JPEG and WebP are decoded and re-encoded as PNG at their own size.
const require = createRequire(import.meta.url)

// Every codec is compiled on first use, per format: a JPEG cover never pays for the WebP decoder.
const DECODERS = {
  'image/jpeg': { name: 'jpeg', source: '@jsquash/jpeg/decode.js', binary: '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm' },
  'image/webp': { name: 'webp', source: '@jsquash/webp/decode.js', binary: '@jsquash/webp/codec/dec/webp_dec.wasm' }
}
let decoders = {}
let encoder
const compiles = { jpeg: 0, webp: 0, encoder: 0 }

async function wasm(file) { return await WebAssembly.compile(await readFile(require.resolve(file))) }

async function loadDecoder(type) {
  const { source, binary } = DECODERS[type]
  const decoder = await import(source)
  await decoder.init(await wasm(binary))
  return decoder.default
}

async function loadEncoder() {
  const png = await import('@jsquash/png/encode.js')
  await png.init(await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
  return png.default
}

/** Which codecs have been compiled so far — read-only, for diagnostics and the laziness test. */
export function codecLoadState() { return { decoders: Object.keys(decoders), encoder: Boolean(encoder), compiles: { ...compiles } } }

function decoderFor(type) {
  const { name } = DECODERS[type]
  return decoders[name] ??= loadDecoder(type).then(decoder => { compiles[name]++; return decoder },
    error => { delete decoders[name]; throw error })
}

function encoderFor() {
  return encoder ??= loadEncoder().then(encode => { compiles.encoder++; return encode },
    error => { encoder = undefined; throw error })
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
  const [decode, encode] = await Promise.all([decoderFor(type), encoderFor()])
  const pixels = await decode(data)
  return Buffer.from(await encode(pixels))
}
