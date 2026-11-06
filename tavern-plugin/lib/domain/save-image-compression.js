import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Pictures stay as they are on disk; only an exported save re-encodes them as WebP, which is
// several times smaller than PNG or JPEG at no visible loss (quality 80 ≈ JPEG 85, ~40 dB PSNR).
export const SAVE_IMAGE_QUALITY = 80
const require = createRequire(import.meta.url)
let codecs

// The SIMD build compiles only where the encoder's glue also picks it; otherwise fall back.
async function wasm(simdPath, plainPath) {
  if (simdPath) { try { return await WebAssembly.compile(await readFile(require.resolve(simdPath))) } catch {} }
  return await WebAssembly.compile(await readFile(require.resolve(plainPath)))
}

async function loadCodecs() {
  const [png, jpeg, webp] = await Promise.all([import('@jsquash/png/decode.js'), import('@jsquash/jpeg/decode.js'), import('@jsquash/webp/encode.js')])
  await png.init(await wasm(null, '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
  await jpeg.init(await wasm(null, '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))
  await webp.init(await wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm', '@jsquash/webp/codec/enc/webp_enc.wasm'))
  return { 'image/png': png.default, 'image/jpeg': jpeg.default, encode: webp.default }
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
    codecs ??= loadCodecs()
    const loaded = await codecs
    const pixels = await loaded[kind](data)
    const webp = Buffer.from(await loaded.encode(pixels, { quality }))
    return webp.length < data.length * 0.9 ? { ...image, data: webp, mediaType: 'image/webp' } : image
  } catch {
    // A picture the codecs cannot read still goes into the save as it is.
    return image
  }
}
