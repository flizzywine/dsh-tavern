// Fish inline audio requires MessagePack bin values, not JSON/base64 strings.
// Only the closed TTS request schema is encoded; no protocol/dependency on the worker.
export function fishMessagePack(value) {
  const chunks = []
  function sized(tag, length) {
    const header = Buffer.alloc(5); header[0] = tag; header.writeUInt32BE(length, 1); chunks.push(header)
  }
  function encode(v) {
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) { sized(0xc6, v.length); chunks.push(Buffer.from(v)); return }
    if (typeof v === 'string') { const bytes = Buffer.from(v); sized(0xdb, bytes.length); chunks.push(bytes); return }
    if (typeof v === 'boolean') { chunks.push(Buffer.from([v ? 0xc3 : 0xc2])); return }
    if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) { sized(0xce, v); return }
    if (Number.isInteger(v) && v >= -0x80000000 && v < 0) { const bytes = Buffer.alloc(5); bytes[0] = 0xd2; bytes.writeInt32BE(v, 1); chunks.push(bytes); return }
    if (typeof v === 'number' && Number.isFinite(v)) { const bytes = Buffer.alloc(9); bytes[0] = 0xcb; bytes.writeDoubleBE(v, 1); chunks.push(bytes); return }
    if (Array.isArray(v)) { sized(0xdd, v.length); for (const item of v) encode(item); return }
    if (v && Object.getPrototypeOf(v) === Object.prototype) {
      const entries = Object.entries(v); sized(0xdf, entries.length)
      for (const [key, item] of entries) { encode(key); encode(item) }
      return
    }
    throw new TypeError('Unsupported Fish request value')
  }
  encode(value)
  return Buffer.concat(chunks)
}
