import { createHash } from 'node:crypto'

const digest = data => createHash('sha256').update(data).digest('hex')

/** Private durable outbox: no provider calls, credentials or browser image bytes. */
export function createPendingSceneImages(store) {
  const memory = new Map()
  // `.pending-` is reserved by the store's atomic-promotion implementation.
  const pathFor = (path, requestId) => path + '.received-' + digest(String(requestId)) + '.json'
  return {
    async put(path, requestId, image, maxBytes = 20 * 1024 * 1024) {
      const data = Buffer.from(image.data)
      if (!data.length || data.length > maxBytes) throw new Error('待保存图片为空或超过大小限制')
      const pending = { requestId, data: data.toString('base64'), digest: digest(data), mediaType: image.mediaType, metadata: image.metadata, receivedAt: Date.now() }
      const file = pathFor(path, requestId)
      // If the disk itself fails, retain these received bytes while this host is
      // alive. Never turn an unsuccessful outbox write into another paid request.
      memory.set(file, pending)
      await store.writeJson(file, pending)
      memory.delete(file)
    },
    async has(path, requestId) {
      const file = pathFor(path, requestId)
      return memory.has(file) || Boolean(await store.version(file))
    },
    async read(path, requestId) {
      const file = pathFor(path, requestId)
      if (memory.has(file)) {
        await store.writeJson(file, memory.get(file))
        memory.delete(file)
      }
      const pending = memory.get(file) || await store.readJson(file)
      if (!pending || pending.requestId !== requestId || typeof pending.data !== 'string') throw new Error('待保存图片不存在，不能重新生图代替恢复')
      const data = Buffer.from(pending.data, 'base64')
      if (!data.length || digest(data) !== pending.digest) throw new Error('待保存图片校验失败，不能重新生图代替恢复')
      return { data, mediaType: pending.mediaType, metadata: pending.metadata }
    },
    async remove(path, requestId) {
      const file = pathFor(path, requestId)
      await store.remove(file)
      memory.delete(file)
    }
  }
}
