// The stage's backlog (履历): its rows (modules/stage-backlog.js), the stage's wheel and the virtual list drawn by
// features/stage-backlog.js, the last on real React in headless Chromium.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const { stageBacklogEntries, stageBacklogWindow, stageWheelDecision } = vm.runInNewContext(client('modules/stage-backlog.js') + ';({ stageBacklogEntries, stageBacklogWindow, stageWheelDecision })')
const plain = value => JSON.parse(JSON.stringify(value))
const line = (text, speaker, emotion, quotes) => ({ kind: 'line', text, speaker, emotion, quotes })
const narration = text => ({ kind: 'narration', text })

test('backlog: earlier turns read-only, the latest turn only up to the current page', () => {
  const turns = [
    { turn: 2, pages: [narration('第二轮旁白。'), line('「你好」她说。', 'Nora', 'joy', ['你好'])] },
    { turn: 3, pages: [] },
    { turn: 4, pages: [narration('第四轮开场。'), line('「想」', 'Nora', 'sadness', ['想']), narration('还没读到。')] }
  ]
  const rows = plain(stageBacklogEntries(turns, 1))
  assert.deepEqual(rows.map(row => row.key), ['t2', 'p2:0', 'p2:1', 't4', 'p4:0', 'p4:1'], 'an empty turn has no separator; the unread page is not listed')
  assert.deepEqual(rows.filter(row => row.type === 'page').map(row => [row.turn, row.page, row.current, row.here]), [[2, 0, false, false], [2, 1, false, false], [4, 0, true, false], [4, 1, true, true]])
  assert.deepEqual(rows.filter(row => row.type === 'turn').map(row => row.current), [false, true])
  assert.deepEqual([rows[2].kind, rows[2].speaker, rows[2].emotion, rows[2].quotes, rows[1].kind, rows[1].speaker], ['line', 'Nora', 'joy', ['你好'], 'narration', ''])
  assert.equal(plain(stageBacklogEntries(turns, 99)).filter(row => row.current && row.type === 'page').length, 3, 'a page past the end clamps to the last page')
  assert.equal(plain(stageBacklogEntries(turns, -4)).filter(row => row.current && row.type === 'page').length, 1)
  assert.deepEqual(plain(stageBacklogEntries([], 0)), [])
  assert.deepEqual(plain(stageBacklogEntries(undefined, 0)), [])
})

test('backlog window includes visible variable-height rows plus exactly 20 on each side', () => {
  const offsets = [0]
  for (let i = 0; i < 1000; i++) offsets.push(offsets.at(-1) + (i % 2 ? 150 : 50))
  const range = stageBacklogWindow(offsets, offsets[500] + 10, 600, 20)
  assert.deepEqual([range.start, range.end], [480, 527])
  const end = stageBacklogWindow(offsets, Infinity, 600, 20)
  assert.equal(end.end, 1000)
  assert.ok(end.start >= 970)
  assert.equal(stageBacklogWindow(offsets, -10, 600, 20).start, 0)
  assert.equal(stageBacklogWindow([0], 0, 600, 20).end, 0)
})

test('the stage wheel: up opens the backlog per notch, down turns one page per gesture, small deltas add up', () => {
  let state = null
  const wheel = (deltaY, now, deltaMode = 0, typed = true) => { const decision = stageWheelDecision(state, { now, deltaY, deltaMode, typed }); state = decision.state; return decision.action }
  assert.equal(wheel(-120, 0), 'backlog')
  assert.equal(wheel(120, 50), 'advance', 'a reversed direction is a new gesture')
  assert.deepEqual([wheel(120, 100), wheel(120, 200)], ['none', 'none'], 'the rest of that gesture is consumed, not queued')
  assert.equal(wheel(120, 600), 'advance', 'a gesture after 300 ms of quiet turns again')
  assert.deepEqual([wheel(40, 1000), wheel(40, 1050), wheel(40, 1100)], ['none', 'none', 'advance'], 'trackpad deltas add up to a notch')
  assert.equal(wheel(-1, 2000, 1), 'none')
  assert.equal(wheel(-2, 2050, 1), 'backlog', 'line-mode deltas count as lines')
  assert.equal(wheel(0, 3000), 'none')
  assert.equal(wheel(Number.NaN, 3100), 'none')
  assert.deepEqual([wheel(120, 4000, 0, false), wheel(120, 4050, 0, false)], ['finish', 'none'], 'a line still typing is finished first, once per gesture')
  assert.equal(wheel(-120, 4400, 0, false), 'backlog', 'up still opens the backlog')
})

test('backlog view: opens at the current page, jumps only from the latest turn, and settles when resized and scrolled with 1000 rows', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><div class="dsh-tavern-stage-overlay" style="--gal-ui-ink:#eee;--gal-ui-muted:#aaa;--gal-ui-accent:#9cf;--gal-ui-line:#555;--gal-ui-surface:#222;--gal-ui-radius:6px"><div id="root" style="position:absolute;inset:0"></div></div>')
  await page.addStyleTag({ content: css + '\n.dsh-tavern-stage-backlog-text { font-size: 17px; line-height: 23.37px; }' })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React = modules.react, ReactDOM = modules['react-dom/client'];
    const spoken = [];
    function tavernCastAvatar(data, name, emotion) { return name ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : '' }
    function tavernCastHue() { return 200 }
    function TavernStageGlyph() { return React.createElement('svg') }
    // What a line's voice says (features/stage-runtime.js; its rule is tested in dialogue-voice.test.mjs).
    function tavernPageSpeech(page) { return page.quotes.join(' ') || page.text }
    function TavernCastSpeak(props) { return React.createElement('button', { type: 'button', className: 'dsh-tavern-speak', 'aria-label': '朗读这句', onClick: event => { event.stopPropagation(); spoken.push(props.text) } }, '🔊') }
    ` + client('modules/stage-backlog.js') + '\n' + client('features/stage-backlog.js') })
  await page.evaluate(() => {
    const root = ReactDOM.createRoot(document.getElementById('root'))
    const turns = Array.from({ length: 100 }, (_, t) => ({ turn: t + 1, pages: Array.from({ length: 10 }, (_, i) => i % 3 ? { kind: 'narration', text: 'Row ' + (t * 10 + i) + ' ' + 'Some text to wrap. '.repeat((t * 10 + i) % 7 + 1) }
      : { kind: 'line', text: '「Line ' + (t * 10 + i) + '」', speaker: 'Nora', emotion: 'joy', quotes: ['Line ' + (t * 10 + i)] }) }))
    window.events = { jumps: [], closed: 0, spoken }
    window.mount = () => modules['react-dom'].flushSync(() => root.render(React.createElement(TavernStageBacklog, {
      sessionId: 'offline', data: { turns }, page: 6, onJump: (page, turn) => window.events.jumps.push([page, turn]), onClose: () => window.events.closed++
    })))
    window.mount()
  })
  await page.waitForTimeout(300)
  assert.deepEqual(errors, [])
  const here = page.locator('.dsh-tavern-stage-backlog-row.is-here')
  assert.equal(await here.getAttribute('data-turn'), '100')
  assert.equal(await here.getAttribute('data-page'), '7')
  assert.ok(await here.isVisible(), 'opens with the current page in view')
  assert.ok(await page.locator('.dsh-tavern-stage-backlog-list').evaluate(node => node === document.activeElement), 'the list has the keyboard')
  await page.locator('.dsh-tavern-stage-backlog-row[data-turn="100"][data-page="4"]').click()
  await page.locator('.dsh-tavern-stage-backlog-row[data-turn="100"][data-page="1"]').focus()
  await page.keyboard.press('Enter')
  const past = page.locator('.dsh-tavern-stage-backlog-row[data-turn="99"]').first()
  assert.equal(await past.getAttribute('role'), null, 'an earlier turn is read-only')
  await past.click()
  await page.locator('.dsh-tavern-stage-backlog-row[data-turn="99"][data-page="10"] button').click()
  assert.deepEqual(await page.evaluate(() => window.events), { jumps: [[3, 100], [0, 100]], closed: 0, spoken: ['Line 989'] }, 'a voice replays its line without jumping')
  await page.locator('.dsh-tavern-stage-backlog').click({ button: 'right', position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: '关闭履历' }).click()
  assert.equal(await page.evaluate(() => window.events.closed), 2)
  for (const height of [0, 333, 601, 700]) {
    await page.evaluate(height => {
      document.getElementById('root').style.height = height + 'px'
      const box = document.querySelector('.dsh-tavern-stage-backlog-list')
      for (let i = 0; i < 15; i++) { box.scrollTop = (i % 3) * box.scrollHeight / 3; box.dispatchEvent(new Event('scroll')) }
    }, height)
    await page.waitForTimeout(100)
    assert.deepEqual(errors, [])
  }
  await page.evaluate(() => { document.getElementById('root').style.height = '' })
  for (let i = 0; i < 40; i++) {
    await page.setViewportSize({ width: 700 + i * 14, height: 400 + i % 17 * 13 })
    await page.evaluate(i => { document.querySelector('.dsh-tavern-stage-backlog-list').scrollTop = i % 2 ? 1e9 : 35000 + i * 13 }, i)
    await page.waitForTimeout(20)
    assert.deepEqual(errors, [], 'resize ' + i)
  }
  // Crossing turn separators changes collapsed margins at the leading spacer; native scroll anchoring must not fight the
  // measuring pass's correction.
  await page.evaluate(async () => {
    for (let i = 0; i < 300; i++) { document.querySelector('.dsh-tavern-stage-backlog-list').scrollTop = i * 41; await new Promise(requestAnimationFrame) }
  })
  assert.deepEqual(errors, [])
  assert.ok(await page.locator('.dsh-tavern-stage-backlog-row').count() < 100, 'only the window is rendered')
})
