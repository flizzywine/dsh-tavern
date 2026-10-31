import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { FONT_CATALOG, createFontAssets, adoptBundledFonts } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-assets.js'
import { createFontLibrary } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-library.js'
const family = FONT_CATALOG.families[0], face = family.files[0]
const bundle = new URL('../tavern-plugin/packages/dsh-dream-skin/fonts/', import.meta.url).pathname
async function fixture(t, handler) {
  const root = await mkdtemp(path.join(tmpdir(), 'font-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = await readFile(path.join(bundle, family.id, face.file))
  let calls = 0
  const server = http.createServer((req, res) => { calls++; (handler || ((q, r) => r.end(bytes)))(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const fetchImpl = (url, options) => {
    assert.match(url, /^https:\/\/(cdn.jsdelivr.net|raw.githubusercontent.com)\//)
    assert.ok(url.includes(FONT_CATALOG.revision))
    assert.equal(options.redirect, 'error')
    return fetch(`http://127.0.0.1:${server.address().port}/font`, options).then(response => ({ ok: response.ok, redirected: response.redirected, headers: response.headers, body: response.body }))
  }
  return { root, bytes, calls: () => calls, api: createFontAssets({ dataRoot: root, bundledRoots: [], fetchImpl }) }
}
test('lazy fonts: oversized, hash-invalid and redirect payloads never enter cache; retries bounded with cooldown', async t => {
  for (const mode of ['oversize', 'hash', 'redirect']) {
    const f = await fixture(t, (req, res) => {
      if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' }); res.end(); return }
      res.end(Buffer.alloc(face.bytes + (mode === 'oversize' ? 1 : 0)))
    })
    await assert.rejects(f.api.ensure(family.id, face.file))
    assert.equal(f.calls(), 2)
    await assert.rejects(f.api.ensure(family.id, face.file)); assert.equal(f.calls(), 2)
    assert.deepEqual(await readdir(path.join(f.root, 'cache/fonts')), [])
  }
})
test('lazy fonts: adoption validates old bundle, keeps originals, rejects unknown files and escaped cache', async t => {
  const f = await fixture(t)
  const count = await adoptBundledFonts({ dataRoot: f.root, bundledRoots: [bundle] })
  assert.equal(count, 11)
  assert.deepEqual(await readFile(path.join(bundle, family.id, face.file)), f.bytes)
  assert.equal(f.calls(), 0)
  await assert.rejects(f.api.ensure('../escape', face.file))
  await assert.rejects(f.api.ensure(family.id, '../' + face.file))
  const other = await mkdtemp(path.join(tmpdir(), 'font-outside-'))
  t.after(() => rm(other, { recursive: true, force: true }))
  const bad = path.join(f.root, 'bad'); await mkdir(bad)
  await symlink(other, path.join(bad, 'cache'), 'junction')
  await assert.rejects(createFontAssets({ dataRoot: bad, bundledRoots: [] }).ensure(family.id, face.file), /escapes/)
})
test('lazy fonts: network concurrency is capped at two across distinct faces', async t => {
  const f = await fixture(t)
  let active = 0, peak = 0, calls = 0
  const assets = createFontAssets({ dataRoot: f.root, bundledRoots: [], fetchImpl: async (url) => {
    calls++; active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 30))
    active--
    const item = FONT_CATALOG.families.find(item => url.includes('/' + item.id + '/'))
    const asset = item.files.find(face => url.endsWith('/' + face.file))
    return new Response(await readFile(path.join(bundle, item.id, asset.file)))
  } })
  const requests = FONT_CATALOG.families.flatMap(item => item.files.map(face => [item.id, face.file])).slice(0, 5)
  await Promise.all(requests.map(args => assets.ensure(...args)))
  assert.equal(peak, 2); assert.equal(calls, 5)
})
test('lazy fonts: trusted download failure returns no-store 503; installed URLs cannot initiate fetch', async t => {
  const f = await fixture(t)
  let calls = 0
  const library = createFontLibrary({ dataRoot: f.root, bundledRoot: path.join(f.root, 'absent'), fetchImpl: async () => { calls++; throw Error('offline') } })
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end() {} }
  await library.serve({ method: 'GET', url: '/dream-skin/fonts/' + family.id + '/' + face.file }, response)
  assert.equal(response.status, 503); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.equal(calls, 2)
  const dir = path.join(f.root, 'fonts', family.id); await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ ...family, files: [{ ...face, url: 'http://127.0.0.1/secret' }] }))
  await library.serve({ method: 'GET', url: '/dream-skin/fonts/' + family.id + '/' + face.file }, response)
  assert.equal(response.status, 404); assert.equal(calls, 2)
})
test('lazy fonts: stalled response body times out and leaves no partial cached face', { timeout: 30_000 }, async t => {
  const f = await fixture(t, (req, res) => { res.write(Buffer.from('unfinished-font')) })
  const started = Date.now()
  await assert.rejects(f.api.ensure(family.id, face.file))
  assert.equal(f.calls(), 2)
  assert.ok(Date.now() - started < 29_000)
  assert.deepEqual(await readdir(path.join(f.root, 'cache/fonts')), [])
})
