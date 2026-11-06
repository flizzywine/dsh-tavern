import { fail, wav } from '../core.js'

// Qwen's completed OSS downloads can retain this streaming encoder's size pair.
// Do not treat arbitrary oversized chunks as streams: they may be truncated files.
const STREAM_RIFF_SIZE = 0x7fffffbf
const STREAM_DATA_SIZE = 0x7fffff9b
const MAX_BYTES = 32 * 1024 ** 2

export function qwenWav(value) {
  const bytes = Buffer.from(value)
  if (bytes.length < 44 || bytes.length > MAX_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail('INVALID_AUDIO')
  if (bytes.readUInt32LE(4) !== STREAM_RIFF_SIZE) return wav(bytes)
  let formatSeen = false
  for (let at = 12; at + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8
    if (name === 'data') {
      // An unknown-length data chunk consumes the remainder of the completed HTTP body.
      if (!formatSeen || size !== STREAM_DATA_SIZE) fail('INVALID_AUDIO')
      bytes.writeUInt32LE(bytes.length - 8, 4)
      bytes.writeUInt32LE(bytes.length - start, at + 4)
      return wav(bytes)
    }
    if (start + size + size % 2 > bytes.length) fail('INVALID_AUDIO')
    if (name === 'fmt ') {
      if (formatSeen || size < 16 || bytes.readUInt16LE(start + 12) !== bytes.readUInt16LE(start + 2) * 2) fail('INVALID_AUDIO')
      formatSeen = true
    }
    at = start + size + size % 2
  }
  fail('INVALID_AUDIO')
}
