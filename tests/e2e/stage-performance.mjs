import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
const baseline = process.argv.includes('--baseline')
if (!process.argv.includes('--isolated') || !endpoint || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.addInitScript(() => {
    window.performancePlays = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options)
      if (options?.id?.startsWith('stage:')) window.performancePlays.push({ id: options.id, actor: this.dataset.speaker || null, frames, animation: result })
      return result
    }
  })
  try {
    await stageStateChecks({ page, output, bodyText: '"Ready."\nThe door shakes.\nA small leap.',
      performances: actor => [{ at: 1, op: 'actor.act.play', actor, motion: 'nod' }, { at: 2, op: 'screen.play', effect: 'shake-1' }, { at: 3, op: 'actor.act.play', actor, motion: 'jump' }],
      async inspect({ stage, call, sessionId }) {
        const count = () => page.evaluate(() => window.performancePlays.length)
        const settled = () => page.waitForTimeout(1800)
        const beforeSave = (await call('exportGameSave', { sessionId, images: false })).base64
        const idle = await stage.evaluate(node => node.getAnimations({ subtree: true }).map(animation => animation.animationName).filter(Boolean))
        assert.equal(idle.includes('dsh-tavern-stage-breathe'), baseline, 'demo breathing must be removed, not kept alongside directed actions')
        await settled()
        assert.equal(await count(), 0, 'opening an existing page must not replay')
        await stage.getByRole('button', { name: '下一句', exact: true }).click()
        await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'The door shakes.' }).waitFor()
        if (!baseline) {
          await page.waitForFunction(() => window.performancePlays.length === 1)
          const sampled = await page.evaluate(() => {
            const play = window.performancePlays[0]
            play.animation.pause(); play.animation.currentTime = 120
            return { id: play.id, transform: getComputedStyle(play.animation.effect.target).transform }
          })
          assert.notEqual(sampled.transform, 'none', 'real browser animation changes the frame')
          await page.screenshot({ path: join(output, 'directed-shake.png') })
          await page.evaluate(() => window.performancePlays[0].animation.play())
        }
        await settled()
        assert.equal(await count(), baseline ? 0 : 1)
        await stage.getByRole('button', { name: '上一句', exact: true }).click()
        await settled()
        assert.equal(await count(), baseline ? 0 : 2, 'paging back plays that page once')
        await page.screenshot({ path: join(output, 'page-back.png') })
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: '舞台', exact: true }).click()
        const full = page.locator('.dsh-tavern-stage-overlay')
        await full.waitFor(); await settled()
        assert.equal(await count(), baseline ? 0 : 2, 'fullscreen reopening never replays')
        await full.getByRole('button', { name: '下一句', exact: true }).click()
        await full.getByRole('button', { name: '下一句', exact: true }).click()
        await settled()
        assert.equal(await count(), baseline ? 0 : 3, 'rapid paging cancels the intermediate page')
        await page.screenshot({ path: join(output, 'fullscreen-performance.png') })
        // The reading position belongs to the session; closing releases playback. The BGM is the game's, not the
        // view's: it goes on without a restart.
        await page.keyboard.press('Escape'); await full.waitFor({ state: 'detached' })
        const sources = await page.evaluate(() => window.stageTestAudio.sources)
        assert.ok(sources > 0)
        await page.getByRole('button', { name: '舞台', exact: true }).click(); await full.waitFor()
        await full.locator('.dsh-tavern-stage-text').filter({ hasText: 'A small leap.' }).waitFor()
        assert.equal(await full.locator('.dsh-tavern-stage-progress').innerText(), '3 / 3', 'reopening returns to the page it left')
        await settled()
        assert.equal(await count(), baseline ? 0 : 3, 'reopening on a page does not replay it')
        assert.equal(await page.evaluate(() => window.stageTestAudio.sources), sources, 'reopening neither restarts nor doubles the BGM')
        await page.screenshot({ path: join(output, 'reopened-position.png') })
        if (!baseline) {
          await stage.getByRole('button', { name: '上一句', exact: true }).click()
          await stage.getByRole('button', { name: '跳过', exact: true }).click()
          await settled()
          assert.equal(await count(), 3, 'skip cancels queued effects and does not play the destination')
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await stage.getByRole('button', { name: '上一句', exact: true }).click()
          await settled()
          assert.equal(await count(), 3, 'reduced motion consumes the event without animation')
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await settled()
          assert.equal(await count(), 3)
        }
        const receipts = await page.evaluate(() => window.performancePlays.map(({ id, actor, frames }) => ({ id, actor, frames })))
        // Reading is a projection: compare saved plugin data, not export timestamps.
        const { readGameSave } = await import('../../tavern-plugin/lib/domain/game-save.js')
        const afterSave = (await call('exportGameSave', { sessionId, images: false })).base64
        assert.deepEqual(readGameSave(Buffer.from(afterSave, 'base64')).plugins, readGameSave(Buffer.from(beforeSave, 'base64')).plugins)
        await page.reload(); await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor(); await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Ready.' }).waitFor()
        await settled()
        assert.equal(await count(), 0, 'refresh never replays even though the page has an accepted event')
        await page.setViewportSize({ width: 390, height: 844 })
        await page.locator('.dsh-tavern-stage-overlay').waitFor()
        await page.screenshot({ path: join(output, 'mobile-stage.png') })
        await page.setViewportSize({ width: 1280, height: 900 })
        return { baseline, idle, receipts, refreshSilent: true, readOnly: true, reopenedPosition: true, skipSilent: !baseline, reducedMotion: !baseline }
      }
    })
    console.log(JSON.stringify({ baseline, continuity: true, performances: !baseline, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
