import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { atomicWrite, readJson, serialQueue } from './storage.js'

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const validFile = value => typeof value === 'string' && value === basename(value) && /^[\w-]+\.(png|jpe?g|webp|gif)$/i.test(value)

/** One mutation gate covers append, delete and clear, including calls from the host gallery. */
export function createCardGallery(directory, { removeFile = rm } = {}) {
  const images = join(directory, 'images'), index = join(directory, 'jobs.json'), serial = serialQueue()
  let loading
  const load = () => loading ||= readJson(index, []).then(value => {
    if (!Array.isArray(value)) throw new Error('工作台画廊记录损坏，已保留原文件')
    return value.filter(item => item && typeof item.id === 'string' && validFile(item.file)).slice(-500)
  }).catch(error => { loading = null; throw error })
  const publish = async next => { await atomicWrite(index, next); loading = Promise.resolve(next) }
  const url = file => '/dsh-tavern-gen/img/' + encodeURIComponent(file)
  async function find(id, sessionId) {
    return (await load()).find(item => item.id === id && (sessionId === undefined || sessionId && item.session === sessionId))
  }
  return {
    async list(sessionId) { return (await load()).filter(item => sessionId === undefined || sessionId && item.session === sessionId).slice().reverse().map(item => ({ ...item, url: url(item.file) })) },
    async add(result, { sessionId, preset } = {}) {
      const extension = Object.keys(MIME).find(key => MIME[key] === result.mediaType) || 'png'
      const id = result.jobId || randomUUID(), file = id + '.' + extension
      return serial(async () => {
        const list = await load(), existing = list.find(item => item.id === id)
        if (existing) return { ...existing, url: url(existing.file) }
        await mkdir(images, { recursive: true })
        await copyFile(result.file, join(images, file))
        const entry = { id, file, at: Date.now(), session: sessionId || '', prompt: result.prompt, negative: result.negative,
          preset: preset || '', channel: result.channel, size: result.size, mediaType: result.mediaType, seed: result.seed, jobId: result.jobId }
        const next = [...list, entry].slice(-500)
        try { await publish(next) }
        catch (error) { await rm(join(images, file), { force: true }); throw error }
        for (const old of list.slice(0, Math.max(0, list.length + 1 - 500))) await rm(join(images, old.file), { force: true }).catch(() => {})
        return { ...entry, url: url(file) }
      })
    },
    remove(id, sessionId) {
      return serial(async () => {
        const list = await load(), target = await find(id, sessionId)
        if (!target) return false
        // Keep the record available for retry when Windows still holds the image file.
        await removeFile(join(images, target.file), { force: true })
        await publish(list.filter(item => item.id !== target.id))
        return true
      })
    },
    clear() {
      return serial(async () => {
        const list = await load()
        const failed = []
        for (const item of list) {
          try { await removeFile(join(images, item.file), { force: true }) }
          catch { failed.push(item) }
        }
        await publish(failed)
        if (failed.length) throw Object.assign(new Error(`还有 ${failed.length} 张图片暂时无法删除，记录已保留，请稍后重试`), { code: 'GALLERY_DELETE_FAILED', removed: list.length - failed.length })
        return list.length
      })
    },
    async read(id, sessionId) {
      const entry = await find(id, sessionId)
      if (!entry) throw Object.assign(new Error('图片不存在或不属于当前会话'), { code: 'NOT_FOUND' })
      return { data: await readFile(join(images, entry.file)), mediaType: entry.mediaType || MIME[entry.file.split('.').pop().toLowerCase()] }
    },
    async file(name) {
      if (!validFile(name) || !(await load()).some(item => item.file === name)) throw Object.assign(new Error('图片不存在'), { code: 'NOT_FOUND' })
      const file = join(images, name), info = await stat(file)
      return { file, size: info.size, mediaType: MIME[name.split('.').pop().toLowerCase()] }
    },
  }
}
