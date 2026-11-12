// 数据删除 voice (mods/redaction/README.md 配音): a line over covered words is synthesized whole; while a cover still shut is
// heard the mixer turns the voice down under the mod's seeded noise.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'

const require = createRequire(import.meta.url)
const marks = require('../tavern-plugin/packages/dsh-presentation-protocol/src/text-marks.cjs')
const {redactionNoise} = require('../tavern-plugin/mods/redaction/client/noise.cjs')
const math = await readFile(new URL('../tavern-plugin/src/client/stage-audio-math.js', import.meta.url), 'utf8')
const mixer = await readFile(new URL('../tavern-plugin/src/client/stage-audio.js', import.meta.url), 'utf8')

test('a covered range is heard where its share of the speaking weight falls, pauses included', () => {
  const [row] = marks.textMarkTimes('十三楼见。', [{start:0, end:3}])
  // 十三楼 is three syllables of 十三楼见 (four) and a full stop (2.5)
  assert.deepEqual([row.from, +row.to.toFixed(4)], [0, +(3 / 6.5).toFixed(4)])
  const [latin] = marks.textMarkTimes('Go to Floor 13', [{start:6, end:14}])
  assert.ok(latin.from > 0.3 && latin.to === 1)
})

test('a voice over covered words masks the covers still shut, and one that reads other words is not heard', () => {
  const open = new Set(), kind = {open:(place, index) => open.has(place.para + ':' + index), noise:() => new Float32Array(4)}
  const mark = {quote:'十三楼', index:0, kind}, place = {sessionId:'s', turn:2, source:'k', para:1}
  const cover = {text:'去十三楼。', ranges:[{start:1, end:4, mark}], place}
  const voice = marks.textMarkVoice('去十三楼。', cover)
  assert.equal(voice.maskedText, '去。', 'browser speech reads the line without the words')
  const shut = voice.masks()
  assert.equal(shut.spans.length, 1); assert.equal(shut.noise, kind.noise)
  open.add('1:0')
  assert.equal(voice.masks(), null, 'an opened cover is heard as words')
  // a quoted line voices the same words inside other text: the quote is found there
  assert.ok(marks.textMarkVoice('「去十三楼。」', cover).masks)
  assert.equal(marks.textMarkVoice('Go to the 13th floor.', cover), false, 'a translated voice cannot be covered')
})

test('the noise is seeded: the same seed gives the same samples, another seed others, at the nominal voice level', () => {
  const a = redactionNoise(8000, 7, 1), b = redactionNoise(8000, 7, 1), c = redactionNoise(8000, 8, 1)
  assert.equal(a.length, 8000)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  const rms = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) / a.length)
  assert.ok(rms > 0.08 && rms <= 0.1, String(rms))
  assert.ok(a.every(value => value >= -1 && value <= 1))
  assert.equal(Math.abs(a[0]), 0, 'the loop seam fades')
})

function harness() {
  const timers = []
  const param = () => ({value:1, cancelScheduledValues() {}, cancelAndHoldAtTime() {}, setTargetAtTime(v) { this.value = v }, setValueAtTime(v) { this.value = v }})
  const graph = () => ({gain:param(), connect() {}, disconnect() {}})
  const started = []
  class Context {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sampleRate = 8000 }
    createGain() { return graph() }
    createMediaElementSource() { return graph() }
    createBuffer(channels, length) { return {length, copyToChannel(samples) { this.samples = samples }} }
    createBufferSource() { const source = {connect() {}, disconnect() {}, start() { started.push(source) }, stop() { source.stopped = true }}; return source }
    resume() { return Promise.resolve() }
    suspend() { return Promise.resolve() }
    addEventListener() {}
  }
  const ctx = {setTimeout, clearTimeout, setInterval:fn => (timers.push(fn), timers.length), clearInterval:() => { timers.length = 0 },
    window:{AudioContext:Context, addEventListener() {}}, localStorage:{getItem() {}, setItem() {}}, Math}
  const api = vm.runInNewContext(math + mixer + ';forkStageAudio', ctx)
  const node = {volume:1, paused:true, ended:false, duration:2, currentTime:0, addEventListener() {}}
  return {api, node, started, tick:() => timers.forEach(fn => fn())}
}

test('the mixer turns a voice down under the noise only while a shut cover is heard', () => {
  const h = harness(), record = h.api.bind(h.node, 'voice', 'blob:a'), full = record.gain.gain.value
  h.api.mask(h.node, {spans:[[0.5, 0.75]], noise:(rate, seed) => Object.assign(new Float32Array(rate), {seed})})
  h.node.paused = false; h.tick()
  assert.equal(record.gain.gain.value, full, 'before the cover the words are heard')
  h.node.currentTime = 0.9; h.tick()
  assert.ok(Math.abs(record.gain.gain.value - full * 0.05) < 1e-9, 'the cover (from 1.0 s, 0.15 s early) turns the voice down')
  assert.equal(h.started.length, 1, 'its noise sounds')
  h.node.currentTime = 1.7; h.tick()
  assert.equal(record.gain.gain.value, full, 'after the cover (to 1.5 s, 0.15 s late) the words are heard again')
  h.node.currentTime = 1.2; h.node.paused = true; h.tick()
  assert.equal(record.gain.gain.value, full, 'a paused voice is not covered')
  h.node.paused = false; h.tick()
  assert.ok(record.gain.gain.value < full)
  h.node.ended = true; h.tick()
  assert.equal(record.gain.gain.value, full); assert.equal(h.started[0].stopped, true, 'an ended line drops its noise')
})

test('a cover over the first words holds from the first sample, and no cover hears the line as is', () => {
  const h = harness(), record = h.api.bind(h.node, 'voice', 'blob:b'), full = record.gain.gain.value
  h.api.mask(h.node, {spans:[[0, 0.2]], noise:null})
  assert.ok(record.gain.gain.value < full, 'covered before play() starts')
  h.api.mask(h.node, null)
  assert.equal(record.gain.gain.value, full)
})
