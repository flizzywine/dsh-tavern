// Reproduce a CLI chat on another origin and decode the real card tool's served PNG in Chromium.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { marked } from 'marked'
import { chromium } from 'playwright'
import { imagePluginFixture, IMAGE_PNG, imageJson } from '../fixtures/image-plugin-runtime.mjs'

const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path)) || chromium.executablePath()
const cleanup = [], tools = new Map()
let registered, origin, runtime, relativePath, html = ''
const ready = new Promise(resolve => { registered = resolve })
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const handler = runtime?.routes.get(path) || [...(runtime?.routes || [])].find(([prefix]) => path.startsWith(prefix + '/'))?.[1]
  if (!handler) { res.writeHead(404); res.end(); return }
  Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500); res.end(error.message) })
})
const ui = createServer((req, res) => {
  if (!['/cli', '/desktop-origin', '/old-relative'].includes(req.url)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><meta charset="utf-8"><title>工作台图片显示检查</title><main>' + (req.url === '/old-relative' ? marked.parse('![图片](' + relativePath + ')') : html) + '</main>')
})
let browser
try {
  const fixture = await imagePluginFixture({ after: fn => cleanup.push(fn) }, {
    webOrigin: () => origin,
    config: { imageBackend: 'openai', activeImageChannel: 'one', imageChannels: [{ id: 'one', name: 'one', provider: 'openai', model: 'user-model', baseUrl: 'https://images.test/v1', authMode: 'none', options: {} }] },
    tools: { register(tool) { tools.set(tool.name, tool); if (tools.size === 5) registered(); return () => tools.delete(tool.name) } },
    tavern: { toolModes() { return () => {} }, skillSource() { return () => {} } },
  })
  runtime = await fixture.start()
  await ready
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => ui.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  globalThis.fetch = async () => imageJson({ data: [{ b64_json: IMAGE_PNG.toString('base64') }] })
  const tool = tools.get('gen_image')
  const result = await tool.execute({ prompt: 'one traveler beside a window' }, { agent: { session: { id: 'cli-card-session' } } })
  assert.equal(new URL(result.images[0].url).origin, origin)
  relativePath = new URL(result.images[0].url).pathname
  html = marked.parse(tool.output.render({}, result).map(block => block.text).join('\n\n'))
  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage(), imageRequests = []
  page.setDefaultTimeout(10000)
  page.on('response', response => { if (response.url().startsWith(origin + '/dsh-tavern-gen/img/')) imageRequests.push(response.status()) })
  const uiOrigin = 'http://localhost:' + ui.address().port
  await page.goto(uiOrigin + '/old-relative')
  await page.waitForFunction(() => { const image = document.querySelector('main img'); return image?.complete && image.naturalWidth === 0 })
  assert.equal(await page.locator('main img').getAttribute('src'), relativePath)
  for (const mode of ['cli', 'desktop-origin']) {
    await page.goto(uiOrigin + '/' + mode)
    await page.waitForFunction(() => { const img = document.querySelector('main img'); return img?.complete && img.naturalWidth === 2 && img.naturalHeight === 2 })
    assert.equal(await page.locator('main img').getAttribute('src'), result.images[0].url)
  }
  assert.ok(imageRequests.length >= 1 && imageRequests.every(status => status === 200))
  const screenshot = join(tmpdir(), 'dsh-image-card-render-fixed.png')
  await page.screenshot({ path: screenshot })
  console.log('PASS Chromium: card tool Markdown carries a full listener URL; CLI and separate-origin views load and decode the actual generated PNG over HTTP')
  console.log('SCREENSHOT ' + screenshot)
} finally {
  await browser?.close()
  for (const instance of [ui, server]) { instance.closeIdleConnections(); await new Promise(resolve => instance.close(resolve)) }
  for (const dispose of cleanup.reverse()) await dispose()
}
