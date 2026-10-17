import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPluginAssets, parsePluginAssetPath, PLUGIN_ASSET_PREFIX } from '../tavern-plugin/lib/domain/plugin-assets.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'battle-folder')
  await mkdir(path.join(dir, 'assets', 'map'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-tavern-battle' }))
  await writeFile(path.join(dir, 'secret.json'), '{"key":"x"}')
  await writeFile(path.join(dir, 'assets', 'map', 'forest.png'), Buffer.from('0123456789'))
  await writeFile(path.join(dir, 'assets', 'hit.mp3'), Buffer.from('sound'))
  await writeFile(path.join(root, 'outside.txt'), 'outside')
  try { await symlink(path.join(root, 'outside.txt'), path.join(dir, 'assets', 'link.txt')) } catch {}
  return root
}

test('插件资源路径：拒绝越界与隐藏文件，作用域包名占两段', () => {
  assert.deepEqual(parsePluginAssetPath(PLUGIN_ASSET_PREFIX + 'p/map/a.png'), { name: 'p', file: 'map/a.png' })
  assert.deepEqual(parsePluginAssetPath(PLUGIN_ASSET_PREFIX + '@me/p/a.png'), { name: '@me/p', file: 'a.png' })
  for (const bad of ['p/../secret.json', 'p/.env', 'p', 'p/', 'p/a//b.png', 'p/a\\b.png']) assert.equal(parsePluginAssetPath(PLUGIN_ASSET_PREFIX + bad), null, bad)
})

test('插件资源：只提供 assets/ 下的文件，按包名或文件夹名找到插件，经 HTTP 支持 Range 与缓存校验', async t => {
  const pluginsDir = await fixture(t)
  const assets = createPluginAssets({ pluginsDir })
  assert.equal((await assets.read(PLUGIN_ASSET_PREFIX + 'dsh-tavern-battle/map/forest.png')).mediaType, 'image/png')
  assert.equal((await assets.read(PLUGIN_ASSET_PREFIX + 'battle-folder/hit.mp3')).mediaType, 'audio/mpeg')
  assert.equal(await assets.read(PLUGIN_ASSET_PREFIX + 'dsh-tavern-battle/secret.json'), undefined, 'assets/ 外的文件不提供')
  assert.equal(await assets.read(PLUGIN_ASSET_PREFIX + 'dsh-tavern-battle/link.txt'), undefined, '链接不能指到 assets/ 外')
  assert.equal(await assets.read(PLUGIN_ASSET_PREFIX + 'missing/a.png'), undefined)

  const server = createServer()
  let handler
  registerTavernHttpRoutes({ ctx: { get: () => ({ server, register(spec) { if (spec.path === '/api/dsh-tavern') handler = spec.handler; return () => {} } }), effect: fn => fn() },
    dispatch: async () => ({}), str: String, performanceDiagnostics: { http() {} }, runtimeGeneration: 'g', runtimeReadiness: Promise.resolve({ ok: true }), pluginAssets: assets })
  server.on('request', (req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const base = 'http://127.0.0.1:' + server.address().port + PLUGIN_ASSET_PREFIX + 'dsh-tavern-battle/'
  const full = await fetch(base + 'map/forest.png')
  assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789')
  assert.equal(full.headers.get('content-type'), 'image/png')
  const part = await fetch(base + 'map/forest.png', { headers: { Range: 'bytes=2-4' } })
  assert.equal(part.status, 206); assert.equal(await part.text(), '234')
  assert.equal(part.headers.get('content-range'), 'bytes 2-4/10')
  const cached = await fetch(base + 'map/forest.png', { headers: { 'If-None-Match': full.headers.get('etag') } })
  assert.equal(cached.status, 304)
  assert.equal((await fetch(base + 'secret.json')).status, 404)
  assert.equal((await fetch(base + 'map/forest.png', { headers: { Origin: 'https://other.example' } })).status, 200, '跨源的 <img> 也能用')
})
