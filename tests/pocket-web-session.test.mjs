import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, get } from 'node:http'
import test from 'node:test'

import { createHandshakeTracker, createPocketProxy } from '../node_modules/dsh-pocket/lib/proxy.mjs'

const authRequired = 'dsh web authentication required; reopen the URL printed by dsh web.'
const launchToken = 'fixture-launch-token'
const staleCookie = 'dsh-auth-previous=stale'
const currentCookie = 'dsh-auth-current=valid'
const appHtml = '<!doctype html><title>DSH</title>'

async function pocketFixture(t) {
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/' && url.searchParams.get('token') === launchToken) {
      res.writeHead(303, { location: '/', 'set-cookie': currentCookie + '; Path=/; HttpOnly; SameSite=Strict' })
      res.end()
      return
    }
    if ((req.headers.cookie ?? '').split('; ').includes(currentCookie)) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(appHtml)
      return
    }
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end(authRequired)
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => new Promise(resolve => upstream.close(resolve)))

  const proxy = await createPocketProxy({
    port: 0,
    host: '127.0.0.1',
    upstream: { host: '127.0.0.1', port: upstream.address().port },
    auth: { getToken: () => 'fixture-public-pin' },
    injectHtml: '',
    launchToken: () => launchToken,
    handshakeLimit: 2,
  })
  t.after(() => proxy.close())
  return async (path, { cookie = staleCookie, host = '192.168.1.10' } = {}) => {
    const request = get(`http://127.0.0.1:${proxy.port}${path}`, {
      headers: { accept: 'text/html', cookie, host },
      signal: AbortSignal.timeout(3000),
    })
    const [response] = await once(request, 'response')
    let body = ''
    response.setEncoding('utf8')
    for await (const chunk of response) body += chunk
    return { status: response.statusCode, headers: response.headers, body }
  }
}

async function renewSession(visit) {
  const retry = await visit('/')
  assert.equal(retry.status, 303, retry.body)
  assert.match(retry.headers.location, /^\/\?/)
  assert.ok(!retry.headers.location.includes(launchToken))
  return visit(retry.headers.location)
}

test('Pocket renews a rejected DSH session on the password-free LAN homepage', async t => {
  const visit = await pocketFixture(t)
  const transition = await renewSession(visit)
  assert.equal(transition.status, 200, transition.body)
  assert.equal(transition.headers['x-dsh-pocket-handshake'], 'transition')
  assert.equal(transition.headers['set-cookie'][0]?.split(';')[0], currentCookie)

  const homepage = await visit('/', { cookie: `${staleCookie}; ${currentCookie}` })
  assert.equal(homepage.status, 200)
  assert.equal(homepage.body, appHtml)

  const api = await visit('/api/example')
  assert.equal(api.status, 401)
  assert.equal(api.body, authRequired)

  const publicHomepage = await visit('/', { host: 'public.example' })
  assert.match(publicHomepage.body, /pocket-login/)
})

test('Pocket limits session retries when a browser keeps sending its stale cookie', async t => {
  const visit = await pocketFixture(t)
  for (let attempt = 0; attempt < 2; attempt++) {
    const transition = await renewSession(visit)
    assert.equal(transition.status, 200, transition.body)
    assert.equal(transition.headers['x-dsh-pocket-handshake'], 'transition')
  }
  const blocked = await renewSession(visit)
  assert.equal(blocked.status, 503, blocked.body)
  assert.equal(blocked.headers['x-dsh-pocket-handshake'], 'blocked')

  const homepage = await visit('/', { cookie: currentCookie })
  assert.equal(homepage.status, 200)
  assert.equal(homepage.body, appHtml)

  const transition = await renewSession(visit)
  assert.equal(transition.headers['x-dsh-pocket-handshake'], 'transition')
})

test('Pocket allows another handshake after its retry window expires', () => {
  const tracker = createHandshakeTracker({ max: 2, windowMs: 1000 })
  tracker.record('test-client', 0)
  tracker.record('test-client', 10)
  assert.equal(tracker.exhausted('test-client', 1000), true)
  assert.equal(tracker.exhausted('test-client', 1001), false)
})
