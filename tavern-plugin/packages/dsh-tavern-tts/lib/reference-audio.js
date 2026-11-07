// bounded reference formats; no dependency on the asset-library plugin.
import {wav,fail} from './core.js'
export const REFERENCE_BYTES = 60 * 1024 ** 2 // Pack single-audio policy, not a provider list limit.
const check = ok => { if (!ok) fail('INVALID_AUDIO') }
export function referenceAudio(value) {
  const bytes = Buffer.from(value)
  if (!bytes.length || bytes.length > REFERENCE_BYTES) fail('INVALID_AUDIO')
  if (bytes.toString('ascii',0,4) === 'RIFF') return {bytes:wav(bytes,{maxBytes:REFERENCE_BYTES}),ext:'wav',mime:'audio/wav'}
  mp3Info(bytes)
  return {bytes,ext:'mp3',mime:'audio/mpeg'}
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
