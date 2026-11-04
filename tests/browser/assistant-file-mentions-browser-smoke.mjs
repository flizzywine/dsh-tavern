// Run explicitly: node tests/browser/assistant-file-mentions-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'
import { assistantRendererHostScript } from '../fixtures/assistant-renderer-host.mjs'

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><div id="reply"></div>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `const React = modules.react;
${await assistantRendererHostScript()}
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = {failed: false}; }
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? React.createElement('div', {id: 'native-fallback'}, 'Native raw reply') : this.props.children; }
}
const root = modules['react-dom/client'].createRoot(document.getElementById('reply'));
window.showReply = mode => root.render(React.createElement(Boundary, {key: mode}, React.createElement('section', {'data-case': mode}, assistantHost.element(mode))));` })
  for (const [mode, expected] of [['fallback', 'fallback mentions'], ['legacy', 'legacy mentions'], ['missing', undefined], ['unrouted', undefined]]) {
    await page.evaluate(mode => window.showReply(mode), mode)
    await page.waitForFunction(({mode, expected}) => document.querySelector('[data-case]')?.getAttribute('data-case') === mode
      && document.querySelector('.dsh-tavern-assistant')?.textContent === 'Tavern reply'
      && assistantHost.mentions() === expected, {mode, expected})
    assert.equal(await page.locator('#native-fallback').count(), 0)
  }
  const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  await page.addStyleTag({ content: '.host_tabs {display:flex;align-items:flex-start;height:48px}.tab {height:48px}.host_viewsMore {height:24px;margin-top:-3px}' })
  await page.addStyleTag({ content: css })
  await page.evaluate(() => {
    document.body.classList.add('dsh-tavern-shell-active')
    document.body.insertAdjacentHTML('beforeend', '<div class="host_tabs"><span class="tab">对话</span><span class="host_viewsMoreAnchor"><button class="host_viewsMore">⋯</button></span></div>')
  })
  const offset = await page.locator('.host_viewsMore').evaluate(button => {
    const row = button.closest('.host_tabs').getBoundingClientRect(), box = button.getBoundingClientRect()
    return Math.abs((box.top + box.bottom) / 2 - (row.top + row.bottom) / 2)
  })
  assert.ok(offset <= 1, `More views button center differs by ${offset}px`)
  assert.deepEqual(errors, [])
  console.log('PASS Chrome: closed-turn registration, fallback mentions, legacy precedence, missing service and centered view button')
} finally {
  await browser.close()
}
