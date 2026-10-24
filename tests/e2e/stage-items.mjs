// 物品 (cast-presentation.md 17/N): a director-shown item plays once on its page over the real stage, from the card's
// pack entry, and 物品 off (stageToggles.items) takes it away without touching the save. Fresh disposable profile only.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

// An original 160×160 picture: a gold disc with a dark rim on transparency.
function watch() {
  const size = 160, rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 80, y - 84), hand = Math.abs(x - 80) < 3 && y > 44 && y < 84
      const rgba = d > 64 ? [0, 0, 0, 0] : d > 56 || hand ? [70, 48, 20, 255] : [232, 190, 92, 255]
      row.set(rgba, 1 + x * 4)
    }
    rows.push(row)
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.addInitScript(() => {
    window.performancePlays = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options)
      if (options?.id?.startsWith('stage:')) window.performancePlays.push({ id: options.id, item: this.classList.contains('dsh-tavern-stage-item'), animation: result })
      return result
    }
  })
  try {
    await stageStateChecks({ page, output, bodyText: '"Ready."\nShe holds up a pocket watch.\nThe hands still move.', items: [{ name: '怀表', bytes: watch() }],
      performances: () => [{ at: 2, op: 'item.play', item: '怀表' }],
      async inspect({ stage, call, sessionId }) {
        const plays = () => page.evaluate(() => window.performancePlays.filter(play => play.item).length)
        const settled = () => page.waitForTimeout(1800)
        const item = stage.locator('.dsh-tavern-stage-item')
        const beforeSave = (await call('exportGameSave', { sessionId, images: false })).base64
        const shown = (await call('castStage', { sessionId, count: 1 })).turns.at(-1).performances
        assert.equal(shown.length, 1)
        assert.deepEqual([shown[0].op, shown[0].at, shown[0].item], ['item.play', 2, '怀表'])
        assert.match(shown[0].image, /\/lease\//, 'the host hands the entry\'s picture lease')
        await settled()
        assert.equal(await plays(), 0, 'opening an existing page does not play')
        assert.equal(await item.count(), 0, 'only the item\'s own page holds it')
        // Paging to the item's page plays it once: picture and name over the scene, above the text box, never in the way.
        const holdMiddle = async label => {
          await page.waitForFunction(count => window.performancePlays.filter(play => play.item).length === count, await plays() + 1)
          const sample = await page.evaluate(() => {
            const play = window.performancePlays.filter(play => play.item).at(-1)
            // The middle of the showcase, held as a still frame (a paused composited animation can lag in a hidden window).
            play.animation.pause(); play.animation.currentTime = 1400; play.animation.commitStyles(); play.animation.cancel()
            const node = play.animation.effect.target, img = node.querySelector('img'), box = node.getBoundingClientRect()
            const text = document.querySelector('.dsh-tavern-stage-overlay .dsh-tavern-stage-textbox').getBoundingClientRect()
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
            return { opacity: Number(getComputedStyle(node).opacity), name: node.querySelector('strong').textContent, picture: img ? img.naturalWidth : 0,
              box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right }, textTop: text.top, width: innerWidth, takesClick: node.contains(hit) }
          })
          // The paused frame reaches the compositor before the shot.
          await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
          await page.waitForTimeout(150)
          await page.screenshot({ path: join(output, label + '.png') })
          await page.evaluate(() => window.performancePlays.filter(play => play.item).at(-1).animation.effect.target.removeAttribute('style'))
          assert.equal(sample.opacity, 1, label)
          assert.equal(sample.name, '怀表')
          assert.equal(sample.picture, 160, 'the pack entry\'s picture is drawn')
          assert.ok(sample.box.bottom <= sample.textTop && sample.box.left >= 0 && sample.box.right <= sample.width, label + ': above the text box, inside the screen ' + JSON.stringify(sample))
          assert.equal(sample.takesClick, false, 'the showcase never takes a click')
          return sample
        }
        await stage.getByRole('button', { name: '下一句', exact: true }).click()
        await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'pocket watch' }).waitFor()
        const wide = await holdMiddle('item-1920')
        await settled()
        assert.equal(await plays(), 1, 'played once')
        assert.equal(await item.evaluate(node => getComputedStyle(node).opacity), '0', 'after the showcase the item is gone again')
        await stage.getByRole('button', { name: '下一句', exact: true }).click()
        await settled()
        assert.equal(await item.count(), 0, 'the next page has no item')
        // 375: paging back plays the page once again, inside the narrow screen.
        await page.setViewportSize({ width: 375, height: 812 })
        await stage.getByRole('button', { name: '上一句', exact: true }).click()
        const narrow = await holdMiddle('item-375')
        await settled()
        assert.equal(await plays(), 2)
        await page.setViewportSize({ width: 1920, height: 1080 })
        // 物品 off for every card: the turn no longer shows it; the save is not changed.
        await call('updateTavernSettings', { patch: { stageToggles: { items: false } } })
        assert.deepEqual((await call('castStage', { sessionId, count: 1 })).turns.at(-1).performances, [])
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        await stage.getByRole('button', { name: '上一句', exact: true }).click()
        await stage.getByRole('button', { name: '下一句', exact: true }).click()
        await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'pocket watch' }).waitFor()
        await page.waitForFunction(() => !document.querySelector('.dsh-tavern-stage-overlay .dsh-tavern-stage-item'))
        await settled()
        assert.equal(await plays(), 2, '物品 off: nothing shows')
        await page.screenshot({ path: join(output, 'items-off-1920.png') })
        await call('updateTavernSettings', { patch: { stageToggles: { items: true } } })
        assert.equal((await call('castStage', { sessionId, count: 1 })).turns.at(-1).performances.length, 1, 'switching back shows it again; nothing was rewritten')
        const { readGameSave } = await import('../../tavern-plugin/lib/domain/game-save.js')
        const afterSave = (await call('exportGameSave', { sessionId, images: false })).base64
        assert.deepEqual(readGameSave(Buffer.from(afterSave, 'base64')).plugins, readGameSave(Buffer.from(beforeSave, 'base64')).plugins)
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        return { wide, narrow, plays: 2, offHidden: true, readOnly: true }
      }
    })
    console.log(JSON.stringify({ items: true, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
