// 音效: the stage's one-shot sound player (modules/stage-sfx.js) on a fake audio context: no device, no sound.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = name => readFileSync(new URL('../tavern-plugin/src/client/modules/' + name, import.meta.url), 'utf8')
const { createStageSfx } = vm.runInNewContext(read('stage-music.js') + '\n' + read('stage-sfx.js') + '; ({ createStageSfx })', { AbortController })
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function harness({ fail = new Set() } = {}) {
  let serial = 0
  const timers = new Map(), sources = [], fetched = []
  const context = {
    state: 'running', decodes: 0, currentTime: 0, destination: { name: 'destination' },
    resume() { this.state = 'running'; return Promise.resolve() },
    createGain() {
      return { gain: { value: 1, ramps: [], setValueAtTime(value) { this.value = value }, linearRampToValueAtTime(value) { this.ramps.push(value) } },
        connect(next) { this.next = next }, disconnect() { this.next = null } }
    },
    async decodeAudioData(bytes) { context.decodes++; return { duration: 1, bytes } },
    createBufferSource() {
      const node = { started: false, stopped: false, connect(next) { this.next = next }, disconnect() { this.next = null },
        start() { this.started = true }, stop() { this.stopped = true } }
      sources.push(node); return node
    }
  }
  const sfx = createStageSfx({ context: () => context,
    fetch: async url => { fetched.push(url); return fail.has(url) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } },
    clock: { setTimeout(fn, ms) { timers.set(++serial, { fn, ms }); return serial }, clearTimeout(id) { timers.delete(id) } } })
  return { sfx, context, sources, fetched, timers, fire() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(job => job.fn()) } }
}

test('a cue plays its decoded sound once at the entry volume; a prepared sound is not fetched again', async () => {
  const h = harness()
  h.sfx.prepare('knock')
  await drain()
  assert.equal(await h.sfx.play('knock', .4), true)
  assert.deepEqual([h.fetched, h.context.decodes, h.sources.length], [['knock'], 1, 1])
  const [source] = h.sources
  assert.equal(source.started, true)
  assert.equal(source.next.gain.value, .4)
  assert.equal(source.next.next, h.context.destination)
  // It ends by itself: the voice is released.
  source.onended()
  assert.deepEqual([source.stopped, h.sfx.sounding(), h.timers.size], [true, 0, 0])
})

test('a sound rings out for at most 10 s, then fades over 0.5 s; at most six sound at once', async () => {
  const h = harness()
  assert.equal(await h.sfx.play('long', 1), true)
  const [timer] = [...h.timers.values()]
  assert.equal(timer.ms, 10000)
  h.fire()
  assert.deepEqual(h.sources[0].next.gain.ramps, [0])
  assert.equal([...h.timers.values()][0].ms, 500)
  h.fire()
  assert.deepEqual([h.sources[0].stopped, h.sfx.sounding()], [true, 0])
  for (let i = 0; i < 6; i++) assert.equal(await h.sfx.play('s' + i), true)
  assert.equal(await h.sfx.play('seventh'), false)
  assert.equal(h.sfx.sounding(), 6)
})

test('stop ends every sound, including one still decoding; a failed read plays nothing and is asked again', async () => {
  const h = harness({ fail: new Set(['missing']) })
  await h.sfx.play('a')
  const late = h.sfx.play('b')
  h.sfx.stop()
  assert.equal(await late, false)
  assert.deepEqual([h.sources.length, h.sources[0].stopped, h.sfx.sounding(), h.timers.size], [1, true, 0, 0])
  assert.equal(await h.sfx.play('missing'), false)
  assert.equal(await h.sfx.play('missing'), false)
  assert.deepEqual(h.fetched.filter(url => url === 'missing').length, 2)
  assert.equal(await h.sfx.play(''), false)
})
