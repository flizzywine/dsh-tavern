import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { decodeMedia } from '../src/pack-v2/media.js'
import { inspectMedia } from '../src/pack-v2/validation.js'
import { BLOB_MIME_TYPES } from '../src/asset-packs/index.js'

// Header fixtures intentionally do not claim codec playability.
function box(type, data) { const b = Buffer.alloc(8); b.writeUInt32BE(8 + data.length); b.write(type, 4); return Buffer.concat([b, data]) }
function oggPage(data, flags, sequence, samples) {
  const b = Buffer.alloc(28); b.write('OggS'); b[5] = flags; b.writeBigUInt64LE(BigInt(samples), 6); b.writeUInt32LE(1, 14); b.writeUInt32LE(sequence, 18); b[26] = 1; b[27] = data.length
  return Buffer.concat([b, data])
}
function fixtures() {
  const mp3 = Buffer.alloc(417); mp3.set([255,251,144,0])
  const opus = Buffer.alloc(19); opus.write('OpusHead'); opus[8] = 1; opus[9] = 1
  const ogg = Buffer.concat([oggPage(opus, 2, 0, 0), oggPage(Buffer.from([1]), 4, 1, 48000)])
  const flac = Buffer.alloc(46); flac.write('fLaC'); flac[4] = 128; flac.writeUIntBE(34, 5, 3); flac.writeUInt16BE(4096, 8); flac.writeUInt16BE(4096, 10); flac.writeBigUInt64BE((44100n << 44n) | (15n << 36n) | 44100n, 18); flac.set([255,248,1,1], 42)
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(48000, 12); mdhd.writeUInt32BE(48000, 16)
  const m4a = Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0')), box('moov', box('trak', box('mdia', box('mdhd', mdhd)))), box('mdat', Buffer.from([1]))])
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40)
  const jpeg = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217])
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  return {png, webp, jpeg, mp3, ogg, wav, flac, m4a}
}
for (const [ext, bytes] of Object.entries(fixtures())) test('structural media: ' + ext + ' accepts headers and rejects truncation/signature/MIME lies', async () => {
  const descriptor = {ext, mime:BLOB_MIME_TYPES[ext], size:bytes.length}
  const info = await inspectMedia(bytes, descriptor, decodeMedia)
  if (descriptor.mime.startsWith('image/')) assert.deepEqual(info, {width:1, height:1})
  else assert.ok(info.durationMs > 0)
  const truncated = bytes.subarray(0, Math.min(12, bytes.length - 1))
  await assert.rejects(inspectMedia(truncated, {...descriptor, size:truncated.length}, decodeMedia))
  await assert.rejects(inspectMedia(bytes, {...descriptor, mime:'application/octet-stream'}, decodeMedia))
  await assert.rejects(decodeMedia(Buffer.alloc(bytes.length), descriptor))
})
test('structural images enforce dimensions and byte limits before parsing payloads', async () => {
  const bytes = fixtures().png
  bytes.writeUInt32BE(10000, 16); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29)
  await assert.rejects(inspectMedia(bytes, {ext:'png', mime:'image/png', size:bytes.length}, decodeMedia), {code:'LIMIT_EXCEEDED'})
  const big = Buffer.alloc(6 * 1024 ** 2 + 1); fixtures().jpeg.copy(big)
  await assert.rejects(decodeMedia(big, {ext:'jpeg', size:big.length}), {code:'LIMIT_EXCEEDED'})
})
test('MP3 tag without frames and malformed audio lengths never attest audio', async () => {
  const bytes = Buffer.alloc(20); bytes.write('ID3'); bytes[3] = 4
  await assert.rejects(decodeMedia(bytes, {ext:'mp3', size:bytes.length}))
  const wav = fixtures().wav; wav.writeUInt32LE(10000, 40)
  await assert.rejects(decodeMedia(wav, {ext:'wav', size:wav.length}))
  const m4a = fixtures().m4a; m4a.writeUInt32BE(0xffffffff)
  await assert.rejects(decodeMedia(m4a, {ext:'m4a', size:m4a.length}))
})
