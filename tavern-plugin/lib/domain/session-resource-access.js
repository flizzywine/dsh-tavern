import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Capabilities pin reads to the same saved revision as the displayed view.
// Keep only bounded serialized results, never additional full Chat snapshots.
export function createSessionResourceAccess({ read, maxBytes = 32 * 1024 * 1024 }) {
  const secret = randomBytes(32), cache = new Map(), pending = new Map()
  let bytes = 0
  const sign = body => createHmac('sha256', secret).update(body).digest()
  function issue(chatId, revision, kind) {
    if (!Number.isSafeInteger(revision) || revision < 0 || !['card', 'worldbook'].includes(kind)) throw Error('Invalid resource revision')
    const body = Buffer.from(JSON.stringify({ chatId, revision, kind })).toString('base64url')
    return { token: body + '.' + sign(body).toString('base64url'), revision, kind }
  }
  async function resolve(token) {
    const [body, signature, ...extra] = String(token || '').split('.')
    const actual = Buffer.from(signature || '', 'base64url'), expected = sign(body || '')
    if (extra.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('Invalid resource capability')
    const scope = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (cache.has(token)) { const item = cache.get(token); cache.delete(token); cache.set(token, item); return item.json }
    if (pending.has(token)) return pending.get(token)
    const task = Promise.resolve().then(async () => {
      const value = await read(scope)
      if (value === undefined) throw Error('Resource revision unavailable')
      const json = JSON.stringify({ kind: scope.kind, revision: scope.revision, value })
      const size = Buffer.byteLength(json)
      if (size <= maxBytes) {
        cache.set(token, { json, size }); bytes += size
        while (bytes > maxBytes || cache.size > 32) { const first = cache.keys().next().value; bytes -= cache.get(first).size; cache.delete(first) }
      }
      return json
    }).finally(() => pending.delete(token))
    pending.set(token, task)
    return task
  }
  return Object.freeze({ issue, read: resolve })
}
