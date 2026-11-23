import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { chromium } from 'playwright'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { projectAgentContent, projectOpeningCommit, projectOpeningPreview, projectRuntimeReply } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { browserReactScript } from './fixtures/browser-react.mjs'

const rule = (findRegex, replaceString) => ({ findRegex, replaceString, placement: [2], markdownOnly: true })

test('the picker preserves explicit blank alternates without promoting missing or whitespace entries', async () => {
  const { cardOpeningChoices, cardOpeningSwipes, resolveCardOpening } = await import('../tavern-plugin/lib/domain/card-openings.js')
  const card = { first_mes: 'Existing opening', alternate_greetings: ['Another opening', '', null, '  '] }
  assert.deepEqual(cardOpeningChoices(card).map(row => row.id), ['primary', 'alternate:0', 'alternate:1'])
  assert.equal(resolveCardOpening(card, 'alternate:1'), '')
  assert.throws(() => resolveCardOpening(card, 'alternate:2'))
  assert.equal(cardOpeningSwipes(card).openingIds[2], 'alternate:1')
  const preview = await projectCardOpeningPreviews({ card })
  assert.equal(preview.openings.length, 3)
  assert.equal(preview.openings[2].id, 'alternate:1')
  assert.equal(preview.openings[2].text, '')
  assert.deepEqual(preview.openings[2].projection.parts, [])
})

test('native swipe chooser receives opening bridge metadata without treating prose as a chooser', async () => {
  const card = { name: '选择台', first_mes: '<script>const ctx=SillyTavern.getContext();ctx.swipe.to(null,"right",{forceMesId:0,forceSwipeId:1});</script>', alternate_greetings: ['目标开场'] }
  const result = await projectCardOpeningPreviews({ card })
  assert.ok(result.openings[0].openingPreview)
  assert.equal(result.openings[0].openingPreview.openingIds[1], 'alternate:0')
  const prose = await projectCardOpeningPreviews({ card: { first_mes: 'He swiped his card. The character_menu appeared and he decided to jump.' } })
  assert.equal(prose.openings[0].openingPreview, null)
})

test('legacy angle-bracket names agree in preview, committed opening and display refresh without changing card source', async () => {
  const {projectReplyLayers} = await import('../tavern-plugin/lib/domain/reply-presentation.js')
  const source = '```start\n<user> visits <char>.\n```'
  const card = {name:'Host',first_mes:source}
  const options = {charName:card.name,macroState:{userName:'Guest'}}
  const preview = await projectCardOpeningPreviews({card,userName:'Guest'})
  assert.match(preview.openings[0].text,/Guest visits Host/)
  assert.equal(projectOpeningCommit(source,options).bodyText,preview.openings[0].text)
  assert.equal(projectReplyLayers(source,options).displayText,preview.openings[0].text)
  assert.equal(card.first_mes,source)
  assert.equal(projectReplyLayers('<user-card>unchanged</user-card>',options).displayText,'<user-card>unchanged</user-card>')
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

test('chained rules render the same button beside story text in previews, committed openings, and later replies', async () => {
  const source = '你推开门。\n[UI]'
  const regexScripts = [
    rule('\\[UI\\]', '<button>准备</button>'),
    rule('准备', '开始')
  ]
  const preview = await projectCardOpeningPreviews({ card: { first_mes: source }, extensions: { regexScripts } })
  const opening = projectOpeningCommit(source, { regexScripts, regexPlacement: 2 })
  const reply = projectRuntimeReply(source, { regexScripts, placement: 2, depth: 1 })
  const expected = [
    { kind: 'markdown', text: '你推开门。\n' },
    { kind: 'html', content: '<button>开始</button>' }
  ]
  assert.deepEqual(preview.openings[0].projection.parts, expected)
  assert.deepEqual(opening.displayParts, expected)
  assert.deepEqual(reply.displayParts, expected)
})

test('committing an HTML opening preserves nested JavaScript state and resolves Tavern macros', () => {
  const script = '<script>const state = {"player":{"name":"{{user}}"}};</script>\n'
  const source = '{{unsupported}}\n```html\n' + script + '```'
  const result = projectOpeningCommit(source, { macroState: { userName: '玩家' } })
  assert.equal(result.sessionText, source.replace('{{user}}', '玩家'))
  assert.deepEqual(result.displayParts, [
    { kind: 'markdown', text: '{{unsupported}}\n' },
    { kind: 'html', content: script.replace('{{user}}', '玩家') }
  ])
})

test('opening preview, save and history preserve code blocks and template braces', () => {
  const script = 'if (true) {{ const value = 1; globalThis.result = value; }}'
  const html = '<div v-if="ready">{{ count }}</div><script>' + script + '</script>'
  const card = '<section>' + html + '</section>'
  for (const render of [projectOpeningPreview, projectOpeningCommit]) {
    const result = render(card)
    assert.equal(result.sessionText, card)
    assert.equal(result.displayParts[0].content, card)
    const source = result.displayParts[0].content.match(/<script>([\s\S]*?)<\/script>/)[1]
    const sandbox = {}
    vm.runInNewContext(source, sandbox)
    assert.equal(sandbox.result, 1)
    assert.deepEqual(projectRuntimeReply(result.renderedText).displayParts, result.displayParts)
  }
  const worldbookExample = '```js\n' + script + '\n```'
  assert.equal(projectAgentContent(worldbookExample).agentText, worldbookExample)
})

test('opening names are encoded for HTML and inline JavaScript literals in both paths', () => {
  const source = '<section><p title="{{user}}">{{user}}</p>'
    + '<script>globalThis.names = ["{{user}}", \'<user>\', `{{user}}`, {{user}}];</script></section>'
  const userName = 'Alex "Ace" & O\'Neil `name`'
  for (const render of [projectOpeningPreview, projectOpeningCommit]) {
    const result = render(source, { macroState: { userName } })
    const html = result.displayParts[0].content
    assert.match(html, /<p title="Alex &quot;Ace&quot; &amp; O&#39;Neil `name`">Alex &quot;Ace&quot; &amp; O&#39;Neil `name`<\/p>/)
    const sandbox = {}
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox)
    assert.deepEqual(Array.from(sandbox.names), Array(4).fill(userName))
    assert.equal(result.macroState.userName, userName)
  }
})

test('a fenced status panel keeps its own frame beside an HTML opening', async () => {
  const opening = '<div>开场说明</div>\n'
  const status = '<div>状态栏</div>\n'
  const result = await projectCardOpeningPreviews({
    card: { first_mes: opening + '<mvu-status/>' },
    extensions: { regexScripts: [rule('<mvu-status\\s*/>', '```html\n' + status + '```')] }
  })
  assert.deepEqual(result.openings[0].projection.parts, [
    { kind: 'html', content: opening },
    { kind: 'html', content: status }
  ])
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
