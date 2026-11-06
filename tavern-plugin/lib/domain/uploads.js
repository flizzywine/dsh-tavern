import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

// Large files sent to Tavern as a raw request body (DSH cards of several hundred MB), kept on disk
// until the call that uses them; never read into memory or encoded as base64.

const ID = /^[0-9a-f-]{36}$/

export function createUploads({ root, maxBytes = 1024 * 1024 * 1024, maxAgeMs = 24 * 60 * 60 * 1000 }) {
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
