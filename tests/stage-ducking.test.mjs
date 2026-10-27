// 避让 (cast-presentation.md 37/N): while a voice or a sound effect sounds, the layers below it dip (features/stage-audio.js);
// the voice says when it is heard (features/speech.js), 音效 when its first sound starts and its last ends (modules/stage-sfx.js);
// a skin's `duck` sets the amounts (domain/stage-skin.js). On a fake audio context and fake media: no device, no sound.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { validateStageSkin } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const dB = value => Math.round(20 * Math.log10(value) * 100) / 100

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => { values.set(key, String(value)) } }
}
// Each gain records its value and the glides scheduled on it ({ to, at, tau } after a hold at `held`).
function audioContext() {
  return {
    state: 'running', currentTime: 10, destination: { name: 'destination' },
    createGain() {
      return { gain: { value: 1, glides: [], held: null, setTargetAtTime(to, at, tau) { this.glides.push({ to, at, tau }); this.value = to }, cancelAndHoldAtTime(at) { this.held = at } },
        connect(next) { this.next = next } }
    }
  }
}
// The page's audio state with a fake speech whose watchers the test drives.
function load(storage = memoryStorage()) {
  const context = audioContext(), watchers = []
  const sandbox = { localStorage: storage, window: { AudioContext: function () { return context } },
    tavernSpeech: { tune() {}, watch: fn => { watchers.push(fn); return () => {} } }, React: {} }
  const { tavernStageAudio } = vm.runInNewContext(client('stage-audio-math.js') + '\n' + client('features/stage-audio.js') + '\n;({ tavernStageAudio })', sandbox)
  const voice = on => watchers.forEach(fn => fn(on))
  tavernStageAudio.context()
  const dip = layer => tavernStageAudio.output(context, layer).next.gain
  return { audio: tavernStageAudio, context, storage, voice, dip, level: layer => dB(dip(layer).value) }
}

test('a voice lowers the layers below it, 音效 the ones below it; both take the deepest dip, never the sum; sliders untouched', () => {
  const page = load(), layers = () => ['music', 'ambience', 'sfx'].map(page.level)
  const music = page.audio.output(page.context, 'music'), sfx = page.audio.output(page.context, 'sfx')
  assert.ok(music.next !== sfx.next && music.next.next === sfx.next.next, 'each layer has its own dip before the one 总音量')
  assert.deepEqual(layers(), [0, 0, 0], 'nothing sounding: no dip')
  page.voice(true)
  assert.deepEqual(layers(), [-4, -4, -2], 'a voice: BGM and 环境音 -4 dB, 音效 -2 dB')
  page.audio.duck('sfx', true)
  assert.deepEqual(layers(), [-4, -4, -2], 'with a sound effect too, each layer keeps the deeper dip')
  page.voice(false)
  assert.deepEqual(layers(), [-2, -3, 0], 'the sound effect alone: BGM -2, 环境音 -3, 音效 itself untouched')
  page.audio.duck('sfx', false)
  assert.deepEqual(layers(), [0, 0, 0], 'all back')
  assert.deepEqual([music.gain.value, sfx.gain.value], [1, 1], 'the layer sliders never move')
})

test('a dip glides down at the attack and back up after the hold, held where it is so a turn midway is continuous', () => {
  const page = load(), gain = page.dip('music')
  page.voice(true)
  assert.deepEqual([gain.held, gain.glides.at(-1)], [10, { to: Math.pow(10, -4 / 20), at: 10, tau: .05 }])
  page.context.currentTime = 12
  page.voice(false)
  assert.deepEqual([gain.held, gain.glides.at(-1)], [12, { to: 1, at: 12.25, tau: .2 }], 'voice: up after 0.25 s, release 0.2 s')
  page.audio.duck('sfx', true); page.audio.duck('sfx', false)
  assert.deepEqual(gain.glides.slice(-2).map(glide => [dB(glide.to), Math.round((glide.at - 12) * 100) / 100, glide.tau]), [[-2, 0, .02], [0, .05, .15]], '音效: attack 20 ms, hold 50 ms, release 150 ms')
  const count = gain.glides.length
  page.audio.duck('sfx', false)
  assert.equal(gain.glides.length, count, 'an unchanged trigger schedules nothing')
})

test('CONFIG › 声音 › 自动混音 turns it off and on, saved in this browser; off only adds duck: false', () => {
  const page = load()
  page.voice(true)
  page.audio.setDucking(false)
  assert.equal(page.level('music'), 0, 'off: a sounding voice no longer dips')
  assert.deepEqual(JSON.parse(page.storage.getItem('dsh-tavern-stage-audio')), { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {}, duck: false })
  const again = load(page.storage)
  again.voice(true)
  assert.deepEqual([again.audio.get().duck, again.level('music')], [false, 0], 'a reload reads it back')
  again.audio.setDucking(true)
  assert.deepEqual([again.level('music'), again.audio.get().duck], [-4, undefined], 'on again, at once')
  assert.deepEqual(JSON.parse(again.storage.getItem('dsh-tavern-stage-audio')), { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} })
})

test('a skin sets the amounts cell by cell over the engine\'s; without one the engine\'s return', () => {
  const page = load()
  page.voice(true)
  page.audio.duckBy({ voice: { music: -12, sfx: 0 } })
  assert.deepEqual(['music', 'ambience', 'sfx'].map(page.level), [-12, -4, 0], 'the declared cells change, the rest stay')
  page.audio.duckBy(null)
  assert.equal(page.level('music'), -4)
})

test('the voice is heard from its start to its end or stop; 音效 sounds from its first sound to its last', async () => {
  const elements = []
  class FakeAudio { constructor(url) { this.url = url; elements.push(this) } play() { return Promise.resolve() } pause() {} }
  const sandbox = { window: {}, Audio: FakeAudio, rpc: async () => ({}), tavernErrorHub: { report() {} }, React: {}, Promise }
  const { tavernSpeech } = vm.runInNewContext(client('features/speech.js') + '\n;({ tavernSpeech })', sandbox)
  const heard = []
  tavernSpeech.watch(on => heard.push(on))
  const first = tavernSpeech.play({ url: 'a.wav' })
  assert.deepEqual(heard, [], 'loading is not heard')
  elements[0].onplaying()
  assert.deepEqual(heard, [true])
  elements[0].onended(); await first
  assert.deepEqual(heard, [true, false])
  void tavernSpeech.play({ url: 'b.wav' }); elements[1].onplaying()
  tavernSpeech.stop()
  assert.deepEqual(heard, [true, false, true, false], 'a stop ends it')

  const { createStageSfx } = vm.runInNewContext(client('modules/stage-music.js') + '\n' + client('modules/stage-sfx.js') + '; ({ createStageSfx })', { AbortController })
  const sources = [], sounding = []
  const context = { state: 'running', currentTime: 0, destination: {}, decodeAudioData: async () => ({}),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => { const node = { connect() {}, disconnect() {}, start() {}, stop() {} }; sources.push(node); return node } }
  const sfx = createStageSfx({ context: () => context, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    clock: { setTimeout: () => 0, clearTimeout() {} }, sounding: on => sounding.push(on) })
  await sfx.play('knock'); await sfx.play('door')
  assert.deepEqual(sounding, [true], 'the first sound starts it; a second one adds nothing')
  sources[0].onended()
  assert.deepEqual(sounding, [true])
  sources[1].onended()
  assert.deepEqual(sounding, [true, false], 'the last one ends it')
  await sfx.play('knock'); sfx.stop()
  assert.deepEqual(sounding, [true, false, true, false], 'the stage closing stops it')
})

test('a skin\'s duck is checked where it enters: known triggers and layers below them, -24..0 dB', () => {
  const skin = duck => ({ schema: 'dsh.skin/1', id: 'sample-duck', label: '示例', textbox: { paint: { bg: '#101418', fg: '#f2f2f2', accent: '#7fd0ff' } },
    nameplate: { shape: 'plain', paint: { bg: '#101418', fg: '#f2f2f2' } }, font: {}, textFx: { reveal: 'type' }, duck })
  validateStageSkin(skin({ voice: { music: -10, ambience: -24, sfx: 0 }, sfx: { music: -1.5 } }))
  for (const duck of [{}, { voice: { voice: -3 } }, { sfx: { sfx: -3 } }, { ambience: { music: -3 } }, { voice: { music: 2 } }, { voice: { music: -30 } }, { voice: -4 }])
    assert.throws(() => validateStageSkin(skin(duck)), error => error.code === 'INVALID_SKIN', JSON.stringify(duck))
})
