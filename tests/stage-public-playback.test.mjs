import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createStagePublicPlayback } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/public-playback.cjs')
function fixture() {
  let state = { source: { sessionId: 'game', turn: 3, sourceKey: 'secret' }, opened: true, visible: true,
    cursor: { mode: 'live' }, ledger: { a: { status: 'playing', descriptor: {kind:'performance-phase'}, token: 'secret' }, b: { status: 'skipped', descriptor: {kind:'mod-performance'} }, c:{status:'playing', descriptor:{kind:'voice'}} }, projection: { url: 'secret' } }
  const listeners = new Set()
  const store = { getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  let allowed = true, current = store
  const api = createStagePublicPlayback({ getStore: id => id === 'game' ? current : null, isAllowed: id => allowed && id === 'game' })
  return { api, store, listeners, set(value) { state = value; for (const fn of [...listeners]) fn() },
    revoke() { allowed = false; api.revalidate() }, replace() { current = null; api.revalidate() } }
}

test('public playback exposes only bounded lifecycle fields, not source or media data', () => {
  const f = fixture(), observed = []
  const stop = f.api.subscribe('game', value => observed.push(value))
  assert.deepEqual(observed[0], { version: 1, turn: 3, opened: true, visible: true, mode: 'live', ledger: { pending: 0, playing: 1, played: 0, skipped: 1 } })
  assert.equal(JSON.stringify(observed).includes('secret'), false)
  assert.equal(f.api.get('other'), null)
  stop(); assert.equal(f.listeners.size, 0)
})

test('revocation, replacement, close and disposal cannot keep stale listeners', () => {
  for (const action of ['revoke', 'replace', 'dispose']) {
    const f = fixture(), observed = []
    f.api.subscribe('game', value => observed.push(value))
    if (action === 'dispose') f.api.dispose(); else f[action]()
    assert.equal(observed.at(-1), null)
    assert.equal(f.listeners.size, 0)
    assert.equal(f.api.get('game'), null)
  }
  const f = fixture(), observed = []
  f.api.subscribe('game', value => observed.push(value))
  f.set({ source: { sessionId: 'game', turn: 3 }, opened: false, visible: true, cursor: { mode: 'history' }, ledger: { a: { status: 'playing' } } })
  assert.equal(observed.at(-1).ledger.playing, 0)
  assert.equal(observed.at(-1).mode, 'history')
  f.set({ source: { sessionId: 'other', turn: 3 }, opened: true, visible: true, cursor: { mode: 'live' }, ledger: {} })
  assert.equal(observed.at(-1), null)
  assert.equal(f.listeners.size, 0)
})

test('synchronous store notification still cleans up after invalidation', () => {
  let active = 0
  const store = { getSnapshot: () => null, subscribe(fn) { active++; fn(); return () => active-- } }
  const api = createStagePublicPlayback({ getStore: () => store, isAllowed: () => true })
  const observed = []
  api.subscribe('game', value => observed.push(value))
  assert.deepEqual(observed, [null])
  assert.equal(active, 0)
})
