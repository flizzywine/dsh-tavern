import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const PNG = require('./vendor/pngjs/lib/png-sync.js')
const jpeg = require('./vendor/jpeg-js')
const MAX_PIXELS = 16_000_000

function jpegSettings(config = {}) {
  const raw = String(config.jpegBackground ?? '#ffffff').trim()
  const hit = /^#?([0-9a-f]{6})$/i.exec(raw)
  const hex = hit ? hit[1] : 'ffffff'
  return {
    quality: Math.max(50, Math.min(100, Math.round(Number(config.jpegQuality) || 88))),
    background: [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)),
  }
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function detectImageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  return ''
}

/**
 * 全黑图检测（bf16 在部分显卡上偶尔数值溢出，ComfyUI 会出一张纯黑图）。
 * 纯黑 PNG 压缩后只有几 KB，所以先按文件大小筛，再解码抽样确认。
 */
export function isBlankImage(bytes) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  const dims = pngDimensions(source)
  if (!dims || dims.width * dims.height < 65536 || dims.width * dims.height > MAX_PIXELS) return false
  if (source.length > Math.max(64 * 1024, dims.width * dims.height / 8)) return false
  try {
    const image = PNG.read(source)
    const data = image.data
    const step = 4 * 97
    for (let i = 0; i < data.length; i += step) if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) return false
    return true
  } catch { return false }
}

/**
 * Optionally converts a PNG to JPEG. Unsupported formats and conversion errors
 * return the original bytes with a visible warning so successful image jobs survive.
 */
export function transcodeImageOutput(bytes, mediaType, config = {}, { maxOutputBytes = 32 * 1024 * 1024 } = {}) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  const declared = String(mediaType ?? '').toLowerCase().split(';')[0].trim()
  const kind = detectImageType(source) || declared
  const original = { bytes: source, mediaType: kind || 'image/png', converted: false, warning: '' }
  if (config.jpegOutput !== true) return original
  if (kind === 'image/jpeg') return original
  if (kind !== 'image/png') {
    return { ...original, warning: `JPEG 仅支持 PNG；${kind || '当前格式'}已保留原格式。` }
  }
  const dimensions = pngDimensions(source)
  if (!dimensions || !dimensions.width || !dimensions.height) {
    return { ...original, warning: 'JPEG 转换无法读取 PNG 文件头，已保留原图。' }
  }
  if (dimensions.width * dimensions.height > MAX_PIXELS) {
    return { ...original, warning: `图片超过 ${MAX_PIXELS.toLocaleString()} 像素安全上限，跳过 JPEG 转换并保留原图。` }
  }
  try {
    const image = PNG.read(source)
    if (image.width !== dimensions.width || image.height !== dimensions.height || image.data.length !== image.width * image.height * 4) throw new Error('Invalid PNG dimensions')
    const { quality, background } = jpegSettings(config)
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3] / 255
      if (alpha < 1) {
        image.data[i] = Math.round(image.data[i] * alpha + background[0] * (1 - alpha))
        image.data[i + 1] = Math.round(image.data[i + 1] * alpha + background[1] * (1 - alpha))
        image.data[i + 2] = Math.round(image.data[i + 2] * alpha + background[2] * (1 - alpha))
      }
      image.data[i + 3] = 255
    }
    const encoded = Buffer.from(jpeg.encode(image, quality).data)
    if (!encoded.length || encoded.length > maxOutputBytes) throw new Error('JPEG output exceeds configured size limit')
    return { bytes: encoded, mediaType: 'image/jpeg', converted: true, warning: '' }
  } catch (error) {
    return { ...original, warning: `JPEG 转换失败（${String(error?.message ?? error).slice(0, 160)}），已保留原图。` }
  }
}

/** Runs CPU-heavy PNG decode/JPEG encoding away from the host event loop. */
export function transcodeImageOutputAsync(bytes, mediaType, config = {}, options = {}) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  const declared = String(mediaType ?? '').toLowerCase().split(';')[0].trim()
  const kind = detectImageType(source) || declared
  if (config.jpegOutput !== true || kind !== 'image/png') return Promise.resolve(transcodeImageOutput(source, kind, config, options))
  return new Promise(resolve => {
    const input = Uint8Array.from(source)
    let worker
    let settled = false
    let timer
    const signal = options.signal
    const fallback = message => ({ bytes: source, mediaType: kind, converted: false, warning: message })
    const detachAbort = () => signal?.removeEventListener?.('abort', onAbort)
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detachAbort()
      try { Promise.resolve(worker?.terminate?.()).catch(() => {}) } catch {}
      resolve(result)
    }
    const onAbort = () => finish(fallback('JPEG 转换已取消，已保留原图。'))
    if (signal?.aborted) { finish(fallback('JPEG 转换已取消，已保留原图。')); return }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    try {
      const factory = options.workerFactory ?? ((url, workerOptions) => new Worker(url, workerOptions))
      worker = factory(new URL('./image-output-worker.js', import.meta.url), {
        workerData: { bytes: input, mediaType: kind, config: { jpegOutput: true, jpegQuality: config.jpegQuality, jpegBackground: config.jpegBackground }, maxOutputBytes: options.maxOutputBytes },
        transferList: [input.buffer],
      })
      if (!worker?.once) throw new Error('Invalid worker')
    } catch (error) {
      finish(fallback(`JPEG 转换线程无法启动（${String(error?.message ?? error).slice(0, 120)}），已保留原图。`))
      return
    }
    const timeoutMs = Math.max(1, Math.min(120_000, Number(options.timeoutMs) || 60_000))
    timer = setTimeout(() => finish(fallback('JPEG 转换超时，已保留原图。')), timeoutMs)
    worker.once('message', result => {
      try {
        if (!result || !result.bytes || !result.mediaType) throw new Error('Invalid worker result')
        const bytes = Buffer.from(result.bytes)
        const actualType = detectImageType(bytes)
        if (result.converted && (result.mediaType !== 'image/jpeg' || actualType !== 'image/jpeg')) throw new Error('JPEG bytes and media type do not match')
        finish({ ...result, bytes, mediaType: actualType || result.mediaType })
      } catch (error) {
        finish(fallback(`JPEG 转换线程返回无效结果（${String(error?.message ?? error).slice(0, 100)}），已保留原图。`))
      }
    })
    worker.once('error', error => finish(fallback(`JPEG 转换线程失败（${String(error?.message ?? error).slice(0, 120)}），已保留原图。`)))
    worker.once('exit', code => finish(code === 0 ? fallback('JPEG 转换线程未返回结果，已保留原图。') : fallback('JPEG 转换线程异常退出，已保留原图。')))
  })
}

export const imageOutputLimits = Object.freeze({ maxPixels: MAX_PIXELS })
