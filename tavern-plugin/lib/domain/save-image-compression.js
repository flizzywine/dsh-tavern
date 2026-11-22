import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Pictures stay as they are on disk; only an exported save re-encodes them as WebP, which is
// several times smaller than PNG or JPEG at no visible loss (quality 80 ≈ JPEG 85, ~40 dB PSNR).
export const SAVE_IMAGE_QUALITY = 80
const require = createRequire(import.meta.url)

// The decoder is picked from the input bytes: a PNG never compiles the JPEG decoder and vice versa.
const DECODERS = {
  'image/png': { name: 'png', source: '@jsquash/png/decode.js', binary: '@jsquash/png/codec/pkg/squoosh_png_bg.wasm' },
  'image/jpeg': { name: 'jpeg', source: '@jsquash/jpeg/decode.js', binary: '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm' }
}
let decoders = {}
let encoder
const compiles = { png: 0, jpeg: 0, encoder: 0 }

// The SIMD build compiles only where the encoder's glue also picks it; otherwise fall back.
async function wasm(simdPath, plainPath) {
  if (simdPath) { try { return await WebAssembly.compile(await readFile(require.resolve(simdPath))) } catch {} }
  return await WebAssembly.compile(await readFile(require.resolve(plainPath)))
}

async function loadDecoder(kind) {
  const { source, binary } = DECODERS[kind]
  const decoder = await import(source)
  await decoder.init(await wasm(null, binary))
  return decoder.default
}

async function loadEncoder() {
  const webp = await import('@jsquash/webp/encode.js')
  await webp.init(await wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm', '@jsquash/webp/codec/enc/webp_enc.wasm'))
  return webp.default
}

/** Which codecs have been compiled so far — read-only, for diagnostics and the laziness test. */
export function codecLoadState() { return { decoders: Object.keys(decoders), encoder: Boolean(encoder), compiles: { ...compiles } } }

function decoderFor(kind) {
  const { name } = DECODERS[kind]
  return decoders[name] ??= loadDecoder(kind).then(decoder => { compiles[name]++; return decoder })
}

function encoderFor() {
  return encoder ??= loadEncoder().then(encode => { compiles.encoder++; return encode })
}

function sniff(data) {
  // An animated PNG would lose its frames.
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return data.includes('acTL') ? undefined : 'image/png'
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  return undefined
}

/** { data, mediaType } → a WebP copy when that is clearly smaller; anything else comes back unchanged. */
export async function compressSaveImage(image, { quality = SAVE_IMAGE_QUALITY } = {}) {
  const data = Buffer.isBuffer(image?.data) ? image.data : Buffer.from(image?.data || [])
  const kind = sniff(data)
  if (!kind) return image
  try {
    const [decode, encode] = await Promise.all([decoderFor(kind), encoderFor()])
    const pixels = await decode(data)
    const webp = Buffer.from(await encode(pixels, { quality }))
    return webp.length < data.length * 0.9 ? { ...image, data: webp, mediaType: 'image/webp' } : image
  } catch {
    // A picture the codecs cannot read still goes into the save as it is.
    return image
  }
}
