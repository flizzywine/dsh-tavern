import test from 'node:test'
import { Writable } from 'node:stream'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFontLibrary, FONT_ROUTE } from '../tavern-plugin/lib/font-library.js'

// The font library (font-library.js): the families a skin's font ids name, the shipped ones and an installed one.
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-fonts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'fonts', 'example')
  await mkdir(dir, { recursive: true })
  const file = '400-0123456789abcdef.woff2'
  const manifest = { id: 'example', label: '示例', family: 'Tavern example', category: 'sans', weights: [400], files: [{ weight: 400, style: 'normal', file, format: 'woff2' }], license: 'SIL OFL 1.1', source: 'https://example.test/font', coverage: { subset: false } }
  await writeFile(path.join(dir, 'index.json'), JSON.stringify(manifest))
  await writeFile(path.join(dir, file), 'wOF2-0123456789')
  const api = createFontLibrary({ dataRoot: root, bundledRoot: null })
  const url = FONT_ROUTE + 'example/' + file
  async function request(urlValue = url, headers = {}, method = 'GET', library = api) {
    const result = {}
    const chunks = [], response = new Writable({ write(chunk, _, done) { chunks.push(chunk); done() } })
    response.writeHead = (status, headers) => { Object.assign(result, { status, headers }); response.headersSent = true }
    result.handled = await library.serve({ url: urlValue, headers, method }, response)
    result.body = chunks.length ? Buffer.concat(chunks) : undefined
    return result
  }
  return { root, dir, manifest, api, url, request }
}

test('font library: the catalog lists each family with its files; a broken folder hides only itself', async t => {
  const f = await fixture(t)
  const { fonts } = await f.api.listFonts()
  assert.equal(fonts.length, 1)
  assert.deepEqual(fonts[0], { id: 'example', label: '示例', family: 'Tavern example', category: 'sans', weights: [400],
    files: [{ weight: 400, style: 'normal', file: f.manifest.files[0].file, format: 'woff2', bytes: 15, url: f.url }], url: f.url,
    license: 'SIL OFL 1.1', source: 'https://example.test/font', coverage: { subset: false } })
  assert.deepEqual(await createFontLibrary({ dataRoot: path.join(f.root, 'missing'), bundledRoot: null }).listFonts(), { fonts: [] })
  await mkdir(path.join(f.root, 'fonts', 'broken'))
  await writeFile(path.join(f.root, 'fonts', 'broken', 'index.json'), 'broken')
  assert.equal((await f.api.listFonts()).fonts.length, 1)
  await writeFile(path.join(f.dir, 'index.json'), JSON.stringify({ ...f.manifest, family: 'evil";}' }))
  assert.equal((await f.api.listFonts()).fonts.length, 0, 'a family name that is not a plain name is never listed')
})

test('font library: the plugin ships its open-source families; an installed family of the same id replaces one whole', async t => {
  const f = await fixture(t), api = createFontLibrary({ dataRoot: f.root })
  const shipped = Object.fromEntries((await api.listFonts()).fonts.map(font => [font.id, font]))
  assert.deepEqual(Object.keys(shipped).sort(), ['example', 'neo-xihei-screen', 'neo-zhisong-screen', 'noto-sans-sc', 'noto-serif-sc', 'resource-han-rounded'])
  for (const id of ['noto-sans-sc', 'noto-serif-sc', 'resource-han-rounded']) assert.deepEqual([shipped[id].license, shipped[id].weights], ['SIL OFL 1.1', [400, 500, 700]], id)
  for (const id of ['neo-xihei-screen', 'neo-zhisong-screen']) {
    assert.deepEqual([shipped[id].license, shipped[id].weights, shipped[id].files[0].format], ['IPA Font License 1.0', [400], 'truetype'], id)
    const head = await f.request(shipped[id].files[0].url, {}, 'HEAD', api)
    assert.deepEqual([head.status, head.headers['Content-Type']], [200, 'font/ttf'])
  }
  const partial = await f.request(shipped['neo-xihei-screen'].files[0].url, { range: 'bytes=0-3' }, 'GET', api)
  assert.deepEqual([partial.status, [...partial.body]], [206, [0, 1, 0, 0]])
  const local = path.join(f.root, 'fonts', 'noto-serif-sc')
  await mkdir(local)
  await writeFile(path.join(local, 'index.json'), JSON.stringify({ ...f.manifest, id: 'noto-serif-sc', label: '本机安装' }))
  await writeFile(path.join(local, f.manifest.files[0].file), 'wOF2-local')
  const installed = (await api.listFonts()).fonts.find(font => font.id === 'noto-serif-sc')
  assert.deepEqual([installed.label, installed.weights], ['本机安装', [400]])
})

test('font library: WOFF2 type, immutable cache, HEAD, ETag and Range', async t => {
  const { request, url } = await fixture(t)
  const full = await request()
  assert.equal(full.status, 200)
  assert.equal(full.headers['Content-Type'], 'font/woff2')
  assert.equal(full.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(full.headers['Cache-Control'], /max-age=31536000, immutable/)
  assert.equal(full.body.toString(), 'wOF2-0123456789')
  const head = await request(url, {}, 'HEAD')
  assert.deepEqual([head.status, head.body, head.headers['Content-Length']], [200, undefined, 15])
  assert.equal((await request(url, { 'if-none-match': full.headers.ETag })).status, 304)
  for (const [range, body, contentRange] of [['bytes=0-3', 'wOF2', 'bytes 0-3/15'], ['bytes=-3', '789', 'bytes 12-14/15'], ['bytes=13-', '89', 'bytes 13-14/15']]) {
    const partial = await request(url, { range })
    assert.deepEqual([partial.status, partial.body.toString(), partial.headers['Content-Range']], [206, body, contentRange], range)
  }
  for (const range of ['bytes=50-', 'bytes=4-1', 'bytes=-0', 'bytes=0-1,3-4', 'nonsense']) assert.equal((await request(url, { range })).status, 416, range)
  assert.equal((await request(url, { range: 'bytes=0-3', 'if-range': 'stale' })).status, 200)
  assert.equal((await request(url, {}, 'POST')).status, 405)
})

test('font library: original TrueType and OpenType faces retain their format and MIME', async t => {
  const f = await fixture(t)
  for (const [extension, format, mime] of [['ttf', 'truetype', 'font/ttf'], ['otf', 'opentype', 'font/otf']]) {
    const file = 'original.' + extension
    await writeFile(path.join(f.dir, file), 'original-font')
    await writeFile(path.join(f.dir, 'index.json'), JSON.stringify({ ...f.manifest, files: [{ weight: 400, style: 'normal', file, format }] }))
    const font = (await f.api.listFonts()).fonts[0]
    assert.equal(font.files[0].format, format)
    const response = await f.request(font.files[0].url)
    assert.deepEqual([response.status, response.headers['Content-Type'], response.body.toString()], [200, mime, 'original-font'])
  }
})

test('font library: only a listed file inside the library is served', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.dir, 'extra.woff2'), 'not listed')
  for (const suffix of ['../secret.woff2', 'example/../secret.woff2', 'example/%2e%2e%2fsecret.woff2', 'example/%5csecret.woff2', 'example/C:%5csecret.woff2', 'example/index.json', 'example/extra.woff2', 'example/file.woff2%00', 'example/%ZZ']) {
    const response = await f.request(FONT_ROUTE + suffix)
    assert.deepEqual([response.handled, response.status], [true, 404], suffix)
  }
  assert.equal((await f.request('/unrelated')).handled, false)
  // A family folder that links outside the library is neither listed nor served.
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'index.json'), JSON.stringify({ ...f.manifest, id: 'escape' }))
  await writeFile(path.join(outside, f.manifest.files[0].file), 'secret')
  await symlink(outside, path.join(f.root, 'fonts', 'escape'), 'junction')
  assert.equal((await f.request(FONT_ROUTE + 'escape/' + f.manifest.files[0].file)).status, 404)
  assert.equal((await f.api.listFonts()).fonts.length, 1)
})
