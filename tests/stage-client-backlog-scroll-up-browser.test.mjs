// Scrolling the 履历 up never pulls the rows back, and at the end a new page still keeps the end in view.
// The virtual list (backlog-view.cjs) measures a row as the distance to the next row's top;
// the first drawn row's own top margin used to stand outside that measure, so each time the first drawn row changed kind
// (a round separator, the player's words, a narration page) the rows jumped by the margins' difference against the wheel.
// What the reader sees is the rows' place on screen; scrollTop itself also moves when a row above the view is measured.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { stageThemeCss } from './helpers/stage-theme-css.mjs'
import { stageClientPage } from './helpers/stage-client-page.mjs'

// classic: the stage's own list; art: a drawn skin's 履历 (art.backlog) with its own row, narration and after-separator gaps.
const LOOKS = {
  classic: '',
  art: 'data-fk-skin-art-backlog style="--mu:1px;--art-bl-gap:14;--art-bl-top:10"',
}
// (the drawn 履历 places its list from the skin's art; here the list keeps the classic sheet's height)
const LOOK_CSS = {
  classic: '',
  art: '#root .fork-gal-backlog-list { flex: none; height: 600px; }',
}
const WHEEL = 60, STEPS = 45

async function openPage(browser, look, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><div id="root" class="fork-gal-stage" data-theme="classic" ' + LOOKS[look] + '></div>')
  await page.addStyleTag({ content: await stageThemeCss() + '\n#root { height: 700px; } .fork-gal-backlog-text { font-size: 17px; line-height: 23.37px; }\n' + LOOK_CSS[look] })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, ReactDOM=modules['react-dom/client'];
    ${stageClientPage()}
    const stage=stageClient.start({options:stageHost.options(),sessionInputs:()=>stageHost.sessionInputs({native:stageHost.nativeSession().native})});
    if(!stage.views)throw new Error('stage client did not mount: '+stage.errors.map(args=>String(args[1]?.stack||args[1])).join('\\n'));
    window.GalBacklog=stage.views.backlogView.Backlog;
    ` })
  await page.evaluate(look => {
    const root = ReactDOM.createRoot(document.getElementById('root'))
    // 30 earlier rounds of mixed rows (lines and narration pages of every length), each after the player's words.
    const unit = i => i % 3 ? { kind: 'narration', text: 'R' + i + ' ' + 'Narration that wraps. '.repeat(i * 7 % 13 + 1), para: i + 1 }
      : { kind: 'line', alias: 'sayo', name: '小夜', text: 'R' + i + ' ' + 'A spoken line. '.repeat(i * 5 % 9 + 1), para: i + 1 }
    const units = Array.from({ length: 300 }, (_, i) => unit(i))
    const index = new Map(Array.from({ length: 30 }, (_, i) => [i + 1, { units: units.slice(i * 10, i * 10 + 10) }]))
    const inputs = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i + 1, 'R-in' + i + ' ' + 'What I said. '.repeat(i % 4 + 1)]))
    const current = Array.from({ length: 12 }, (_, i) => ({ kind: 'narration', text: 'R-now' + i + ' ' + 'This round. '.repeat(i % 5 + 1), para: i + 1 }))
    // (rounds from `from` on: the earlier ones not read yet)
    window.show = (page, from = 1) => modules['react-dom'].flushSync(() => root.render(React.createElement(GalBacklog, {
      sessionId: 'offline', turn: 31, pages: current, page, textIndex: from > 1 ? new Map([...index].filter(([turn]) => turn >= from)) : index, inputs, config: {},
      colorOf: () => '', avatarOf: () => null, nameOf: alias => alias, onClose() {}, onJump() {}
    })))
    window.show(9, look.from)
  }, { from: options.from })
  await page.waitForTimeout(300)
  return { page, errors }
}

// Per frame: how far the row in the middle of the list moved on screen since the last frame (+ = down, the rows following
// an upward wheel).
async function watchRows(page) {
  await page.evaluate(() => {
    const box = document.querySelector('.fork-gal-backlog-list')
    const rows = () => [...box.querySelectorAll('.fork-gal-backlog-col > [data-bl-role], .fork-gal-backlog-col > .fork-gal-backlog-turn')]
    const idOf = node => node.textContent.match(/R[-\w]*\d+|第 \d+ 轮/)?.[0]
    window.moves = []
    // a script setting scrollTop stops a wheel's or touchpad's glide: count them
    const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    window.writes = 0
    Object.defineProperty(box, 'scrollTop', { configurable: true, get() { return own.get.call(this) }, set(value) { window.writes++; own.set.call(this, value) } })
    let last = null
    const tick = () => {
      if (last) {
        const node = rows().find(row => idOf(row) === last.id)
        if (node) { const d = node.getBoundingClientRect().top - last.y; if (Math.abs(d) > 0.5) window.moves.push(d) }
      }
      const r = box.getBoundingClientRect(), mid = r.top + r.height / 2
      const node = rows().find(row => row.getBoundingClientRect().bottom > mid)
      last = node ? { id: idOf(node), y: node.getBoundingClientRect().top } : null
      window.frame = requestAnimationFrame(tick)
    }
    tick()
  })
}

for (const look of Object.keys(LOOKS)) {
  test(look + ': wheeling the 履历 up moves the rows down by the wheel, never back', { timeout: 120000 }, async t => {
    const browser = await chromium.launch({ headless: true })
    t.after(() => browser.close())
    const { page, errors } = await openPage(browser, look)
    const box = page.locator('.fork-gal-backlog-list')
    const start = await box.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)
    assert.ok(start <= 2, 'opens at the end: ' + start)
    await watchRows(page)
    const area = await box.boundingBox()
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
    for (let i = 0; i < STEPS; i++) { await page.mouse.wheel(0, -WHEEL); await page.waitForTimeout(40) }
    await page.waitForTimeout(200)
    const { moves, writes } = await page.evaluate(() => { cancelAnimationFrame(window.frame); return { moves: window.moves, writes: window.writes } })
    assert.equal(writes, 0, 'the list set its own scrollTop while the reader scrolled up')
    const back = moves.filter(d => d < -0.5), off = moves.filter(d => Math.abs(d - WHEEL) > 1)
    assert.deepEqual(back, [], 'rows pulled back against the wheel: ' + JSON.stringify(moves))
    assert.deepEqual(off, [], 'each wheel step moves the rows by the wheel: ' + JSON.stringify(moves))
    assert.ok(moves.length >= STEPS - 2, 'the wheel scrolled: ' + moves.length)
    // far enough up that the drawn window crossed many rounds, row kinds and measurements
    assert.ok(await page.locator('.fork-gal-backlog-turn').count() >= 2)
    assert.deepEqual(errors, [])
  })
}

test('at the end a new page keeps the end in view; scrolled up it keeps the rows where they are', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const { page, errors } = await openPage(browser, 'classic')
  const box = page.locator('.fork-gal-backlog-list')
  const gap = () => box.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)
  for (const next of [10]) {
    await page.evaluate(next => window.show(next), next)
    await page.waitForTimeout(150)
    assert.ok(await gap() <= 2, 'page ' + next + ' at the end: ' + await gap())
    assert.equal(await page.locator('.fork-gal-backlog-row.is-here').textContent().then(text => text.match(/R-now\d+/)[0]), 'R-now' + next)
  }
  // Scrolled up, a new page below does not move what the reader sees.
  await box.evaluate(node => { node.scrollTop -= 900 })
  await page.waitForTimeout(150)
  const mark = () => page.evaluate(() => {
    const box = document.querySelector('.fork-gal-backlog-list'), r = box.getBoundingClientRect()
    const node = [...box.querySelectorAll('.fork-gal-backlog-row')].find(row => row.getBoundingClientRect().top >= r.top + 40)
    return { id: node.textContent.match(/R[-\w]*\d+/)[0], y: node.getBoundingClientRect().top }
  })
  const before = await mark()
  await page.evaluate(() => window.show(11))
  await page.waitForTimeout(150)
  assert.deepEqual(await mark(), before)
  assert.deepEqual(errors, [])
})

// Paging: reading at the top of what is loaded, earlier rounds arrive above; the rows being read stay where they are.
for (const top of [0, 40]) {
  test('earlier rounds arriving above the reader at ' + top + ' px from the top keep the rows in place', { timeout: 120000 }, async t => {
    const browser = await chromium.launch({ headless: true })
    t.after(() => browser.close())
    const { page, errors } = await openPage(browser, 'classic', { from: 25 })
    const box = page.locator('.fork-gal-backlog-list')
    // up to the top in reading steps, so the rows on the way are drawn and measured
    for (let i = 0; i < 200 && await box.evaluate(node => node.scrollTop) > top; i++) {
      await box.evaluate((node, top) => { node.scrollTop = Math.max(top, node.scrollTop - 400) }, top)
      await page.waitForTimeout(16)
    }
    await page.waitForTimeout(150)
    const mark = () => page.evaluate(() => {
      const box = document.querySelector('.fork-gal-backlog-list'), r = box.getBoundingClientRect()
      const node = [...box.querySelectorAll('.fork-gal-backlog-row')].find(row => row.getBoundingClientRect().top >= r.top + 60)
      return { id: node.textContent.match(/R[-\w]*\d+/)[0], y: Math.round(node.getBoundingClientRect().top) }
    })
    const before = await mark()
    assert.equal(before.id.startsWith('R2'), true, 'reading round 25 at the top: ' + before.id)
    await page.evaluate(() => window.show(9))
    await page.waitForTimeout(300)
    assert.deepEqual(await mark(), before)
    assert.ok(await page.locator('.fork-gal-backlog-turn').count() > 0)
    assert.deepEqual(errors, [])
  })
}