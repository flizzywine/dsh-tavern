import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { chromium } from 'playwright'

// The headless card-script runtime loads this same bundle into jsdom for every
// game. Its module scope used to read the full settings document on sight, so
// every boot paid one pointless round trip (and the sandbox refused it).
async function loadBundle(t, { headless }) {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const calls = []
  await page.route('http://tavern.test/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/api/')) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    calls.push(url.pathname.split('/').at(-1))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings: {} }) })
  })
  await page.goto('http://tavern.test/')
  if (headless) await page.evaluate(() => { window.__dshTavernHeadless = true })
  let harness = await browserReactScript()
  harness += 'window.__ModuleLoader__={load(definition){window.client=definition.factory(name=>name==="react"?modules.react:{});}};'
  await page.addScriptTag({ content: harness })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.waitForTimeout(400)
  return calls
}

test('无头运行时不再在装载时读取整份设置', async t => {
  const headless = await loadBundle(t, { headless: true })
  assert.deepEqual(headless.filter(name => name === 'getTavernSettings'), [])
  const page = await loadBundle(t, { headless: false })
  assert.ok(page.includes('getTavernSettings'), '普通页面仍在装载时读取设置，证明上面的断言不是空过')
})
