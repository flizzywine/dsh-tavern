// 跳过 (cast-presentation.md 28/N) on the real stage: a fast-forward, not a jump. The control (or Ctrl held) shows the round's
// cards one by one - a long line's cards too - each whole, about every 150 ms, and stops on the last card with the input up.
// Any other key, click or wheel stops it and does only that; a Ctrl tap shorter than the arm delay does nothing; Ctrl held
// runs it until released; 自动 ends it. Fresh disposable profile only, no model calls. Nothing reaches a speaker: every
// AudioContext ends in stage-state's zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const LONG = '走廊在傍晚的光里一直延伸下去，长而安静，沿途的每一扇窗都映着同一片橘色的天空。她走得很慢，像是在数自己的脚步，又像是在等谁先开口。风从半开的窗缝里钻进来，把公告栏上的旧海报吹得沙沙作响。窗外的操场上还有人在练习投篮，篮球砸在篮板上的声音一下一下地传过来，又被走廊尽头的楼梯间吞没。你想起那天也下过一场小雨，地面湿漉漉的，她撑着一把透明的伞站在门口，说自己忘了带钥匙。'
const body = ['"Ready."', 'The hall is quiet.', LONG, 'She stops.', 'A bell rings somewhere below.', 'The lights come on one by one.'].join('\n')

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.evaluate(() => localStorage.removeItem('dsh-tavern-stage-reading'))
  try {
    const result = await stageStateChecks({ page, output, bodyText: body,
      async inspect({ stage }) {
        const steps = {}
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const at = value => progress.filter({ hasText: value }).waitFor()
        const skip = stage.getByRole('button', { name: '跳过', exact: true })
        const auto = stage.getByRole('button', { name: '自动', exact: true })
        const backButton = stage.getByRole('button', { name: '上一句', exact: true })
        const pressed = async () => (await skip.getAttribute('aria-pressed')) === 'true'
        const shown = () => stage.evaluate(node => {
          const type = node.querySelector('.dsh-tavern-stage-text .dsh-tavern-stage-type')
          return { progress: node.querySelector('.dsh-tavern-stage-progress').textContent, text: type ? type.textContent : '',
            typing: Boolean(node.querySelector('.dsh-tavern-stage-type-rest')), input: Boolean(node.querySelector('.dsh-tavern-stage-choices')) }
        })
        // Every card the stage shows, with when it showed (a page-side observer: nothing of the test's own timing in between).
        const record = () => page.evaluate(() => {
          window.skipLog = []
          const note = () => {
            const type = document.querySelector('.dsh-tavern-stage-text .dsh-tavern-stage-type'), shownText = type ? type.textContent : ''
            const key = document.querySelector('.dsh-tavern-stage-progress')?.textContent + ' ' + shownText, last = window.skipLog.at(-1)
            if (!last || last.key !== key) window.skipLog.push({ key, at: performance.now(), typing: Boolean(document.querySelector('.dsh-tavern-stage-type-rest')) })
          }
          note()
          window.skipObserver?.disconnect()
          window.skipObserver = new MutationObserver(note)
          window.skipObserver.observe(document.querySelector('.dsh-tavern-stage-overlay'), { subtree: true, childList: true, characterData: true })
        })
        // A state that stood at least 50 ms (one React commit can pass through a frame of the old card).
        const log = async () => { const run = await page.evaluate(() => window.skipLog); return run.filter((entry, i) => i === run.length - 1 || run[i + 1].at - entry.at >= 50) }
        const released = () => page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-controls [data-action="skip"]').getAttribute('aria-pressed') === 'false')
        const toFirst = async () => { for (let n = 0; n < 40 && (await shown()).progress !== '1 / 6'; n++) { await backButton.click(); await page.waitForTimeout(40) } await at('1 / 6') }
        await at('1 / 6')
        // 1. The control fast-forwards card by card to the round's last card and stops there, the input up.
        await record()
        await skip.click()
        assert.equal(await pressed(), true, 'the control is on while it skips')
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'w1920-skipping.png') })
        await at('6 / 6')
        await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-controls [data-action="skip"]').getAttribute('aria-pressed') === 'false')
        await stage.locator('.dsh-tavern-stage-choices').waitFor()
        const run = await log()
        const visited = [...new Set(run.map(entry => entry.key.split(' ')[0] + ' ' + entry.key.split(' ')[1] + ' ' + entry.key.split(' ')[2]))]
        assert.deepEqual(visited, ['1 / 6', '2 / 6', '3 / 6', '4 / 6', '5 / 6', '6 / 6'], 'every page in order: ' + JSON.stringify(run.map(entry => entry.key.slice(0, 24))))
        const onLong = run.filter(entry => entry.key.startsWith('3 / 6'))
        assert.ok(onLong.length >= 2, 'the long line\'s cards one by one: ' + onLong.length)
        assert.ok(run.slice(1).every(entry => !entry.typing), 'every card shown whole')
        const gaps = run.slice(2).map((entry, i) => entry.at - run[i + 1].at)
        assert.ok(gaps.every(gap => gap >= 90 && gap <= 600), 'about 150 ms a card: ' + JSON.stringify(gaps.map(Math.round)))
        const end = await shown()
        assert.equal(end.typing, false); assert.equal(end.input, true)
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'w1920-skip-end.png') })
        steps.control = { cards: run.length - 1, longCards: onLong.length, medianGap: Math.round(gaps.sort((a, b) => a - b)[gaps.length >> 1]) }
        // 2. Any key stops it, and that key does only that (no card turns with it).
        await toFirst()
        await skip.click(); await at('2 / 6')
        await page.keyboard.press('ArrowRight')
        await released()
        const stopped = await shown()
        await page.waitForTimeout(500)
        assert.deepEqual(await shown(), stopped, 'the key that stopped it turned nothing, and it stays stopped')
        assert.equal(stopped.typing, false, 'the card it stopped on stays whole')
        // A click on the scene stops it the same way.
        await skip.click(); await page.waitForTimeout(200)
        await stage.locator('.dsh-tavern-stage-scene').click({ position: { x: 300, y: 200 } })
        await released()
        const clicked = await shown()
        await page.waitForTimeout(500)
        assert.deepEqual(await shown(), clicked, 'the click turned nothing')
        steps.inputStops = [stopped.progress, clicked.progress]
        // 3. A Ctrl tap shorter than the arm delay skips nothing; Ctrl held runs it until released.
        await toFirst()
        await page.keyboard.down('Control'); await page.waitForTimeout(60); await page.keyboard.up('Control')
        await page.waitForTimeout(400)
        assert.equal((await shown()).progress, '1 / 6', 'a Ctrl tap skips nothing')
        await record()
        await page.keyboard.down('Control')
        await page.waitForTimeout(700)
        assert.equal(await pressed(), true, 'the control shows on while Ctrl is held')
        await page.keyboard.up('Control')
        await released()
        const held = await shown()
        await page.waitForTimeout(500)
        assert.deepEqual(await shown(), held, 'and stays stopped')
        const heldRun = await log()
        assert.ok(heldRun.length >= 3, 'Ctrl held turned cards: ' + heldRun.length)
        steps.ctrl = { cards: heldRun.length - 1, stoppedAt: held.progress }
        // 4. 自动 ends it (the press that stopped it also turns auto on); the control turns auto off.
        await toFirst()
        await skip.click(); await page.waitForTimeout(200)
        await auto.click()
        await released()
        assert.equal(await auto.getAttribute('aria-pressed'), 'true')
        await skip.click()
        assert.equal(await auto.getAttribute('aria-pressed'), 'false', '跳过 ends auto paging')
        await at('6 / 6')
        steps.auto = true
        // 5. A phone: the same fast-forward, more cards on the long line, each inside the box.
        await page.setViewportSize({ width: 375, height: 812 })
        await toFirst()
        await record()
        await skip.click()
        await page.waitForTimeout(450)
        await page.screenshot({ path: join(output, 'w375-skipping.png') })
        await at('6 / 6')
        await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-controls [data-action="skip"]').getAttribute('aria-pressed') === 'false')
        const phone = (await log()).filter(entry => entry.key.startsWith('3 / 6'))
        assert.ok(phone.length > onLong.length, 'more cards on a phone: ' + phone.length + ' vs ' + onLong.length)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'w375-skip-end.png') })
        steps.phone = { longCards: phone.length }
        await page.setViewportSize({ width: 1920, height: 1080 })
        return steps
      }
    })
    await writeFile(join(output, 'stage-skip.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ skip: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
