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

test('static asset hostnames must resolve only to public addresses', async () => {
  const resolved = []
  const resolve = async hostname => {
    resolved.push(hostname)
    return hostname === 'private.example' ? [{ address: '93.184.215.14' }, { address: '192.168.1.2' }] : [{ address: '93.184.215.14' }]
  }
  await assert.rejects(verifyPublicHostname('https://private.example/a.js', resolve), /private or reserved/)
  await verifyPublicHostname('https://cdn.example/a.js', resolve)
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '0.0.0.0', '198.51.100.1', '198.18.0.75', '198.19.255.1', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]', '[fdfe:dcba:9876::52]', '[2001:2::52]']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve), /private or reserved/)
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve, true), /private or reserved/)
  }
  assert.deepEqual(resolved, ['private.example', 'cdn.example'], 'IP literals do not pass through DNS')
})

test('Fake-IP only admits DNS answers for opted-in CDN hosts on the default HTTPS port', async () => {
  const addresses = [{ address: '198.19.255.1', family: 4 }, { address: 'fdfe:dcba:9876::52', family: 6 }, { address: '2001:2::52', family: 6 }]
  const resolve = async () => addresses
  for (const host of ['cdn.jsdelivr.net', 'testingcf.jsdelivr.net', 'fastly.jsdelivr.net', 'raw.githubusercontent.com']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve, false), /private or reserved/)
    assert.equal(await verifyPublicHostname('https://' + host + '/a.js', resolve, true), addresses)
  }
  for (const host of ['cdn.example', 'cdn.jsdelivr.net.example', 'cdn.jsdelivr.net:8443', 'raw.githubusercontent.com.example', 'raw.githubusercontent.com:8443']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve, true), /private or reserved/)
  }
  await assert.rejects(verifyPublicHostname('https://cdn.jsdelivr.net/a.js',
    async () => [...addresses, { address: '192.168.1.5', family: 4 }], true), /private or reserved/)
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

test('a CDN Fake-IP request gets a pinned dispatcher and cannot redirect to another Fake-IP host', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-static-fake-ip-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  const requests = []
  const resolve = async () => [{ address: '198.18.0.75', family: 4 }]
  const cache = createTavernStaticResourceCache({
    rootDir,
    verifyHostname: url => verifyPublicHostname(url, resolve, true),
    fetch: async (url, { dispatcher }) => {
      requests.push({ url, dispatcher })
      return new Response(null, { status: 302, headers: { Location: 'https://other.example/a.js' } })
    },
  })
  await assert.rejects(cache.get('https://cdn.jsdelivr.net/a.js'), /private or reserved/)
  assert.deepEqual(requests.map(request => request.url), ['https://cdn.jsdelivr.net/a.js'])
  assert.equal(requests[0].dispatcher?.destroyed, true)
})
