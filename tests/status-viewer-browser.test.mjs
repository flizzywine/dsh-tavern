import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import vm from './fixtures/client-vm.mjs' // foreground document fixture
import test from 'node:test'
import { chromium } from 'playwright'
import { readTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

test('第二个 HTTP 浏览器没有脚本执行器时，旧卡 parent.Mvu 状态栏仍显示并跟随变量更新', async t => {
  let descriptor
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { descriptor = value } } }, console
  })
  const client = descriptor.factory(() => ({}))
  const context = hp => ({ stateRevision: hp, messages: [{ message_id: 0, role: 'assistant', message: 'opening', variables: { stat_data: { hp } } }] })
  // The real card polls parent.Mvu even though a local Helper API is present.
  const content = `<output>等待 MVU 数据加载…</output><script>
    function refresh(){const m=parent.Mvu;document.querySelector('output').textContent=m?.getMvuData?String(m.getMvuData({type:'message',message_id:'latest'}).stat_data.hp):'等待 MVU 数据加载…'}
    refresh();setInterval(refresh,50);
  </script>`
  const viewer = client.buildTavernFrameDocument({ token: 'viewer', helperContext: context(10), trustedCardMode: true, persistent: true, preserveInstance: true, content })
  const executor = client.buildTavernHelperScriptDocument({ token: 'executor', context: context(10), trustedCardMode: true,
    scripts: [{ id: 'start', content: 'parent.executorStarts=(parent.executorStarts||0)+1;' }] })
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const asset = await readTavernRuntimeAsset(path)
    if (asset) { res.setHeader('content-type', asset.mediaType); res.end(asset.body); return }
    res.setHeader('content-type', 'text/html')
    res.end(path === '/viewer' ? viewer : path === '/executor' ? executor
      : `<iframe src="${path === '/desktop' ? '/executor' : '/viewer'}"></iframe>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const desktop = await browser.newPage()
  const url = 'http://127.0.0.1:' + server.address().port
  await desktop.goto('http://127.0.0.1:' + server.address().port + '/desktop')
  await desktop.waitForFunction(() => window.executorStarts === 1)
  await desktop.evaluate(() => {
    window.executorMvu = window.Mvu
    const frame = document.createElement('iframe')
    frame.src = '/viewer'
    document.body.appendChild(frame)
  })
  await desktop.frameLocator('iframe[src="/viewer"]').locator('output').waitFor()
  assert.equal(await desktop.evaluate(() => window.Mvu === window.executorMvu), true, '状态栏不能替换已有执行器的 MVU')
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  // Give Chromium an ordinary HTTP origin while keeping the test server local.
  await phone.route('http://tavern-lan.test/**', async route => {
    const target = new URL(route.request().url())
    const response = await route.fetch({ url: url + target.pathname + target.search })
    await route.fulfill({ response })
  })
  await phone.goto('http://tavern-lan.test/')
  assert.equal(await phone.evaluate(() => isSecureContext), false)
  const frame = phone.frames().find(frame => frame.url().endsWith('/viewer'))
  assert.equal(await frame.evaluate(() => window.Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data.hp), 10)
  await frame.waitForFunction(() => document.querySelector('output').textContent === '10', null, { timeout: 3000 })
  const update = client.createTavernHelperContextUpdate(null, context(20), 1, 1)
  await phone.evaluate(update => document.querySelector('iframe').contentWindow.postMessage({ type: 'dsh-tavern-helper-context-update', token: 'viewer', update }, '*'), update)
  await frame.waitForFunction(() => document.querySelector('output').textContent === '20')
  assert.equal(await phone.evaluate(() => window.executorStarts || 0), 0)
  assert.equal(await desktop.evaluate(() => window.executorStarts), 1)
  await phone.evaluate(() => document.querySelector('iframe').remove())
  assert.equal(await phone.evaluate(() => typeof window.Mvu), 'undefined')
})
