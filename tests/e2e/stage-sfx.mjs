// 音效 (cast-presentation.md 19/N): a director-placed sound plays once on its page over the real stage, from the card's pack
// entry; skip, reopen and reload never replay it; 音效 off (stageToggles.sfx) silences it and an entry switched off is not
// played, without touching the save. Fresh disposable profile only. Nothing reaches a speaker: every AudioContext ends in an
// analyser feeding a zero gain; the evidence is the analyser's level and the one-shot sources the page starts.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { stageNext, stageStateChecks } from './stage-state.mjs'

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

await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
  assert.equal(pages.length, 1)
  const page = pages[0]
  page.setDefaultTimeout(20000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  // Installed before stage-state's own silencer, whose zero gain then feeds this analyser at full level (the analyser's own
  // zero gain still keeps the speakers silent); one-shot sources (loop false, unlike the BGM's) are counted as they start.
  await page.addInitScript(() => {
    const Base = window.AudioContext
    window.sfxTap = { contexts: [], starts: [] }
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args)
        const silence = super.createGain(); silence.gain.value = 0; silence.connect(super.destination)
        const tap = super.createAnalyser(); tap.fftSize = 2048; tap.connect(silence)
        this.sfxAnalyser = tap; window.sfxTap.contexts.push(this)
        queueMicrotask(() => { if (this.stageTestSilence) this.stageTestSilence.gain.value = 1 })
      }
      get destination() { return this.sfxAnalyser }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node)
        node.start = (...args) => { if (!node.loop) window.sfxTap.starts.push({ duration: node.buffer?.duration, at: performance.now() }); return start(...args) }
        return node
      }
    }
    window.sfxLevel = () => {
      const context = window.sfxTap.contexts[0]
      if (!context) return { rms: 0, starts: window.sfxTap.starts.length }
      const data = new Float32Array(2048); context.sfxAnalyser.getFloatTimeDomainData(data)
      let sum = 0; for (const value of data) sum += value * value
      return { rms: Math.sqrt(sum / data.length), time: context.currentTime, state: context.state, starts: window.sfxTap.starts.length }
    }
  })
  try {
    const result = await stageStateChecks({ page, output, bodyText: '"Ready."\nSomeone knocks at the door.\nA bell rings for a long time.',
      sfx: [{ name: '敲门', bytes: tone(523, 1.2) }, { name: '铃声', bytes: tone(784, 4) }],
      performances: () => [{ at: 1, op: 'sfx.play', sfx: '敲门' }, { at: 2, op: 'sfx.play', sfx: '敲门' }, { at: 3, op: 'sfx.play', sfx: '铃声' }],
      async inspect({ stage, call, sessionId, cardPath }) {
        const level = () => page.evaluate(() => window.sfxLevel())
        const starts = async () => (await level()).starts
        const settled = () => page.waitForTimeout(1800)
        const text = value => stage.locator('.dsh-tavern-stage-text').filter({ hasText: value }).waitFor()
        const next = () => stageNext(stage)
        const back = () => stage.getByRole('button', { name: '上一句', exact: true }).click()
        const sounding = async (count, label) => {
          await page.waitForFunction(count => window.sfxTap.starts.length === count, count, { timeout: 8000, polling: 100 })
          await page.waitForFunction(() => window.sfxLevel().rms > .05, null, { timeout: 8000, polling: 100 })
          const now = await level()
          assert.ok(now.rms > .05 && now.state === 'running', label + ': ' + JSON.stringify(now))
          return { rms: Number(now.rms.toFixed(3)), starts: now.starts }
        }
        const silent = async label => {
          await page.waitForFunction(() => window.sfxLevel().rms < .001, null, { timeout: 8000, polling: 100 })
          const now = await level()
          assert.ok(now.rms < .001, label + ': ' + JSON.stringify(now))
          return { rms: now.rms, starts: now.starts }
        }
        const steps = {}
        const beforeSave = (await call('exportGameSave', { sessionId, images: false })).base64
        const data = await call('castStage', { sessionId, count: 1 })
        const cues = data.turns.at(-1).performances
        assert.deepEqual(cues.map(event => [event.at, event.op, event.sfx, event.volume]), [[1, 'sfx.play', '敲门', 1], [2, 'sfx.play', '敲门', 1], [3, 'sfx.play', '铃声', 1]])
        assert.ok(cues.every(event => /\/lease\//.test(event.audio)), 'the host hands the entry\'s audio lease')
        assert.equal(data.sfxEnabled, true)
        // 1. Opening the stage on a page with a sound restores it without playing.
        await settled()
        assert.equal(await starts(), 0, 'opening an existing page does not play')
        // 2. Paging to the sound's page plays it once (after the ~1 s stay); it ends by itself.
        await next(); await text('knocks')
        steps.played = await sounding(1, 'the knock plays on its page')
        assert.equal((await page.evaluate(() => window.sfxTap.starts[0].duration)).toFixed(1), '1.2')
        await page.screenshot({ path: join(output, 'sfx-1920.png') })
        steps.ended = await silent('the knock ends')
        await settled()
        assert.equal(await starts(), 1, 'played once')
        // 3. 音效 off while the long bell rings: it stops at once; its page no longer plays and the save is not changed.
        await next(); await text('bell')
        steps.bell = await sounding(2, 'the bell plays')
        await call('updateTavernSettings', { patch: { stageToggles: { sfx: false } } })
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        steps.switchedOff = await silent('音效 off silences the ringing bell')
        const off = await call('castStage', { sessionId, count: 1 })
        assert.deepEqual([off.sfxEnabled, off.turns.at(-1).performances], [false, []])
        await back(); await text('knocks'); await settled()
        assert.equal(await starts(), 2, '音效 off: the knock page plays nothing')
        await page.screenshot({ path: join(output, 'sfx-off-1920.png') })
        await call('updateTavernSettings', { patch: { stageToggles: { sfx: true } } })
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        // 4. The knock entry switched off (its lamp): its pages play nothing; the bell stays.
        const [packId] = (await call('getCardAssetPacks', { path: cardPath })).boundPackIds
        const pack = (await call('getAssetPack', { packId })).pack
        const lamp = enabled => call('updateAssetPackEntries', { packId, expectedRevision: pack.revision, assets: pack.manifest.assets.map(asset => asset.kind === 'sfx' && asset.name === '敲门' ? { ...asset, enabled } : asset) })
        const dark = (await lamp(false)).pack
        assert.deepEqual((await call('castStage', { sessionId, count: 1 })).turns.at(-1).performances.map(event => event.sfx), ['铃声'])
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        await back(); await next(); await text('knocks'); await settled()
        assert.equal(await starts(), 2, 'a switched-off entry is not played')
        await call('updateAssetPackEntries', { packId, expectedRevision: dark.revision, assets: pack.manifest.assets })
        assert.equal((await call('castStage', { sessionId, count: 1 })).turns.at(-1).performances.length, 3, 'switching it back plays it again; nothing was rewritten')
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed')))
        // 5. Skip lands on the bell's page without playing it; closing and reopening the stage restores it without playing.
        await back(); await text('Ready.'); await settled()
        const beforeSkip = await starts()
        await stage.getByRole('button', { name: '跳过', exact: true }).click()
        await text('bell'); await settled()
        assert.equal(await starts(), beforeSkip, 'skip never plays')
        await page.keyboard.press('Escape')
        await stage.waitFor({ state: 'detached' })
        await page.getByRole('button', { name: '舞台', exact: true }).click()
        await stage.waitFor(); await text('bell'); await settled()
        assert.equal(await starts(), beforeSkip, 'reopening restores the page without playing')
        // 6. A reload opens the stage again on a page with a sound: nothing plays.
        await page.reload()
        await page.getByRole('button', { name: '舞台', exact: true }).click()
        await stage.waitFor(); await text('Ready.'); await settled()
        assert.equal(await starts(), 0, 'a reload never replays')
        // 7. 375: the knock page plays once in the narrow layout too.
        await page.setViewportSize({ width: 375, height: 812 })
        await stage.locator('.dsh-tavern-stage-text .dsh-tavern-stage-type[data-typed]').waitFor()
        await stage.getByRole('button', { name: '下一句', exact: true }).evaluate(button => button.click())
        await text('knocks')
        steps.narrow = await sounding(1, 'the knock plays at 375')
        await page.screenshot({ path: join(output, 'sfx-375.png') })
        await silent('the knock ends at 375')
        await page.setViewportSize({ width: 1920, height: 1080 })
        const afterSave = (await call('exportGameSave', { sessionId, images: false })).base64
        assert.deepEqual(readGameSave(Buffer.from(afterSave, 'base64')).plugins, readGameSave(Buffer.from(beforeSave, 'base64')).plugins, 'playing and switching never write')
        return steps
      }
    })
    await writeFile(join(output, 'stage-sfx.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ sfx: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
