import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

const notices = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/notices.cjs', import.meta.url), 'utf8')

test('stage voice notices stay quiet for healthy synthesis and expire after a result', async () => {
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({content:await browserReactScript()})
    await page.addScriptTag({content: notices + `
      const React = modules.react, ReactDOM = modules['react-dom'];
      const views = createStageNotices({React, foreground:window});
      const root = modules['react-dom/client'].createRoot(document.getElementById('root'));
      function Probe({source}) {
        return React.createElement('span', {id:'phase'}, views.useVoiceStatus(source) || 'none');
      }
      window.showVoice = source => ReactDOM.flushSync(() => root.render(React.createElement(Probe, {source})));
      window.voicePhase = () => document.getElementById('phase').textContent;
    `})
    await page.evaluate(() => window.showVoice({key:'line', state:'loading'}))
    assert.equal(await page.evaluate(() => window.voicePhase()), 'none')
    await page.waitForFunction(() => window.voicePhase() === 'working', null, {timeout:1000})
    await page.waitForFunction(() => window.voicePhase() === 'slow', null, {timeout:2000})
    for (const [state, failed, phase] of [['text', false, 'text-slow'], ['text', true, 'text-failed'], ['error', false, 'failed']]) {
      await page.evaluate(source => window.showVoice(source), {key:'reply', state, failed})
      assert.equal(await page.evaluate(() => window.voicePhase()), phase)
    }
    await page.waitForFunction(() => window.voicePhase() === 'none', null, {timeout:5000})
    await page.evaluate(() => window.showVoice(null))
    assert.equal(await page.evaluate(() => window.voicePhase()), 'none')
  } finally { await browser.close() }
})
