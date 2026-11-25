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

test('默认启用 Fake-IP 公共 DNS 校验，首个 DoH 不可达时回退备用公共 DNS，显式关闭或私网结果仍返回 403', async t => {
  const seen = []
  t.mock.method(globalThis, 'fetch', async url => {
    seen.push(url.origin + url.pathname)
    if (url.hostname === '1.1.1.1') throw new TypeError('fetch failed')
    if (url.searchParams.get('type') === '28') return Response.json({ Status: 0, Answer: [] })
    const name = url.searchParams.get('name')
    if (name === 'private.example') return Response.json({ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] })
    return Response.json({ Status: 0, Answer: [{ type: 1, data: '104.18.1.1' }] })
  })
  const resolve = async () => [{ address: '198.18.0.88', family: 4 }]
  const previous = process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP
  delete process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP
    else process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP = previous
  })

  assert.deepEqual(await verifyPublicHostname('https://testingcf.jsdelivr.net/npm/jsonrepair@3.15.0/+esm', resolve), [{ address: '104.18.1.1', family: 4 }])
  assert.ok(seen.includes('https://1.1.1.1/dns-query'))
  assert.ok(seen.includes('https://223.5.5.5/resolve'))

  await assert.rejects(verifyPublicHostname('https://private.example/a.js', resolve), { status: 403 })
  await assert.rejects(verifyPublicHostname('https://testingcf.jsdelivr.net/a.js', resolve, false), { status: 403 })

  process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP = '0'
  await assert.rejects(verifyPublicHostname('https://testingcf.jsdelivr.net/a.js', resolve), { status: 403 })
})
