import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'

// Exercise the installed dependency, including its HTTP/WS forwarding and cookie exchange.
const { createPocketProxy } = await import(pathToFileURL(createRequire(import.meta.url).resolve('dsh-pocket/package.json').replace(/package\.json$/, 'lib/proxy.mjs')).href)

async function fixture(t, password = false) {
  const requests = []
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid')
    requests.push(url.pathname)
    if (url.pathname === '/' && url.searchParams.get('token') === 'fixture-launch-token') {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-current=valid; HttpOnly; Path=/' })
      res.end()
    } else if (!req.headers.cookie?.includes('dsh-auth-current=valid')) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"expired-session"}')
    } else {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>Saved game</title>原有游戏')
    }
  })
  const sockets = new WebSocketServer({ server: upstream })
  sockets.on('connection', socket => socket.on('message', data => socket.send(data)))
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
  })
  const proxy = await createPocketProxy({
    host: '127.0.0.1', port: 0,
    upstream: { host: '127.0.0.1', port: upstream.address().port },
    launchToken: () => 'fixture-launch-token',
    auth: { isProtected: () => password, getToken: () => 'fixture-pocket-pin', sessionKey: 'fixture-key' },
  })
  t.after(() => proxy.close())
  const origin = `http://127.0.0.1:${proxy.port}`
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options })
  let pocketCookie = ''
  if (password) {
    const login = await request('/pocket-login', { method: 'POST', body: 'token=fixture-pocket-pin' })
    assert.equal(login.status, 302)
    pocketCookie = login.headers.get('set-cookie').split(';')[0]
    await login.text()
  }
  const cookie = session => [pocketCookie, session].filter(Boolean).join('; ')
  return { request, origin, requests, cookie }
}

for (const password of [false, true]) {
  test(`Pocket restores a rejected DSH session through its real proxy (LAN password: ${password})`, async t => {
    const h = await fixture(t, password)
    const stale = { accept: 'text/html', cookie: h.cookie('dsh-auth-old=expired') }
    const rejected = await h.request('/', { headers: stale })
    assert.equal(rejected.status, 303, 'a stale browser cookie must restart the DSH exchange')
    assert.equal(rejected.headers.get('location'), '/?dsh-pocket-auth=1')
    await rejected.text()

    const exchange = await h.request(rejected.headers.get('location'), { headers: stale })
    assert.equal(exchange.status, 200)
    assert.equal(exchange.headers.get('x-dsh-pocket-handshake'), 'transition')
    const fresh = exchange.headers.get('set-cookie').split(';')[0]
    await exchange.text()
    const restored = await h.request('/', { headers: { accept: 'text/html', cookie: h.cookie(fresh) } })
    assert.equal(restored.status, 200)
    assert.match(await restored.text(), /原有游戏/)

    const api = await h.request('/api/dsh-tavern/getSession', { headers: { accept: 'application/json', cookie: h.cookie('dsh-auth-old=expired') } })
    assert.equal(api.status, 401, 'API callers receive JSON rather than a login document')
    assert.equal(api.headers.get('location'), null)
    assert.deepEqual(await api.json(), { error: 'expired-session' })
  })
}

test('Pocket rejects unauthenticated HTTP/WS and forwards an authenticated mux connection', async t => {
  const h = await fixture(t, true)
  const before = h.requests.length
  const denied = await h.request('/api/dsh-tavern/getSession', { headers: { accept: 'application/json' } })
  assert.equal(denied.status, 401)
  assert.deepEqual(await denied.json(), { error: 'unauthorized' })
  assert.equal(h.requests.length, before)

  const rejected = new WebSocket(h.origin.replace('http:', 'ws:') + '/api/remote.mux')
  rejected.on('error', () => {})
  const [, response] = await once(rejected, 'unexpected-response')
  assert.equal(response.statusCode, 401)
  response.resume()
  rejected.terminate()

  const connected = new WebSocket(h.origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie: h.cookie('dsh-auth-current=valid') } })
  t.after(() => connected.terminate())
  await once(connected, 'open')
  const message = once(connected, 'message')
  connected.send('tavern-session-signal')
  assert.equal((await message)[0].toString(), 'tavern-session-signal')
})
