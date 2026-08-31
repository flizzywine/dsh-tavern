import { deflateRawSync } from 'node:zlib'
import { diagnosticZip } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'

/** A valid ZIP fixture with optional deflate and data descriptor. */
export function imageZip(data, { compressed = false, descriptor = false, name = 'image_0.png' } = {}) {
  const stored = diagnosticZip([{ path: name, content: data }])
  const end = stored.length - 22, start = stored.readUInt32LE(end + 16)
  const header = Buffer.from(stored.subarray(0, 30 + Buffer.byteLength(name)))
  const directory = Buffer.from(stored.subarray(start, end)), footer = Buffer.from(stored.subarray(end))
  const body = compressed ? deflateRawSync(data) : Buffer.from(data)
  header.writeUInt16LE(compressed ? 8 : 0, 8); directory.writeUInt16LE(compressed ? 8 : 0, 10)
  header.writeUInt32LE(body.length, 18); directory.writeUInt32LE(body.length, 20)
  const extra = descriptor ? Buffer.alloc(16) : Buffer.alloc(0)
  if (descriptor) {
    extra.writeUInt32LE(0x08074b50); header.copy(extra, 4, 14, 26)
    header.fill(0, 14, 26)
    header.writeUInt16LE(0x808, 6); directory.writeUInt16LE(0x808, 8)
  }
  footer.writeUInt32LE(header.length + body.length + extra.length, 16)
  return Buffer.concat([header, body, extra, directory, footer])
}
