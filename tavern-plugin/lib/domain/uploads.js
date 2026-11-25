import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

// Large files sent to Tavern as a raw request body (DSH cards / asset packs up to several GB), kept on disk
// until the call that uses them; never read into memory or encoded as base64.

const ID = /^[0-9a-f-]{36}$/
const CARD_ARCHIVE_ID = /^card-archive-[0-9a-f-]{36}$/
export const CARD_ARCHIVE_CHUNK_BYTES = 16 * 1024 ** 2
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000
// The disk space pending card archives may hold. Its own figure: the asset library's spoolBytes bounds what a pack
// import holds in memory, which says nothing about how large a card archive on disk may be.
export const MAX_CARD_UPLOAD_BYTES = 32 * 1024 ** 3
export const isCardArchiveUpload = id => CARD_ARCHIVE_ID.test(String(id))

export function createUploads({ root, maxBytes = 1024 ** 3, maxAgeMs = UPLOAD_MAX_AGE_MS }) {
  const dir = path.join(path.resolve(root), 'tmp-uploads')
  const fileOf = id => ID.test(String(id)) ? path.join(dir, id) : null

  async function receive(source) {
    await mkdir(dir, { recursive: true })
    const id = randomUUID(), file = path.join(dir, id)
    let size = 0
    const meter = new Transform({ transform(chunk, _encoding, done) {
      size += chunk.length
      if (size > maxBytes) done(Object.assign(new Error('文件超过 ' + Math.round(maxBytes / 1048576) + ' MB'), { code: 'TAVERN_UPLOAD_TOO_LARGE' }))
      else done(null, chunk)
    } })
    try { await pipeline(source, meter, createWriteStream(file)) }
    catch (error) { await rm(file, { force: true }); throw error }
    if (!size) { await rm(file, { force: true }); throw new Error('上传的文件是空的') }
    return { id, size }
  }

  async function take(id) {
    const file = fileOf(id)
    if (!file || !(await stat(file).catch(() => null))?.isFile()) throw Object.assign(new Error('上传的文件不存在或已过期，请重新导入'), { code: 'TAVERN_NOT_FOUND' })
    return { file, remove: () => rm(file, { force: true }) }
  }

  /** Remove uploads nobody claimed (a closed page, a failed call). */
  async function sweep(now = Date.now()) {
    for (const name of await readdir(dir).catch(() => [])) {
      const file = path.join(dir, name), info = await stat(file).catch(() => null)
      if (info && now - info.mtimeMs > maxAgeMs) await rm(file, { force: true, recursive: true })
    }
  }

  return Object.freeze({ receive, take, sweep })
}


// Only the streaming card archive RPCs can consume this pool. Each pending upload
// reserves its declared size, while each HTTP request carries just one chunk.
export function createCardArchiveUploads({ root, maxBytes = MAX_CARD_UPLOAD_BYTES, maxAgeMs = UPLOAD_MAX_AGE_MS }) {
  const dir = path.join(path.resolve(root), 'tmp-card-archive-uploads')
  const staged = new Map()
  let reserved = 0
  const fileOf = id => path.join(dir, id)
  const missing = () => Object.assign(new Error('上传的卡包不存在或已过期，请重新导入'), { code: 'TAVERN_NOT_FOUND' })

  async function remove(id, item) {
    await rm(fileOf(id), { force: true })
    if (staged.get(id) === item) {
      staged.delete(id)
      reserved -= item.total
    }
  }

  async function receive(source, params) {
    const total = Number(params.get('size')), offset = Number(params.get('offset'))
    if (!Number.isSafeInteger(total) || total <= 0 || total > maxBytes) {
      throw new Error('卡包大小无效或超过 ' + Math.round(maxBytes / 1048576) + ' MB')
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total) throw new Error('卡包上传位置无效')
    const expected = Math.min(CARD_ARCHIVE_CHUNK_BYTES, total - offset)
    const declared = source.headers?.['content-length']
    if (declared !== undefined && Number(declared) !== expected) throw new Error('卡包分段长度不符')

    let id = params.get('uploadId')
    let item
    if (id) {
      item = staged.get(id)
      if (!item) throw missing()
      if (item.busy || item.size !== offset || item.total !== total) throw new Error('卡包上传位置已变化，请重新导入')
    } else {
      if (offset !== 0) throw new Error('卡包上传必须从开头开始')
      const retained = await retainedBytes(Date.now())
      if (reserved + retained + total > maxBytes) throw new Error('待导入卡包占用的暂存空间已达上限')
      id = 'card-archive-' + randomUUID()
      item = { size: 0, total, touched: Date.now(), busy: false }
      staged.set(id, item)
      reserved += total
    }
    item.busy = true
    let size = 0
    try {
      await mkdir(dir, { recursive: true })
      const meter = new Transform({ transform(chunk, _encoding, done) {
        size += chunk.length
        if (size > expected) done(new Error('卡包分段长度不符'))
        else done(null, chunk)
      } })
      await pipeline(source, meter, createWriteStream(fileOf(id), { flags: offset === 0 ? 'wx' : 'a' }))
      if (size !== expected) throw new Error('卡包分段长度不符')
      item.size += size
      item.touched = Date.now()
      return { id, size: item.size }
    } catch (error) {
      await remove(id, item)
      throw error
    } finally {
      item.busy = false
    }
  }

  async function take(id) {
    const item = staged.get(id)
    if (!item || item.busy || item.size !== item.total) throw missing()
    const file = fileOf(id)
    if (!(await stat(file).catch(() => null))?.isFile()) throw missing()
    return { file, remove: () => discard(id) }
  }

  async function discard(id) {
    const item = staged.get(id)
    if (!item) return
    if (item.busy) throw new Error('卡包分段仍在上传')
    item.busy = true
    try { await remove(id, item) } finally { item.busy = false }
  }

  // After a DSH restart, unfinished uploads have lost their session, but their
  // files still count toward the disk budget until the same expiry as live uploads.
  async function retainedBytes(now) {
    let total = 0
    for (const id of await readdir(dir).catch(() => [])) {
      if (!isCardArchiveUpload(id) || staged.has(id)) continue
      const info = await stat(fileOf(id)).catch(() => null)
      if (!info?.isFile()) continue
      if (now - info.mtimeMs > maxAgeMs) await rm(fileOf(id), { force: true })
      else total += info.size
    }
    return total
  }

  async function sweep(now = Date.now()) {
    for (const [id, item] of staged) {
      if (!item.busy && now - item.touched > maxAgeMs) await discard(id)
    }
    await retainedBytes(now)
  }

  return Object.freeze({ receive, take, discard, sweep })
}
