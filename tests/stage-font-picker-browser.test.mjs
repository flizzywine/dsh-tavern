import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createFontLibrary } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-library.js'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { stageClientPage } from './helpers/stage-client-page.mjs'
import { stageThemeCss } from './helpers/stage-theme-css.mjs'

const read = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

test('compact CONFIG font picker reaches and selects the last font in a single column', { timeout: 60000 }, async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'stage-font-picker-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const { fonts } = await createFontLibrary({ dataRoot }).listFonts()
  assert.ok(fonts.length > 1, 'the shipped font catalogue is populated')
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 375, height: 400 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="app"></div>' }))
  await page.goto('http://tavern.test/')
  await page.addStyleTag({ content: await stageThemeCss() })
  const settings = await read('settings-ui.js')
  // Use the actual adapter and catalogue. Font binary downloads are not part of this interaction test.
  await page.addScriptTag({ content: await browserReactScript() + `
const React = window.React = modules.react;
const ReactDOM = window.ReactDOM = {...modules['react-dom'], ...modules['react-dom/client']};
const BUILTIN_STAGE_SKINS = {};
window.dshSkinFonts = { list: async () => ${JSON.stringify(fonts)}, ensure: async () => {} };
` + await read('fonts.js') + '\n' + settings.slice(settings.indexOf('function floatingPanelPlace('), settings.indexOf('function HelpTip(')) + '\n' + stageClientPage() + `
const base = stageHost.options();
const client = stageClient.start({
  sessionInputs: () => stageHost.sessionInputs({native: stageHost.nativeSession().native}),
  options: stageHost.options({
    fontPicker: {...base.fontPicker, FloatingPanel, fonts: tavernFonts},
    configText: {...base.configText, fonts: tavernFonts},
    configScreen: {...base.configScreen, rpc: async () => ({mods: []})},
  }),
});
if (!client.views) throw new Error('stage client did not mount: ' + client.errors.map(row => String(row[1])).join('; '));
ReactDOM.createRoot(document.getElementById('app')).render(React.createElement('div',
  {className: 'fork-gal-stage', 'data-theme': 'classic', style: {position: 'fixed', inset: 0}},
  React.createElement(client.views.configScreen.Screen, {sessionId: 'session', data: {config: {}}, tests: {}, onClose() {}})));
` })
  await page.getByRole('tab', { name: '文字', exact: true }).click()
  const trigger = page.getByRole('button', { name: /^舞台字体：/ })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const panel = page.locator('.fork-font-pop')
  const list = panel.getByRole('listbox', { name: '舞台字体' })
  const options = list.getByRole('option')
  const follow = options.first()
  await options.nth(fonts.length).waitFor()
  assert.equal(await options.count(), fonts.length + 1)
  assert.match(await follow.getAttribute('aria-label'), /^跟随皮肤/)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-selected') === 'true')
  assert.equal(await follow.evaluate(node => node === document.activeElement), true)

  const layout = await panel.evaluate(node => {
    const box = node.getBoundingClientRect()
    const rows = [...node.querySelectorAll('[role="option"]')].map(row => row.getBoundingClientRect())
    return {
      inViewport: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      oneColumn: rows.every((row, i) => row.left === rows[0].left && row.right === rows[0].right && (!i || row.top >= rows[i - 1].bottom)),
      overflows: node.scrollHeight > node.clientHeight,
    }
  })
  assert.deepEqual(layout, { inViewport: true, oneColumn: true, overflows: true })
  const last = options.last()
  const id = await last.getAttribute('data-font-id')
  const name = await last.getAttribute('aria-label')
  assert.ok(fonts.some(font => font.id === id))
  await page.keyboard.press('End')
  // Let captured scroll events run before checking that the focused option stayed in view.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await last.evaluate(node => {
    const row = node.getBoundingClientRect(), panel = node.closest('.fork-font-pop')
    const box = panel.getBoundingClientRect()
    return node === document.activeElement && panel.scrollTop > 0 && row.top >= box.top - 1 && row.bottom <= box.bottom + 1
  }), true, 'End focuses the last font and scrolls it into view')
  await page.keyboard.press('Enter')
  await panel.waitFor({ state: 'detached' })
  assert.equal(await trigger.getAttribute('aria-label'), '舞台字体：' + name)
  assert.equal(await page.evaluate(() => localStorage.getItem('dsh-tavern-font-stage')), id)
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true)

  await page.keyboard.press('ArrowDown')
  const selected = list.locator('[aria-selected="true"]')
  assert.equal(await selected.getAttribute('data-font-id'), id)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-selected') === 'true')
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(errors, [])
})
