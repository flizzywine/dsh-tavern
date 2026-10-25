// 环境音 (cast-presentation.md 20/N): the director's ambience is persistent stage state over the real stage, from the card's pack
// entries: it plays beside the BGM while the stage is open, keeps playing across pages and turns, crossfades on a change, fades
// out on the director's stop, stops when the stage closes or 环境音 goes off, leaves with its entry's lamp and resumes after a
// reload without replaying one-shots. Fresh disposable profile only. Nothing reaches a speaker: every AudioContext ends in an
// analyser feeding a zero gain; the evidence is the analyser's spectrum (one sine per source) and the sources the page starts.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { STAGE_DATA_OWNER } from '../../tavern-plugin/lib/domain/stage-director.js'
import { stageDirectorFixture, runDirectorFixture } from '../helpers/stage-director-fixture.mjs'
import { stageNext } from './stage-state.mjs'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')

// An original sine tone as 16-bit mono WAV (8 kHz).
function tone(hz, seconds) {
  const samples = Math.round(8000 * seconds), bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / 8000) * 9000), 44 + i * 2)
  return bytes
}
// The sources' pitches: the BGM, two ambiences and a one-shot sound effect.
const HZ = { theme: 220, rain: 500, crowd: 1300, knock: 900, heavy: 700 }

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.addInitScript(() => {
    const Base = window.AudioContext
    window.ambienceTap = { contexts: [], loops: 0, shots: 0 }
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args)
        const silence = super.createGain(); silence.gain.value = 0; silence.connect(super.destination)
        const tap = super.createAnalyser(); tap.fftSize = 4096; tap.smoothingTimeConstant = 0; tap.connect(silence)
        this.ambienceAnalyser = tap; window.ambienceTap.contexts.push(this)
      }
      get destination() { return this.ambienceAnalyser }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node)
        node.start = (...args) => { if (node.loop) window.ambienceTap.loops++; else window.ambienceTap.shots++; return start(...args) }
        return node
      }
    }
    // The level (dB) at each pitch, the loudest of its three nearest bins.
    window.ambienceBands = hz => {
      const context = window.ambienceTap.contexts[0]
      if (!context) return { bands: Object.fromEntries(Object.keys(hz).map(key => [key, -200])), loops: 0, shots: 0 }
      const data = new Float32Array(context.ambienceAnalyser.frequencyBinCount); context.ambienceAnalyser.getFloatFrequencyData(data)
      const at = f => { const bin = Math.round(f * context.ambienceAnalyser.fftSize / context.sampleRate); return Math.max(data[bin - 1], data[bin], data[bin + 1]) }
      return { bands: Object.fromEntries(Object.entries(hz).map(([key, f]) => [key, Math.round(at(f))])), loops: window.ambienceTap.loops, shots: window.ambienceTap.shots, state: context.state }
    }
  })
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const settingsChanged = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
  const bands = () => page.evaluate(hz => window.ambienceBands(hz), HZ)
  // Heard: louder than -50 dB at its pitch; quiet: below -80 dB.
  async function hear(expected, label) {
    await page.waitForFunction(([hz, expected]) => {
      const { bands } = window.ambienceBands(hz)
      return Object.entries(expected).every(([key, on]) => on ? bands[key] > -50 : bands[key] < -80)
    }, [HZ, expected], { timeout: 12000, polling: 100 }).catch(async () => { throw Error(label + ': ' + JSON.stringify(await bands())) })
    return await bands()
  }

  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Ambience ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {}, assets: [
    { type: 'music', name: 'theme', uri: 'embeded://assets/music/theme.wav', ext: 'wav' }] } }
  const archive = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/music/theme.wav', content: tone(HZ.theme, 3) }])
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'ambience-' + run + '.charx', fileB64: archive.toString('base64') } })).card
  const [packId] = (await call('getCardAssetPacks', { path: imported.path })).boundPackIds
  const upload = rows => page.evaluate(rows => Promise.all(rows.map(async ({ name, bytes }) => {
    const reply = await (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) })).json()
    if (!reply.ok) throw Error('upload: ' + JSON.stringify(reply))
    return { uploadId: reply.uploadId, name }
  })), rows.map(row => ({ name: row.name, bytes: row.bytes.toString('base64') })))
  const ambienceAdded = await call('addAssetPackFiles', { packId, kind: 'ambience', files: await upload([{ name: 'rain', bytes: tone(HZ.rain, 2) }, { name: 'crowd', bytes: tone(HZ.crowd, 2) }]) })
  assert.equal(ambienceAdded.added.length, 2, JSON.stringify(ambienceAdded.rejected))
  assert.equal((await call('addAssetPackFiles', { packId, kind: 'sfx', files: await upload([{ name: 'knock', bytes: tone(HZ.knock, 1) }]) })).added.length, 1)
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true, music: true, sfx: true, ambience: true } } })

  // Turns 2–6 and the director's accepted increments for each (its real tool and transaction).
  const bodies = ['Rain falls on the roof.\nThe hall is quiet.', 'Nobody speaks.', 'They step into the crowded square.', 'Everything falls silent.',
    'The rain returns.\nSomeone knocks at the door.\nNobody moves.']
  const deltas = [{ music: 'theme', ambience: 'rain' }, {}, { ambience: 'crowd' }, { ambience: null }, { ambience: 'rain', performances: [{ at: 2, op: 'sfx.play', sfx: 'knock' }] }]
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' },
    ...bodies.flatMap(text => [{ name: 'Reader', is_user: true, mes: 'Go on.' }, { name, is_user: false, mes: text }])].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'ambience.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: game.sessionId, images: false })).base64, 'base64'))
  const assistants = save.chat.messages.map((message, index) => [message, index]).filter(([message]) => message.role === 'assistant' && message.turn > 1)
  assert.deepEqual(assistants.map(([message]) => message.turn), [2, 3, 4, 5, 6])
  const upTo = index => ({ ...save.chat, messages: save.chat.messages.slice(0, index + 1) })
  const fixture = await stageDirectorFixture(upTo(assistants[0][1]), { player: 'Reader', cast: [{ name }], background: [], music: [{ name: 'theme' }],
    sfx: [{ name: 'knock' }], ambience: [{ name: 'rain' }, { name: 'crowd' }] })
  const prompts = []
  for (const [i, [, index]] of assistants.entries()) {
    if (i) await fixture.persistence.update(save.chat.id, current => ({ ...current, messages: save.chat.messages.slice(0, index + 1), timeline: { ...current.timeline, revision: current.timeline.revision + 1 } }))
    const directed = await runDirectorFixture(fixture, [deltas[i]])
    assert.deepEqual(directed.receipts, [{ ok: true }], 'turn ' + (i + 2))
    prompts.push(directed.prompts[0])
  }
  assert.match(prompts[0].system, /ambience 是地点或天气的持续背景声/)
  save.plugins = { data: { version: 1, owners: (await fixture.data.snapshot(save.chat.id)).owners }, media: null, attachments: [] }
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const sessionId = restored.sessionId, title = 'Ambience verification ' + run
  await call('renameConversation', { sessionId, title })
  const result = { records: save.plugins.data.owners[STAGE_DATA_OWNER].turns.map(record => [record.turn, record.data.delta]) }
  const data = await call('castStage', { sessionId, count: 1 })
  assert.deepEqual([data.stage.ambience, data.ambience.name, data.ambience.volume, data.ambienceEnabled, data.stage.music], ['rain', 'rain', undefined, true, 'theme'])
  assert.match(data.ambience.identity, /:ambience:/)
  assert.match(data.ambience.url, /\/lease\//)
  result.contract = Object.keys(data.ambience).sort()

  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const text = value => stage.locator('.dsh-tavern-stage-text').filter({ hasText: value }).waitFor()
  const next = () => stageNext(stage)
  const open = async () => { await page.getByRole('button', { name: '舞台', exact: true }).click(); await stage.waitFor() }
  // In chat (no stage open) only the BGM plays.
  result.chat = await hear({ theme: true, rain: false }, 'chat: BGM only')
  // 1. The open stage plays the turn's ambience beside the BGM.
  await open(); await text('The rain returns.')
  result.opened = await hear({ theme: true, rain: true, crowd: false }, 'the stage plays the ambience with the BGM')
  await page.screenshot({ path: join(output, 'ambience-1920.png') })
  // 2. Page turns keep the same playback: no new loop starts; a page's one-shot plays on its own.
  const loops = result.opened.loops
  await next(); await text('knocks'); await next(); await text('Nobody moves.')
  await page.waitForTimeout(1500)
  result.paged = await hear({ theme: true, rain: true }, 'page turns keep the ambience')
  assert.equal(result.paged.loops, loops, 'turning pages never restarts the ambience')
  // 3. 环境音 off silences it at once (the BGM plays on); on again, it resumes from the state.
  await call('updateTavernSettings', { patch: { stageToggles: { ambience: false } } }); await settingsChanged()
  result.switchedOff = await hear({ theme: true, rain: false }, '环境音 off')
  const off = await call('castStage', { sessionId, count: 1 })
  assert.deepEqual([off.ambience, off.ambienceEnabled, off.stage.ambience], [null, false, 'rain'], 'switching off never rewrites the state')
  await call('updateTavernSettings', { patch: { stageToggles: { ambience: true } } }); await settingsChanged()
  result.switchedOn = await hear({ theme: true, rain: true }, '环境音 on again')
  // 4. Its entry switched off: it leaves (the save is not changed); switched on again, it returns.
  const beforeLamp = readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64')).plugins
  const pack = (await call('getAssetPack', { packId })).pack
  const dark = (await call('updateAssetPackEntries', { packId, expectedRevision: pack.revision, assets: pack.manifest.assets.map(asset => asset.kind === 'ambience' && asset.name === 'rain' ? { ...asset, enabled: false } : asset) })).pack
  await settingsChanged()
  result.lampOff = await hear({ theme: true, rain: false }, 'the rain entry switched off')
  assert.equal((await call('castStage', { sessionId, count: 1 })).ambience, null)
  await call('updateAssetPackEntries', { packId, expectedRevision: dark.revision, assets: pack.manifest.assets }); await settingsChanged()
  result.lampOn = await hear({ theme: true, rain: true }, 'the rain entry switched on')
  assert.deepEqual(readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64')).plugins, beforeLamp, 'lamps and switches never write')
  // 5. Closing the stage stops it (the BGM goes on in chat); reopening resumes it.
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  result.closed = await hear({ theme: true, rain: false }, 'closing the stage')
  await open()
  result.reopened = await hear({ theme: true, rain: true }, 'reopening the stage')
  // 6. A reload resumes the state's ambience; the page's one-shot is not replayed.
  await page.reload()
  await open(); await stage.locator('.dsh-tavern-stage-text').first().waitFor()
  result.reloaded = await hear({ theme: true, rain: true }, 'after a reload')
  await page.waitForTimeout(2000)
  assert.equal((await bands()).shots, 0, 'a reload never replays a one-shot')
  // 7. 375: the same.
  await page.setViewportSize({ width: 375, height: 812 })
  result.narrow = await hear({ rain: true }, 'at 375')
  await page.screenshot({ path: join(output, 'ambience-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  // 8. The director's stop (turn 5, reached by rolling turn 6 back) fades it out; the BGM plays on.
  const back = async (turn, line) => { await call('rollbackTurn', { sessionId, expectedTurn: turn }); await text(line) }
  await back(6, 'Everything falls silent.')
  result.stopped = await hear({ theme: true, rain: false, crowd: false }, 'the director\'s stop')
  assert.equal((await call('castStage', { sessionId, count: 1 })).stage.ambience, undefined)
  // 9. Turn 4 chose the crowd: it starts.
  await back(5, 'crowded square')
  result.crowd = await hear({ theme: true, rain: false, crowd: true }, 'the crowd starts')
  // 10. Back to turn 3 (rain from turn 2, kept). A rollback replaces the game's binding, so the stage starts over: it plays the rain.
  await back(4, 'Nobody speaks.')
  result.rolledBackToRain = await hear({ theme: true, rain: true, crowd: false }, 'turn 3 keeps turn 2\'s rain')
  // A change of what plays while the stage stays (here the rain entry's file replaced: a new identity) crossfades: the page samples
  // the spectrum every 50 ms; for a while both sound, then only the new one.
  await page.evaluate(hz => { window.ambienceSamples = []; window.ambienceSampler = setInterval(() => window.ambienceSamples.push(window.ambienceBands(hz).bands), 50) }, HZ)
  const current = (await call('getAssetPack', { packId })).pack, rainEntry = current.manifest.assets.find(asset => asset.kind === 'ambience' && asset.name === 'rain')
  const [heavy] = await upload([{ name: 'heavy rain', bytes: tone(HZ.heavy, 2) }])
  await call('replaceAssetPackMedia', { packId, expectedRevision: current.revision, kind: 'ambience', id: rainEntry.id, uploadId: heavy.uploadId })
  await settingsChanged()
  result.changed = await hear({ theme: true, rain: false, heavy: true }, 'the change settles on the new sound')
  const samples = await page.evaluate(() => { clearInterval(window.ambienceSampler); return window.ambienceSamples })
  const both = samples.filter(row => row.rain > -50 && row.heavy > -50)
  result.crossfade = { samples: samples.length, overlapping: both.length, first: both[0], last: both.at(-1) }
  assert.ok(both.length >= 2, 'the change crossfades: both sound for a while ' + JSON.stringify(samples.map(row => [row.rain, row.heavy])))
  await page.screenshot({ path: join(output, 'ambience-change-1920.png') })
  // 11. A new turn with no change keeps it playing: no new loop starts.
  const kept = (await bands()).loops
  await call('appendStoryRounds', { sessionId, rounds: [{ user: 'Wait.', assistant: 'The rain keeps falling.' }] })
  await text('The rain keeps falling.')
  await page.waitForTimeout(1500)
  result.nextTurn = await hear({ theme: true, heavy: true }, 'the next turn keeps it')
  assert.equal(result.nextTurn.loops, kept, 'a new turn never restarts the ambience')
  assert.equal((await call('castStage', { sessionId, count: 1 })).stage.ambience, 'rain')
  await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' })
  result.end = await hear({ theme: true, rain: false, heavy: false }, 'closing the stage at the end')
  result.contexts = (await page.evaluate(() => window.ambienceTap.contexts.length))
  assert.equal(result.contexts, 1, 'one AudioContext for the page')
  await writeFile(join(output, 'stage-ambience.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ambience: true, output }))
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages())[0]
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close() }
