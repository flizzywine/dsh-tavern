import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DEFAULT_MAX_EDGE = 160
// Decoding holds the inflated rows plus two RGBA copies; keep a phone-sized ceiling.
const MAX_PIXELS = 16 * 1000 * 1000

const CRC_TABLE = (function () {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let value = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function channelsOf(colorType) {
  if (colorType === 0) return 1
  if (colorType === 2) return 3
  if (colorType === 3) return 1
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  return 0
}

function readChunks(buffer) {
  if (buffer.length <= SIGNATURE.length || !buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('不是有效的 PNG 文件')
  const chunks = { header: null, palette: null, transparency: null, idat: [] }
  let offset = SIGNATURE.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > buffer.length) throw new Error('PNG 数据不完整')
    const data = buffer.subarray(start, end)
    if (type === 'IHDR') chunks.header = data
    else if (type === 'PLTE') chunks.palette = data
    else if (type === 'tRNS') chunks.transparency = data
    else if (type === 'IDAT') chunks.idat.push(data)
    else if (type === 'IEND') break
    offset = end + 4
  }
  return chunks
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

function unfilter(raw, height, stride, bytesPerPixel) {
  const out = new Uint8Array(stride * height)
  let position = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position]
    position += 1
    const lineStart = y * stride
    const previousStart = lineStart - stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[position + x]
      const left = x >= bytesPerPixel ? out[lineStart + x - bytesPerPixel] : 0
      const up = y > 0 ? out[previousStart + x] : 0
      const upLeft = (y > 0 && x >= bytesPerPixel) ? out[previousStart + x - bytesPerPixel] : 0
      let restored
      if (filter === 0) restored = value
      else if (filter === 1) restored = value + left
      else if (filter === 2) restored = value + up
      else if (filter === 3) restored = value + ((left + up) >> 1)
      else if (filter === 4) restored = value + paeth(left, up, upLeft)
      else throw new Error('PNG 行滤波类型无效')
      out[lineStart + x] = restored & 0xff
    }
    position += stride
  }
  return out
}

function readPackedSample(raw, index, bitDepth) {
  const perByte = 8 / bitDepth
  const byte = raw[Math.floor(index / perByte)]
  const shift = 8 - bitDepth * ((index % perByte) + 1)
  return (byte >> shift) & ((1 << bitDepth) - 1)
}

function toRgba(raw, width, height, colorType, bitDepth, palette, transparency) {
  const out = new Uint8Array(width * height * 4)
  const pixels = width * height
  const level = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1
  const grayKey = (colorType === 0 && transparency && transparency.length >= 2) ? transparency.readUInt16BE(0) : null
  const colorKey = (colorType === 2 && transparency && transparency.length >= 6)
    ? [transparency.readUInt16BE(0), transparency.readUInt16BE(2), transparency.readUInt16BE(4)]
    : null
  const alphaByIndex = (colorType === 3 && transparency) ? transparency : null
  for (let index = 0; index < pixels; index += 1) {
    const target = index * 4
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 255
    if (colorType === 0) {
      const sample = bitDepth === 8 ? raw[index] : (bitDepth === 16 ? raw[index * 2] : readPackedSample(raw, index, bitDepth))
      red = green = blue = Math.round(sample * level)
      if (grayKey !== null && sample === grayKey) alpha = 0
    } else if (colorType === 2) {
      if (bitDepth === 16) {
        red = raw[index * 6]
        green = raw[index * 6 + 2]
        blue = raw[index * 6 + 4]
      } else {
        red = raw[index * 3]
        green = raw[index * 3 + 1]
        blue = raw[index * 3 + 2]
      }
      if (colorKey && red === colorKey[0] && green === colorKey[1] && blue === colorKey[2]) alpha = 0
    } else if (colorType === 3) {
      const paletteIndex = bitDepth === 8 ? raw[index] : readPackedSample(raw, index, bitDepth)
      const base = paletteIndex * 3
      if (palette && base + 3 <= palette.length) {
        red = palette[base]
        green = palette[base + 1]
        blue = palette[base + 2]
      }
      if (alphaByIndex && paletteIndex < alphaByIndex.length) alpha = alphaByIndex[paletteIndex]
    } else if (colorType === 4) {
      if (bitDepth === 16) {
        red = green = blue = raw[index * 4]
        alpha = raw[index * 4 + 2]
      } else {
        red = green = blue = raw[index * 2]
        alpha = raw[index * 2 + 1]
      }
    } else {
      if (bitDepth === 16) {
        red = raw[index * 8]
        green = raw[index * 8 + 2]
        blue = raw[index * 8 + 4]
        alpha = raw[index * 8 + 6]
      } else {
        red = raw[index * 4]
        green = raw[index * 4 + 1]
        blue = raw[index * 4 + 2]
        alpha = raw[index * 4 + 3]
      }
    }
    out[target] = red
    out[target + 1] = green
    out[target + 2] = blue
    out[target + 3] = alpha
  }
  return out
}

function decodePng(buffer) {
  const chunks = readChunks(buffer)
  const header = chunks.header
  if (!header || header.length < 13) throw new Error('PNG 缺少 IHDR 数据块')
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const bitDepth = header[8]
  const colorType = header[9]
  if (width <= 0 || height <= 0) throw new Error('PNG 尺寸无效')
  if (width * height > MAX_PIXELS) throw new Error('图片像素过多，无法生成缩略图')
  if (header[10] !== 0 || header[11] !== 0) throw new Error('不支持的 PNG 压缩或滤波方式')
  if (header[12] !== 0) throw new Error('暂不支持隔行 PNG 缩略图')
  const channels = channelsOf(colorType)
  if (!channels) throw new Error('不支持的 PNG 颜色类型')
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error('不支持的 PNG 位深')
  if (bitDepth < 8 && colorType !== 0 && colorType !== 3) throw new Error('不支持的 PNG 位深')
  if (!chunks.idat.length) throw new Error('PNG 缺少图像数据')
  const stride = Math.ceil(width * channels * bitDepth / 8)
  // A tiny IDAT can inflate without bound; the header fixes the exact size the rows need.
  let raw
  try { raw = inflateSync(Buffer.concat(chunks.idat), { maxOutputLength: height * (stride + 1) + 1 }) }
  catch (error) { throw new Error(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'PNG 图像数据长度异常' : 'PNG 图像数据无法解压') }
  const bytesPerPixel = Math.max(1, Math.ceil(channels * bitDepth / 8))
  if (raw.length < height * (stride + 1)) throw new Error('PNG 图像数据长度异常')
  const pixels = unfilter(raw, height, stride, bytesPerPixel)
  return { width, height, data: toRgba(pixels, width, height, colorType, bitDepth, chunks.palette, chunks.transparency) }
}

function scaleDown(image, maxEdge) {
  const longest = Math.max(image.width, image.height)
  if (longest <= maxEdge) return image
  const ratio = maxEdge / longest
  const width = Math.max(1, Math.round(image.width * ratio))
  const height = Math.max(1, Math.round(image.height * ratio))
  const data = image.data
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor(y * image.height / height)
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor((y + 1) * image.height / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor(x * image.width / width)
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor((x + 1) * image.width / width))
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let count = 0
      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY += 1) {
        let offset = (sourceY * image.width + sourceX0) * 4
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX += 1) {
          const weight = data[offset + 3]
          red += data[offset] * weight
          green += data[offset + 1] * weight
          blue += data[offset + 2] * weight
          alpha += weight
          count += 1
          offset += 4
        }
      }
      const target = (y * width + x) * 4
      if (alpha > 0) {
        out[target] = Math.round(red / alpha)
        out[target + 1] = Math.round(green / alpha)
        out[target + 2] = Math.round(blue / alpha)
      }
      out[target + 3] = Math.round(alpha / count)
    }
  }
  return { width, height, data: out }
}

function encodePng(image) {
  const { width, height, data } = image
  let opaque = true
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) { opaque = false; break }
  }
  const channels = opaque ? 3 : 4
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4
      const target = rowStart + 1 + x * channels
      raw[target] = data[source]
      raw[target + 1] = data[source + 1]
      raw[target + 2] = data[source + 2]
      if (!opaque) raw[target + 3] = data[source + 3]
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = opaque ? 2 : 6
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * 把 PNG 图片缩放到最长边不超过 maxEdge 的小图，返回可缓存的缩略图字节。
 * 只依赖 node:zlib，不引入任何原生依赖；无法识别或过大的图片会抛错，调用方自行降级。
 */
export function renderPngThumbnail(buffer, options = {}) {
  const maxEdge = Number.isFinite(options.maxEdge) ? Math.max(16, Math.min(512, Math.floor(options.maxEdge))) : DEFAULT_MAX_EDGE
  const decoded = decodePng(buffer)
  const scaled = scaleDown(decoded, maxEdge)
  return Object.freeze({ body: encodePng(scaled), width: scaled.width, height: scaled.height })
}
