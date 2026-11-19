import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPublicHostname } from '../tavern-plugin/lib/http/public-hostname.js'

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
