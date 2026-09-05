import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { readTavernClientAsset, TAVERN_CLIENT_ASSET_PREFIX } from '../tavern-plugin/lib/domain/tavern-client-assets.js'

test('Tavern 客户端样式作为独立本地资源提供', async () => {
  assert.equal(TAVERN_CLIENT_ASSET_PREFIX, '/api/dsh-tavern/client-assets/')
  const asset = await readTavernClientAsset('/api/dsh-tavern/client-assets/tavern.css')
  assert.equal(asset.mediaType, 'text/css; charset=utf-8')
  assert.match(asset.body.toString('utf8'), /\.dsh-tavern-sidebar/)
  assert.match(asset.body.toString('utf8'), /@keyframes dsh-tavern-pulse/)
})

test('Web 宿主只装载样式模块，不再内嵌整份 CSS', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const appended = []
  const document = {
    querySelector() { return null },
    createElement(name) { return { name, dataset: {} } },
    head: { appendChild(node) { appended.push(node) } }
  }
  let descriptor
  vm.runInNewContext(source, { document, window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  descriptor.factory(() => ({}))
  assert.equal(appended.length, 1)
  assert.deepEqual(appended[0], {
    name: 'link', rel: 'stylesheet',
    dataset: { plugin: 'dsh-tavern-plugin', pluginCss: 'dsh-tavern-plugin/tavern.css' },
    href: '/api/dsh-tavern/client-assets/tavern.css'
  })
  assert.doesNotMatch(source, /const TAVERN_CSS\s*=\s*`/)
})
