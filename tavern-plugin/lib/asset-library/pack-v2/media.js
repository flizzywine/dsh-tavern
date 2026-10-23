// Bounded structural validation, not full compressed-media decoding.
import { inflateSync, crc32 } from 'node:zlib'
import { check } from '../asset-packs/common.js'
export const STAGE_IMAGE_MAX_BYTES = 6 * 1024 ** 2
export function imageKind(bytes) {
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg'
  return ''
}
export function audioKind(bytes) {
  if (bytes.length < 12) return ''
  if (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (bytes.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
  return ''
}
export function pngSize(bytes, structural = false) {
  let p = 8, size, depth, color, ended = false, data = [], palette = false
  const channels = {0:1, 2:3, 3:1, 4:2, 6:4}
  while (p + 12 <= bytes.length) {
    const n = bytes.readUInt32BE(p), type = bytes.toString('ascii', p + 4, p + 8), end = p + 12 + n
    check(end <= bytes.length && crc32(bytes.subarray(p + 4, end - 4)) === bytes.readUInt32BE(end - 4), '$.media', 'Invalid PNG CRC/length')
    const chunk = bytes.subarray(p + 8, end - 4)
    if (p === 8) {
      check(type === 'IHDR' && n === 13, '$.media', 'Invalid PNG header')
      size = [chunk.readUInt32BE(0), chunk.readUInt32BE(4)]; depth = chunk[8]; color = chunk[9]
      check(size.every(v => v > 0 && v <= 8192) && size[0] * size[1] <= 32 * 1024 ** 2, '$.media', 'Image dimensions exceed limit', 'LIMIT_EXCEEDED')
      check(Object.hasOwn(channels, color) && [1,2,4,8,16].includes(depth) && (color === 0 || color === 3 || depth >= 8) && (color !== 3 || depth <= 8) && chunk[10] === 0 && chunk[11] === 0 && (chunk[12] === 0 || structural && chunk[12] === 1), '$.media', 'Unsupported PNG encoding (non-interlaced required)')
    } else check(type !== 'IHDR', '$.media', 'Duplicate PNG header')
    check(!['acTL', 'fcTL', 'fdAT'].includes(type), '$.media', 'Animated PNG is not supported')
    if (type === 'PLTE') { check(n > 0 && n <= 768 && n % 3 === 0, '$.media'); palette = true }
    if (type === 'IDAT') data.push(chunk)
    if (type === 'IEND') { check(n === 0 && end === bytes.length, '$.media'); ended = true; break }
    p = end
  }
  check(ended && data.length && (color !== 3 || palette), '$.media', 'Incomplete PNG')
  if (structural) return {width:size[0], height:size[1]}
  const stride = Math.ceil(size[0] * channels[color] * depth / 8), length = (stride + 1) * size[1]
  const decoded = inflateSync(Buffer.concat(data), {maxOutputLength:length})
  check(decoded.length === length, '$.media', 'PNG decoded size mismatch')
  for (let i = 0; i < length; i += stride + 1) check(decoded[i] <= 4, '$.media', 'Invalid PNG filter')
  return {width:size[0], height:size[1]}
}
export function wavInfo(bytes) {
  check(bytes.readUInt32LE(4) + 8 === bytes.length, '$.media', 'Invalid WAV size')
  let format, data = 0, p = 12
  for (; p + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(p + 4), start = p + 8, end = start + size
    check(end <= bytes.length, '$.media', 'Truncated WAV')
    const kind = bytes.toString('ascii', p, p + 4)
    if (kind === 'fmt ') {
      check(!format && size >= 16, '$.media', 'Invalid WAV format')
      const codec = bytes.readUInt16LE(start), channels = bytes.readUInt16LE(start + 2), rate = bytes.readUInt32LE(start + 4), align = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14)
      check([1,3].includes(codec) && channels >= 1 && channels <= 8 && rate >= 8000 && rate <= 192000 && (codec === 1 ? [8,16,24,32].includes(bits) : [32,64].includes(bits)) && align === channels * bits / 8 && bytes.readUInt32LE(start + 8) === rate * align, '$.media', 'Invalid PCM WAV format')
      format = {align, rate}
    }
    if (kind === 'data') { check(!data, '$.media'); data = size }
    p = end + (size % 2)
    check(p <= bytes.length, '$.media', 'Truncated WAV padding')
  }
  check(p === bytes.length && format && data > 0 && data % format.align === 0, '$.media', 'Missing WAV samples or trailing bytes')
  return {durationMs:data / format.align / format.rate * 1000}
}
export function imageDimensions(bytes, ext) {
  if (ext === 'webp') return portraitWebpSize(bytes)
  if (ext === 'png') { check(bytes.length >= 33, '$.media', 'Truncated PNG'); return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }
  for (let p = 2; p < bytes.length;) {
    check(bytes[p++] === 0xff, '$.media', 'Invalid JPEG marker')
    while (bytes[p] === 0xff) p++
    const marker = bytes[p++]
    check(marker !== 0xda && marker !== 0xd9 && p + 2 <= bytes.length, '$.media', 'JPEG frame missing')
    const size = bytes.readUInt16BE(p)
    check(size >= 2 && p + size <= bytes.length, '$.media', 'Truncated JPEG segment')
    if ([0xc0,0xc1,0xc2].includes(marker)) {
      check(size >= 8 && bytes[p + 2] === 8 && [1,3,4].includes(bytes[p + 7]) && size === 8 + 3 * bytes[p + 7], '$.media', 'Invalid JPEG frame')
      return [bytes.readUInt16BE(p + 5), bytes.readUInt16BE(p + 3)]
    }
    p += size
  }
  check(false, '$.media', 'Missing image dimensions')
}
export function portraitWebpSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid layered WebP')
  let size, payload = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), p = offset + 8
    if (p + length > bytes.length) throw new Error('Truncated layered WebP')
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated portrait layers are not supported')
    if (kind === 'VP8X' && length >= 10) { if (bytes[p] & 2) throw new Error('Animated portrait layers are not supported'); size = [1 + bytes.readUIntLE(p + 4, 3), 1 + bytes.readUIntLE(p + 7, 3)] }
    if (kind === 'VP8L' && length >= 5 && bytes[p] === 0x2f) { const bits = bytes.readUInt32LE(p + 1); const decoded = [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    if (kind === 'VP8 ' && length >= 10 && bytes[p + 3] === 0x9d && bytes[p + 4] === 1 && bytes[p + 5] === 0x2a) { const decoded = [bytes.readUInt16LE(p + 6) & 0x3fff, bytes.readUInt16LE(p + 8) & 0x3fff]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    offset = p + length + (length & 1)
    if (offset === bytes.length) break
    if (offset > bytes.length - 8) throw new Error('Invalid layered WebP chunks')
  }
  if (!payload || !size || !size.every(n => n > 0 && n <= 4096)) throw new Error('Invalid layered WebP dimensions')
  return size
}


function mp3Info(bytes) {
  let p = 0, durationMs = 0
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    check(bytes.length >= 10 && [2,3,4].includes(bytes[3]) && bytes.subarray(6, 10).every(n => n < 128), '$.media', 'Invalid ID3 header')
    p = 10 + bytes.subarray(6, 10).reduce((n, b) => n * 128 + b, 0) + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0)
  }
  while (p + 4 <= bytes.length) {
    if (bytes.length - p === 128 && bytes.toString('ascii', p, p + 3) === 'TAG') { p = bytes.length; break }
    const h = bytes.readUInt32BE(p), version = (h >>> 19) & 3, layer = (h >>> 17) & 3, bitrate = (h >>> 12) & 15, sample = (h >>> 10) & 3
    check((h >>> 21) === 2047 && version !== 1 && layer === 1 && bitrate > 0 && bitrate < 15 && sample < 3, '$.media', 'Invalid MP3 frame')
    const rate = [44100,48000,32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4)
    const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrate]
    const size = Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + ((h >>> 9) & 1)
    check(p + size <= bytes.length, '$.media', 'Truncated MP3 frame')
    durationMs += (version === 3 ? 1152 : 576) / rate * 1000
    p += size
  }
  check(p === bytes.length && durationMs > 0, '$.media', 'Missing MP3 frames')
  return {durationMs}
}
function oggInfo(bytes) {
  let p = 0, rate, preSkip = 0, samples = 0n, serial, sequence = 0, ended = false
  while (p < bytes.length) {
    check(p + 27 <= bytes.length && bytes.toString('ascii', p, p + 4) === 'OggS' && bytes[p + 4] === 0 && !(bytes[p + 5] & ~7), '$.media', 'Invalid Ogg page')
    const count = bytes[p + 26], body = p + 27 + count
    check(body <= bytes.length, '$.media', 'Truncated Ogg lacing')
    const size = bytes.subarray(p + 27, body).reduce((a, b) => a + b, 0), end = body + size
    check(end <= bytes.length && !ended, '$.media', 'Truncated Ogg page')
    if (p === 0) {
      check((bytes[p + 5] & 2) && !(bytes[p + 5] & 1), '$.media', 'Missing Ogg start')
      serial = bytes.readUInt32LE(p + 14)
      if (size >= 19 && bytes.toString('ascii', body, body + 8) === 'OpusHead') {
        check(bytes[body + 8] === 1 && bytes[body + 9] > 0, '$.media', 'Invalid Opus header')
        rate = 48000; preSkip = bytes.readUInt16LE(body + 10)
      } else {
        check(size >= 30 && bytes[body] === 1 && bytes.toString('ascii', body + 1, body + 7) === 'vorbis' && bytes.readUInt32LE(body + 7) === 0 && bytes[body + 11] > 0 && (bytes[body + 29] & 1), '$.media', 'Invalid Vorbis header')
        rate = bytes.readUInt32LE(body + 12)
      }
      check(rate >= 8000 && rate <= 192000, '$.media', 'Invalid Ogg sample rate')
    }
    check(bytes.readUInt32LE(p + 14) === serial && bytes.readUInt32LE(p + 18) === sequence++, '$.media', 'Unsupported chained or discontinuous Ogg')
    const granule = bytes.readBigUInt64LE(p + 6)
    if (granule !== 0xffffffffffffffffn) { check(granule >= samples, '$.media', 'Invalid Ogg granule'); samples = granule }
    ended = !!(bytes[p + 5] & 4); p = end
  }
  check(ended && samples > BigInt(preSkip) && samples <= BigInt(Number.MAX_SAFE_INTEGER), '$.media', 'Missing Ogg audio')
  return {durationMs:(Number(samples) - preSkip) / rate * 1000}
}
function flacInfo(bytes) {
  check(bytes.length >= 42 && (bytes[4] & 127) === 0 && bytes.readUIntBE(5, 3) === 34, '$.media', 'Invalid FLAC STREAMINFO')
  const min = bytes.readUInt16BE(8), max = bytes.readUInt16BE(10), stream = bytes.readBigUInt64BE(18)
  const rate = Number(stream >> 44n), bits = Number((stream >> 36n) & 31n) + 1, samples = Number(stream & 0xfffffffffn)
  check(min >= 16 && max >= min && rate > 0 && rate <= 655350 && bits >= 4 && samples > 0, '$.media', 'Invalid FLAC stream fields')
  let p = 4, last = false
  while (!last) {
    check(p + 4 <= bytes.length, '$.media', 'Truncated FLAC metadata')
    last = !!(bytes[p] & 128); p += 4 + bytes.readUIntBE(p + 1, 3)
    check(p <= bytes.length, '$.media', 'Truncated FLAC metadata')
  }
  check(p + 2 < bytes.length && bytes[p] === 255 && (bytes[p + 1] & 254) === 248, '$.media', 'Missing FLAC frame')
  return {durationMs:samples / rate * 1000}
}
function m4aInfo(bytes) {
  let durationMs, media = false, ftyp = false
  function boxes(start, end, level = 0) {
    check(level <= 4, '$.media', 'Invalid MP4 nesting')
    for (let p = start; p < end;) {
      check(p + 8 <= end, '$.media', 'Truncated MP4 box')
      let size = bytes.readUInt32BE(p), header = 8
      const type = bytes.toString('ascii', p + 4, p + 8)
      if (size === 1) { check(p + 16 <= end, '$.media'); const big = bytes.readBigUInt64BE(p + 8); check(big <= BigInt(bytes.length), '$.media'); size = Number(big); header = 16 }
      if (size === 0) size = end - p
      check(size >= header && p + size <= end, '$.media', 'Invalid MP4 box size')
      const body = p + header
      if (type === 'ftyp') { check(level === 0 && size >= header + 8 && (size - header) % 4 === 0, '$.media', 'Invalid MP4 file type'); ftyp = true }
      if (type === 'mdat' && size > header) media = true
      if (['moov','trak','mdia'].includes(type)) boxes(body, p + size, level + 1)
      if (type === 'mdhd') {
        const version = bytes[body], offset = version === 1 ? 20 : 12
        check((version === 0 || version === 1) && body + offset + (version === 1 ? 12 : 8) <= p + size, '$.media', 'Invalid MP4 media header')
        const scale = bytes.readUInt32BE(body + offset), duration = version === 1 ? Number(bytes.readBigUInt64BE(body + offset + 4)) : bytes.readUInt32BE(body + offset + 4)
        check(scale > 0 && Number.isSafeInteger(duration) && duration > 0, '$.media', 'Invalid MP4 duration')
        durationMs = Math.max(durationMs || 0, duration / scale * 1000)
      }
      p += size
    }
  }
  boxes(0, bytes.length)
  check(ftyp && media && durationMs > 0, '$.media', 'Missing MP4 media')
  return {durationMs}
}

// The historical port name is decodeMedia. Results attest headers/structure only;
// playback still owns codec decoding. No executable, native codec or network I/O.
export async function decodeMedia(input, descriptor) {
  const bytes = Buffer.from(input), ext = imageKind(bytes) || audioKind(bytes), image = ['png','webp','jpeg'].includes(ext)
  check(ext && ext === descriptor.ext && bytes.length === descriptor.size, '$.media', 'Media signature mismatch')
  check(bytes.length <= (image ? 6 : 60) * 1024 ** 2, '$.media', 'Media byte limit', 'LIMIT_EXCEEDED')
  if (image) {
    const [width, height] = imageDimensions(bytes, ext)
    check(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32 * 1024 ** 2, '$.media', 'Image dimension limit', 'LIMIT_EXCEEDED')
    if (ext === 'png') return pngSize(bytes, true)
    if (ext === 'jpeg') {
      check(bytes.readUInt16BE(bytes.length - 2) === 0xffd9, '$.media', 'Missing JPEG end')
      let p = 2, scan = false
      while (p + 4 <= bytes.length) {
        check(bytes[p++] === 255, '$.media', 'Invalid JPEG marker')
        while (bytes[p] === 255) p++
        const marker = bytes[p++]
        check(p + 2 <= bytes.length, '$.media', 'Truncated JPEG header')
        const size = bytes.readUInt16BE(p)
        check(size >= 2 && p + size <= bytes.length - 2, '$.media', 'Invalid JPEG segment')
        if (marker === 218) { check(size >= 6 && size === 6 + 2 * bytes[p + 2] && p + size < bytes.length - 2, '$.media', 'Invalid JPEG scan'); scan = true; break }
        p += size
      }
      check(scan, '$.media', 'Missing JPEG scan')
    }
    return {width, height}
  }
  return ({wav:wavInfo, mp3:mp3Info, ogg:oggInfo, flac:flacInfo, m4a:m4aInfo})[ext](bytes)
}
