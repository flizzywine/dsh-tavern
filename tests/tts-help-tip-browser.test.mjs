// The 配音 page's 「?」 inside Tavern is Tavern's HelpTip: a 「?」 near the left edge of the narrow right sidebar
// (overflow hidden) opens its text fully inside the viewport, never cut by the sidebar or any clipping ancestor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')

const mock = `(() => {
  const ok = value => ({ ok: true, json: async () => structuredClone(value) })
  window.fetch = async (url, options = {}) => {
    const { method } = JSON.parse(options.body || '{}')
    if (method === 'services') return ok({ configured: [], running: [] })
    if (method === 'reading') return ok({ dialogueVoice: null, narrator: { enabled: false, voice: null } })
    if (method === 'voicePresets') return ok([])
    if (method === 'cache') return ok({ bytes: 0, count: 0, maxBytes: 1024 ** 3, maxAgeDays: 30 })
    return ok({})
  }
  window.EventSource = class { constructor() { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ enabled: true }) }), 0) } close() {} }
})()`

const boot = `(() => {
  const services = new Map(), tabs = new Map()
  services.set('tavernPresentation', { getHelpTip: () => HelpTip })
  services.set('betterSidebar', { registerTab(tab) { tabs.set(tab.id, tab); return () => tabs.delete(tab.id) }, openTab() {} })
  const ctx = { provide(key, value) { services.set(key, value); return () => services.delete(key) }, get: key => services.get(key), effect: fn => fn(),
    inject(keys, fn) { if (keys.every(key => services.has(key))) fn(ctx) }, slots: { inject() {}, register() { return () => {} } } }
  for (const m of window.__modules) m.apply(ctx)
  modules['react-dom/client'].createRoot(document.getElementById('panel')).render(React.createElement(tabs.get('dsh-tts:voice').component))
})()`

test('the 配音 page 「?」 at the sidebar left edge opens its whole text inside the viewport', { timeout: 60000 }, async () => {
  const [react, theme, settings, tts] = await Promise.all([browserReactScript(), read('lib/client-assets/theme.css'), read('src/client/settings-ui.js'), read('packages/dsh-tavern-tts/lib/client.js')])
  const browser = await chromium.launch()
  try {
    for (const [width, panel] of [[1920, 380], [1280, 320]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent('<!doctype html><html><body style="margin:0"><main style="position:fixed;inset:0 ' + panel + 'px 0 0"></main>' +
        '<aside style="position:fixed;top:0;right:0;bottom:0;width:' + panel + 'px;overflow:hidden"><div id="panel" style="height:100%;overflow:auto"></div></aside></body></html>')
      await page.addStyleTag({ content: theme })
      await page.addScriptTag({ content: react + ';window.React=modules.react;window.ReactDOM=modules["react-dom"];' +
        'window.__modules=[];window.__ModuleLoader__={load:m=>window.__modules.push(m.factory(()=>modules.react))};\n' + settings + '\n;window.HelpTip=HelpTip;' })
      await page.addScriptTag({ content: mock })
      await page.addScriptTag({ content: tts })
      await page.addScriptTag({ content: boot })
      const help = page.getByRole('button', { name: '朗读 说明' })
      await help.click()
      const tip = page.locator('.fork-popover.fork-help-tip-body')
      await tip.waitFor()
      assert.match(await tip.textContent(), /正文的 🔊 和舞台按这里的声音朗读/)
      const geometry = await tip.evaluate(node => {
        node.style.pointerEvents = 'auto' // the tip ignores the pointer; let the hit probe see it
        const rect = node.getBoundingClientRect(), clipped = []
        for (let parent = node.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflow === 'visible') continue
          const box = parent.getBoundingClientRect()
          if (rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom) clipped.push(parent.tagName)
        }
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, clipped,
          hit: node.contains(document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2)) }
      })
      const label = width + 'px: ' + JSON.stringify(geometry)
      assert.ok(geometry.left >= 8 && geometry.right <= width - 8 && geometry.top >= 8 && geometry.bottom <= 900 - 8, 'inside the viewport with an 8 px margin — ' + label)
      assert.ok(geometry.width <= 300, 'width is capped — ' + label)
      assert.deepEqual(geometry.clipped, [], 'no clipping ancestor — ' + label)
      assert.ok(geometry.hit, 'its left edge is visible on top — ' + label)
      await page.close()
    }
  } finally { await browser.close() }
})
