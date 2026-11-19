import test from 'node:test'
import { Writable } from 'node:stream'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFontLibrary, FONT_ROUTE } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-library.js'

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
