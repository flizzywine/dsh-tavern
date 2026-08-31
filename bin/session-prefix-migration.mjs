import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

// Node's decoder stops at the first frame. DSH stores the header in its own
// frame, followed by multiple append frames: every frame must survive repair.
export function decodeZstdFrames(bytes) {
  const decoded = []
  let offset = 0
  while (offset < bytes.length) {
    const result = zstdDecompressSync(bytes.subarray(offset), { info: true })
    const consumed = result.engine.bytesWritten
    if (!Number.isSafeInteger(consumed) || consumed <= 0) throw new Error('无法读取完整 Zstandard 历史')
    decoded.push(result.buffer)
    offset += consumed
  }
  return Buffer.concat(decoded)
}

/** Offline-only upgrade: call after checking the Tavern service is stopped. */
export async function migrateSessionPrefixEvents({ sessionsRoot, backupRoot }) {
  const changed = []
  const files = createDurableFilePromotion()
  async function visit(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { await visit(file); continue }
      if (!entry.isFile() || !['session.jsonl', 'session.jsonl.zstd'].includes(entry.name)) continue
      const original = await readFile(file)
      const compressed = entry.name.endsWith('.zstd')
      const text = (compressed ? decodeZstdFrames(original) : original).toString('utf8')
      if (!text.includes('dsh-tavern/stable-prefix')) continue
      if (!text.endsWith('\n')) throw new Error('历史末尾不完整，未改写：' + file)
      const lines = text.slice(0, -1).split('\n')
      const header = JSON.parse(lines[0])
      if (header.type !== 'session' || typeof header.id !== 'string') throw new Error('历史头无效，未改写：' + file)
      let count = 0
      for (let index = 1; index < lines.length; index++) {
        const event = JSON.parse(lines[index])
        if (event.type !== 'dsh-tavern/stable-prefix' || event.ignorable === true) continue
        if (event.data?.version !== 1 || event.data.id !== 'tavern-session-prefix:' + header.id || typeof event.data.text !== 'string' || !event.data.text.trim() || event.surfaceOp !== undefined) throw new Error('固定背景事件格式无效，未改写：' + file)
        // Unknown to DSH, but retained verbatim for Tavern to recover its prefix.
        lines[index] = JSON.stringify({ ...event, ignorable: true })
        count++
      }
      if (!count) continue
      const head = lines[0] + '\n', body = lines.slice(1).join('\n') + '\n'
      const output = compressed ? Buffer.concat([zstdCompressSync(head), zstdCompressSync(body)]) : Buffer.from(head + body)
      if (compressed && decodeZstdFrames(output).toString('utf8') !== head + body) throw new Error('历史压缩校验失败：' + file)
      const hash = createHash('sha256').update(original).digest('hex')
      const backup = path.join(backupRoot, path.relative(sessionsRoot, file) + '.' + hash + '.bak')
      await mkdir(path.dirname(backup), { recursive: true })
      try { await copyFile(file, backup, constants.COPYFILE_EXCL) } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      if (!(await readFile(backup)).equals(original) || !(await readFile(file)).equals(original)) throw new Error('历史在修复期间发生变化，拒绝覆盖：' + file)
      await files.write(file, output)
      changed.push({ file, backup, events: count })
    }
  }
  await visit(sessionsRoot)
  return changed
}
