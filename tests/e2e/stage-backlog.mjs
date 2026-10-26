// The stage's backlog (cast-presentation.md 24/N) over the real stage: the control bar's 「履历」 opens it with the current page
// at the bottom; it scrolls back across the earlier turns the stage holds; a spoken line in an earlier turn replays its voice
// without jumping; a row of the latest turn jumps the stage to its page; L, Esc, a wheel up and a wheel down past its end open
// and close it; it covers the whole stage and fits 375; two speakers' lines show avatar, name and 朗读这句; nothing it does
// reaches the save. Fresh disposable profile only, no model calls. Nothing reaches a
// speaker: 配音 uses the browser channel and the page's speechSynthesis is a recorder; every AudioContext ends in a zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { CAST_DATA_OWNER } from '../../tavern-plugin/lib/domain/cast-annotation.js'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

// Three more turns of six pages each, two speakers (Aoi, Ren) talking between narration: the backlog then holds more than a
// screen, and both screenshots show spoken rows (avatar, name, 朗读这句) beside a turn's separator. [speaker, emotion, text];
// a speaker's page quotes one line.
const script = {
  3: [['', '', 'Rain taps on the windows of the old house while the evening settles over the hall.'],
    ['Aoi', 'joy', '"Ren! You made it before the storm." Aoi waves from the top of the stairs.'],
    ['Ren', 'joy', '"Only just. The bridge road is already a river." Ren shakes the rain from her coat.'],
    ['', '', 'The lamps along the hall flicker once, then settle into a steady amber glow.'],
    ['Aoi', 'sadness', '"The power has been like that all week. I keep candles in every drawer now."'],
    ['', '', 'Somewhere upstairs a door creaks open on its own and stays that way.']],
  4: [['', '', 'They carry the lanterns into the library, where the fire has burned down to embers.'],
    ['Ren', 'joy', '"Look at all these letters. Who kept every single one of them?" Ren lifts a bundle tied with ribbon.'],
    ['Aoi', 'joy', '"My grandmother. She answered everyone who ever wrote to her, even strangers."'],
    ['Ren', 'sadness', '"This one is addressed to you, and it was never opened."'],
    ['', '', 'The clock on the mantel stops ticking; the room goes quiet enough to hear the rain again.'],
    ['Aoi', 'sadness', '"Then I suppose tonight is the night I read it." Aoi takes the envelope with both hands.']],
  5: [['', '', 'The envelope is lighter than it looks; inside there is a single folded page and a brass key.'],
    ['Ren', 'joy', '"A key! It has to open something in this house." Ren is already on her feet.'],
    ['Aoi', 'joy', '"The music box in the attic. She never let anyone wind it."'],
    ['Ren', 'joy', '"Then let us go and hear what it plays, before the lamps change their mind again."'],
    ['', '', 'They climb the narrow stairs together, the key warm in Aoi\'s palm.'],
    ['Aoi', 'joy', '"Ready?" Aoi turns the key three times, and the first note rings out.']]
}
const rounds = Object.entries(script).map(([round, pages]) => ({ user: 'Go on ' + round + '.', assistant: pages.map(page => page[2]).join('\n') }))
const annotations = Object.fromEntries(Object.entries(script).map(([round, pages]) => [round, { version: 1,
  lines: pages.filter(page => page[0]).map(([speaker, emotion, text], index) => ({ n: index + 1, quote: text.match(/"([^"]+)"/)[1], speaker, emotion })) }]))

// A PNG drawn by colourAt(x, y) -> [r, g, b]: a speaker's avatar.
function png(width, height, colourAt) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6], 8)
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([...colourAt(x, y), 255], y * (width * 4 + 1) + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// A head-and-shoulders silhouette in `ink` on `paper` (64 px).
const bust = (paper, ink) => png(64, 64, (x, y) => (x - 32) ** 2 + (y - 26) ** 2 <= 144 || ((x - 32) / 24) ** 2 + ((y - 64) / 22) ** 2 <= 1 ? ink : paper)

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  // The browser channel speaks through speechSynthesis: a recorder that ends each line after 150 ms.
  await page.addInitScript(() => {
    window.spoken = []
    const synth = { speaking: false, pending: false, paused: false, speak(utterance) { window.spoken.push(utterance.text); setTimeout(() => utterance.onend && utterance.onend(), 150) },
      cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {} }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth })
  })
  try {
    const result = await stageStateChecks({ page, output, bodyText: '"Ready."\nSomeone knocks at the door.\nThe hall is quiet again.',
      async inspect({ stage, call, sessionId, name }) {
        const steps = {}
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const at = value => progress.filter({ hasText: value }).waitFor()
        const backlog = page.locator('.dsh-tavern-stage-backlog[role="dialog"]')
        const list = backlog.locator('.dsh-tavern-stage-backlog-list')
        const entry = stage.getByRole('button', { name: '履历', exact: true })
        const row = (turn, number) => backlog.locator('.dsh-tavern-stage-backlog-row[data-turn="' + turn + '"][data-page="' + number + '"]')
        const save = async () => { const value = readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64')); return JSON.stringify([value.chat.messages, value.plugins]) }
        // Opens a game of this card by its title, then its stage.
        const show = async (id, title) => {
          await call('renameConversation', { sessionId: id, title })
          await page.reload()
          const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
          await group.waitFor()
          if (await group.getAttribute('aria-expanded') === 'false') await group.click()
          await page.getByText(title, { exact: true }).first().click()
          if (!await stage.isVisible()) await page.getByRole('button', { name: '舞台', exact: true }).click()
          await stage.waitFor()
        }
        // Every speaker has an avatar. Turns 3-5 arrive and their lines get speakers the way a settled turn does (the cast
        // annotation travels through a native save round trip, no model); the stage opens that game on turn 5's first page.
        for (const [who, paper, ink] of [[name, [240, 200, 60], [120, 80, 20]], ['Aoi', [50, 130, 105], [222, 245, 236]], ['Ren', [200, 90, 120], [250, 228, 236]]])
          await call('castSetImage', { sessionId, name: who, slot: 'avatar', data: bust(paper, ink).toString('base64') })
        await call('appendStoryRounds', { sessionId, rounds })
        const exported = readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64'))
        exported.plugins.data.owners[CAST_DATA_OWNER].turns.push(...Object.entries(annotations).map(([round, data]) =>
          ({ turn: Number(round), key: computeSceneTarget(exported.chat, Number(round)).key, data, bytes: JSON.stringify(data).length, updatedAt: 1 })))
        const voiced = (await call('importGameSave', { fileB64: buildGameSave({ ...exported, tavernVersion: exported.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })).sessionId
        await call('updateSpeechSettings', { enabled: true, provider: 'browser', config: {} })
        await show(voiced, 'Stage backlog voiced ' + Date.now())
        await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'The envelope is lighter' }).waitFor()
        await at('1 / 6')
        const origin = sessionId
        sessionId = voiced
        const before = await save()
        // A screenshot of the open backlog once its wipe-in has finished and its pictures have loaded: the sheet covers the
        // whole stage (every edge point is the backlog's), nothing of the stage shows undimmed.
        const shot = async file => {
          await backlog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)))
          // Rows rendered past the list's edges keep their lazy avatars unloaded; wait for the ones in view (the list, not the
          // window: a row scrolled under the header is not loaded unless the chat already showed that avatar).
          await list.evaluate(node => { const edge = node.getBoundingClientRect(); return Promise.all([...node.querySelectorAll('img')].filter(image => { const box = image.getBoundingClientRect(); return box.bottom > edge.top && box.top < edge.bottom })
            .map(image => image.complete || new Promise(done => { image.onload = image.onerror = done }))) })
          const cover = await backlog.evaluate(node => {
            const box = node.getBoundingClientRect(), w = innerWidth, h = innerHeight
            const points = [[1, 1], [w / 2, 1], [w - 1, 1], [1, h - 1], [w / 2, h - 1], [w - 1, h - 1], [1, h / 2], [w - 1, h / 2]]
            return { box: [box.left, box.top, box.width, box.height], viewport: [w, h], clip: getComputedStyle(node).clipPath,
              outside: points.filter(([x, y]) => !node.contains(document.elementFromPoint(x, y))), sideways: document.documentElement.scrollWidth > w }
          })
          assert.deepEqual(cover.box, [0, 0, ...cover.viewport], file + ': the backlog covers the stage')
          assert.deepEqual([cover.clip, cover.outside, cover.sideways], ['none', [], false], file + ': ' + JSON.stringify(cover))
          await page.screenshot({ path: join(output, file) })
        }
        for (let i = 0; i < 3; i++) await stageNext(stage)
        await at('4 / 6')
        // 1. 「履历」 opens it: the current page is the last row, in view, the list has the keyboard; the stage's box is hidden.
        await entry.click()
        await backlog.waitFor()
        const here = backlog.locator('.dsh-tavern-stage-backlog-row.is-here')
        assert.deepEqual([await here.getAttribute('data-turn'), await here.getAttribute('data-page')], ['5', '4'])
        assert.ok(await here.isVisible(), 'the current page is in view')
        assert.equal(await row(5, 5).count(), 0, 'an unread page is not listed')
        assert.ok(await list.evaluate(node => node === document.activeElement), 'the list has the keyboard')
        assert.equal(await stage.locator('.dsh-tavern-stage-textbox').evaluate(node => getComputedStyle(node).visibility), 'hidden')
        // Both speakers' lines are in view with their avatar, name and 朗读这句, under the turn's separator.
        steps.speakers = await backlog.locator('.dsh-tavern-stage-backlog-row.is-line').evaluateAll(nodes => nodes.filter(node => {
          const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight
        }).map(node => [node.querySelector('.dsh-tavern-stage-backlog-name b').textContent, Boolean(node.querySelector('.dsh-tavern-stage-backlog-face img')), Boolean(node.querySelector('.dsh-tavern-stage-backlog-name button'))]))
        assert.ok(['Aoi', 'Ren'].every(who => steps.speakers.some(([speaker, face, voice]) => speaker === who && face && voice)), 'spoken rows in view: ' + JSON.stringify(steps.speakers))
        await shot('backlog-1920.png')
        // 2. It scrolls back across the earlier turns to the first one the stage holds.
        const seen = new Set()
        const visibleTurns = () => backlog.locator('.dsh-tavern-stage-backlog-turn').evaluateAll(nodes => nodes.filter(node => {
          const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight
        }).map(node => node.textContent))
        const { scrollHeight, clientHeight } = await list.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
        assert.ok(scrollHeight > clientHeight * 1.5, 'the backlog is longer than a screen: ' + scrollHeight + ' / ' + clientHeight)
        // In the list's view, not merely rendered (the window renders 20 rows beyond each edge).
        const inView = locator => locator.evaluate(node => { const box = node.getBoundingClientRect(), view = node.closest('.dsh-tavern-stage-backlog-list').getBoundingClientRect(); return box.top >= view.top && box.bottom <= view.bottom }).catch(() => false)
        for (let i = 0; i < 40 && !(await inView(row(2, 1))); i++) {
          (await visibleTurns()).forEach(value => seen.add(value))
          await page.mouse.move(960, 540); await page.mouse.wheel(0, -400); await page.waitForTimeout(80)
        }
        await row(2, 1).waitFor()
        ;(await visibleTurns()).forEach(value => seen.add(value))
        steps.turns = [...seen]
        assert.ok(['第 2 轮', '第 3 轮', '第 4 轮', '第 5 轮 · 本轮'].every(value => seen.has(value)), 'scrolled across the turns: ' + steps.turns)
        assert.equal(await row(2, 1).getAttribute('role'), null, 'an earlier turn is read-only')
        const read = await call('castStage', { sessionId, count: 5 })
        assert.equal(await row(2, 1).locator('.dsh-tavern-stage-backlog-name b').innerText(), read.turns.find(turn => turn.turn === 2).pages[0].speaker)
        assert.equal(await row(2, 1).locator('.dsh-tavern-stage-backlog-face img').getAttribute('src'), read.cast.find(item => item.name === name).avatarUrl, 'a spoken line shows its speaker\'s avatar')
        await shot('backlog-earlier-1920.png')
        // 3. The earlier line's 朗读 says it again (its quote, as the stage reads it); the stage stays where it was.
        const said = await page.evaluate(() => window.spoken.length)
        await row(2, 1).getByRole('button', { name: '朗读这句', exact: true }).click()
        await page.waitForFunction(count => window.spoken.length > count, said)
        steps.replayed = await page.evaluate(count => window.spoken.slice(count), said)
        assert.deepEqual(steps.replayed, ['Ready.'])
        assert.ok(await backlog.isVisible(), 'a replay does not close the backlog')
        assert.equal(await progress.textContent(), '4 / 6', 'the stage stays on its page (hidden under the backlog)')
        // 4. A row of the latest turn jumps there: the backlog closes, the stage shows that page, focus is back on 「履历」.
        await list.focus(); await page.keyboard.press('End')
        await row(5, 2).click()
        await backlog.waitFor({ state: 'detached' })
        await at('2 / 6')
        assert.ok(await entry.evaluate(node => node === document.activeElement), 'focus returns to 履历')
        steps.jump = true
        // 5. L opens it and Esc closes only it; a wheel up over the scene opens it and a wheel down past its end closes it.
        await page.keyboard.press('l'); await backlog.waitFor()
        await page.keyboard.press('Escape'); await backlog.waitFor({ state: 'detached' })
        assert.ok(await stage.isVisible(), 'Esc closed the backlog, not the stage')
        await page.waitForTimeout(500)
        await page.mouse.move(960, 300); await page.mouse.wheel(0, -150); await backlog.waitFor()
        await page.waitForTimeout(500)
        await page.mouse.wheel(0, 150); await backlog.waitFor({ state: 'detached' })
        await page.waitForTimeout(500)
        assert.equal(await progress.innerText(), '2 / 6', 'the closing wheel did not also turn a page')
        steps.keys = true
        // 6. 375: the sheet's column, rows and close fit the screen, no sideways scroll.
        await page.setViewportSize({ width: 375, height: 812 })
        await page.keyboard.press('l'); await backlog.waitFor()
        const boxes = await backlog.locator('.dsh-tavern-stage-backlog-col, .dsh-tavern-stage-backlog-row, .dsh-tavern-stage-backlog-close').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))
        assert.ok(boxes.length > 3 && boxes.every(box => box.left >= -.5 && box.right <= 375.5), '375: ' + JSON.stringify(boxes.find(box => box.left < -.5 || box.right > 375.5)))
        assert.equal(await list.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'no sideways scroll')
        await shot('backlog-375.png')
        await backlog.getByRole('button', { name: '关闭履历', exact: true }).click(); await backlog.waitFor({ state: 'detached' })
        await page.setViewportSize({ width: 1920, height: 1080 })
        steps.narrow = boxes.length
        // 7. Reading the backlog, replaying and jumping never write the save.
        await call('updateSpeechSettings', { enabled: false })
        await page.evaluate(() => window.dispatchEvent(new Event('dsh-tavern-settings-changed')))
        assert.equal(await save(), before, 'the save is unchanged')
        steps.save = true
        // Back to the game stage-state.mjs goes on with.
        await show(origin, 'Stage backlog origin ' + Date.now())
        return steps
      }
    })
    await writeFile(join(output, 'stage-backlog.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ backlog: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
