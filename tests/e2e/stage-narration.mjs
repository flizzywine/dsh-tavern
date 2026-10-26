// 旁白 (cast-presentation.md 29/N) on the real stage: a skin that declares art.narration reads its narration pages without the
// box - the lines centred over the darkened scene, or in a band along the bottom while the page's item picture shows - and with
// art.narration.lines brings each card in visual line by visual line. 经典 and line pages keep the box; 跳过 keeps it while it
// fast-forwards; a click finishes the lines; reduced motion shows them at once. Fresh disposable profile only, no model calls.
// Nothing reaches a speaker: every AudioContext ends in stage-state's zero gain.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

const LONG = '雨在傍晚停了。街灯一盏接一盏地亮起来，石板路上的水洼映着它们，像是有人把整条街的光都折起来，藏进了脚下。她站在路口，很久都没有动。'
const ITEM = '她从口袋里取出那盏小小的灯，灯罩上还留着去年冬天的划痕。'
const body = ['"Ready."', LONG, ITEM, '远处传来了钟声。'].join('\n')
// An original 160×160 picture: a lantern, an amber pane in a dark frame on transparency.
function lantern() {
  const size = 160, rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const frame = Math.abs(x - 80) <= 40 && y >= 30 && y <= 140, pane = Math.abs(x - 80) <= 32 && y >= 38 && y <= 132
      row.set(pane ? [244, 176, 74, 255] : frame || Math.abs(x - 80) < 4 && y >= 12 && y < 30 ? [52, 40, 34, 255] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const chunk = (type, data) => {
    const all = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(all.length + 8)
    result.writeUInt32BE(data.length); all.copy(result, 4); result.writeUInt32BE(crc32(all), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
// An original skin: ink on paper in the box; its narration boxless on a 576-high design screen, lines fading in one by one.
const paper = { schema: 'dsh.skin/1', id: 'paper-night', label: '纸·夜',
  textbox: { paint: { bg: '#f4efe6', fg: '#1d1a22', fgMuted: '#4a4550', accent: '#8a2a3a', onAccent: '#ffffff', border: '#4a4550' }, shape: { radius: 4 } },
  nameplate: { shape: 'plain', paint: { bg: '#2a2440', fg: '#ffffff' } }, font: {}, textFx: { reveal: 'type' },
  art: { screen: 576, screenWidth: 1024, narration: { font: 30, pitch: 54, veil: .62, y: 280, band: { font: 24, pitch: 38, veil: .5, bottom: 0 }, lines: { fade: .5, stagger: .6, rise: 18 } } } }
// The same paper by day: dark ink with no halo over a light veil (31/N), the stage's own layout rule.
const day = { ...paper, id: 'paper-day', label: '纸·昼',
  art: { ...paper.art, narration: { ...paper.art.narration, veil: .75, band: { ...paper.art.narration.band, veil: .75 }, ink: '#1d1a22', halo: false, veilColor: '#f4efe6' } } }
// And with narration kept in the box (layout box), in the skin's own narration ink, still line by line.
const boxed = { ...paper, id: 'paper-box', label: '纸·框', textStyle: { narration: '#3a2050' },
  art: { ...paper.art, narration: { ...paper.art.narration, layout: 'box' } } }

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
    const result = await stageStateChecks({ page, output, bodyText: body, items: [{ name: '提灯', bytes: lantern() }],
      performances: () => [{ at: 3, op: 'item.play', item: '提灯' }],
      async inspect({ stage, call, cardPath }) {
        const steps = {}
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const at = value => progress.filter({ hasText: value }).waitFor()
        const overlay = page.locator('.dsh-tavern-stage-overlay')
        const backButton = stage.getByRole('button', { name: '上一句', exact: true })
        const layout = () => overlay.getAttribute('data-narration-layout')
        // What the narration page shows: the box, its text, the lines and the scene's light.
        const look = () => page.evaluate(() => {
          const root = document.querySelector('.dsh-tavern-stage-overlay'), box = root.querySelector('.dsh-tavern-stage-textbox'), text = root.querySelector('.dsh-tavern-stage-text')
          const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width } }
          const controls = root.querySelector('.dsh-tavern-stage-controls')
          return { layout: root.dataset.narrationLayout || '', box: rect(box), text: rect(text), font: parseFloat(getComputedStyle(text).fontSize), color: getComputedStyle(text).color,
            background: getComputedStyle(box).backgroundColor, figures: getComputedStyle(root.querySelector('.dsh-tavern-stage-figures')).filter,
            veil: getComputedStyle(root.querySelector('.dsh-tavern-stage-figures'), '::after').backgroundColor, controls: controls ? rect(controls) : null,
            shadow: getComputedStyle(text).textShadow, controlInk: controls ? getComputedStyle(controls).color : '',
            name: root.querySelector('.dsh-tavern-stage-name') ? getComputedStyle(root.querySelector('.dsh-tavern-stage-name')).display : '',
            lines: [...root.querySelectorAll('.dsh-tavern-stage-line')].map(line => ({ text: line.textContent, opacity: +getComputedStyle(line).opacity, rect: rect(line) })),
            typed: Boolean(root.querySelector('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]')), instant: Boolean(root.querySelector('.dsh-tavern-stage-lines[data-instant]')),
            overflow: document.documentElement.scrollWidth > innerWidth }
        })
        // 1. 经典: the narration page keeps its box and types glyph by glyph.
        await at('1 / 4'); await stageNext(stage); await at('2 / 4')
        await page.waitForTimeout(200)
        assert.equal(await layout(), null, '经典 declares no art.narration')
        assert.ok(await stage.locator('.dsh-tavern-stage-glyph').count() > 0, 'glyph by glyph')
        assert.equal(await stage.locator('.dsh-tavern-stage-line').count(), 0)
        // The skin enters as the card's pack entry and is the pack's default.
        const upload = document => page.evaluate(async text => (await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: text })).json()).uploadId, JSON.stringify(document))
        const { pack } = await call('createAssetPack', { name: '纸 ' + Date.now() % 100000 })
        await call('setAssetPackState', { path: cardPath, packId: pack.manifest.id, state: 'card' })
        const wear = async document => {
          await call('addAssetPackSkin', { packId: pack.manifest.id, document: await upload(document), files: [] })
          const revision = (await call('getAssetPack', { packId: pack.manifest.id })).pack.revision
          await call('setAssetPackStageSkin', { packId: pack.manifest.id, expectedRevision: revision, skin: document.id })
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
          await page.locator('.dsh-tavern-stage-overlay[data-fk-skin="' + document.id + '"]').waitFor()
        }
        await wear(paper)
        // 2. A line page keeps the box.
        await backButton.click(); await at('1 / 4')
        assert.equal(await layout(), null, 'a line page keeps its box')
        // 3. The long narration: no box, centred on art.narration.y over the darkened scene, its lines coming in one by one.
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        const opened = await page.evaluate(() => performance.now())
        await stage.getByRole('button', { name: '下一句', exact: true }).click(); await at('2 / 4')
        await page.waitForTimeout(350)
        const early = await look()
        await page.screenshot({ path: join(output, 'w1920-screen-lines.png') })
        assert.equal(early.layout, 'screen')
        assert.ok(early.lines.length >= 3, 'visual lines: ' + JSON.stringify(early.lines.map(line => line.text)))
        assert.equal(early.lines.map(line => line.text).join(''), LONG, 'the lines are the card, in order')
        assert.ok(early.lines[0].opacity > 0 && early.lines.at(-1).opacity === 0 && !early.typed, 'the first line is in, the last still waits: ' + JSON.stringify(early.lines.map(line => line.opacity)))
        assert.equal(early.background, 'rgba(0, 0, 0, 0)', 'no box paint')
        assert.ok(['', 'none'].includes(early.name), 'no name plate')
        assert.equal(early.veil, 'rgba(0, 0, 0, 0.62)', 'one black veil over the backdrop and the figures')
        assert.equal(early.shadow.split('rgb').length - 1, 3, 'the default halo: ' + early.shadow)
        assert.ok(Math.abs(early.font - 30 * 1080 / 576) < .5, 'design px: ' + early.font)
        assert.equal(early.color, 'rgb(251, 248, 255)')
        const middle = (early.text.top + early.text.bottom) / 2
        assert.ok(Math.abs(middle - 280 * 1080 / 576) < 4, 'centred on y 280 of 576: ' + middle)
        assert.ok(early.controls && early.controls.top >= early.text.bottom - 1, 'the controls follow the lines')
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        const took = await page.evaluate(start => performance.now() - start, opened)
        const full = await look()
        await page.screenshot({ path: join(output, 'w1920-screen-typed.png') })
        assert.ok(full.lines.every(line => line.opacity === 1))
        const expected = ((full.lines.length - 1) * .6 + .5) * 1000
        assert.ok(took >= expected - 50 && took < expected + 1500, 'typed after the last line faded in: ' + Math.round(took) + ' ms, lines from ' + expected + ' ms')
        steps.screen = { lines: full.lines.length, font: full.font, middle: Math.round(middle), typedMs: Math.round(took) }
        // 4. A click mid-way shows every line at once, on the same page.
        await backButton.click(); await at('1 / 4')
        await stageNext(stage); await at('2 / 4')
        await page.waitForTimeout(300)
        await stage.locator('.dsh-tavern-stage-scene').click({ position: { x: 300, y: 200 } })
        await stage.locator('.dsh-tavern-stage-lines[data-instant][data-typed]').waitFor()
        assert.equal((await progress.innerText()).trim(), '2 / 4', 'the click finished the lines, it did not turn the page')
        assert.ok((await look()).lines.every(line => line.opacity === 1))
        steps.finish = true
        // 5. The item's page: a band along the bottom, the scene in its own light; the picture plays above the band.
        await stageNext(stage); await at('3 / 4')
        await page.waitForTimeout(400)
        const band = await look()
        assert.equal(band.layout, 'band')
        assert.ok(Math.abs(band.box.bottom - 1080) < 1 && Math.abs(band.box.width - 1920) < 1, 'the band spans the bottom: ' + JSON.stringify(band.box))
        assert.equal(band.background, 'rgba(0, 0, 0, 0.5)')
        assert.equal(band.veil, 'rgba(0, 0, 0, 0)', 'the scene keeps its light')
        assert.ok(Math.abs(band.font - 24 * 1080 / 576) < .5)
        const item = stage.locator('.dsh-tavern-stage-item')
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.dsh-tavern-stage-item')).opacity) > .9, null, { timeout: 4000 })
        const picture = await item.evaluate(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
        await page.screenshot({ path: join(output, 'w1920-band-item.png') })
        assert.ok(picture.bottom <= band.box.top, 'the picture stays clear of the band: ' + JSON.stringify({ picture, band: band.box }))
        steps.band = { top: Math.round(band.box.top), picture: Math.round(picture.bottom) }
        // 6. 跳过 keeps the box while it fast-forwards; where it stops (the last page, narration) the layout comes back.
        await backButton.click(); await at('2 / 4'); await backButton.click(); await at('1 / 4')
        await page.evaluate(() => {
          window.skipLayouts = []
          const root = document.querySelector('.dsh-tavern-stage-overlay')
          const note = () => window.skipLayouts.push({ skipping: root.querySelector('[data-action="skip"]')?.getAttribute('aria-pressed') === 'true', layout: root.dataset.narrationLayout || '', page: root.querySelector('.dsh-tavern-stage-progress')?.textContent })
          window.skipObserver?.disconnect()
          window.skipObserver = new MutationObserver(note)
          window.skipObserver.observe(root, { subtree: true, attributes: true, childList: true, characterData: true })
        })
        await stage.getByRole('button', { name: '跳过', exact: true }).click()
        await stage.locator('[data-action="skip"][aria-pressed="false"]').waitFor()
        await at('4 / 4')
        const log = await page.evaluate(() => { window.skipObserver.disconnect(); return window.skipLayouts })
        assert.ok(log.some(entry => entry.skipping && /[234] \/ 4/.test(entry.page)), 'it passed the narration pages')
        assert.equal(log.filter(entry => entry.skipping && entry.layout).length, 0, 'no layout while skipping')
        assert.equal(await layout(), 'screen', 'the layout returns where it stops')
        assert.ok((await look()).typed)
        steps.skip = log.filter(entry => entry.skipping).length
        // 7. Reduced motion: every line at once.
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await backButton.click(); await at('3 / 4'); await backButton.click(); await at('2 / 4')
        await stage.locator('.dsh-tavern-stage-lines[data-instant][data-typed]').waitFor({ timeout: 500 })
        const calm = await look()
        assert.ok(calm.instant && calm.typed && calm.lines.every(line => line.opacity === 1), 'reduced motion: ' + JSON.stringify(calm.lines.map(line => line.opacity)))
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        steps.reducedMotion = true
        // 8. A phone: the same lines inside the screen at the reading size.
        await page.setViewportSize({ width: 375, height: 812 })
        // back through the page's cards (it landed on its last one) to the line page
        for (let i = 0; i < 8 && (await progress.innerText()).trim() !== '1 / 4'; i++) { await backButton.click(); await page.waitForTimeout(120) }
        await at('1 / 4')
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        await stage.getByRole('button', { name: '下一句', exact: true }).click(); await at('2 / 4')
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        const phone = await look()
        await page.screenshot({ path: join(output, 'w375-screen-typed.png') })
        assert.equal(phone.layout, 'screen')
        assert.equal(phone.overflow, false)
        assert.ok(phone.font >= 17, 'the phone reading size: ' + phone.font)
        assert.ok(phone.lines.every(line => line.rect.left >= 0 && line.rect.right <= 375 + .5), JSON.stringify(phone.lines.map(line => line.rect)))
        // through the page's other cards to the item's page
        for (let i = 0; i < 8 && (await progress.innerText()).trim() !== '3 / 4'; i++) await stageNext(stage)
        await at('3 / 4')
        await page.waitForTimeout(1600)
        await page.screenshot({ path: join(output, 'w375-band.png') })
        assert.equal(await layout(), 'band')
        steps.phone = { lines: phone.lines.length, font: phone.font }
        await page.setViewportSize({ width: 1920, height: 1080 })
        const back = async () => { for (let i = 0; i < 8 && (await progress.innerText()).trim() !== '1 / 4'; i++) { await backButton.click(); await page.waitForTimeout(120) } await at('1 / 4') }
        // 9. Dark ink on a light veil: the skin's ink with no halo, its veil colour over the scene and in the band, the controls in its ink.
        await wear(day)
        await back()
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        await stageNext(stage); await at('2 / 4')
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        const light = await look()
        await page.screenshot({ path: join(output, 'w1920-day-screen.png') })
        assert.equal(light.layout, 'screen')
        assert.equal(light.color, 'rgb(29, 26, 34)', 'the skin\'s ink')
        assert.equal(light.shadow, 'none', 'halo: false')
        assert.equal(light.veil, 'rgba(244, 239, 230, 0.75)', 'the skin\'s veil colour at its strength')
        assert.equal(light.controlInk, 'rgb(29, 26, 34)', 'the controls take the ink')
        assert.ok(light.lines.every(line => line.opacity === 1))
        for (let i = 0; i < 8 && (await progress.innerText()).trim() !== '3 / 4'; i++) await stageNext(stage)
        await at('3 / 4'); await page.waitForTimeout(400)
        const lightBand = await look()
        await page.screenshot({ path: join(output, 'w1920-day-band.png') })
        assert.equal(lightBand.layout, 'band', 'no layout declared: the item picture still takes the band')
        assert.equal(lightBand.background, 'rgba(244, 239, 230, 0.75)')
        assert.equal(lightBand.color, 'rgb(29, 26, 34)')
        steps.day = { veil: light.veil, band: lightBand.background }
        // 10. layout box: narration stays in the box (its paint, no veil, also on the item's page) in textStyle.narration, line by line.
        await wear(boxed)
        await back()
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        await stageNext(stage); await at('2 / 4')
        await page.waitForTimeout(350)
        const kept = await look()
        await page.screenshot({ path: join(output, 'w1920-box-lines.png') })
        assert.equal(kept.layout, '', 'box: no boxless layout')
        assert.equal(kept.background, 'rgb(244, 239, 230)', 'the box keeps its paint')
        assert.equal(kept.veil, 'rgba(0, 0, 0, 0)', 'no veil')
        assert.equal(kept.color, 'rgb(58, 32, 80)', 'textStyle.narration')
        assert.ok(kept.lines.length >= 2 && kept.lines.at(-1).opacity < 1, 'still line by line in the box: ' + JSON.stringify(kept.lines.map(line => line.opacity)))
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        await page.screenshot({ path: join(output, 'w1920-box-typed.png') })
        for (let i = 0; i < 8 && (await progress.innerText()).trim() !== '3 / 4'; i++) await stageNext(stage)
        await at('3 / 4'); await page.waitForTimeout(400)
        assert.equal(await layout(), null, 'box wins over the item picture')
        await page.screenshot({ path: join(output, 'w1920-box-item.png') })
        steps.box = { lines: kept.lines.length, color: kept.color }
        return steps
      }
    })
    await writeFile(join(output, 'stage-narration.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ narration: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
