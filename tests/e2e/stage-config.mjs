// The stage's CONFIG (cast-presentation.md 23/N): the control bar's 「声音」 opens it at 声音 over the real stage. A
// director-placed knock is heard at 音效 100, is silent at 音效 0 (the entry then says 部分静音) and is heard again when the slider
// goes back; 文字 › 自动阅读速度 3.0× turns pages faster and auto paging waits while CONFIG is open; the settings survive a reload
// and never touch the save; CONFIG keeps the stage's keys to itself and fits 375 in its compact layout. Fresh disposable profile
// only. Nothing reaches a speaker: every AudioContext ends in an analyser feeding a zero gain; the evidence is the analyser's
// level after the layer buses and the one-shot sources the page starts.
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
  await page.evaluate(() => { localStorage.removeItem('dsh-tavern-stage-audio'); localStorage.removeItem('dsh-tavern-stage-reading') })
  // As in stage-sfx.mjs: an analyser in front of stage-state's zero gain; one-shot sources are counted as they start.
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
      return { rms: Math.sqrt(sum / data.length), state: context.state, starts: window.sfxTap.starts.length }
    }
  })
  try {
    const result = await stageStateChecks({ page, output, bodyText: '"Ready."\nSomeone knocks at the door.\nThe hall is quiet again.',
      sfx: [{ name: '敲门', bytes: tone(523, 2.5) }],
      performances: () => [{ at: 2, op: 'sfx.play', sfx: '敲门' }],
      async inspect({ stage, call, sessionId }) {
        const steps = {}
        const beforeSave = (await call('exportGameSave', { sessionId, images: false })).base64
        const level = () => page.evaluate(() => window.sfxLevel())
        const progress = stage.locator('.dsh-tavern-stage-progress')
        const at = value => progress.filter({ hasText: value }).waitFor()
        const next = () => stageNext(stage)
        const first = async () => { while (!(await progress.innerText()).startsWith('1 /')) await stage.getByRole('button', { name: '上一句', exact: true }).click(); await at('1 / 3') }
        const sound = stage.locator('.dsh-tavern-stage-controls [data-action="sound"]')
        const config = page.locator('.dsh-tavern-stage-config[role="dialog"]')
        const slider = name => config.getByRole('slider', { name, exact: true })
        const tab = name => config.getByRole('tab', { name: new RegExp('^' + name) })
        const open = async () => { await sound.click(); await config.waitFor() }
        const close = async () => { await config.getByRole('button', { name: '关闭设置', exact: true }).click(); await config.waitFor({ state: 'detached' }) }
        // The knock's page: one more one-shot starts; its peak level over the next 0.9 s after the layer buses.
        async function knock() {
          const before = (await level()).starts
          await first(); await next(); await at('2 / 3')
          await page.waitForFunction(count => window.sfxTap.starts.length > count, before, { timeout: 8000, polling: 100 })
          let peak = 0
          for (let i = 0; i < 9; i++) { peak = Math.max(peak, (await level()).rms); await page.waitForTimeout(100) }
          return Number(peak.toFixed(4))
        }
        const auto = stage.getByRole('button', { name: '自动', exact: true })
        async function autoMs() {
          await first(); await page.waitForTimeout(300)
          const started = Date.now()
          await auto.click(); await at('2 / 3')
          const ms = Date.now() - started
          await auto.click()
          return ms
        }
        await at('1 / 3')
        // 1. 「声音」 opens CONFIG at 声音 with focus inside: every layer at its old level, 配音倍速 1.0×.
        assert.equal(await sound.getAttribute('aria-label'), '声音')
        await open()
        assert.equal(await tab('声音').getAttribute('aria-selected'), 'true')
        assert.ok(await config.evaluate(node => node.contains(document.activeElement)), 'focus moves into CONFIG')
        assert.equal(await config.getByText('CONFIG', { exact: true }).isVisible(), true)
        assert.deepEqual(await Promise.all(['总音量', '配音音量', '背景音乐音量', '音效音量', '环境音音量', '配音倍速'].map(name => slider(name).inputValue())), ['1', '1', '1', '1', '1', '1'])
        await page.screenshot({ path: join(output, 'config-sound-1920.png') })
        // 2. Its keys are its own: Space on a mute and ← → on a slider do not turn the page; Esc closes only CONFIG, focus back on 声音.
        await config.getByRole('button', { name: '总音量静音', exact: true }).focus()
        await page.keyboard.press('Space')
        assert.equal(await sound.getAttribute('aria-label'), '声音（已静音）', 'the entry says the mix is muted')
        await page.keyboard.press('Space')
        await slider('环境音音量').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight')
        assert.equal(await progress.innerText(), '1 / 3', 'the stage did not page while CONFIG was open')
        await page.keyboard.press('Escape')
        await config.waitFor({ state: 'detached' })
        assert.ok(await stage.isVisible(), 'Esc closed CONFIG, not the stage')
        assert.ok(await sound.evaluate(node => node === document.activeElement), 'focus returns to 声音')
        await open(); await config.click({ button: 'right', position: { x: 5, y: 5 } }); await config.waitFor({ state: 'detached' })
        steps.keys = true
        // 3. The knock at 音效 100 is heard; at 音效 0 it still starts but is silent; back at 100 it is heard again.
        steps.full = await knock()
        assert.ok(steps.full > .05, 'heard at 音效 100: ' + steps.full)
        await open(); await slider('音效音量').focus(); await page.keyboard.press('Home')
        assert.equal(await slider('音效音量').inputValue(), '0'); await close()
        assert.equal(await sound.getAttribute('data-level'), 'partial')
        steps.zero = await knock()
        assert.ok(steps.zero < .001, 'silent at 音效 0: ' + steps.zero)
        await open(); await slider('音效音量').focus(); await page.keyboard.press('End'); await close()
        assert.equal(await sound.getAttribute('data-level'), 'normal')
        steps.restored = await knock()
        assert.ok(steps.restored > .05, 'heard again at 音效 100: ' + steps.restored)
        // 4. 文字 › 自动阅读速度: a short line turns after 1.5 s at 1.0× and 0.5 s at 3.0×; auto waits while CONFIG is open.
        steps.auto1 = await autoMs()
        await first(); await auto.click(); await open()
        await page.waitForTimeout(2200)
        assert.equal(await progress.innerText(), '1 / 3', 'auto paging waits while CONFIG is open')
        await close(); await at('2 / 3'); await auto.click()
        steps.held = true
        await open(); await tab('文字').click()
        assert.equal(await slider('自动阅读速度').getAttribute('aria-valuetext'), '1.0 倍')
        assert.equal(await slider('自动模式等待').getAttribute('aria-valuetext'), '0.4 秒')
        await page.screenshot({ path: join(output, 'config-text-1920.png') })
        await slider('自动阅读速度').focus(); await page.keyboard.press('End')
        assert.equal(await slider('自动阅读速度').getAttribute('aria-valuetext'), '3.0 倍'); await close()
        steps.auto3 = await autoMs()
        assert.ok(steps.auto1 >= 1400 && steps.auto3 <= 1100 && steps.auto3 < steps.auto1 - 600, 'auto pace: ' + steps.auto1 + ' vs ' + steps.auto3)
        // 5. The settings are this browser's: a reload reads them back (CONFIG reopens at its last tab via 声音 = 声音); the save is untouched.
        await open(); await config.getByRole('button', { name: '配音静音', exact: true }).click(); await close()
        const saved = await page.evaluate(() => [localStorage.getItem('dsh-tavern-stage-audio'), localStorage.getItem('dsh-tavern-stage-reading')].map(value => JSON.parse(value)))
        assert.deepEqual(saved, [{ v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: { voice: true } }, { textSpeed: 28, autoWait: 400, autoSpeed: 3, voiceRate: 1 }])
        await page.reload()
        await page.getByRole('button', { name: '舞台', exact: true }).click()
        await stage.waitFor(); await open()
        assert.equal(await config.getByRole('button', { name: '取消配音静音', exact: true }).getAttribute('aria-pressed'), 'true')
        await tab('文字').click()
        assert.equal(await slider('自动阅读速度').getAttribute('aria-valuetext'), '3.0 倍')
        steps.reload = true
        // 6. 375: the compact layout fills the screen, every row in view, no sideways scroll.
        await page.setViewportSize({ width: 375, height: 812 })
        await tab('声音').click()
        assert.equal(await config.getAttribute('data-layout'), 'compact')
        const sheet = config.locator('.dsh-tavern-stage-config-sheet')
        const box = await sheet.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= 375.5 && box.y >= 0 && box.y + box.height <= 812.5, '375: ' + JSON.stringify(box))
        assert.equal(await config.locator('.dsh-tavern-stage-config-page').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'no sideways scroll')
        await page.screenshot({ path: join(output, 'config-sound-375.png') })
        await config.getByRole('button', { name: '取消配音静音', exact: true }).click()
        await tab('文字').click(); await slider('自动阅读速度').fill('1'); await close()
        await page.setViewportSize({ width: 1920, height: 1080 })
        const afterSave = (await call('exportGameSave', { sessionId, images: false })).base64
        assert.deepEqual(readGameSave(Buffer.from(afterSave, 'base64')).plugins, readGameSave(Buffer.from(beforeSave, 'base64')).plugins, 'settings never write the save')
        steps.save = true
        return steps
      }
    })
    await writeFile(join(output, 'stage-config.json'), JSON.stringify(result.performance, null, 2))
    console.log(JSON.stringify({ config: true, steps: result.performance, output }))
  } catch (error) {
    await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  }
} finally { await browser.close() }
