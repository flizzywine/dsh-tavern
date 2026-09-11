import http from 'node:http'
import { randomBytes } from 'node:crypto'

// Owned by the DSHA entry plugin. No detached watchdog, shared unauthenticated
// port, or process-name based cleanup. The authenticated host grants access.
export function createEmbeddedProxy({ accessUrl, request = fetch }) {
  const secret = randomBytes(32).toString('hex')
  const cookieName = `tavern_embed_${randomBytes(8).toString('hex')}`
  let origin = '', upstreamOrigin = '', sessionCookie = '', handshakePending
  const sockets = new Set()
  const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
  const clean = (headers, response = false) => Object.fromEntries(Object.entries(headers).filter(([name]) => !hop.has(name.toLowerCase()) && !(response ? ['set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials'] : ['cookie', 'host', 'origin', 'referer']).includes(name.toLowerCase())))
  async function handshake(force = false) {
    if (!force && sessionCookie) return
    if (handshakePending) return handshakePending
    handshakePending = (async () => {
      const url = await accessUrl()
      if (!url) throw new Error('酒馆尚未就绪，请稍后刷新')
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('酒馆地址无效')
      const res = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      await res.body?.cancel()
      const cookies = res.headers.getSetCookie().map(value => value.split(';')[0])
      if (res.status < 200 || res.status >= 400 || !cookies.length) throw new Error('酒馆登录尚未就绪，请刷新或直接打开')
      upstreamOrigin = parsed.origin
      sessionCookie = cookies.join('; ')
    })().finally(() => { handshakePending = undefined })
    return handshakePending
  }
  function allowed(req) {
    return req.headers.host === new URL(origin).host &&
      (!req.headers.origin || req.headers.origin === origin) &&
      String(req.headers.cookie || '').split(';').some(value => value.trim() === `${cookieName}=${secret}`)
  }
  function fail(res, status, text) {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(text)
  }
  function forward(req, res, retry) {
    const headers = clean(req.headers)
    headers.host = new URL(upstreamOrigin).host
    headers.origin = upstreamOrigin
    headers.cookie = sessionCookie
    const upstream = http.request(upstreamOrigin, { method: req.method, path: req.url, headers }, async response => {
      if (response.statusCode === 401 && retry && ['GET', 'HEAD'].includes(req.method)) {
        response.resume()
        try { await handshake(true); forward(req, res, false) } catch { fail(res, 503, '酒馆已重启，请刷新窗口或直接打开。') }
        return
      }
      const out = clean(response.headers, true)
      if (out.location?.startsWith(upstreamOrigin)) out.location = origin + out.location.slice(upstreamOrigin.length)
      res.writeHead(response.statusCode || 502, out)
      response.pipe(res)
      response.on('error', () => res.destroy())
    })
    upstream.setTimeout(120000, () => upstream.destroy())
    upstream.on('error', () => { if (!res.headersSent) fail(res, 502, '酒馆连接中断，请稍后刷新。'); else res.destroy() })
    res.on('close', () => upstream.destroy())
    // Never replay mutation bodies. A 401 for POST is returned to the caller.
    if (['GET', 'HEAD'].includes(req.method)) upstream.end()
    else req.pipe(upstream)
  }
  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== new URL(origin).host) return fail(res, 403, 'forbidden')
    const url = new URL(req.url, origin)
    if (req.method === 'GET' && url.pathname === '/__tavern_embed' && url.searchParams.get('key') === secret) {
      res.writeHead(303, { location: '/', 'set-cookie': `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(); return
    }
    if (!allowed(req)) return fail(res, 403, '请从 DSHA 酒馆工作台进入。')
    try { await handshake(); forward(req, res, true) }
    catch {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end('<!doctype html><meta charset="utf-8"><p>酒馆正在启动，请稍候。也可使用顶部的“直接打开”。</p><script>setInterval(()=>fetch(location.href,{cache:"no-store"}).then(r=>{if(r.ok)location.reload()}).catch(()=>{}),2000)</script>')
    }
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('upgrade', async (req, client, head) => {
    client.on('error', () => client.destroy())
    if (!allowed(req)) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    try { await handshake(true) } catch { client.destroy(); return }
    const headers = { ...req.headers, host: new URL(upstreamOrigin).host, origin: upstreamOrigin, cookie: sessionCookie }
    delete headers.referer
    const upstream = http.request(upstreamOrigin, { method: 'GET', path: req.url, headers })
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      socket.setTimeout(0)
      const responseHeaders = Object.entries(response.headers).filter(([key]) => key.toLowerCase() !== 'set-cookie')
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders.map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      if (head.length) socket.write(head)
      if (upstreamHead.length) client.write(upstreamHead)
      client.pipe(socket); socket.pipe(client)
      client.on('close', () => socket.destroy()); socket.on('close', () => client.destroy())
      socket.on('error', () => client.destroy())
    })
    upstream.on('response', response => { response.resume(); client.end(`HTTP/1.1 ${response.statusCode} Upstream rejected\r\nConnection: close\r\n\r\n`) })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    upstream.setTimeout(10000, () => upstream.destroy())
    upstream.end()
  })
  let listening
  return {
    async url() {
      if (!listening) listening = new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve() })
      })
      await listening
      return `${origin}/__tavern_embed?key=${secret}`
    },
    close() { for (const socket of sockets) socket.destroy(); server.close() },
  }
}
