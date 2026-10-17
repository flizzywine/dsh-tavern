import { StringDecoder } from 'node:string_decoder'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const BODY_FRAME_TARGET = 512 * 1024

/** Parse header + events frame by frame without concatenating the whole archive. */
export function parseSessionLog(buffer) {
  const decoder = new StringDecoder('utf8')
  let pending = '', headerLine
  const events = []
  const consume = line => {
    if (!line.trim()) return
    if (headerLine === undefined) headerLine = line
    else events.push(JSON.parse(line))
  }
  const append = text => {
    pending += text
    let start = 0, end
    while ((end = pending.indexOf('\n', start)) !== -1) {
      consume(pending.slice(start, end))
      start = end + 1
    }
    pending = pending.slice(start)
  }
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZSTD_MAGIC) {
    for (const frame of scanZstdFrames(buffer)) {
      append(decoder.write(zstdDecompressSync(buffer.subarray(frame.start, frame.end))))
    }
  } else append(decoder.write(buffer))
  append(decoder.end())
  consume(pending)
  if (headerLine === undefined) throw new Error('空会话日志')
  return { headerLine, header: JSON.parse(headerLine), events }
}

export function encodeMigratedSessionLog(headerLine, events) {
  return encodeFramedSessionLog(headerLine + '\n', events, event => JSON.stringify(event) + '\n')
}

export function encodeCurrentGeneration(artifact, catalog) {
  const headerLine = JSON.stringify(catalog.encodeCurrentHeader(artifact.header, artifact.inheritedEventCount)) + '\n'
  const events = Array.isArray(artifact.events) ? artifact.events : []
  return encodeFramedSessionLog(headerLine, events, event => JSON.stringify(catalog.encodeCurrentEvent(event)) + '\n')
}

function encodeFramedSessionLog(headerLine, events, stringify) {
  const parts = [compressFrame(Buffer.from(headerLine))]
  if (!events.length) return parts[0]
  let chunk = ''
  for (const event of events) {
    chunk += stringify(event)
    if (chunk.length >= BODY_FRAME_TARGET) {
      parts.push(compressFrame(Buffer.from(chunk)))
      chunk = ''
    }
  }
  if (chunk) parts.push(compressFrame(Buffer.from(chunk)))
  return Buffer.concat(parts)
}

function compressFrame(bytes) {
  return zstdCompressSync(bytes, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
}

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 6 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      offset += blockType === 1 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  if (!frames.length || frames.at(-1).end !== buffer.length) throw new Error('会话日志不是完整的 zstd 帧')
  return frames
}

