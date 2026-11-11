import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { readTavernRuntimeAsset } from '../../tavern-plugin/lib/domain/tavern-runtime-assets.js'

const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const core = `
  window.Mvu = {};
  void (async () => {
    await window.__dshTavernCompanionScriptsReady;
    window.parent.__initializedWith = window.__handlersRegistered;
  })();
`
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'tavern.fixture') return route.abort()
    if (url.pathname === '/client.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: client })
    if (url.pathname === '/mvu.js') return route.fulfill({ contentType: 'text/javascript', body: core })
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      '<!doctype html><script>window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}));}};</script><script src="/client.js"></script>' })
    try {
      const asset = await readTavernRuntimeAsset(url.pathname)
      if (asset) return route.fulfill({ contentType: asset.mediaType, body: asset.body })
    } catch { /* Optional style and font assets can be missing from the fixture. */ }
    return route.fulfill({ status: 404 })
  })
  await page.goto('http://tavern.fixture/')
  await page.evaluate(() => {
    window.__attempts = 0
    window.__initializedWith = null
    window.__states = []
    window.__runtime = client.createTavernHelperScriptRuntime({
      companionTimeoutMs: 1000,
      rpc: async () => ({}),
      onMutation() {},
      reportError() {},
      resolveError() {},
      onMvuLoadState(state) { window.__states.push(state) }
    })
    window.__runtime.sync('fixture', {
      chatId: 'fixture',
      tavernRuntimePolicy: { trustedCardMode: true },
      tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js' },
      tavernHelper: { version: 1, lifecycleRevision: 1, messages: [], chatVariables: { stat_data: {}, schema: {} } },
      tavernHelperScripts: [{ id: 'slow', name: '配套探针', content: `
        if (++parent.__attempts === 1) await new Promise(() => {});
        globalThis.__handlersRegistered = true;
      ` }]
    })
  })
  await page.waitForFunction(() => window.__states.at(-1)?.phase === 'companion-timeout')
  const timeout = await page.evaluate(() => ({
    state: window.__states.at(-1), initialized: window.__initializedWith,
    frameCount: document.querySelectorAll('#dsh-tavern-helper-script-host iframe').length,
    attempts: window.__attempts
  }))
  assert.equal(timeout.initialized, null)
  assert.equal(timeout.frameCount, 0)
  assert.equal(timeout.attempts, 1)
  assert.equal(timeout.state.canRetry, true)
  assert.match(timeout.state.error, /配套探针/)
  assert.equal(await page.evaluate(() => window.__runtime.retryMvuLoad()), true)
  await page.waitForFunction(() => window.__states.at(-1)?.phase === 'ready' && window.__initializedWith === true)
  assert.equal(await page.evaluate(() => window.__attempts), 2)
  console.log('PASS MVU 配套脚本超时停止旧沙箱，手动重试后按注册顺序继续初始化')
} finally {
  await browser.close()
}
