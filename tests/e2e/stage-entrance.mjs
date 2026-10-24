// 入场演出 (cast-presentation.md 18/N): the card's pack entrance plays over the real stage each time it opens and never holds
// it - a click or Enter skips it, reduced motion stills it, no canvas or no first frame drops it, and 入场演出 off
// (stageToggles.entrance) leaves the stage without one. Fresh disposable profile only.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
const sample = JSON.parse(await readFile(new URL('../../examples/stage-entrance/light-tunnel.json', import.meta.url), 'utf8'))
const FULL_MS = 2600

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const errors = []
  page.on('pageerror', error => errors.push(String(error.stack || error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  try {
    await stageStateChecks({ page, output, entrances: [sample],
      async inspect({ stage, call, sessionId }) {
        const entrance = stage.locator('.dsh-tavern-stage-entrance')
        const shown = await call('castStage', { sessionId, count: 1 })
        assert.deepEqual([shown.entrance.ref.kind, shown.entrance.name, shown.entrance.document.label], ['entrances', '光点隧道', '光点隧道'])
        assert.ok(!JSON.stringify(shown.turns).includes('entrance'), 'the entrance is not part of a page')
        // The entrance's states over time, from the moment the stage is opened.
        const watch = () => page.evaluate(() => {
          const t0 = performance.now(), log = window.entranceLog = []
          const note = () => {
            const node = document.querySelector('.dsh-tavern-stage-entrance')
            const state = !node ? 'none' : node.dataset.covered !== undefined ? 'covered' : node.dataset.started !== undefined ? 'started' : 'mounted'
            if (log.at(-1)?.state !== state) log.push({ state, t: Math.round(performance.now() - t0) })
          }
          window.entranceObserver?.disconnect()
          window.entranceObserver = new MutationObserver(note)
          window.entranceObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-started', 'data-covered'] })
          note()
        })
        const log = () => page.evaluate(() => window.entranceLog)
        const ended = () => page.waitForFunction(() => window.entranceLog.length > 1 && window.entranceLog.at(-1).state === 'none', null, { timeout: 15000 })
        // narrow: at 375 the desktop window's own menu strip lies over the chat header, so the 舞台 button is pressed directly.
        const reopen = async ({ narrow = false } = {}) => {
          if (await stage.isVisible()) { await stage.getByRole('button', { name: '退出舞台', exact: true }).click(); await stage.waitFor({ state: 'detached' }) }
          await watch()
          const toggle = page.getByRole('button', { name: '舞台', exact: true })
          if (narrow) await toggle.evaluate(button => button.click())
          else await toggle.click()
          await stage.waitFor()
        }
        const stageUsable = async label => {
          // The stage under it answers at once: the text box is the topmost element and paging works.
          const top = await page.evaluate(() => { const box = document.querySelector('.dsh-tavern-stage-overlay .dsh-tavern-stage-textbox').getBoundingClientRect(); return !!document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.dsh-tavern-stage-textbox') })
          assert.equal(top, true, label + ': the stage is reachable')
        }
        // The canvas really draws: the light point at the focus is brighter than the backdrop corner.
        const drawn = () => page.evaluate(() => {
          const canvas = document.querySelector('.dsh-tavern-stage-entrance canvas'), ctx = canvas.getContext('2d')
          const at = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]
          return { center: at(canvas.width * 0.5, canvas.height * 0.48), corner: at(2, 2), side: at(canvas.width * 0.2, canvas.height * 0.25), width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height }
        })

        // 1. A full play: mounted, its first frame, the cover, then gone - about the document's length, never held.
        await reopen()
        await page.waitForFunction(() => window.entranceLog.some(row => row.state === 'started'))
        await page.waitForTimeout(900)
        const wide = await drawn()
        await page.screenshot({ path: join(output, 'entrance-1920.png') })
        await ended()
        const full = await log()
        assert.deepEqual(full.map(row => row.state), ['none', 'mounted', 'started', 'covered', 'none'], JSON.stringify(full))
        assert.ok(full.at(-1).t >= FULL_MS - 300 && full.at(-1).t < FULL_MS + 2000, 'full play ' + JSON.stringify(full))
        assert.ok(wide.center[0] + wide.center[1] + wide.center[2] > wide.corner[0] + wide.corner[1] + wide.corner[2] + 150, 'drawn ' + JSON.stringify(wide))
        assert.deepEqual([wide.width, wide.height], [1920, 1080])
        await stageUsable('after a full play')
        await page.screenshot({ path: join(output, 'after-entrance-1920.png') })

        // 2. A click skips it: the cover and the handoff come at once.
        await reopen()
        await page.waitForFunction(() => window.entranceLog.some(row => row.state === 'started'))
        await page.waitForTimeout(300)
        await entrance.click({ position: { x: 300, y: 300 } })
        await ended()
        const clicked = await log()
        assert.ok(clicked.at(-1).t < FULL_MS, 'click skip ' + JSON.stringify(clicked))
        await stageUsable('after a click skip')
        // ... and so does Enter, without paging the stage.
        const pageBefore = await stage.locator('.dsh-tavern-stage-progress').textContent()
        await reopen()
        await page.waitForFunction(() => window.entranceLog.some(row => row.state === 'started'))
        await page.waitForTimeout(300)
        await page.keyboard.press('Enter')
        await ended()
        const entered = await log()
        assert.ok(entered.at(-1).t < FULL_MS, 'Enter skip ' + JSON.stringify(entered))
        assert.equal(await stage.locator('.dsh-tavern-stage-progress').textContent(), pageBefore, 'the skip key did not turn the page')

        // 3. Reduced motion: one still frame (no white cover), then a short fade.
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await reopen()
        await page.waitForFunction(() => window.entranceLog.some(row => row.state === 'started' || row.state === 'covered'))
        const still = await drawn()
        await ended()
        const reduced = await log()
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        assert.ok(reduced.at(-1).t < FULL_MS, 'reduced ' + JSON.stringify(reduced))
        assert.ok(still.corner[0] + still.corner[1] + still.corner[2] < 200 && still.center[0] > 200, 'a drawn still frame and no white cover ' + JSON.stringify(still))
        await stageUsable('reduced motion')

        // 4. No 2D canvas: no entrance, the stage at once.
        await page.evaluate(() => { const own = HTMLCanvasElement.prototype.getContext; window.entranceGetContext = own; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return this.classList.contains('dsh-tavern-stage-entrance-canvas') ? null : own.call(this, kind, ...rest) } })
        const warned = page.waitForEvent('console', message => message.text().includes('入场演出不可用'))
        await reopen()
        await warned
        await page.waitForTimeout(300)
        const broken = await log()
        await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.entranceGetContext })
        assert.ok(broken.at(-1).state === 'none' && !broken.some(row => row.state === 'started') && await entrance.count() === 0, 'no canvas ' + JSON.stringify(broken))
        await stageUsable('no canvas')

        // 5. No first frame in time (the entrance's own frames withheld): dropped after its start timeout, the stage shown.
        await page.evaluate(() => { const own = window.entranceRaf = window.requestAnimationFrame; window.requestAnimationFrame = fn => fn.name === 'tick' ? 0 : own.call(window, fn) })
        await reopen()
        await page.waitForTimeout(3600)
        await page.evaluate(() => { window.requestAnimationFrame = window.entranceRaf })
        await ended()
        const stalled = await log()
        assert.ok(!stalled.some(row => row.state === 'started') && stalled.at(-1).t >= 2900 && stalled.at(-1).t < 4200, 'no first frame ' + JSON.stringify(stalled))
        await stageUsable('no first frame')

        // 6. 375 wide: the entrance covers the narrow screen too.
        await page.setViewportSize({ width: 375, height: 812 })
        await reopen({ narrow: true })
        await page.waitForFunction(() => window.entranceLog.some(row => row.state === 'started'))
        await page.waitForTimeout(900)
        const narrow = await drawn()
        await page.screenshot({ path: join(output, 'entrance-375.png') })
        await ended()
        assert.deepEqual([narrow.width, narrow.height], [375, 812])
        await page.setViewportSize({ width: 1920, height: 1080 })

        // 7. 入场演出 off for every card: castStage holds none and the stage opens without one.
        await call('updateTavernSettings', { patch: { stageToggles: { entrance: false } } })
        assert.equal((await call('castStage', { sessionId, count: 1 })).entrance, null)
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        await page.waitForTimeout(1500)
        await reopen()
        await page.waitForTimeout(800)
        const off = await log()
        assert.deepEqual(off.map(row => row.state), ['none'], 'off ' + JSON.stringify(off))
        await page.screenshot({ path: join(output, 'entrance-off-1920.png') })
        await stageUsable('entrance off')
        return { full, clicked, entered, reduced, broken, stalled, off, wide, narrow, still }
      }
    })
    console.log(JSON.stringify({ entrance: true, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + errors.join('\n') + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
