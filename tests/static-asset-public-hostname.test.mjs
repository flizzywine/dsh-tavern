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
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '0.0.0.0', '198.51.100.1', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve), /private or reserved/)
  }
  for (const fakeIp of ['198.18.0.75', '198.19.255.1', '[fdfe:dcba:9876::52]']) {
    await verifyPublicHostname('https://' + fakeIp + '/a.js', resolve)
  }
  await verifyPublicHostname('https://cdn.jsdelivr.net/a.js', async () => [{ address: '198.18.0.75' }])
  assert.deepEqual(resolved, ['private.example', 'cdn.example'], 'IP literals do not pass through DNS')
})

test('static-assets route returns non-200 HTTP status on error instead of 200 JSON', async () => {
  let handler
  const webServer = { register(route) { if (route.path === '/api/dsh-tavern') handler = route.handler; return () => {} } }
  let nextError = new Error('Static assets cannot access private or reserved network addresses')
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : { requestRejection: () => undefined }, effect(cb) { cb() } },
    dispatch: async () => ({}),
    str: value => String(value ?? ''),
    tavernStaticResources: { get: async () => { throw nextError } },
    performanceDiagnostics: { http() {} },
    runtimeGeneration: 'test-gen',
    runtimeReadiness: Promise.resolve({ ok: true })
  })
  for (const [errMsg, expectedStatus] of [
    ['静态资源缓存只允许 HTTPS 地址', 400],
    ['Static assets cannot access private or reserved network addresses', 403],
    ['静态资源下载失败（HTTP 502）', 502]
  ]) {
    nextError = new Error(errMsg)
    let status, body
    await handler(
      { url: '/api/dsh-tavern/static-assets?url=https%3A%2F%2Fexample.com%2Fa.html', method: 'GET', headers: { host: 'localhost:3081' } },
      { writeHead(code) { status = code }, end(payload) { body = payload } }
    )
    assert.equal(status, expectedStatus)
    assert.deepEqual(JSON.parse(body), { ok: false, error: errMsg })
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
