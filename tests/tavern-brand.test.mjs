import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

test('运行窗口图标与正式应用 SVG 一致，并实际打包到前端', async () => {
  const root = new URL('../', import.meta.url)
  const icon = await readFile(new URL('docs/assets/brand/dsh-tavern-app-icon.svg', root), 'utf8')
  const logo = await readFile(new URL('tavern-plugin/lib/client-assets/logo.svg', root), 'utf8')
  assert.equal(logo.replace(/\r\n/g, '\n'), icon.replace(/\r\n/g, '\n'))
  const url = 'data:image/svg+xml,' + encodeURIComponent(logo.replace(/\r\n/g, '\n').replace(/\s*\n\s*/g, ''))
  const bundle = await readFile(new URL('tavern-plugin/lib/client.js', root), 'utf8')
  assert.ok(bundle.includes(JSON.stringify(url)), '正式 Logo 必须进入实际加载的前端脚本')
  const source = await readFile(new URL('tavern-plugin/src/client/brand.js', root), 'utf8')
  const install = vm.runInNewContext(source + '\ninstallTavernBrand')
  const dom = new JSDOM('<head><title>DeepSeek Harness</title><link rel="icon" href="/favicon.svg"></head>')
  const dispose = install(dom.window.document, { logo: url, lockup: '', 'lockup-dark': '' })
  const links = dom.window.document.querySelectorAll('link[rel="icon"]')
  assert.equal(links[links.length - 1].href, url)
  dispose()
  assert.equal(dom.window.document.querySelectorAll('link[rel="icon"]').length, 1)
  dom.window.close()
})
