// 逐字显示 (cast-presentation.md 25/N) on the real stage: a page's line types out at CONFIG › 文字 › 文字速度 without re-wrapping;
// the first → / click / wheel step / › finishes it and the next turns the page; auto paging waits
// until the line is typed; a restored page, a backlog jump and 跳过 show the whole line; 文字速度 is faster at a lower value and
// 瞬间 at the far right; the 文字 page's preview types; the setting survives a reload and never touches the save; 375 fits.
// Fresh disposable profile only, no model calls. Nothing reaches a speaker: every AudioContext ends in stage-state's zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const LONG = 'The corridor stretches on in the evening light, long and quiet, and every window along it holds the same orange sky.'
const body = ['"Ready."', LONG, 'She stops, turns, and looks back at you.'].join('\n')

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
      async inspect({ stage, call, sessionId }) {
        const steps = {}
        const beforeSave = (await call('exportGameSave', { sessionId, images: false })).base64
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const at = value => progress.filter({ hasText: value }).waitFor()
        const text = stage.locator('.dsh-tavern-stage-text')
        const typing = () => stage.locator('.dsh-tavern-stage-type-rest').count().then(count => count > 0)
        const typed = () => stage.locator('.dsh-tavern-stage-type[data-typed]').waitFor()
        const next = () => stageNext(stage)
        const nextButton = stage.getByRole('button', { name: '下一句', exact: true })
        const back = () => stage.getByRole('button', { name: '上一句', exact: true }).click()
        const config = page.locator('.dsh-tavern-stage-config[role="dialog"]')
        const slider = name => config.getByRole('slider', { name, exact: true })
        const openText = async () => { await stage.locator('.dsh-tavern-stage-controls [data-action="sound"]').click(); await config.waitFor(); await config.getByRole('tab', { name: /^文字/ }).click() }
        const close = async () => { await config.getByRole('button', { name: '关闭设置', exact: true }).click(); await config.waitFor({ state: 'detached' }) }
        // The time from a page turn (the › control) to its line being typed.
        async function typeMs() {
          await at('2 / 3'); await back(); await at('1 / 3'); await typed()
          const started = Date.now()
          await nextButton.click(); await at('2 / 3'); await typed()
          return Date.now() - started
        }
        await at('1 / 3')
        // 1. The stage opens on a restored page: its whole line at once.
        assert.equal(await typing(), false, 'a restored page shows its whole line')
        await typed()
        // 2. › on a typed line turns the page; the next line types out glyph by glyph, laid out in full from the start (it never re-wraps).
        await next(); await at('2 / 3')
        await page.waitForTimeout(400)
        assert.equal(await typing(), true, 'the line is still typing')
        assert.equal((await text.innerText()).trim(), LONG, 'the whole line is laid out from the start')
        const shownEarly = await stage.locator('.dsh-tavern-stage-type-shown, .dsh-tavern-stage-glyph').evaluateAll(nodes => nodes.map(node => node.textContent).join('').length)
        assert.ok(shownEarly > 3 && shownEarly < LONG.length / 2, 'typed part after 0.4 s: ' + shownEarly)
        const heightTyping = (await text.boundingBox()).height
        await page.screenshot({ path: join(output, 'typing-1920.png') })
        // 3. → while it types finishes the line and stays on the page; the next → turns.
        await page.keyboard.press('ArrowRight')
        await typed()
        assert.equal(await typing(), false)
        assert.equal(await progress.innerText(), '2 / 3', 'the first key finished the line, it did not turn')
        assert.equal((await text.boundingBox()).height, heightTyping, 'the finished line keeps the same lines')
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'typed-1920.png') })
        await page.keyboard.press('ArrowRight'); await at('3 / 3')
        steps.finish = true
        // 4. A wheel step down while typing finishes the line too; a click on the stage likewise.
        await back(); await at('2 / 3'); await page.waitForTimeout(200)
        assert.equal(await typing(), true)
        await stage.locator('.dsh-tavern-stage-scene').hover({ position: { x: 900, y: 300 } })
        await page.mouse.wheel(0, 120); await typed()
        assert.equal(await progress.innerText(), '2 / 3', 'the wheel finished the line')
        await page.waitForTimeout(400)
        await back(); await at('1 / 3'); await next(); await at('2 / 3'); await page.waitForTimeout(200)
        await stage.locator('.dsh-tavern-stage-scene').click({ position: { x: 900, y: 300 } }); await typed()
        assert.equal(await progress.innerText(), '2 / 3', 'the click finished the line')
        await page.waitForTimeout(400)
        await back(); await at('1 / 3'); await next(); await at('2 / 3'); await page.waitForTimeout(200)
        assert.equal(await typing(), true)
        await nextButton.click(); await typed()
        assert.equal(await progress.innerText(), '2 / 3', '› finished the line')
        steps.wheelClickAndNext = true
        // 5. Speed: the default 28 ms per glyph types the long line in about 3 s; 10 ms is much faster; 瞬间 shows it at once.
        steps.ms28 = await typeMs()
        await openText()
        assert.equal(await slider('文字速度').getAttribute('aria-valuetext'), '28 毫秒每字')
        const preview = config.locator('.dsh-tavern-stage-config-preview')
        await preview.locator('.dsh-tavern-stage-type-rest').waitFor()
        await preview.locator('.dsh-tavern-stage-config-preview-next').waitFor({ timeout: 8000 })
        await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'config-text-1920.png') })
        await slider('文字速度').fill('70')
        assert.equal(await slider('文字速度').getAttribute('aria-valuetext'), '10 毫秒每字'); await close()
        steps.ms10 = await typeMs()
        assert.ok(steps.ms28 >= 2600 && steps.ms10 < steps.ms28 - 1500, 'typing pace: ' + steps.ms28 + ' vs ' + steps.ms10)
        await openText(); await slider('文字速度').focus(); await page.keyboard.press('End')
        assert.equal(await slider('文字速度').getAttribute('aria-valuetext'), '瞬间显示'); await close()
        await back(); await at('1 / 3'); await next(); await at('2 / 3')
        assert.equal(await typing(), false, '瞬间 shows the whole line at once')
        await openText(); await slider('文字速度').fill('52'); await close()
        // 6. Auto paging waits for the line to be typed, then waits its usual time.
        await openText(); await slider('自动阅读速度').fill('3'); await close()
        await back(); await at('1 / 3'); await next(); await at('2 / 3')
        await stage.getByRole('button', { name: '自动', exact: true }).click()
        await typed()
        const typedAt = Date.now()
        assert.equal(await progress.innerText(), '2 / 3', 'auto did not turn before the line was typed')
        await at('3 / 3')
        steps.autoAfterTyped = Date.now() - typedAt
        const hold = Math.round(Math.max(1500, Math.min(10000, 400 + 70 * LONG.length)) / 3)
        assert.ok(steps.autoAfterTyped >= hold * .85, 'auto waits after typing: ' + steps.autoAfterTyped + ' vs ' + hold)
        await stage.getByRole('button', { name: '自动', exact: true }).click()
        // 7. A backlog jump (from the last page back to the long one) and 跳过 show the whole line.
        await page.keyboard.press('l')
        const backlog = page.locator('.dsh-tavern-stage-backlog[role="dialog"]')
        await backlog.waitFor()
        await backlog.locator('.dsh-tavern-stage-backlog-row[data-page="2"]').last().click()
        await backlog.waitFor({ state: 'detached' })
        await at('2 / 3')
        assert.equal(await typing(), false, 'a backlog jump shows the whole line')
        await back(); await at('1 / 3')
        await stage.getByRole('button', { name: '跳过', exact: true }).click(); await at('3 / 3')
        assert.equal(await typing(), false, '跳过 shows the whole line')
        steps.jumpAndSkip = true
        // 8. 375: the typing line wraps inside the box.
        await page.setViewportSize({ width: 375, height: 812 })
        await back(); await at('2 / 3'); await page.waitForTimeout(300)
        const narrow = await stage.evaluate(node => { const t = node.querySelector('.dsh-tavern-stage-text'); return { overflow: document.documentElement.scrollWidth > window.innerWidth, inside: t.getBoundingClientRect().right <= window.innerWidth + .5 } })
        assert.deepEqual(narrow, { overflow: false, inside: true })
        // mid-typing on the long line, late enough that the typing has reached its last lines
        await page.waitForTimeout(2000)
        steps.narrowTyping = await stage.evaluate(node => { const t = node.querySelector('.dsh-tavern-stage-text'), rest = t.querySelector('.dsh-tavern-stage-type-rest'); return { typing: Boolean(rest), scrollHeight: t.scrollHeight, clientHeight: t.clientHeight, scrollTop: t.scrollTop } })
        await page.screenshot({ path: join(output, 'typing-375.png') })
        await typed(); await page.waitForTimeout(400)
        await page.screenshot({ path: join(output, 'typed-375.png') })
        await page.setViewportSize({ width: 1920, height: 1080 })
        // 9. 文字速度 is this browser's: a reload reads it back; the save is untouched.
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-tavern-stage-reading'))), { textSpeed: 28, autoWait: 400, autoSpeed: 3, voiceRate: 1 })
        await page.reload()
        await page.getByRole('button', { name: '舞台', exact: true }).click()
        await stage.waitFor(); await stage.locator('.dsh-tavern-stage-type').waitFor()
        assert.equal(await typing(), false, 'the reopened page shows its whole line')
        await openText()
        assert.equal(await slider('文字速度').getAttribute('aria-valuetext'), '28 毫秒每字')
        await slider('自动阅读速度').fill('1'); await close()
        const afterSave = (await call('exportGameSave', { sessionId, images: false })).base64
        assert.deepEqual(readGameSave(Buffer.from(afterSave, 'base64')).plugins, readGameSave(Buffer.from(beforeSave, 'base64')).plugins, 'settings never write the save')
        steps.save = true
        return steps
      }
    })
    await writeFile(join(output, 'stage-typewriter.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ typewriter: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
