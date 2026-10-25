// A long reply (150 quotes): settlement numbers every quote, cast_submit annotates all of them, and quote 61 onwards
// shows its speaker in the chat and on the stage like the first 60. The annotation is made by the real settlement
// note and submission check (a fixed reply names every numbered quote, as tests/e2e/model.mjs does).
// Fresh disposable profile only, no model calls. Nothing reaches a speaker: every AudioContext ends in stage-state's zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { castSettlementText, dialogueQuotes, normalizeCastSubmission } from '../../tavern-plugin/lib/domain/cast-annotation.js'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const COUNT = 150
const other = 'Lee'
const body = '"Ready."\n' + Array.from({ length: COUNT - 1 }, (_, index) => (index % 2 ? 'She' : other) + ' says: "Line ' + (index + 2) + '."').join('\n')
const speakerOf = (n, name) => n % 2 ? name : other

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  // 瞬间 text speed, so paging to quote 150 does not wait for typing.
  await page.evaluate(() => localStorage.setItem('dsh-tavern-stage-reading', JSON.stringify({ textSpeed: 80 })))
  try {
    const result = await stageStateChecks({ page, output, bodyText: body,
      castLines(name) {
        const quotes = dialogueQuotes(body)
        const note = castSettlementText(quotes)
        const lines = [...note.matchAll(/^(\d+)\. /gm)].map(([, n]) => ({ n: Number(n), speaker: speakerOf(Number(n), name), emotion: 'neutral' }))
        return normalizeCastSubmission({ lines }, quotes)
      },
      async inspect({ stage, name }) {
        const steps = {}
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const speaker = () => stage.locator('.dsh-tavern-stage-name b').innerText().catch(() => null)
        await progress.filter({ hasText: '1 / ' + COUNT }).waitFor()
        const seen = {}
        for (let at = 1; at <= COUNT; at++) {
          if (at > 1) { await stageNext(stage); await progress.filter({ hasText: at + ' / ' + COUNT }).waitFor() }
          if ([1, 60, 61, 62, 100, COUNT].includes(at)) {
            seen[at] = await speaker()
            if (at === 61 || at === COUNT) { await page.waitForTimeout(300); await page.screenshot({ path: join(output, 'stage-quote-' + at + '.png') }) }
            assert.equal(seen[at], speakerOf(at, name), 'stage page ' + at + ' shows its speaker')
          }
        }
        steps.stage = seen
        await page.keyboard.press('Escape'); await stage.waitFor({ state: 'hidden' })
        const rows = page.locator('.dsh-tavern-cast-line')
        assert.equal(await rows.count(), COUNT, 'every quote is a speaker row in the chat')
        const row61 = rows.filter({ hasText: 'Line 61.' })
        assert.equal(await row61.locator('.dsh-tavern-cast-name').innerText(), name)
        await row61.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
        await page.screenshot({ path: join(output, 'chat-quote-61.png') })
        steps.chatRows = COUNT
        await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor()
        return steps
      }
    })
    await writeFile(join(output, 'cast-quote-limit.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ castQuoteLimit: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => ''))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
