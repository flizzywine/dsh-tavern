// The shared 「?」 HelpTip: hover opens it, a click pins it (the pointer may leave), a click while pinned,
// Esc or a click outside closes it; a touch tap opens it; keyboard focus opens it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')

async function mount(browser, options = {}) {
  const [react, theme, settings] = await Promise.all([browserReactScript(), read('lib/client-assets/theme.css'), read('src/client/settings-ui.js')])
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, ...options })
  await page.setContent('<!doctype html><html><body style="margin:40px"><button id="before">前</button> <span id="root"></span> <p id="away" style="margin-top:300px">别处</p></body></html>')
  await page.addStyleTag({ content: theme })
  await page.addScriptTag({ content: react + ';window.React=modules.react;window.ReactDOM=modules["react-dom"];\n' + settings + '\n;' +
    'modules["react-dom/client"].createRoot(document.getElementById("root")).render(React.createElement(HelpTip,{label:"朗读 说明"},"正文按这里的声音朗读。"));' })
  return page
}

const tip = page => page.locator('.fork-popover.fork-help-tip-body')

test('HelpTip: hover opens, click pins, click again / Esc / outside click close', { timeout: 60000 }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await mount(browser)
    const help = page.getByRole('button', { name: '朗读 说明' })
    await help.hover()
    await tip(page).waitFor()
    await page.mouse.move(700, 20)
    await tip(page).waitFor({ state: 'detached' })

    await help.click() // hover then click: stays open, even after the pointer leaves
    await page.mouse.move(700, 20)
    await page.waitForTimeout(300)
    assert.equal(await tip(page).count(), 1, 'a click pins the tip open')
    assert.match(await tip(page).textContent(), /正文按这里的声音朗读/)
    await help.click()
    await tip(page).waitFor({ state: 'detached' })

    await help.click()
    await page.keyboard.press('Escape')
    await tip(page).waitFor({ state: 'detached' })
    await page.mouse.move(700, 20)
    await help.click() // Esc unpinned it: a fresh click pins again
    await page.waitForTimeout(100)
    assert.equal(await tip(page).count(), 1)
    await page.click('#away')
    await tip(page).waitFor({ state: 'detached' })

    await page.focus('#before')
    await page.keyboard.press('Tab')
    await tip(page).waitFor()
    await page.keyboard.press('Escape')
    await tip(page).waitFor({ state: 'detached' })
    await page.close()
  } finally { await browser.close() }
})

test('HelpTip: a touch tap opens it, a tap outside closes it', { timeout: 60000 }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await mount(browser, { hasTouch: true, isMobile: true })
    await page.getByRole('button', { name: '朗读 说明' }).tap()
    await page.waitForTimeout(200)
    assert.equal(await tip(page).count(), 1, 'a tap opens the tip')
    await page.tap('#away')
    await tip(page).waitFor({ state: 'detached' })
    await page.close()
  } finally { await browser.close() }
})
