import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { stageDirectorFixture, runDirectorFixture } from '../helpers/stage-director-fixture.mjs'

// The stage's BGM against a real host. Run only against an owned, hidden, muted fresh profile.
// Nothing reaches a speaker: every AudioContext's destination is an analyser feeding a zero gain, and the
// evidence is the analyser's level and the audio clock, not sound.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

// The page's audio, silenced before anything plays: what the player would send to the speakers goes into an
// analyser and then a zero gain.
function muteStageAudio(page) {
  return page.addInitScript(() => {
    const Base = window.AudioContext
    window.stageTestAudio = { contexts: [], sources: 0 }
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args)
        const silence = super.createGain(); silence.gain.value = 0; silence.connect(super.destination)
        const tap = super.createAnalyser(); tap.fftSize = 2048; tap.connect(silence)
        this.stageTestTap = tap; window.stageTestAudio.contexts.push(this)
      }
      get destination() { return this.stageTestTap }
      createBufferSource() { window.stageTestAudio.sources++; return super.createBufferSource() }
    }
    window.stageTestLevel = () => {
      const context = window.stageTestAudio.contexts[0]
      if (!context) return { contexts: 0, rms: 0, time: 0, sources: window.stageTestAudio.sources }
      const data = new Float32Array(2048); context.stageTestTap.getFloatTimeDomainData(data)
      let sum = 0; for (const value of data) sum += value * value
      return { contexts: window.stageTestAudio.contexts.length, state: context.state, rms: Math.sqrt(sum / data.length), time: context.currentTime, sources: window.stageTestAudio.sources }
    }
  })
}
// A sine tone as 16-bit mono WAV (8 kHz).
function tone(hz, seconds = 2) {
  const samples = 8000 * seconds, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / 8000) * 9000), 44 + i * 2)
  return bytes
}

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
await muteStageAudio(page)
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const level = () => page.evaluate(() => window.stageTestLevel())
// Sounding: the analyser hears the tone and the audio clock moves.
async function sounding(label) {
  await page.waitForFunction(() => window.stageTestLevel().rms > .05, null, { timeout: 15000 })
  const first = await level(); await page.waitForTimeout(500); const second = await level()
  assert.ok(second.rms > .05 && second.time > first.time + .3, label + ': ' + JSON.stringify([first, second]))
  return { rms: Number(second.rms.toFixed(3)), clock: Number((second.time - first.time).toFixed(2)), contexts: second.contexts, sources: second.sources }
}
async function silent(label) {
  await page.waitForFunction(() => window.stageTestLevel().rms < .001, null, { timeout: 15000 })
  await page.waitForTimeout(400)
  const now = await level()
  assert.ok(now.rms < .001, label + ': ' + JSON.stringify(now))
  return { rms: now.rms, sources: now.sources }
}
const result = {}
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const run = Date.now(), name = 'Bgm ' + run % 100000
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {}, assets: [
    { type: 'music', name: 'theme', uri: 'embeded://assets/music/theme.wav', ext: 'wav' },
    { type: 'music', name: 'night', uri: 'embeded://assets/music/night.wav', ext: 'wav' }] } }
  const archive = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) },
    { path: 'assets/music/theme.wav', content: tone(440) }, { path: 'assets/music/night.wav', content: tone(660) }])
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'bgm-' + run + '.charx', fileB64: archive.toString('base64') } })).card
  // 舞台模式 is global and needs 对话气泡.
  await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: 'Music rises.\nThe hall is quiet.' }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'bgm.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: game.sessionId, images: false })).base64, 'base64'))
  // The director's real tool and transaction choose 「theme」; the record travels in through a native save import.
  const fixture = await stageDirectorFixture(save.chat, { player: 'Reader', cast: [{ name }], background: [], music: [{ name: 'theme' }, { name: 'night' }] })
  assert.deepEqual((await runDirectorFixture(fixture, [{ music: 'theme' }])).receipts, [{ ok: true }])
  save.plugins = { data: { version: 1, owners: (await fixture.data.snapshot(save.chat.id)).owners }, media: null, attachments: [] }
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const title = 'BGM verification ' + run
  await call('renameConversation', { sessionId: restored.sessionId, title })
  const stageData = await call('castStage', { sessionId: restored.sessionId, count: 1 })
  assert.deepEqual([stageData.stage.music, stageData.music.name, stageData.musicEnabled], ['theme', 'theme', true])
  assert.match(stageData.music.identity, /:music:/)
  const tracks = await call('getStageMusicTracks', { sessionId: restored.sessionId })
  assert.deepEqual(tracks.tracks.map(track => track.name), ['theme', 'night'])
  result.contract = { music: Object.keys(stageData.music).sort(), track: Object.keys(tracks.tracks[0]).sort() }
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()

  // In chat: the header chip names the director's track and it plays (no stage open).
  const chatChip = page.getByRole('button', { name: 'BGM：theme', exact: true })
  await chatChip.waitFor()
  result.chat = await sounding('the director\'s track plays in chat')
  await page.screenshot({ path: join(output, 'chat-chip.png') })

  // Opening the fullscreen stage keeps the same playback: no new context, no new source.
  await page.getByRole('button', { name: '舞台', exact: true }).click()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  await stage.waitFor()
  const stageChip = stage.getByRole('button', { name: 'BGM：theme', exact: true })
  await stageChip.waitFor()
  result.stage = await sounding('the stage keeps playing')
  assert.deepEqual([result.stage.contexts, result.stage.sources], [1, result.chat.sources], 'opening the stage neither restarts nor doubles the music')

  // The panel: list in pack order with the director's mark; a pick turns 导演选曲 off.
  await stageChip.click()
  const panel = stage.locator('.dsh-tavern-bgm-panel')
  await panel.waitFor()
  assert.deepEqual(await panel.locator('.dsh-tavern-bgm-track > span:first-child').allInnerTexts(), ['theme', 'night'])
  assert.equal(await panel.locator('.dsh-tavern-bgm-track[aria-current="true"]').innerText(), 'theme')
  assert.equal(await panel.locator('.dsh-tavern-bgm-cue').count(), 1)
  const follow = panel.getByRole('switch')
  assert.equal(await follow.isChecked(), true)
  await page.screenshot({ path: join(output, 'stage-panel.png') })
  await panel.locator('.dsh-tavern-bgm-track').filter({ hasText: 'night' }).click()
  await stage.getByRole('button', { name: 'BGM：night', exact: true }).waitFor()
  assert.equal(await follow.isChecked(), false, 'a manual pick turns 导演选曲 off')
  result.picked = await sounding('the picked track plays')
  assert.ok(result.picked.sources > result.stage.sources)
  // Pause keeps the track; play resumes it.
  await panel.getByRole('button', { name: '暂停', exact: true }).click()
  result.paused = await silent('pause silences at once')
  await stage.getByRole('button', { name: 'BGM：night', exact: true }).waitFor()
  await panel.getByRole('button', { name: '播放', exact: true }).click()
  result.resumed = await sounding('play resumes')
  // 下一首 wraps: night → theme.
  await panel.getByRole('button', { name: '下一首', exact: true }).click()
  await stage.getByRole('button', { name: 'BGM：theme', exact: true }).waitFor()
  await panel.getByRole('button', { name: '下一首', exact: true }).click()
  await stage.getByRole('button', { name: 'BGM：night', exact: true }).waitFor()
  // 导演选曲 on jumps back to the director's track.
  await follow.click()
  await stage.getByRole('button', { name: 'BGM：theme', exact: true }).waitFor()
  const memory = await page.evaluate(() => localStorage.getItem('dsh-tavern-bgm-sessions'))
  assert.equal(memory, '{}', 'following and playing is the default and is not stored')
  // Esc closes the panel without leaving the stage; the stage closes and the music goes on in chat.
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
  assert.equal(await stage.isVisible(), true)
  await page.keyboard.press('Escape')
  await stage.waitFor({ state: 'detached' })
  result.afterStage = await sounding('closing the stage does not stop the BGM')
  await page.screenshot({ path: join(output, 'chat-after-stage.png') })

  // The global BGM switch (舞台设置 › 基础设置): off silences and empties what the director may choose.
  await call('updateTavernSettings', { patch: { stageToggles: { music: false } } })
  await page.evaluate(() => window.dispatchEvent(new Event('dsh-tavern-settings-changed')))
  result.switchedOff = await silent('BGM off stops the music')
  const off = await call('castStage', { sessionId: restored.sessionId, count: 1 })
  assert.equal(off.musicEnabled, false)
  // Switched off, nothing is current: the chip is only ♪.
  await page.getByRole('button', { name: 'BGM', exact: true }).click()
  const chatPanel = page.locator('.dsh-tavern-bgm-panel.is-chat')
  await chatPanel.getByText('BGM 已关闭', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'chat-panel-off.png') })
  await page.keyboard.press('Escape')
  await call('updateTavernSettings', { patch: { stageToggles: { music: true } } })
  await page.evaluate(() => window.dispatchEvent(new Event('dsh-tavern-settings-changed')))
  result.switchedOn = await sounding('BGM on plays the director\'s track again')
  assert.deepEqual((await call('getStageMusicTracks', { sessionId: restored.sessionId })).tracks.length, 2)
  result.contexts = (await level()).contexts
  assert.equal(result.contexts, 1, 'one AudioContext for the page')
  await writeFile(join(output, 'stage-bgm.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
