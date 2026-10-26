// 画面效果 (cast-presentation.md 35/N) on the real stage: the director's nine screen effects each play once on their page, on the
// scene's layers and under the text box; every flash is photosensitive-safe; a skin's `effects` restyles one; the system's
// reduced motion leaves out shakes, zoom, glitch and the wave. Fresh disposable profile only, no model calls; nothing reaches a
// speaker (stage-state's zero gain).
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { stageNext, stageStateChecks } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

// An original 240×480 figure on transparency: a round head over a rounded body, so the screenshots show a real sprite.
function figure(solid) {
  const w = solid ? 1 : 240, ht = solid ? 1 : 480, rows = []
  for (let y = 0; y < ht; y++) {
    const row = Buffer.alloc(1 + w * 4)
    for (let x = 0; x < w; x++) {
      const head = Math.hypot(x - 120, y - 80) < 56, body = y > 150 && y < 470 && Math.abs(x - 120) < 70 + (y - 150) / 8
      row.set(solid || (head ? [236, 206, 184, 255] : body ? [70, 96, 168, 255] : [0, 0, 0, 0]), 1 + x * 4)
    }
    rows.push(row)
  }
  const chunk = (type, data) => { const all = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(all.length + 8); out.writeUInt32BE(data.length); all.copy(out, 4); out.writeUInt32BE(crc32(all), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(ht, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
const EFFECTS = ['flash', 'flash-red', 'blackout', 'shake-1', 'shake-3', 'shock', 'glitch', 'heartbeat', 'shake-2']
const body = ['"Ready."', ...EFFECTS.map((effect, i) => 'Beat ' + (i + 2) + ': ' + effect + '.')].join('\n')
// An original skin: the classic look with its own flash colour and a stepped background shake for shake-1.
const skin = { schema: 'dsh.skin/1', id: 'fx-sample', label: '效果示例',
  textbox: { paint: { bg: '#14161c', fg: '#f4f1ea', fgMuted: '#b8b2a6', accent: '#d8b46a', onAccent: '#14161c', border: '#3a3d46' } },
  nameplate: { shape: 'pill', paint: { bg: '#d8b46a', fg: '#14161c' } }, font: {}, textFx: { reveal: 'type' },
  effects: { flash: { color: '#20c0ff' }, 'shake-1': { path: [[6, 0], [-6, 0], [3, 0]], step: 0.05, target: 'background' } } }

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.evaluate(() => localStorage.removeItem('dsh-tavern-stage-reading'))
  // Every part of a played effect: its id, the layer it moves and its keyframes.
  await page.addInitScript(() => {
    window.fxPlays = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options)
      if (/^stage(-fx)?:/.test(options?.id || '')) window.fxPlays.push({ id: options.id, layer: String(this.className).split(' ')[0].replace('dsh-tavern-stage-', ''), frames, ms: options.duration, animation: result })
      return result
    }
  })
  try {
    const result = await stageStateChecks({ page, output, bodyText: body, commands: { actionCaps: { beat: 9 } },
      performances: () => EFFECTS.map((effect, i) => ({ at: i + 2, op: 'screen.play', effect })),
      async inspect({ stage, call, cardPath, sessionId, name }) {
        await call('castSetImage', { sessionId, name, slot: 'sadness', data: figure().toString('base64') })
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-figure img')?.naturalWidth === 240)
        const progress = stage.locator('.dsh-tavern-stage-progress'), back = stage.getByRole('button', { name: '上一句', exact: true })
        const at = value => progress.filter({ hasText: value }).waitFor()
        const starts = () => page.evaluate(() => window.fxPlays.filter(play => play.id.startsWith('stage:')).length)
        // The parts of the newest play, summarised: layers, durations, the cover's peak and colour, the largest shake.
        const latest = () => page.evaluate(() => {
          const key = window.fxPlays.filter(play => play.id.startsWith('stage:')).at(-1).id.slice(6)
          const parts = window.fxPlays.filter(play => play.id === 'stage:' + key || play.id === 'stage-fx:' + key)
          const cover = parts.find(part => part.layer === 'fx-cover'), shake = part => Math.max(...part.frames.map(frame => frame.translate ? Math.abs(parseFloat(frame.translate)) : 0))
          return { key, layers: parts.map(part => part.layer), ms: parts.map(part => part.ms), cover: cover ? { peak: Math.max(...cover.frames.map(frame => frame.opacity)), color: cover.frames[0].backgroundColor } : null,
            world: parts.find(part => part.layer === 'backdrop') ? shake(parts.find(part => part.layer === 'backdrop')) : 0, box: parts.find(part => part.layer === 'textbox') ? shake(parts.find(part => part.layer === 'textbox')) : 0 }
        })
        // Freeze every part of the newest play at ms for a screenshot, then let it finish.
        const shot = async (name, ms) => {
          await page.evaluate(ms => { const key = window.fxPlays.filter(play => play.id.startsWith('stage:')).at(-1).id.slice(6); window.fxPlays.filter(play => play.id === 'stage:' + key || play.id === 'stage-fx:' + key).forEach(play => { play.animation.pause(); play.animation.currentTime = ms }) }, ms)
          await page.screenshot({ path: join(output, name + '.png') })
          await page.evaluate(() => window.fxPlays.forEach(play => play.animation.playState === 'paused' && play.animation.play()))
        }
        const visit = async (n, expectPlay = true) => {
          const before = await starts()
          await stageNext(stage); await at(n + ' / 10')
          if (expectPlay) await page.waitForFunction(count => window.fxPlays.filter(play => play.id.startsWith('stage:')).length > count, before)
          else { await page.waitForTimeout(1600); assert.equal(await starts(), before, 'page ' + n + ' plays nothing') }
          return expectPlay ? latest() : null
        }
        const plays = {}
        await at('1 / 10'); await page.waitForTimeout(1500)
        assert.equal(await starts(), 0, 'opening an existing page does not replay')
        // 1. Each effect once on its page, photosensitive-safe.
        for (const [i, effect] of EFFECTS.entries()) {
          plays[effect] = await visit(i + 2)
          if (['flash', 'flash-red', 'blackout', 'shock', 'glitch', 'heartbeat'].includes(effect)) await shot('effect-' + effect, { flash: 60, 'flash-red': 70, blackout: 700, shock: 120, glitch: 30, heartbeat: 110 }[effect])
          await page.waitForTimeout(1800)
        }
        assert.deepEqual(plays.flash.cover, { peak: 0.5, color: '#ffffff' }, 'white at most .5')
        assert.deepEqual(plays['flash-red'].cover, { peak: 0.4, color: '#72091a' }, 'saturated red turns dark, at most .4')
        assert.deepEqual(plays.blackout.cover, { peak: 1, color: '#000000' }, 'a dark cover is not a flash')
        for (const name of ['shake-1', 'shake-2', 'shake-3']) assert.deepEqual(plays[name].layers, ['backdrop', 'figures', 'fx', 'textbox'], name)
        assert.ok(plays['shake-3'].world > plays['shake-2'].world && plays['shake-2'].world > plays['shake-1'].world, 'three sizes')
        assert.ok(Math.abs(plays['shake-3'].box - plays['shake-3'].world / 2) < 0.05, 'the text box follows at half')
        assert.deepEqual(plays.shock.layers, ['fx-cover', 'backdrop', 'figures', 'fx', 'textbox', 'fx-wave'])
        assert.ok(plays.shock.cover.peak <= 0.5 && plays.shock.cover.peak > 0.45, 'the burst at most .5')
        assert.deepEqual(plays.glitch.layers, ['figures', 'figures'], 'the figures tear, the backdrop stays')
        assert.deepEqual(plays.heartbeat.layers, ['fx-vignette', 'backdrop', 'figures'])
        // Under the text box: the cover never hides the line.
        assert.ok(await page.evaluate(() => { const fx = document.querySelector('.dsh-tavern-stage-fx'), box = document.querySelector('.dsh-tavern-stage-textbox'); return Boolean(fx.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) }))
        // 2. Paging back plays that page once more; a skip plays nothing.
        await back.click(); await at('9 / 10')
        await page.waitForFunction(() => window.fxPlays.filter(play => play.id.startsWith('stage:')).length === 10)
        await page.waitForTimeout(1400)
        // 3. The skin's effects: its flash colour (still safe), its stepped shake on the background alone.
        const upload = document => page.evaluate(async text => (await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: text })).json()).uploadId, JSON.stringify(document))
        const { pack } = await call('createAssetPack', { name: '效果 ' + Date.now() % 100000 })
        await call('setAssetPackState', { path: cardPath, packId: pack.manifest.id, state: 'card' })
        await call('addAssetPackSkin', { packId: pack.manifest.id, document: await upload(skin), files: [] })
        await call('setAssetPackStageSkin', { packId: pack.manifest.id, expectedRevision: (await call('getAssetPack', { packId: pack.manifest.id })).pack.revision, skin: skin.id })
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        await page.locator('.dsh-tavern-stage-overlay[data-fk-skin="' + skin.id + '"]').waitFor()
        for (let n = 9; n > 1; n--) { await back.click(); await at((n - 1) + ' / 10') }
        await page.waitForTimeout(400)
        const skinned = await visit(2)
        assert.deepEqual(skinned.cover, { peak: 0.5, color: '#20c0ff' }, 'the skin\'s flash colour')
        await shot('skin-flash', 60); await page.waitForTimeout(1200)
        await visit(3); await page.waitForTimeout(1200); await visit(4); await page.waitForTimeout(1600)
        const stepped = await visit(5)
        assert.deepEqual(stepped.layers, ['backdrop'], 'target background moves the background alone')
        assert.deepEqual(stepped.ms, [150])
        await page.waitForTimeout(1200)
        // 4. Reduced motion: no shake, zoom, glitch or wave; flashes and the vignette still show.
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const calm = {}
        calm['shake-3'] = await visit(6, false)
        calm.shock = await visit(7); await page.waitForTimeout(1600)
        calm.glitch = await visit(8, false)
        calm.heartbeat = await visit(9); await shot('reduced-heartbeat', 110); await page.waitForTimeout(1600)
        assert.deepEqual(calm.shock.layers, ['fx-cover'])
        assert.deepEqual(calm.heartbeat.layers, ['fx-vignette'])
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        // 5. The phone.
        await page.setViewportSize({ width: 375, height: 812 })
        await back.click(); await at('8 / 10'); await back.click(); await at('7 / 10')
        await page.waitForFunction(count => window.fxPlays.filter(play => play.id.startsWith('stage:')).length > count, await starts())
        await shot('mobile-shock', 120)
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(1200)
        // stage-state's own sprite back (its later checks compare the figure with the one it opened on).
        await call('castSetImage', { sessionId, name, slot: 'sadness', data: figure([40, 80, 200, 255]).toString('base64') })
        const summary = { plays, skinned, stepped, calm: { shock: calm.shock, heartbeat: calm.heartbeat } }
        await writeFile(join(output, 'screen-effects.json'), JSON.stringify(summary, null, 2))
        return summary
      }
    })
    console.log(JSON.stringify({ screenEffects: true, output, flash: result.performance.plays.flash.cover, red: result.performance.plays['flash-red'].cover }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
