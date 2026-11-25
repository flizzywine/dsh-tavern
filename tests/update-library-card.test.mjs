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

test('updater authenticates desktop cookies and replaces selected JSON path', async t => {
  const input = await fixture(t), routes = []
  const result = await updateLibraryCard({ ...input, accessPin: 'test-only-pin', fetchImpl: async (url, options) => {
    routes.push(url.pathname)
    if (url.pathname === '/pocket-login') return new Response(null, { status: 302, headers: { location: '/?dsh-pocket-auth=1', 'set-cookie': 'pocket=test; HttpOnly; Path=/' } })
    assert.match(options.headers.cookie, /pocket=test/)
    if (url.pathname === '/') return new Response('ready', { headers: { 'set-cookie': 'session=ready; Path=/' } })
    assert.match(options.headers.cookie, /session=ready/)
    if (url.pathname.endsWith('/getCard')) return json({ card: {}, replacementSupported: true })
    if (url.pathname.endsWith('/card-upload')) {
      assert.equal(options.headers['content-type'], 'application/octet-stream')
      assert.equal(options.headers['content-length'], '2')
      const parts = []
      for await (const chunk of options.body) parts.push(chunk)
      assert.equal(Buffer.concat(parts).toString(), '{}')
      return json({ uploadId: 'staged', size: 2 })
    }
    const body = JSON.parse(options.body)
    assert.equal(body.uploadId, 'staged')
    if (url.pathname.endsWith('/discardCardUpload')) return json({ removed: true })
    assert.equal(body.replacePath, input.cardPath)
    assert.equal(body.name, 'new.json')
    return json({ card: { updated: true, path: input.cardPath } })
  } })
  assert.equal(result.updated, true)
  assert.deepEqual(routes, ['/pocket-login', '/', '/api/dsh-tavern/getCard', '/api/dsh-tavern/card-upload', '/api/dsh-tavern/importCardUpload', '/api/dsh-tavern/discardCardUpload'])
})
