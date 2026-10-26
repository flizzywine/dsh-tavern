// 分页 (cast-presentation.md 26/N) on the real stage: a line longer than the text box shows card by card, each as many lines as the box holds (at most 3),
// so nothing overflows at 1920 or on a 375 phone. Each card types out; the first →/›/click finishes it, the next shows the next
// card and only after the last card turns the page. ‹ walks the cards back into the previous page's last card; 跳过 fast-forwards to the
// last page's last card whole; a backlog jump and a reopened stage show the first card whole; auto paging reads every card.
// Fresh disposable profile only, no model calls. Nothing reaches a speaker: every AudioContext ends in stage-state's zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const LONG = '走廊在傍晚的光里一直延伸下去，长而安静，沿途的每一扇窗都映着同一片橘色的天空。她走得很慢，像是在数自己的脚步，又像是在等谁先开口。风从半开的窗缝里钻进来，把公告栏上的旧海报吹得沙沙作响。窗外的操场上还有人在练习投篮，篮球砸在篮板上的声音一下一下地传过来，又被走廊尽头的楼梯间吞没。你想起那天也下过一场小雨，地面湿漉漉的，她撑着一把透明的伞站在门口，说自己忘了带钥匙。「你还记得吗？」她终于停下来，回头看着你，「第一次来这里的时候，我们也是这样一前一后地走着。」'
const LAST = '楼梯口的灯一盏接一盏亮了起来。她把书包换到另一边肩上，像是想说什么，又把话咽了回去，只是朝你笑了笑，示意你跟上。远处传来社团活动结束的哨声，操场上的人影渐渐散去，只剩下长长的影子落在台阶上。'
const body = ['"Ready."', LONG, 'She stops.', LAST].join('\n')
// The cards with any bracket a card reopens or closes taken off, joined: the page's line.
const unbracket = (cards, line) => { let out = ''; for (const card of cards) { let text = card; if (out && /^[「（]/.test(text) && !line.startsWith(out + text[0])) text = text.slice(1); if (/[」）]$/.test(text) && !line.startsWith(out + text)) text = text.slice(0, -1); out += text } return out }

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
        const typing = () => stage.locator('.dsh-tavern-stage-type-rest').count().then(count => count > 0)
        const typed = () => stage.locator('.dsh-tavern-stage-type[data-typed]').waitFor()
        const nextButton = stage.getByRole('button', { name: '下一句', exact: true })
        const backButton = stage.getByRole('button', { name: '上一句', exact: true })
        const config = page.locator('.dsh-tavern-stage-config[role="dialog"]')
        const slider = name => config.getByRole('slider', { name, exact: true })
        const openText = async () => { await stage.locator('.dsh-tavern-stage-controls [data-action="sound"]').click(); await config.waitFor(); await config.getByRole('tab', { name: /^文字/ }).click() }
        const close = async () => { await config.getByRole('button', { name: '关闭设置', exact: true }).click(); await config.waitFor({ state: 'detached' }) }
        // The card on screen: its text, the lines it takes, and whether the text area (or the page) overflows.
        const shown = () => stage.evaluate(node => {
          const area = node.querySelector('.dsh-tavern-stage-text'), type = area.querySelector('.dsh-tavern-stage-type'), box = node.querySelector('.dsh-tavern-stage-textbox')
          const range = document.createRange(); range.selectNodeContents(type)
          const a = area.getBoundingClientRect(), b = box.getBoundingClientRect(), lineHeight = parseFloat(getComputedStyle(area).lineHeight)
          // a glyph still fading in sits a little low: lines are line-height steps from the text area's top
          const tops = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0).map(rect => Math.floor((rect.top + rect.height / 2 - a.top + area.scrollTop) / lineHeight)))
          return { text: type.textContent, lines: tops.size, overflow: area.scrollHeight > area.clientHeight + 1, outside: a.bottom > b.bottom + .5 || a.right > b.right + .5,
            page: document.documentElement.scrollWidth > window.innerWidth, progress: node.querySelector('.dsh-tavern-stage-progress').textContent }
        })
        const fits = card => { assert.equal(card.overflow, false, 'the card overflows its text area: ' + JSON.stringify(card)); assert.equal(card.outside, false); assert.equal(card.page, false); assert.ok(card.lines >= 1 && card.lines <= 3, 'lines: ' + card.lines) }
        // Walks the page on screen from its current card: › finishes a typing card, the next › shows the next card; returns the cards
        // seen before the page turned.
        async function walk(label) {
          const start = (await shown()).progress, cards = []
          for (let n = 0; n < 40; n++) {
            await typed()
            const card = await shown(); fits(card); cards.push(card)
            if (label && n < 2) { await page.waitForTimeout(450); await page.screenshot({ path: join(output, label + '-card' + (n + 1) + '.png') }) }
            await nextButton.click()
            await page.waitForFunction(([before, text]) => { const t = document.querySelector('.dsh-tavern-stage-text .dsh-tavern-stage-type'); return document.querySelector('.dsh-tavern-stage-progress').textContent !== before || t && t.textContent !== text }, [start, card.text])
            if ((await shown()).progress !== start) return cards
          }
          throw Error('the page never turned')
        }
        async function measure(width, label) {
          await at('1 / 4'); await typed()
          await stageNext(stage); await at('2 / 4')
          // 1. The long line opens on its first card, typing; the whole card is laid out from the start and fits.
          await page.waitForTimeout(300)
          assert.equal(await typing(), true, 'the first card types')
          const first = await shown(); fits(first)
          assert.ok(first.text.length < LONG.length && LONG.startsWith(first.text), 'a card, not the whole line: ' + first.text)
          await page.screenshot({ path: join(output, label + '-typing.png') })
          // 2. → finishes the card and stays on it; the next → shows the next card on the same page.
          await page.keyboard.press('ArrowRight'); await typed()
          assert.equal((await shown()).text, first.text, 'the first key finished the card')
          assert.equal((await shown()).progress, '2 / 4')
          await page.keyboard.press('ArrowRight')
          await page.waitForFunction(text => document.querySelector('.dsh-tavern-stage-text .dsh-tavern-stage-type').textContent !== text, first.text)
          const second = await shown(); fits(second)
          assert.equal(second.progress, '2 / 4', 'a card turn is not a page turn')
          await page.waitForTimeout(150)
          assert.equal(await typing(), true, 'the next card types')
          // 3. ‹ walks back to the first card; every card fits and together they are the line.
          await backButton.click(); await typed()
          assert.equal((await shown()).text, first.text)
          const cards = await walk(label)
          await at('3 / 4')
          assert.equal(unbracket(cards.map(card => card.text), LONG), LONG, 'the cards are the line: ' + JSON.stringify(cards.map(card => card.text)))
          // 4. ‹ from the next page lands on the long page's last card.
          await typed(); await backButton.click(); await at('2 / 4'); await typed()
          assert.equal((await shown()).text, cards.at(-1).text, 'back lands on the last card')
          await backButton.click(); await typed()
          assert.equal((await shown()).text, cards.at(-2).text, 'and walks the cards back')
          await page.waitForTimeout(450)
          await page.screenshot({ path: join(output, label + '-back.png') })
          // 5. 跳过 fast-forwards to the last page's last card and stops there, whole; the input waits there, › is off.
          await stage.getByRole('button', { name: '跳过', exact: true }).click(); await at('4 / 4')
          await stage.locator('.dsh-tavern-stage-controls [data-action="skip"][aria-pressed="false"]').waitFor()
          assert.equal(await typing(), false, '跳过 shows the card whole')
          const end = await shown(); fits(end)
          assert.ok(LAST.endsWith(end.text.replace(/^[「（]/, '')), 'the last card: ' + end.text)
          assert.equal(await nextButton.isDisabled(), true)
          await stage.locator('.dsh-tavern-stage-choices').waitFor()
          await page.waitForTimeout(450)
          await page.screenshot({ path: join(output, label + '-skip.png') })
          // A card before the last: the input waits for the last card.
          await backButton.click(); await typed()
          const before = await shown()
          assert.equal(await stage.locator('.dsh-tavern-stage-choices').count(), 0, 'the input shows on the last card only')
          assert.equal(await nextButton.isDisabled(), false)
          // 6. A backlog jump to the long page shows its first card whole.
          await page.keyboard.press('l')
          const backlog = page.locator('.dsh-tavern-stage-backlog[role="dialog"]')
          await backlog.waitFor()
          await backlog.locator('.dsh-tavern-stage-backlog-row[data-page="2"]').last().click()
          await backlog.waitFor({ state: 'detached' }); await at('2 / 4')
          assert.equal(await typing(), false, 'a backlog jump shows the card whole')
          assert.equal((await shown()).text, first.text, 'on the first card')
          return { width, cards: cards.length, lines: cards.map(card => card.lines), lastPageCards: before.progress === '4 / 4' ? 'several' : 'one' }
        }
        steps.wide = await measure(1920, 'w1920')
        // 7. Auto paging reads every card of the page before it turns (瞬间 text, the fastest pace).
        await openText(); await slider('文字速度').focus(); await page.keyboard.press('End'); await slider('自动阅读速度').fill('3'); await close()
        await backButton.click(); await at('1 / 4'); await stageNext(stage); await at('2 / 4')
        const seen = []
        const watch = setInterval(() => { shown().then(card => { const key = card.progress + ' ' + card.text; if (seen.at(-1) !== key) seen.push(key) }, () => {}) }, 120)
        await stage.getByRole('button', { name: '自动', exact: true }).click()
        await at('3 / 4')
        clearInterval(watch)
        await stage.getByRole('button', { name: '自动', exact: true }).click()
        const onLong = seen.filter(key => key.startsWith('2 / 4'))
        assert.equal(onLong.length, steps.wide.cards, 'auto showed every card: ' + JSON.stringify(seen))
        steps.auto = onLong.length
        await openText(); await slider('文字速度').fill('52'); await slider('自动阅读速度').fill('1'); await close()
        // 8. A phone: the same line in more, shorter cards; nothing overflows.
        await page.setViewportSize({ width: 375, height: 812 })
        for (let n = 0; n < 30 && await progress.innerText() !== '1 / 4'; n++) { await backButton.click(); await page.waitForTimeout(60) }
        steps.narrow = await measure(375, 'w375')
        assert.ok(steps.narrow.cards > steps.wide.cards, 'more cards on a phone: ' + steps.narrow.cards + ' vs ' + steps.wide.cards)
        // 9. Reopening the stage restores the page on its first card, whole (at 1920: on a phone the host's side bar covers 舞台).
        await page.setViewportSize({ width: 1920, height: 1080 })
        await stage.getByRole('button', { name: '退出舞台', exact: true }).click(); await stage.waitFor({ state: 'detached' })
        await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor(); await at('2 / 4')
        assert.equal(await typing(), false, 'the reopened page shows its card whole')
        const reopened = await shown(); fits(reopened)
        assert.ok(LONG.startsWith(reopened.text) && reopened.text.length < LONG.length)
        steps.reopen = true
        return steps
      }
    })
    await writeFile(join(output, 'stage-pager.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ pager: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
