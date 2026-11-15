// ui-sfx.js play: a card page's sound(name) is the shown skin's own cue file, through the same mixer bus and UI volume
// as the engine cues; a skin without that cue (or no skin palette at all) gets the engine's own cue of that name.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/ui-sfx.js', import.meta.url), 'utf8')
const {createUiSfx} = vm.runInNewContext(source + ';({createUiSfx})', {setTimeout, performance, Math, Object, Promise, Map, Set})

function harness(prefs = {master: 1, ui: 1, muted: {}}) {
  const fetched = [], started = []
  let clock = 1000
  const context = {createBufferSource: () => {
    const node = {buffer: null, playbackRate: {value: 1}, connect() {}, disconnect() {}, start() { started.push(node.buffer.url) }}
    return node
  }}
  const sfx = createUiSfx({
    foreground: {isAudible: () => true},
    mixer: {musicContext: () => context, bufferInput: () => ({input: {}, release() {}})},
    OfflineAudioContext: class { decodeAudioData(bytes) { return Promise.resolve({url: bytes.url, duration: 0.2}) } },
    fetch: url => { fetched.push(url); return Promise.resolve({ok: true, arrayBuffer: () => Promise.resolve({url})}) },
    prefs: () => prefs, now: () => (clock += 500), random: () => 0.5
  })
  return {sfx, fetched, started}
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }

// two skins: one with its own move / confirm files, one that ships no sounds
const SKIN_WITH_SOUNDS = {move: {url: '/skins/ink/move.ogg', gain: 0.8, every: 1, pitch: 0}, confirm: {url: '/skins/ink/confirm.ogg', gain: 1, every: 1, pitch: 0}}
const SKIN_WITHOUT_SOUNDS = {}

test('a skin with sounds plays its own files for a card page cue', async () => {
  const h = harness()
  h.sfx.useSkin(SKIN_WITH_SOUNDS)
  await settle()
  assert.deepEqual(h.fetched, ['/skins/ink/move.ogg', '/skins/ink/confirm.ogg'])
  assert.equal(h.sfx.play('move'), true)
  assert.equal(h.sfx.play('confirm'), true)
  await h.sfx.preload()
  assert.equal(h.sfx.play('open'), true, 'a cue the skin does not define is the engine cue')
  assert.deepEqual(h.started.slice(0, 2), ['/skins/ink/move.ogg', '/skins/ink/confirm.ogg'])
  assert.match(h.started[2], /ui-sfx\/open\.ogg$/)
})

test('a skin without sounds, or no skin, gets the engine cue of that name', async () => {
  for (const palette of [SKIN_WITHOUT_SOUNDS, null]) {
    const h = harness()
    h.sfx.useSkin(palette)
    await settle()
    await h.sfx.preload()
    assert.equal(h.sfx.play('move'), true)
    assert.equal(h.started.length, 1)
  }
})

test('a muted UI layer keeps the skin cue silent', async () => {
  const h = harness({master: 1, ui: 1, muted: {ui: true}})
  h.sfx.useSkin(SKIN_WITH_SOUNDS)
  await settle()
  assert.equal(h.sfx.play('move'), false)
  assert.deepEqual(h.started, [])
})
