// The stage's BGM transport (modules/stage-music.js) on a fake audio render clock: no device, no sound.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/stage-music.js', import.meta.url), 'utf8')
const { createStageMusic, stageMusicLoop } = vm.runInNewContext(source + '; ({ createStageMusic, stageMusicLoop })', { AbortController })
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function harness({ fetch } = {}) {
  let now = 0, serial = 0
  const timers = new Map(), nodes = [], gains = []
  const samples = new Float32Array(12000).fill(.2)
  const context = {
    state: 'running', decodes: 0, destination: { name: 'destination' },
    get currentTime() { return now / 1000 },
    resume() { this.state = 'running'; return Promise.resolve() },
    createGain() {
      const node = { gain: { value: 1, setValueAtTime(value) { this.value = value } }, connect(next) { this.next = next }, disconnect() { this.next = null } }
      gains.push(node); return node
    },
    async decodeAudioData() { context.decodes++; const data = samples.slice(); return { sampleRate: 1000, length: 12000, duration: 12, numberOfChannels: 1, getChannelData: () => data } },
    createBufferSource() {
      const node = { paused: true, buffer: null, loop: false, connect(input) { this.input = input }, disconnect() {},
        start(when, offset) { this.paused = false; this.offset = offset }, stop() { this.paused = true } }
      nodes.push(node); return node
    }
  }
  const music = createStageMusic({ context: () => context, fetch: fetch || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    clock: { now: () => now, setTimeout(fn) { timers.set(++serial, fn); return serial }, clearTimeout(id) { timers.delete(id) } } })
  // A voice is input -> envelope -> trim -> destination: its envelope is the gain the input feeds.
  const envelope = node => node.input.next.gain.value
  return { music, context, nodes, gains, envelope, advance(ms) { now += ms; const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()) } }
}

test('a track plays its intro once, loops at its points, pauses without decoding and keeps its identity across renewed URLs', async () => {
  const h = harness()
  await h.music.play('first', true, 'id', { loopStart: 2, loopEnd: 8, volume: .4 })
  assert.equal(h.context.decodes, 1)
  assert.deepEqual([h.nodes[0].loop, h.nodes[0].loopStart, h.nodes[0].loopEnd], [true, 2, 8])
  assert.equal(h.nodes[0].input.next.next.gain.value, .4, 'the entry volume trims the track')
  assert.equal(h.nodes[0].input.next.next.next, h.context.destination)
  h.advance(8500); assert.equal(h.music.get().position, 2.5)
  h.music.pause(); h.advance(1000); assert.equal(h.music.get().position, 2.5)
  h.music.resume(); h.advance(1000); assert.equal(h.music.get().position, 3.5)
  h.music.play('renewed', false, 'id', { loopStart: 2, loopEnd: 8, volume: .4 })
  assert.deepEqual([h.context.decodes, h.music.get().current], [1, 'first'], 'a renewed lease is the same track')
  const previous = h.nodes.at(-1)
  h.music.trim(.3, { loopStart: 3, loopEnd: 9 })
  assert.equal(h.nodes.at(-1).loopStart, 3)
  assert.equal(h.nodes.at(-1).input.next.next.gain.value, .3)
  assert.deepEqual([previous.buffer, h.music.get().position, h.context.decodes], [null, 3.5, 1])
  h.music.stop()
  assert.ok(h.nodes.every(node => node.paused && node.buffer === null))
})

test('without loop points the silent ends are trimmed and one equal-power seam is baked into the tail', () => {
  const data = [new Float32Array(1000), new Float32Array(1000)]
  for (let i = 100; i < 900; i++) { data[0][i] = Math.sin(i * .1) * .2; data[1][i] = .1 }
  const original = data.map(row => row.slice())
  const loop = stageMusicLoop({ sampleRate: 1000, length: 1000, duration: 1, numberOfChannels: 2, getChannelData: i => data[i] })
  assert.deepEqual([loop.offset, loop.start, loop.end], [.1, .14, .9])
  for (let c = 0; c < 2; c++) { assert.equal(data[c][899], original[c][139]); assert.equal(data[c][900], 0) }
  assert.ok(Math.abs(data[1][880] - .1 * Math.SQRT2) < .001)
  loop.restore(); assert.deepEqual(data, original)
  assert.deepEqual({ ...stageMusicLoop({ sampleRate: 1000, length: 1000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(1000) }) },
    { offset: 0, start: 0, end: 1, fallback: true }, 'a silent file loops whole')
})

test('loads are cancel-safe; crossfades, a stop fade a new track interrupts, failed media and a pause while loading release every source', async () => {
  let finish
  const h = harness({ fetch: async url => url === 'slow' ? new Promise(resolve => { finish = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) })
    : { ok: url !== 'bad', status: 404, arrayBuffer: async () => new ArrayBuffer(8) } })
  const stale = h.music.play('slow', true, 'slow'); await drain()
  const fresh = h.music.play('new', true, 'new'); finish(); await fresh; await stale
  assert.equal(h.nodes.filter(node => !node.paused).length, 1); assert.equal(h.music.get().identity, 'new')
  const sounding = h.nodes.at(-1)
  const fade = h.music.stop(false); h.advance(600)
  assert.equal(h.envelope(sounding), .5, 'a stop fades over 1.2 s')
  const next = h.music.play('next', false, 'next'); await drain(); await fade
  h.advance(600)
  assert.ok(h.envelope(sounding) < .5 && h.envelope(h.nodes.at(-1)) > 0, 'the new track crossfades from where the stop had reached')
  h.advance(1200); await next
  assert.equal(h.nodes.filter(node => !node.paused).length, 1)
  await h.music.play('bad', true, 'bad')
  assert.match(h.music.get().error, /404/); assert.ok(h.nodes.every(node => node.paused))
  const loading = h.music.play('slow', true, 'slow'); await drain(); h.music.pause(); finish(); await loading
  assert.equal(h.music.get().paused, true, 'a pause during loading holds the new track')
  h.music.resume(); assert.equal(h.music.get().paused, false)
  h.music.stop(); assert.ok(h.nodes.every(node => node.paused))
})
