// phone power: the stage mixer's AudioContext sleeps when nothing sounds and wakes before a source starts.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

// A short silent WAV served as a blob, so an element can really play.
const wav = seconds => {
  const rate = 8000, samples = Math.round(rate * seconds), data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40)
  return [...data]
}

test('mixer AudioContext suspends after a quiet and resumes before a bound element plays', async t => {
  const browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><title>mixer</title>')
  // Capture the mixer's context: its state is what the device's audio hardware follows.
  await page.evaluate(() => { const Base = window.AudioContext; window.AudioContext = class extends Base { constructor(...args) { super(...args); window.testContext = this } } })
  const scripts = await Promise.all(['stage-audio-math.js', 'stage-audio.js'].map(file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')))
  await page.addScriptTag({content: scripts.join('\n') + '\nwindow.testMixer = forkStageAudio;'})
  const state = () => page.evaluate(() => window.testContext.state)
  const settled = value => page.waitForFunction(value => window.testContext.state === value, value, {timeout: 6000})

  await page.evaluate(() => window.testMixer.wake())
  await settled('running')
  await settled('suspended')

  // A buffer source holds the context awake for as long as it is on the mixer.
  await page.evaluate(() => { window.testInput = window.testMixer.bufferInput('ui', {}) })
  await settled('running')
  await page.waitForTimeout(3600)
  assert.equal(await state(), 'running', 'an active source keeps it running')
  await page.evaluate(() => window.testInput.release())
  await settled('suspended')

  // A bound element's play waits for the wake-up, so it never starts into a sleeping context.
  const startedIn = await page.evaluate(async bytes => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'audio/wav'}))
    const node = new Audio(url)
    window.testMixer.bind(node, 'voice', url)
    const playing = new Promise(resolve => node.addEventListener('playing', () => resolve(window.testContext.state), {once: true}))
    await node.play()
    window.testNode = node
    return playing
  }, wav(0.5))
  assert.equal(startedIn, 'running')
  await page.waitForFunction(() => window.testNode.ended, null, {timeout: 5000})
  await settled('suspended')

  // A phone call holds it from dialling to hang-up, even between its own sounds.
  await page.evaluate(() => { window.testMixer.call(true); window.testMixer.wake() })
  await settled('running')
  await page.waitForTimeout(3600)
  assert.equal(await state(), 'running')
  await page.evaluate(() => window.testMixer.call(false))
  await settled('suspended')
  assert.deepEqual(errors, [])
})

// iOS Safari may not resume a suspended context without a tap; AUTO and a reply streaming with voice start lines from a timer,
// so while either holds the mixer (keepAwake) it never sleeps, even in the silence between lines.
test('mixer AudioContext stays running while a keepAwake owner holds it, and sleeps after a quiet once released', async t => {
  const browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><title>mixer</title>')
  await page.evaluate(() => { const Base = window.AudioContext; window.AudioContext = class extends Base { constructor(...args) { super(...args); window.testContext = this } } })
  const scripts = await Promise.all(['stage-audio-math.js', 'stage-audio.js'].map(file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')))
  await page.addScriptTag({content: scripts.join('\n') + '\nwindow.testMixer = forkStageAudio;'})
  const state = () => page.evaluate(() => window.testContext.state)
  const settled = value => page.waitForFunction(value => window.testContext.state === value, value, {timeout: 6000})

  await page.evaluate(() => window.testMixer.wake())
  await settled('running')
  await settled('suspended')
  // AUTO turns on: the context wakes and stays up through a silence longer than the idle quiet.
  await page.evaluate(() => { window.auto = {}; window.testMixer.keepAwake(window.auto, true) })
  await settled('running')
  await page.waitForTimeout(4000)
  assert.equal(await state(), 'running', 'held awake with nothing sounding')
  // A second holder (a streaming reply) outlasts the first.
  await page.evaluate(() => { window.stream = {}; window.testMixer.keepAwake(window.stream, true); window.testMixer.keepAwake(window.auto, false) })
  await page.waitForTimeout(3600)
  assert.equal(await state(), 'running', 'one holder left')
  await page.evaluate(() => window.testMixer.keepAwake(window.stream, false))
  await settled('suspended')
  assert.deepEqual(errors, [])
})

// A full-screen entrance video with its own soundtrack (stage video.cjs `exclusive`) is the only source heard: every other
// source holds at 0 under the user's levels, a source starting meanwhile starts silent, and they glide back afterwards.
test('an exclusive element silences every other source until it is released', async t => {
  const browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.setContent('<!doctype html><title>mixer</title>')
  const scripts = await Promise.all(['stage-audio-math.js', 'stage-audio.js'].map(file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')))
  await page.addScriptTag({content: scripts.join('\n') + '\nwindow.testMixer = forkStageAudio;'})
  const gains = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)).then(() => Object.fromEntries(Object.entries(window.others).map(([layer, input]) => [layer, input.input.gain.value]))))
  await page.evaluate(bytes => {
    window.others = {}
    for (const layer of ['music', 'ambience', 'voice', 'sfx']) window.others[layer] = window.testMixer.bufferInput(layer, {volume: 1})
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'audio/wav'}))
    window.own = new Audio(url)
    window.testMixer.bind(window.own, 'sfx', url)
  }, wav(0.5))
  const base = await gains(), levels = await page.evaluate(() => window.testMixer.get())
  for (const value of Object.values(base)) assert.ok(value > 0.05)
  await page.evaluate(() => window.testMixer.exclusive(window.own, true))
  assert.equal(await page.evaluate(() => window.testMixer.diagnostics().exclusive), 'sfx')
  for (const [layer, value] of Object.entries(await gains())) assert.ok(value < 0.01, layer + ' ' + value)
  assert.equal(await page.evaluate(() => window.testMixer.bufferInput('voice', {volume: 1}).input.gain.value), 0, 'a source starting meanwhile starts silent')
  assert.deepEqual(await page.evaluate(() => window.testMixer.get()), levels, "the user's levels are untouched")
  await page.evaluate(() => window.testMixer.release(window.own))
  assert.equal(await page.evaluate(() => window.testMixer.diagnostics().exclusive), null, 'releasing the element ends its exclusivity')
  await page.waitForTimeout(1500)
  for (const [layer, value] of Object.entries(await gains())) assert.ok(value > base[layer] * 0.6, layer + ' ' + value)
  assert.deepEqual(errors, [])
})