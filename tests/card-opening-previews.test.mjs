import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { projectOpeningCommit, projectRuntimeReply } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { browserReactScript } from './fixtures/browser-react.mjs'

const rule = (findRegex, replaceString) => ({ findRegex, replaceString, placement: [2], markdownOnly: true })

test('native swipe chooser receives opening bridge metadata without treating prose as a chooser', async () => {
  const card = { name: '选择台', first_mes: '<script>const ctx=SillyTavern.getContext();ctx.swipe.to(null,"right",{forceMesId:0,forceSwipeId:1});</script>', alternate_greetings: ['目标开场'] }
  const result = await projectCardOpeningPreviews({ card })
  assert.ok(result.openings[0].openingPreview)
  assert.equal(result.openings[0].openingPreview.openingIds[1], 'alternate:0')
  const prose = await projectCardOpeningPreviews({ card: { first_mes: 'He swiped his card. The character_menu appeared and he decided to jump.' } })
  assert.equal(prose.openings[0].openingPreview, null)
})

test('whole-message HTML replacements keep chained rules in previews, committed openings, and later replies', async () => {
  const source = '[DEMO_OPENING]'
  const html = '<button>开始游戏</button>\n'
  const regexScripts = [
    rule('^\\[DEMO_OPENING\\]$', '```html\n<button>准备游戏</button>\n```'),
    rule('准备游戏', '开始游戏')
  ]
  const preview = await projectCardOpeningPreviews({ card: { first_mes: source }, extensions: { regexScripts } })
  const opening = projectOpeningCommit(source, { regexScripts, regexPlacement: 2 })
  const reply = projectRuntimeReply(source, { regexScripts, placement: 2, depth: 1 })
  const expected = [{ kind: 'html', content: html }]
  assert.deepEqual(preview.openings[0].projection.parts, expected)
  assert.deepEqual(opening.displayParts, expected)
  assert.deepEqual(reply.displayParts, expected)
  assert.equal(opening.sessionText, source)
  assert.equal(reply.sessionText, source)
})

test('a whole-opening display replacement renders an interactive iframe', { timeout: 15000 }, async t => {
  const result = await projectCardOpeningPreviews({
    card: { first_mes: '[DEMO_OPENING]' },
    extensions: { regexScripts: [rule('^\\[DEMO_OPENING\\]$', '<button onclick="this.textContent=\'已开始\'">开始游戏</button>')] }
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    : route.fulfill({ status: 204 }))
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(projection => {
    modules['react-dom/client'].createRoot(document.querySelector('main')).render(
      client.renderTavernProjection(projection, { turn: 1, trustedCardMode: true })
    )
  }, result.openings[0].projection)
  const frame = page.frameLocator('iframe.dsh-tavern-message-frame')
  await frame.getByRole('button', { name: '开始游戏' }).click({ timeout: 5000 })
  await frame.getByRole('button', { name: '已开始' }).waitFor({ timeout: 5000 })
})
