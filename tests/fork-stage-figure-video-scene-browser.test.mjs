// 动态立绘 on the real Pixi scene (scene.cjs tickFigureVideo over figure-video.cjs): a speaking figure whose still carries an
// idle and a talking loop keeps its frames running - the scene reads the speaker's voice for the talking loop through the
// layered compositor's mouth gear - and the idle loop plays over the still; a change to an image the shown one has a
// transition into plays that transition once before the new idle loop. Videos come from the shared video read
// (video.cjs acquire) over a stub lease serving the magenta fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stageScenePage } from './helpers/stage-pixi-scene-page.mjs'
const root = new URL('../tavern-plugin/', import.meta.url)
const VIDEO = await readFile(new URL('./fixtures/stage-video/magenta.webm', import.meta.url))
const ANATOMY = { figureTop: 0.02, headTop: 0.02, chin: 0.164, feet: 0.99, visibleBottom: 0.99, supportX: 0.5, posture: 'standing', crop: 'full', poseHeightRatio: 1 }

// The scene page with the stage started on a stub lease serving the magenta fixture for every clip; `window.figure(...)`
// makes a figure descriptor whose still is a plain canvas.
async function scenePage(t) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('http://renderer.test/**', async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname)
    if (pathname.startsWith('/api/dsh-tavern/vendor/')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('lib/vendor/' + pathname.split('/vendor/')[1], root)) })
    if (pathname.startsWith('/lease/')) return route.fulfill({ contentType: 'video/webm', body: VIDEO })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"></body>' })
  })
  await page.addInitScript(() => {
    const make = Document.prototype.createElement; window.figureVideos = []
    Document.prototype.createElement = function (tag, ...rest) { const el = make.call(this, tag, ...rest); if (String(tag).toLowerCase() === 'video') window.figureVideos.push(el); return el }
  })
  await page.goto('http://renderer.test/')
  await page.addScriptTag({ content: await stageScenePage() })
  await page.evaluate(async anatomy => {
    const service = { leaseBundle: async () => ({ ticket: 't', url: 'http://renderer.test/lease/t/' }), releaseLease() {} }
    // The scene's own voice reader is the one it is given (the page also has the compositor as page globals, the built
    // stage bundle does not): the spy records the talking loop's reads.
    window.voiceReads = []
    const voice = (key, audio, enabled) => { voiceReads.push(key); return layeredSpriteVoice(key, audio, enabled) }
    const stage = await startStageScene({ sceneServices: { foreground: forkForeground, lipSync: { wake() {} }, loadPixi: loadPixiRuntime, resolution: galResolution,
      subscribeResolution: galResolutionSubscribe, layered: { urls: layeredSpriteUrls, paint: layeredSpritePaint, voice }, canvas: { paint: stagePaintEmpty, palette: stageEmptyPalette } }, video: { getService: () => service, fetch: (...args) => window.fetch(...args), URL, stageVideo: {}, audio: null,
      foreground: forkForeground, setTimeout: (...args) => window.setTimeout(...args), clearTimeout: (...args) => window.clearTimeout(...args) } })
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.append(host)
    window.clip = name => ({ packId: 'pack', bundleKey: name, hash: name, entry: name + '.webm', poster: name + '.png' })
    window.figure = (identity, colour, fields) => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 1800
      const g = canvas.getContext('2d'); g.fillStyle = colour; g.fillRect(150, 100, 300, 1650)
      return { key: 'iroha', alias: 'iroha', kind: 'static', src: canvas.toDataURL('image/png'), identity, visible: true, enter: 'none', shade: 1, x: 0.5,
        speaking: false, audio: null, spriteVoiceKey: '1:0', ...fields,
        figureSizing: { pack: true, version: 1, heightCm: 155, heightBasis: 'standing', source: 'iroha', sourceUrl: 'iroha', outfitKey: 'default', anatomy, assetScale: 1 } }
    }
    window.scene = stage.create(host, { quality: 'high' })
    window.show = figure => scene.set({ visit: 1, snap: false, quality: 'high', background: null, figureScale: { version: 6, scene: 1, hMax: 155, rescales: 0 }, figures: [figure],
      figureLayout: { cast: ['iroha'], priority: ['iroha'] }, effects: [], preload: [], camera: { shot: '', target: '' } })
  }, ANATOMY)
  return { page, errors }
}

test('a speaking figure with idle and talking loops keeps the scene frame running and plays its idle loop', { timeout: 120000 }, async t => {
  const { page, errors } = await scenePage(t)
  await page.evaluate(() => show(figure('iroha', '#3b3550', { speaking: true, video: { source: clip('idle'), talk: clip('talk'), rect: [0, 0, 600, 1800] } })))
  await page.waitForFunction(() => { const s = scene.debug.stats(); return s.figures.length === 1 && s.figures[0].ready }, null, { timeout: 30000 })
  await page.waitForFunction(() => figureVideos.some(video => video.loop && !video.paused && video.currentTime > 0), null, { timeout: 30000 })
  await page.waitForTimeout(1500)
  assert.deepEqual(await page.evaluate(() => figureVideos.map(video => video.loop)), [true, false], 'the idle loop and the talking loop')
  assert.deepEqual(errors.filter(text => !/favicon/.test(text)), [], 'no frame fails while the figure speaks')
  assert.ok(await page.evaluate(() => voiceReads.includes('video:1:0')), 'the talking loop reads the speaker\'s voice through the scene\'s compositor')
})

test('changing to an image the shown one has a transition into plays the transition once, then the new idle loop; the old loop is released', { timeout: 120000 }, async t => {
  const { page, errors } = await scenePage(t)
  await page.evaluate(() => show(figure('calm', '#3b3550', { video: { outfit: 'school', image: 'calm', source: clip('idle-calm'), rect: [0, 0, 600, 1800], into: { joy: { source: clip('calm-joy'), rect: [0, 0, 600, 1800] } } } })))
  await page.waitForFunction(() => figureVideos[0] && !figureVideos[0].paused && figureVideos[0].currentTime > 0, null, { timeout: 30000 })
  assert.deepEqual(await page.evaluate(() => figureVideos.map(video => [video.loop, video.paused])), [[true, false], [false, true]], 'the transition is preloaded with the old picture')
  await page.waitForTimeout(400)
  await page.evaluate(() => show(figure('joy', '#50353b', { video: { outfit: 'school', image: 'joy', source: clip('idle-joy'), rect: [0, 0, 600, 1800], into: {} } })))
  // The new picture's idle loop and its transition: the transition plays to its end, then the idle loop plays.
  await page.waitForFunction(() => figureVideos.length === 3 && figureVideos[1].currentTime > 0, null, { timeout: 30000 })
  assert.equal(await page.evaluate(() => figureVideos[2].paused), true, 'the new idle loop waits for the transition')
  await page.waitForFunction(() => figureVideos[1].ended && !figureVideos[2].paused && figureVideos[2].currentTime > 0, null, { timeout: 30000 })
  // The old picture's loop went with its fade-out.
  await page.waitForFunction(() => !figureVideos[0].getAttribute('src'), null, { timeout: 10000 })
  assert.equal(await page.evaluate(() => scene.debug.stats().figures.length), 1)
  // Back to calm: joy names no transition into it, so the pictures crossfade and calm's idle loop plays at once.
  await page.evaluate(() => show(figure('calm', '#3b3550', { video: { outfit: 'school', image: 'calm', source: clip('idle-calm'), rect: [0, 0, 600, 1800], into: {} } })))
  await page.waitForFunction(() => figureVideos.length === 4 && !figureVideos[3].paused && figureVideos[3].currentTime > 0, null, { timeout: 30000 })
  assert.equal(await page.evaluate(() => figureVideos.length), 4, 'no transition clip')
  assert.deepEqual(errors.filter(text => !/favicon/.test(text)), [])
})
