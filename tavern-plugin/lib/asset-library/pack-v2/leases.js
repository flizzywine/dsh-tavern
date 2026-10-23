import { randomBytes } from 'node:crypto'
import { check } from '../asset-packs/common.js'

export const PACK_LEASE_PATH = '/api/dsh-asset-library/v2/lease/'
// A single-resource body is read on demand in chunks of at most this size, never as a whole file.
export const PACK_LEASE_CHUNK = 1024 ** 2
// No routes are registered here. An authenticated host route must use
// requestBody:'buffered' for every exact GET/HEAD route and pass the original Request.
export function createPackLeases({now = Date.now, ttlMs = 15 * 60000, maxLeases = 2048, authorize, inspect, readRange}) {
  check(Number.isSafeInteger(ttlMs) && ttlMs > 0 && Number.isSafeInteger(maxLeases) && maxLeases > 0, '$.leases')
  const entries = new Map()
  let disposed = false
  function sweep() { for (const [ticket, entry] of entries) if (entry.expiresAt <= now()) entries.delete(ticket) }
  function active() { check(!disposed, '$', 'Lease service disposed', 'ASSET_UNAVAILABLE'); sweep() }
  function valid(ticket, entry) { active(); check(entries.get(ticket) === entry && entry.expiresAt > now(), '$.ticket', 'Lease expired or revoked', 'ASSET_UNAVAILABLE') }
  async function allowed(entry, request) {
    check(typeof authorize === 'function', '$', 'An authenticated lease authorizer is required', 'ASSET_UNAVAILABLE')
    check(await authorize({packId:entry.packId, revision:entry.revision, kind:entry.kind, scope:entry.scope, request}) === true, '$', 'Lease access denied', 'ASSET_UNAVAILABLE')
  }
  return {
    async issue(input) {
      active()
      const origin = new URL(input.origin)
      check(['http:','https:'].includes(origin.protocol) && origin.origin === input.origin && !origin.username && !origin.password && typeof input.scope === 'string' && input.scope.length > 0, '$.origin', 'A same-origin authenticated scope is required')
      check(input.resources.length > 0 && input.resources.some(r => r.name === input.entry), '$.resources')
      await allowed(input); active()
      check([...entries.values()].reduce((sum, entry) => sum + entry.resources.length, 0) + input.resources.length <= maxLeases, '$.leases', 'Lease resource limit', 'LIMIT_EXCEEDED')
      const ticket = randomBytes(24).toString('base64url'), expiresAt = now() + ttlMs
      const entry = {...input, expiresAt}; entries.set(ticket, entry)
      const base = PACK_LEASE_PATH + ticket + '/'
      return {ticket, expiresAt, revision:input.revision, url:base + input.entry.split('/').map(encodeURIComponent).join('/'), resources:input.resources.map(r => base + r.name.split('/').map(encodeURIComponent).join('/'))}
    },
    async response({ticket, resource, request}) {
      active()
      const entry = entries.get(ticket)
      check(entry, '$.ticket', 'Lease expired or revoked', 'ASSET_UNAVAILABLE')
      const url = new URL(request.url), origin = request.headers.get('origin'), fetchSite = request.headers.get('sec-fetch-site')
      check(url.origin === entry.origin && (!origin || origin === entry.origin) && (!fetchSite || ['same-origin','none'].includes(fetchSite)), '$.origin', 'Cross-origin media request rejected', 'ASSET_UNAVAILABLE')
      const file = entry.resources.find(item => item.name === resource)
      check(file && url.pathname === PACK_LEASE_PATH + ticket + '/' + file.name.split('/').map(encodeURIComponent).join('/'), '$.resource', 'Resource outside lease', 'ASSET_UNAVAILABLE')
      await allowed(entry, request); valid(ticket, entry)
      if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405})
      // The revision fence yields only the stored size; cache hits, HEAD and 416 read no payload.
      const {size} = await inspect(entry, file.path)
      await allowed(entry, request); valid(ticket, entry)
      const etag = '"' + file.hash + '"'
      const headers = {'Content-Type':file.mime, 'Cache-Control':'private, no-cache', 'X-Content-Type-Options':'nosniff', 'Cross-Origin-Resource-Policy':'same-origin', 'Accept-Ranges':'bytes', ETag:etag}
      if (request.headers.get('if-none-match')?.split(',').map(v => v.trim()).includes(etag)) return new Response(null, {status:304, headers})
      let start = 0, end = size - 1, status = 200
      const range = request.headers.get('range'), ifRange = request.headers.get('if-range')
      if (range && (!ifRange || ifRange === etag)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || !match[1] && !match[2]) return new Response(null, {status:416, headers:{...headers,'Content-Range':'bytes */' + size}})
        if (!match[1]) start = Math.max(0, size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, {status:416, headers:{...headers,'Content-Range':'bytes */' + size}})
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1))
      if (request.method === 'HEAD' || size === 0) return new Response(null, {status,headers})
      // Each chunk is read under the same revision fence and no file handle outlives it,
      // so a paused <audio> neither pins memory nor blocks a pack publication rename (Windows).
      let position = start
      const body = new ReadableStream({
        async pull(controller) {
          const bytes = await readRange(entry, file.path, position, Math.min(PACK_LEASE_CHUNK, end + 1 - position))
          position += bytes.length
          controller.enqueue(bytes)
          if (position > end) controller.close()
        }
      }, {highWaterMark:0})
      return new Response(body, {status,headers})
    },
    release(ticket) { return entries.delete(ticket) },
    dispose() { disposed = true; entries.clear() }
  }
}
