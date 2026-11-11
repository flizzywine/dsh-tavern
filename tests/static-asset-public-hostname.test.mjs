import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTavernStaticResourceCache } from '../tavern-plugin/lib/domain/tavern-static-resource-cache.js'
import { verifyPublicHostname } from '../tavern-plugin/lib/http/public-hostname.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

function response(body, mediaType, url) {
  const bytes = Buffer.from(body)
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? mediaType : (String(name).toLowerCase() === 'content-length' ? String(bytes.length) : null) },
    arrayBuffer: async () => bytes
  }
}

test('static assets can pin public DNS answers without connecting to private addresses', async () => {
  const resolved = []
  const resolve = async hostname => {
    resolved.push(hostname)
    if (hostname === 'private.example') return [{ address: '192.168.1.2' }]
    if (hostname === 'mixed.example') return [{ address: '93.184.215.14' }, { address: '192.168.1.2' }]
    return [{ address: '93.184.215.14' }]
  }
  await assert.rejects(verifyPublicHostname('https://private.example/a.js', resolve), /private or reserved/)
  assert.deepEqual(await verifyPublicHostname('https://mixed.example/a.js', resolve), [{ address: '93.184.215.14', family: 4 }])
  assert.equal(await verifyPublicHostname('https://cdn.example/a.js', resolve), undefined)
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '0.0.0.0', '198.51.100.1', '198.18.0.75', '198.19.255.1', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]', '[fdfe:dcba:9876::52]', '[2001:2::52]']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve), /private or reserved/)
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve, true), /private or reserved/)
  }
  assert.deepEqual(resolved, ['private.example', 'mixed.example', 'cdn.example'], 'IP literals do not pass through DNS')
})

test('Fake-IP opt-in pins independently resolved public addresses for previously unseen domains', async () => {
  const fake = [{ address: '198.19.255.1', family: 4 }, { address: 'fdfe:dcba:9876::52', family: 6 }, { address: '2001:2::52', family: 6 }]
  const verified = [{ address: '93.184.215.14', family: 4 }, { address: '2606:4700::1111', family: 6 }]
  const resolve = async () => fake
  const names = []
  const resolvePublic = async hostname => { names.push(hostname); return verified }
  const host = 'new-image-host.example'
  const url = 'https://' + host + '/asset.png'
  await assert.rejects(verifyPublicHostname(url, resolve, false, resolvePublic), /private or reserved/)
  for (const blocked of ['http://' + host, 'https://198.18.0.75',
    'https://localhost', 'https://media.home.arpa.', 'https://workstation.lan']) {
    await assert.rejects(verifyPublicHostname(blocked, resolve, true, resolvePublic), /private or reserved/)
  }
  assert.deepEqual(names, [])
  assert.deepEqual(await verifyPublicHostname(url, resolve, true, resolvePublic), verified)
  assert.deepEqual(await verifyPublicHostname('https://' + host + ':8443/asset.png',
    async () => [...fake, { address: '192.168.1.5', family: 4 }], true, resolvePublic), verified)
  assert.deepEqual(names, [host, host])
  assert.deepEqual(await verifyPublicHostname(url, resolve, true,
    async () => [...verified, { address: '10.0.0.1', family: 4 }]), verified)
  for (const unsafe of [[], fake, [{ address: '10.0.0.1', family: 4 }]]) {
    await assert.rejects(verifyPublicHostname(url, resolve, true, async () => unsafe), /private or reserved/)
  }
  await assert.rejects(verifyPublicHostname(url, resolve, true, async () => { throw new Error('resolver offline') }), { status: 502 })
})

test('a failed public DNS address family does not block the other one', async t => {
  let ipv4 = [{ type: 1, data: '93.184.215.14' }]
  t.mock.method(globalThis, 'fetch', async url => url.searchParams.get('type') === '28'
    ? new Response(null, { status: 503 })
    : Response.json({ Status: 0, Answer: ipv4 }))
  const url = 'https://partial-dns.example/cover.png'
  const resolve = async () => [{ address: '198.18.0.75', family: 4 }]
  assert.deepEqual(await verifyPublicHostname(url, resolve, true), [{ address: '93.184.215.14', family: 4 }])
  ipv4 = []
  await assert.rejects(verifyPublicHostname(url, resolve, true), { status: 502 })
})

test('static-assets returns typed errors through the real validation and download path', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-status-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  let handler
  const webServer = { register(route) { if (route.path === '/api/dsh-tavern') handler = route.handler; return () => {} } }
  const cache = createTavernStaticResourceCache({
    rootDir,
    verifyHostname: url => verifyPublicHostname(url, async () => [{ address: '93.184.215.14', family: 4 }]),
    fetch: async url => url.endsWith('/redirect')
      ? new Response(null, { status: 302, headers: { Location: 'http://cdn.example/a.html' } })
      : new Response(null, { status: 503 }),
  })
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : { requestRejection: () => undefined }, effect(cb) { cb() } },
    dispatch: async () => ({}),
    str: value => String(value ?? ''),
    tavernStaticResources: cache,
    performanceDiagnostics: { http() {} },
    runtimeGeneration: 'test-gen',
    runtimeReadiness: Promise.resolve({ ok: true })
  })
  for (const [url, expectedStatus] of [
    ['not a URL', 400], ['http://cdn.example/a.html', 400], ['https://user@cdn.example/a.html', 400],
    ['https://198.18.0.75/a.html', 403], ['https://[fdfe:dcba:9876::52]/a.html', 403],
    ['https://cdn.example/redirect', 502], ['https://cdn.example/down', 502],
  ]) {
    let status, headers, body
    await handler(
      { url: '/api/dsh-tavern/static-assets?url=' + encodeURIComponent(url), method: 'GET', headers: { host: 'localhost:3081' } },
      { writeHead(code, fields) { status = code; headers = fields }, end(payload) { body = payload } }
    )
    assert.equal(status, expectedStatus, url)
    assert.equal(headers['Cache-Control'], 'no-store')
    assert.equal(JSON.parse(body).ok, false)
  }
})

test('static cache checks every redirect hop before fetching it', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-hostname-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  const calls = []
  const verifyHostname = url => verifyPublicHostname(url, async () => [{ address: '93.184.215.14' }])
  const cache = createTavernStaticResourceCache({
    rootDir,
    verifyHostname,
    fetch: async url => {
      calls.push(url)
      if (url.endsWith('/redirect.js')) return { status: 302, headers: { get: () => 'https://[fd00::52]/module.js' } }
      return response('export const ready=true;', 'application/javascript', url)
    }
  })
  await assert.rejects(cache.get('https://cdn.example/redirect.js'), /private or reserved/)
  assert.deepEqual(calls, ['https://cdn.example/redirect.js'])
})

test('a Fake-IP request gets a pinned dispatcher and rechecks the public DNS of each redirect', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-fake-ip-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  const requests = []
  const lookups = []
  const resolve = async () => [{ address: '198.18.0.75', family: 4 }]
  const resolvePublic = async hostname => {
    lookups.push(hostname)
    return [{ address: hostname === 'new-cdn.example' ? '93.184.215.14' : '10.0.0.1', family: 4 }]
  }
  const cache = createTavernStaticResourceCache({
    rootDir,
    verifyHostname: url => verifyPublicHostname(url, resolve, true, resolvePublic),
    fetch: async (url, { dispatcher }) => {
      requests.push({ url, dispatcher })
      return new Response(null, { status: 302, headers: { Location: 'https://other.example/a.js' } })
    },
  })
  await assert.rejects(cache.get('https://new-cdn.example:8443/a.js'), /private or reserved/)
  assert.deepEqual(lookups, ['new-cdn.example', 'other.example'])
  assert.deepEqual(requests.map(request => request.url), ['https://new-cdn.example:8443/a.js'])
  assert.equal(requests[0].dispatcher?.destroyed, true)
})
