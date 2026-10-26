// 避让 (cast-presentation.md 37/N) over the real stage, a stand-in Fish-compatible service and synthetic tones: while Nora's line
// is heard the BGM and the 环境音 dip 4 dB and come back after it; a sound effect dips the 环境音 3 dB and the BGM 2 dB; CONFIG ›
// 声音 › 自动混音 off leaves them alone; a skin's `duck` sets the amount; closing the stage mid-line brings the BGM straight back.
// Fresh disposable profile only, no model calls. Nothing reaches a speaker: the stage's AudioContext ends in an analyser feeding a
// zero gain, every voice <audio> in a second one; the evidence is the level (dB) at each source's pitch.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { stageDirectorFixture, runDirectorFixture } from '../helpers/stage-director-fixture.mjs'
import { stageNext } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

// An original sine tone as 16-bit mono WAV (8 kHz); whole cycles, so a loop has no click.
function tone(hz, seconds) {
  const samples = Math.round(8000 * seconds), bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / 8000) * 9000), 44 + i * 2)
  return bytes
}
// The pitches: the BGM, the 环境音, the sound effect and the voice.
const HZ = { theme: 250, rain: 500, knock: 1000, voice: 750 }
// A stand-in Fish-compatible service: every /v1/tts answers a 2.5 s sine.
async function fishServer() {
  const requests = []
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests.push(req.url)
      if (req.url === '/v1/tts' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(tone(HZ.voice, 2.5)); return }
      res.writeHead(404); res.end('not found')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, requests, url: 'http://127.0.0.1:' + server.address().port }
}

await mkdir(output, { recursive: true })
const fish = await fishServer()
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.evaluate(() => localStorage.removeItem('dsh-tavern-stage-audio'))
  await page.addInitScript(() => {
    const Base = window.AudioContext, Native = window.Audio
    const analyser = context => { const tap = context.createAnalyser(); tap.fftSize = 8192; tap.smoothingTimeConstant = 0; return tap }
    window.duckTap = { contexts: [], shots: 0, voice: null }
    // The stage's context: its destination is an analyser feeding a zero gain; one-shot starts are counted.
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args)
        const silence = super.createGain(); silence.gain.value = 0; silence.connect(super.destination)
        this.duckAnalyser = analyser(this); this.duckAnalyser.connect(silence); window.duckTap.contexts.push(this)
      }
      get destination() { return this.duckAnalyser }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node)
        node.start = (...args) => { if (!node.loop) window.duckTap.shots++; return start(...args) }
        return node
      }
    }
    // Every voice element plays into its own analyser on a second (unpatched) context, also ending in a zero gain.
    window.Audio = function (src) {
      const element = new Native(src), play = element.play.bind(element)
      element.play = () => {
        const tap = window.duckTap
        if (!tap.voice) {
          const context = new Base(), silence = context.createGain(); silence.gain.value = 0; silence.connect(context.destination)
          tap.voice = { context, analyser: analyser(context) }; tap.voice.analyser.connect(silence)
        }
        tap.voice.context.createMediaElementSource(element).connect(tap.voice.analyser)
        return play()
      }
      return element
    }
    const level = (tap, hz) => {
      const data = new Float32Array(tap.analyser.frequencyBinCount); tap.analyser.getFloatFrequencyData(data)
      const bin = Math.round(hz * tap.analyser.fftSize / tap.context.sampleRate)
      return Math.max(data[bin - 1], data[bin], data[bin + 1])
    }
    // The level (dB) at each pitch: the stage's sources on its context, the voice on its own.
    window.duckBands = hz => {
      const stage = window.duckTap.contexts[0], voice = window.duckTap.voice
      const bands = {}
      for (const [key, f] of Object.entries(hz)) bands[key] = key === 'voice' ? (voice ? level(voice, f) : -200) : stage ? level({ context: stage, analyser: stage.duckAnalyser }, f) : -200
      return { bands, shots: window.duckTap.shots }
    }
  })
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const bands = () => page.evaluate(hz => window.duckBands(hz), HZ)
  const until = async (test, label) => page.waitForFunction(([hz, test]) => new Function('b', 'return ' + test)(window.duckBands(hz).bands), [HZ, test], { timeout: 15000, polling: 50 })
    .catch(async () => { throw Error(label + ': ' + JSON.stringify(await bands())) })
  // The mean level of each pitch over ~0.5 s (10 samples), to the tenth of a dB.
  async function measure() {
    const rows = []
    for (let i = 0; i < 10; i++) { rows.push((await bands()).bands); await page.waitForTimeout(50) }
    return Object.fromEntries(Object.keys(HZ).map(key => [key, Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length * 10) / 10]))
  }
  const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' (expected ' + expected + ' ± ' + tolerance + ')')

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Ducking ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {}, assets: [
    { type: 'music', name: 'theme', uri: 'embeded://assets/music/theme.wav', ext: 'wav' }] } }
  const archive = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/music/theme.wav', content: tone(HZ.theme, 4) }])
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'ducking-' + run + '.charx', fileB64: archive.toString('base64') } })).card
  const [packId] = (await call('getCardAssetPacks', { path: imported.path })).boundPackIds
  const upload = bytes => page.evaluate(async bytes => {
    const reply = await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) })).json()
    if (!reply.ok) throw Error('upload: ' + JSON.stringify(reply))
    return reply.uploadId
  }, bytes.toString('base64'))
  assert.equal((await call('addAssetPackFiles', { packId, kind: 'ambience', files: [{ name: 'rain', uploadId: await upload(tone(HZ.rain, 2)) }] })).added.length, 1)
  assert.equal((await call('addAssetPackFiles', { packId, kind: 'sfx', files: [{ name: 'knock', uploadId: await upload(tone(HZ.knock, 1.5)) }] })).added.length, 1)
  // A skin whose voice lowers the BGM 12 dB (the rest stays the engine's).
  const skin = { schema: 'dsh.skin/1', id: 'deep-duck', label: '深避让', font: {}, textFx: { reveal: 'type' }, duck: { voice: { music: -12 } },
    textbox: { paint: { bg: '#101418', fg: '#f2f2f2', fgMuted: '#c0c4c8', accent: '#7fd0ff', onAccent: '#000000', border: '#c0c4c8' } }, nameplate: { shape: 'plain', paint: { bg: '#101418', fg: '#f2f2f2' } } }
  await call('addAssetPackSkin', { packId, document: await upload(Buffer.from(JSON.stringify(skin))), files: [] })
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true, music: true, sfx: true, ambience: true } } })
  await call('updateSpeechSettings', { enabled: true, provider: 'fish', config: { baseUrl: fish.url, model: '', voice: 'ref-default', narratorVoice: '' } })

  // Turn 2: narration, Nora's line, the knock's page, narration; the director's accepted BGM, 环境音 and knock (its real tool).
  const body = 'Rain falls on the roof.\n@bubble:nora|Nora|开心|[Welcome back, traveller.]\nSomeone knocks at the door.\nThe hall is quiet.'
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' },
    { name: 'Reader', is_user: true, mes: 'Hello?' }, { name, is_user: false, mes: body }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'ducking.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: game.sessionId, images: false })).base64, 'base64'))
  const fixture = await stageDirectorFixture(save.chat, { player: 'Reader', cast: [{ name }], background: [], music: [{ name: 'theme' }], sfx: [{ name: 'knock' }], ambience: [{ name: 'rain' }] })
  const directed = await runDirectorFixture(fixture, [{ music: 'theme', ambience: 'rain', performances: [{ at: 3, op: 'sfx.play', sfx: 'knock' }] }])
  assert.deepEqual(directed.receipts, [{ ok: true }])
  save.plugins = { data: { version: 1, owners: (await fixture.data.snapshot(save.chat.id)).owners }, media: null, attachments: [] }
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const sessionId = restored.sessionId, title = 'Ducking verification ' + run
  await call('renameConversation', { sessionId, title })
  await call('castSetCharacter', { sessionId, name: 'Nora' })
  await call('castSetVoice', { sessionId, name: 'Nora', provider: 'fish', voice: 'ref-nora' })
  const result = {}

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const text = value => stage.locator('.dsh-tavern-stage-text').filter({ hasText: value }).waitFor()
  const open = async () => { await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor() }
  const back = async () => { await stage.getByRole('button', { name: '上一句', exact: true }).click() }
  const config = page.locator('.dsh-tavern-stage-config[role="dialog"]')
  const toggle = config.getByRole('switch', { name: '自动混音', exact: true })
  const openConfig = async () => { await stage.locator('.dsh-tavern-stage-controls [data-action="sound"]').click(); await config.waitFor() }
  const closeConfig = async () => { await config.getByRole('button', { name: '关闭设置', exact: true }).click(); await config.waitFor({ state: 'detached' }) }
  const voiceHeard = label => until('b.voice > -60', label)
  const voiceGone = label => until('b.voice < -100', label)
  // Nora's page from the one before it: her line is heard; returns the levels while it sounds.
  async function noraLine(label) {
    await stageNext(stage); await text('Welcome back')
    await voiceHeard(label + ': the line is heard'); await page.waitForTimeout(400)
    return await measure()
  }

  // 1. The stage opens on the rain and the BGM; nothing else sounds: the reference levels.
  await open(); await text('Rain falls')
  await until('b.theme > -60 && b.rain > -60', 'the BGM and the 环境音 play')
  await page.waitForTimeout(1500)
  result.base = await measure()
  // 2. Nora's line: both dip 4 dB while it is heard, then come back within a second of its end.
  result.voice = await noraLine('voice')
  near(result.voice.theme - result.base.theme, -4, 1, 'a voice lowers the BGM 4 dB')
  near(result.voice.rain - result.base.rain, -4, 1, 'a voice lowers the 环境音 4 dB')
  await page.screenshot({ path: join(output, 'ducking-voice-1920.png') })
  await voiceGone('the line ends'); await page.waitForTimeout(900)
  result.after = await measure()
  near(result.after.theme - result.base.theme, 0, .7, 'the BGM comes back')
  near(result.after.rain - result.base.rain, 0, .7, 'the 环境音 comes back')
  // 3. The knock: the 环境音 dips 3 dB, the BGM 2 dB, while it sounds.
  const shots = (await bands()).shots
  await stageNext(stage); await text('knocks')
  await page.waitForFunction(count => window.duckTap.shots > count, shots, { timeout: 8000, polling: 50 })
  await until('b.knock > -60', 'the knock is heard'); await page.waitForTimeout(250)
  result.knock = await measure()
  near(result.knock.rain - result.base.rain, -3, 1, 'a sound effect lowers the 环境音 3 dB')
  near(result.knock.theme - result.base.theme, -2, 1, 'a sound effect lowers the BGM 2 dB')
  await until('b.knock < -100', 'the knock ends'); await page.waitForTimeout(600)
  // 4. CONFIG › 声音 › 自动混音 off (on by default): Nora's line leaves the BGM alone; the switch is saved in this browser.
  await openConfig()
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'on by default')
  await page.screenshot({ path: join(output, 'ducking-config-1920.png') })
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('dsh-tavern-stage-audio'))).duck, false)
  await closeConfig()
  await back(); await text('Welcome back'); await back(); await text('Rain falls')
  await voiceGone('the line is stopped')
  result.off = await noraLine('ducking off')
  near(result.off.theme - result.base.theme, 0, .7, 'ducking off: the BGM stays')
  await voiceGone('the line ends')
  await openConfig(); await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'true'); await closeConfig()
  // 375: CONFIG's 混音 row fits.
  await page.setViewportSize({ width: 375, height: 812 })
  await openConfig()
  const row = await toggle.boundingBox()
  assert.ok(row.x >= 0 && row.x + row.width <= 375.5, '375: ' + JSON.stringify(row))
  await toggle.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'ducking-config-375.png') })
  await closeConfig()
  await page.setViewportSize({ width: 1920, height: 1080 })
  // 5. The card's skin sets the voice's dip on the BGM to 12 dB; the 环境音 keeps the engine's 4 dB.
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  await call('setCardStageSkin', { path: imported.path, skin: { packId, kind: 'skins', assetId: 'deep-duck' } })
  await open()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.getAttribute('data-fk-skin') === 'deep-duck')
  await stage.locator('.dsh-tavern-stage-text').first().waitFor()
  while (!(await stage.locator('.dsh-tavern-stage-text').innerText()).includes('Rain falls')) await back()
  await voiceGone('nothing is said'); await page.waitForTimeout(800)
  result.skinBase = await measure()
  result.skin = await noraLine('skin')
  near(result.skin.theme - result.skinBase.theme, -12, 1.5, 'the skin lowers the BGM 12 dB')
  near(result.skin.rain - result.skinBase.rain, -4, 1, 'the 环境音 keeps the engine\'s 4 dB')
  await page.screenshot({ path: join(output, 'ducking-skin-1920.png') })
  // 6. Closing the stage mid-line stops the line, so the BGM comes straight back in chat (the 环境音 ends with the stage).
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  await voiceGone('closing the stage stops the line'); await page.waitForTimeout(900)
  result.closed = await measure()
  near(result.closed.theme - result.skinBase.theme, 0, .7, 'the BGM is back after the stage closes')
  assert.ok(result.closed.rain < -100, 'the 环境音 ended with the stage: ' + result.closed.rain)
  await call('setCardStageSkin', { path: imported.path, skin: 'classic' })
  result.fish = fish.requests
  result.contexts = await page.evaluate(() => window.duckTap.contexts.length)
  assert.equal(result.contexts, 1, 'one AudioContext for the stage')
  await writeFile(join(output, 'stage-ducking.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ducking: true, output }))
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages())[0]
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close(); fish.server.close() }
