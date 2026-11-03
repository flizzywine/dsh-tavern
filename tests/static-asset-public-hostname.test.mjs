import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTavernStaticResourceCache } from '../tavern-plugin/lib/domain/tavern-static-resource-cache.js'
import { verifyPublicHostname } from '../tavern-plugin/lib/http/public-hostname.js'

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
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '0.0.0.0', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[fe80::1]']) {
    await assert.rejects(verifyPublicHostname('https://' + host + '/a.js', resolve), /private or reserved/)
  }
  assert.deepEqual(resolved, ['private.example', 'cdn.example'], 'IP literals do not pass through DNS')
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
