// The BGM player (modules/stage-bgm.js): one owner across chat and stage, 导演选曲 / manual picks, per-game memory.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const { createStageBgm, stageBgmStep, stageBgmSearch, TAVERN_BGM_STORAGE } = vm.runInNewContext(read('tavern-plugin/src/client/modules/stage-bgm.js') +
  '; ({ createStageBgm, stageBgmStep, stageBgmSearch, TAVERN_BGM_STORAGE })')
const tick = () => new Promise(resolve => setImmediate(resolve))

const track = (id, name = id.toUpperCase()) => ({ key: 'P/' + id, ref: { packId: 'P', kind: 'music', assetId: id }, identity: 'P:music:' + id + ':h', name, pack: 'Pack', url: 'lease-' + id })
const state = (cue, data = {}, reader = { mode: 'live' }) => ({ data: { enabled: true, musicEnabled: true, card: { imageUrl: 'card-a' }, music: cue && track(cue), ...data }, reader })
function storage(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), map } }
function fakeSessions(initial) {
  const states = { ...initial }, listeners = new Map()
  return { getSnapshot: id => states[id] || { data: null, reader: { mode: 'refresh' } },
    subscribe(id, fn) { if (!listeners.has(id)) listeners.set(id, new Set()); listeners.get(id).add(fn); return () => listeners.get(id).delete(fn) },
    set(id, patch) { states[id] = { ...states[id], ...patch }; listeners.get(id)?.forEach(fn => fn()) },
    data(id, patch) { this.set(id, { data: { ...states[id].data, ...patch } }) } }
}
function fakeMusic() {
  const calls = []; let identity = null, current = '', paused = true, error = null
  return { calls, fail: new Set(),
    get: () => ({ identity, current, paused, error }),
    play(url, snap, id) { calls.push(['play', id, url, snap]); identity = id; current = url; paused = false; error = this.fail.has(url) ? 'Music fetch failed: 404' : null; return Promise.resolve() },
    pause() { calls.push(['pause']); paused = true },
    resume() { calls.push(['resume']); paused = false },
    trim() {},
    stop(snap = true) { calls.push(['stop', snap]); identity = null; current = ''; paused = true; error = null } }
}
function harness({ saved = {}, tracks = ['a', 'b', 'c'], sessions = fakeSessions({ s: state('a') }) } = {}) {
  const music = fakeMusic(), local = storage(saved), reads = []
  let time = 0
  const bgm = createStageBgm({ music, sessions, storage: local, now: () => ++time,
    read: async id => { reads.push(id); return { tracks: tracks.map(id => track(id)) } } })
  return { bgm, music, local, reads, sessions, list: tracks }
}
const plays = music => music.calls.filter(call => call[0] === 'play').map(call => call[1])

test('list order: prev / next wrap and enter from outside the list; search keeps order', () => {
  const tracks = ['a', 'b', 'c'].map(id => track(id))
  assert.equal(stageBgmStep(tracks, 'P/a', 1).key, 'P/b')
  assert.equal(stageBgmStep(tracks, 'P/c', 1).key, 'P/a', 'next wraps')
  assert.equal(stageBgmStep(tracks, 'P/a', -1).key, 'P/c', 'prev wraps')
  assert.equal(stageBgmStep(tracks, 'G/x', 1).key, 'P/a', 'a track outside the list: next enters at the top')
  assert.equal(stageBgmStep(tracks, 'G/x', -1).key, 'P/c')
  assert.equal(stageBgmStep([], 'P/a', 1), null)
  assert.deepEqual(stageBgmSearch([track('a', 'Rain Walk'), track('b', '夜'), track('c', 'rainy day')], 'RAIN').map(item => item.key), ['P/a', 'P/c'])
})

test('auto follows the director; a pick turns 导演选曲 off and later choices are recorded, not played; on jumps back', async () => {
  const { bgm, music, sessions } = harness()
  bgm.activate('s'); await tick()
  assert.deepEqual(plays(music), ['P:music:a:h'])
  assert.deepEqual({ ...bgm.get().current }, { key: 'P/a', name: 'A', source: 'director' })
  sessions.data('s', { music: track('b') }); await tick()
  assert.deepEqual(plays(music), ['P:music:a:h', 'P:music:b:h'])
  bgm.pick('P/c'); await tick()
  assert.equal(bgm.get().follow, false, 'a manual pick turns 导演选曲 off')
  assert.deepEqual({ ...bgm.get().current }, { key: 'P/c', name: 'C', source: 'manual' })
  sessions.data('s', { music: track('a') }); await tick()
  assert.equal(plays(music).at(-1), 'P:music:c:h', 'the next directed track does not override the pick')
  assert.equal(bgm.get().cue.key, 'P/a', 'but it is recorded')
  bgm.follow(true); await tick()
  assert.equal(plays(music).at(-1), 'P:music:a:h', 'back on: the director\'s current track')
  const count = plays(music).length
  bgm.follow(false); await tick()
  assert.equal(plays(music).length, count, 'turning it off keeps what sounds (no restart)')
  assert.deepEqual([bgm.get().current.key, bgm.get().current.source], ['P/a', 'manual'])
  sessions.data('s', { music: track('b') }); bgm.pick('P/x'); await tick()
  assert.equal(plays(music).length, count, 'a key outside the list is no pick')
})

test('prev / next follow list order from what plays; pause keeps the track and resumes it without restarting', async () => {
  const { bgm, music } = harness()
  bgm.activate('s'); await tick()
  bgm.step(1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:b:h', 'next from the director\'s a')
  bgm.step(1); bgm.step(1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:a:h', 'c → a wraps')
  bgm.step(-1); await tick()
  assert.equal(plays(music).at(-1), 'P:music:c:h')
  const count = plays(music).length
  bgm.pause(true)
  assert.deepEqual(music.calls.at(-1), ['pause']); assert.equal(bgm.get().paused, true)
  bgm.pause(false)
  assert.deepEqual(music.calls.at(-1), ['resume']); assert.equal(plays(music).length, count)
})

test('BGM off, or the stage off: nothing plays and the panel says so; on again plays the director\'s track', async () => {
  const { bgm, music, sessions } = harness()
  bgm.activate('s'); await tick()
  sessions.data('s', { musicEnabled: false })
  assert.deepEqual([bgm.get().enabled, bgm.get().available, bgm.get().current], [false, true, null])
  assert.deepEqual(music.calls.at(-1), ['stop', true], 'switching off stops at once')
  sessions.data('s', { musicEnabled: true })
  assert.equal(plays(music).at(-1), 'P:music:a:h')
  sessions.data('s', { enabled: false })
  assert.deepEqual([bgm.get().enabled, bgm.get().available], [false, false], 'music plays on the stage: no stage, no music and no chat chip')
})

test('the director\'s stop fades; skipping and leaving the game stop at once; skipping snaps a new track in', async () => {
  const { bgm, music, sessions } = harness()
  bgm.activate('s'); await tick()
  sessions.data('s', { music: null })
  assert.deepEqual(music.calls.at(-1), ['stop', false])
  sessions.set('s', { reader: { mode: 'skip' } }); sessions.data('s', { music: track('b') })
  assert.deepEqual(music.calls.at(-1).slice(0, 4), ['play', 'P:music:b:h', 'lease-b', true])
  sessions.data('s', { music: null })
  assert.deepEqual(music.calls.at(-1), ['stop', true])
  sessions.set('s', { reader: { mode: 'live' } }); sessions.data('s', { music: track('a') })
  bgm.activate(null)
  assert.deepEqual(music.calls.at(-1), ['stop', true])
})

test('per-game memory: the mode, the pick and pause survive a reload of that game; another game starts following', async () => {
  const sessions = fakeSessions({ s: state('a'), t: state('b') })
  const first = harness({ sessions })
  first.bgm.activate('s'); await tick()
  first.bgm.pick('P/c'); await tick()
  const saved = JSON.parse(first.local.map.get(TAVERN_BGM_STORAGE))
  assert.deepEqual(Object.keys(saved), ['s']); assert.equal(saved.s.follow, false); assert.equal(saved.s.manual.key, 'P/c')
  first.bgm.activate('t'); await tick()
  assert.equal(first.bgm.get().follow, true, 'a new game starts in auto')
  assert.equal(plays(first.music).at(-1), 'P:music:b:h')
  first.bgm.activate('s'); await tick()
  assert.equal(first.bgm.get().follow, false); assert.equal(plays(first.music).at(-1), 'P:music:c:h', 'switching back restores the pick')

  const reload = harness({ saved: Object.fromEntries(first.local.map), sessions })
  reload.bgm.activate('s'); await tick()
  assert.deepEqual(plays(reload.music), ['P:music:c:h'], 'the pick plays, not the director\'s track')
  reload.bgm.follow(true); await tick()
  assert.equal(reload.local.map.get(TAVERN_BGM_STORAGE), '{}', 'auto and playing is the default and is not stored')

  const gone = harness({ saved: Object.fromEntries(first.local.map), tracks: ['a', 'b'], sessions })
  gone.bgm.activate('s'); await tick()
  assert.equal(gone.bgm.get().follow, true, 'a pick that left the card\'s packs hands back to the director')
  assert.deepEqual(plays(gone.music), ['P:music:a:h'])

  const many = harness({ sessions: fakeSessions(Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['s' + i, state('a')]))) })
  for (let i = 0; i < 40; i++) { many.bgm.activate('s' + i); await tick(); many.bgm.pause(true) }
  const kept = JSON.parse(many.local.map.get(TAVERN_BGM_STORAGE))
  assert.ok(Object.keys(kept).length <= 32 && kept.s39, 'only the most recent games are kept')
})

test('a stale pick reads the list once more, then shows the failure; another card stops and rereads', async () => {
  const h = harness()
  h.bgm.activate('s'); await tick()
  h.music.fail.add('lease-c')
  h.bgm.pick('P/c'); await tick()
  assert.deepEqual(h.reads, ['s', 's'], 'one fresh list')
  assert.equal(h.bgm.get().error, true, 'the second failure is shown')
  h.music.fail.clear(); h.bgm.pick('P/b'); await tick()
  assert.equal(h.bgm.get().error, false)
  const count = h.reads.length
  h.sessions.data('s', { card: { imageUrl: 'card-b' } }); await tick()
  assert.equal(h.reads.length, count + 1)
  assert.ok(h.music.calls.some(call => call[0] === 'stop'), 'another card is another authority')
})

test('wiring: one transport owner, the chat header chip, the control bar chip, the RPC and the global BGM switch', () => {
  const main = read('tavern-plugin/src/client/main.js'), controls = read('tavern-plugin/src/client/features/play-controls.js')
  const runtime = read('tavern-plugin/src/client/modules/stage-runtime.js'), feature = read('tavern-plugin/src/client/features/stage-bgm.js')
  assert.ok(main.indexOf('// @include features/stage-settings.js') < main.indexOf('// @include modules/stage-music.js'))
  assert.ok(main.indexOf('// @include modules/stage-bgm.js') < main.indexOf('// @include features/stage-bgm.js'))
  assert.match(main, /ctx\.effect\(\(\) => startTavernBgm\(ctx\.sessions\), "dsh-tavern: BGM player"\)/)
  assert.match(controls, /id: "dsh-tavern-bgm", order: 82/)
  assert.match(feature, /tavernBgm\.activate\(selectedStageSession\(sessions\.list\.getSnapshot\(\)\)\)/)
  assert.doesNotMatch(runtime, /music\.|tavernMusic/, 'the stage runtime never touches music')
  assert.match(read('tavern-plugin/lib/rpc/media.js'), /async getStageMusicTracks\(args\)/)
  assert.match(read('tavern-plugin/lib/index.js'), /musicEnabled: \(await readTavernSettings\(\)\)\.stageToggles\.music/)
  assert.match(read('tavern-plugin/lib/index.js'), /if \(!\(await readTavernSettings\(\)\)\.stageToggles\.music\) material\.music = \[\]/)
})
