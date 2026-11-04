import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateLibraryCard } from '../bin/update-library-card.mjs'

async function fixture(t, extension = 'json') {
  const dir = await mkdtemp(join(tmpdir(), 'card-updater-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, `new.${extension}`)
  await writeFile(file, '{}')
  return { url: 'http://127.0.0.1:3081/', cardPath: 'cards/original.json', file }
}
const json = value => Response.json(value)

test('updater refuses old servers before uploading or changing cards', async t => {
  const input = await fixture(t), routes = []
  await assert.rejects(updateLibraryCard({ ...input, fetchImpl: async url => {
    routes.push(url.pathname)
    return json({ card: {} })
  } }), /尚未支持安全原位更新/)
  assert.deepEqual(routes, ['/api/dsh-tavern/getCard'])
})

test('updater authenticates desktop cookies and replaces selected JSON path', async t => {
  const input = await fixture(t), routes = []
  const result = await updateLibraryCard({ ...input, accessPin: 'test-only-pin', fetchImpl: async (url, options) => {
    routes.push(url.pathname)
    if (url.pathname === '/pocket-login') return new Response(null, { status: 302, headers: { location: '/?dsh-pocket-auth=1', 'set-cookie': 'pocket=test; HttpOnly; Path=/' } })
    assert.match(options.headers.cookie, /pocket=test/)
    if (url.pathname === '/') return new Response('ready', { headers: { 'set-cookie': 'session=ready; Path=/' } })
    assert.match(options.headers.cookie, /session=ready/)
    if (url.pathname.endsWith('/getCard')) return json({ card: {}, replacementSupported: true })
    const body = JSON.parse(options.body)
    assert.equal(body.replacePath, input.cardPath)
    assert.equal(body.payload.kind, 'text')
    return json({ card: { updated: true, path: input.cardPath } })
  } })
  assert.equal(result.updated, true)
  assert.deepEqual(routes, ['/pocket-login', '/', '/api/dsh-tavern/getCard', '/api/dsh-tavern/importCard'])
})

test('updater cleans temporary binary upload when replacement fails', async t => {
  const input = await fixture(t, 'dshcard'), routes = []
  await assert.rejects(updateLibraryCard({ ...input, fetchImpl: async (url, options) => {
    const route = url.pathname.split('/').pop(); routes.push(route)
    if (route === 'getCard') return json({ card: {}, replacementSupported: true })
    if (route === 'card-upload') return json({ uploadId: 'temporary' })
    if (route === 'importCardUpload') return json({ ok: false, error: 'invalid archive' })
    assert.deepEqual(JSON.parse(options.body), { uploadId: 'temporary' })
    return json({ ok: true })
  } }), /invalid archive/)
  assert.deepEqual(routes, ['getCard', 'card-upload', 'importCardUpload', 'discardCardUpload'])
})

test('desktop handshake never forwards cookies to a different origin', async t => {
  const input = await fixture(t); let requests = 0
  await assert.rejects(updateLibraryCard({ ...input, accessPin: 'test-only-pin', fetchImpl: async () => {
    requests++
    return new Response(null, { status: 302, headers: { location: 'https://different.invalid/', 'set-cookie': 'pocket=test; Path=/' } })
  } }), /拒绝向其他服务/)
  assert.equal(requests, 1)
})
