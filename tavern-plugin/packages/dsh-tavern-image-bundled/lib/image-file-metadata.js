import { open } from 'node:fs/promises'

const HEADER_BYTES = 24

export function imageMediaTypeFromBytes(bytes) {
  if (!bytes || bytes.length < 4) return ''
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  return ''
}

export async function readImageFileMetadata(file, { openFile = open } = {}) {
  const handle = await openFile(file, 'r')
  try {
    const stat = await handle.stat()
    const header = Buffer.alloc(Math.min(HEADER_BYTES, stat.size))
    const { bytesRead } = header.length
      ? await handle.read(header, 0, header.length, 0)
      : { bytesRead: 0 }
    const bytes = header.subarray(0, bytesRead)
    let width = null
    let height = null
    // Match the cache restore's existing PNG sniff: accept its signature bytes
    // and dimensions only when the file contains data beyond the 24-byte header.
    if (stat.size > HEADER_BYTES && bytes.length >= HEADER_BYTES && bytes[1] === 0x50 && bytes[2] === 0x4e) {
      width = bytes.readUInt32BE(16)
      height = bytes.readUInt32BE(20)
    }
    return {
      mediaType: imageMediaTypeFromBytes(bytes),
      width,
      height,
      byteLength: stat.size,
      mtimeMs: stat.mtimeMs,
    }
  } finally {
    await handle.close()
  }
}
