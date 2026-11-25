// resource readiness is per background/figure slot, not a visual transaction.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createStageRuntimeHarness, runtimeSource as source, runtimePage as page,
  runtimeText as text, runtimeDirection as direction, runtimeGroups as groups} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus: status,
  stageRuntimeIndicators: indicators} = require('../tavern-plugin/src/client/stage-runtime.cjs')
const pages = (n = 6) => Array.from({length: n}, (_, i) => page(i + 1))
function start(h, options = {}) {
  const s = source(options)
  h.dispatch({type: 'SEND_ACK', source: s})
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(1, pages(), true)})
  return s
}
function accept(h, envelope = direction(1, 6), value = groups()) {
  h.replyRead(h.state.observation.flight, envelope)
  const token = h.last('project').token
  h.readyProjection(token, value)
  return token
}
function events(at, ...kinds) {
  return {at, ordinal: at - 1, events: kinds.map((kind, ordinal) => ({kind, ordinal, identity: 'same-media'}))}
}

test('a cold voice service plays only the currently visible opening line once it becomes available', () => {
  for (const target of [0, 1]) {
    const h = createStageRuntimeHarness()
    const s = source({turn: 1})
    h.dispatch({type: 'STAGE_OPEN', opened: false})
    h.dispatch({type: 'TURN_CHANGED', source: s, text: text(1, pages(2).map(p => ({...p, voice: {identity: 'voice:' + p.anchor.para}})))})
    h.dispatch({type: 'STAGE_OPEN', opened: true, voiceAvailable: false})
    if (target) h.dispatch({type: 'PAGE', index: target})
    assert.equal(h.effects('prepare-one-shot').length, 0)

    h.dispatch({type: 'STAGE_VOICE_AVAILABLE', available: true})
    const voice = h.last('prepare-one-shot')
    assert.equal(voice.token.anchor.para, target + 1)
    h.readyOneShot(voice.token)
    h.dispatch({type: 'STAGE_VOICE_AVAILABLE', available: true})
    assert.equal(h.effects('play-one-shot').length, 1)
  }
})

test('late prefixes fold only to min(cursor, through); cursor, read progress and voice stay put', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(2, pages().map(p => ({...p, voice: {identity: 'voice:' + p.anchor.para}})))})
  h.dispatch({type: 'PAGE', index: 3})
  const voice = h.last('prepare-one-shot')
  h.readyOneShot(voice.token)
  h.dispatch({type: 'READ_PROGRESS', source: s, readThrough: 13})
  const cursor = h.state.cursor
  const entries = [events(1, 'sfx'), events(2, 'act'), events(4, 'sfx'), events(6, 'title')]
  h.replyRead(h.state.observation.flight, direction(1, 2, {entries: entries.slice(0, 2)}))
  assert.equal(h.last('project').at, 2)
  h.readyProjection(h.last('project').token, groups('through-2'))
  h.dispatch({type: 'ACCEPT_PREFIX', source: s, envelope: direction(2, 6, {entries})})
  assert.equal(h.last('project').at, 4)
  h.readyProjection(h.last('project').token, groups('current-4'))
  assert.equal(h.state.cursor, cursor)
  assert.equal(h.effects('present').length, 2)
  assert.equal(h.effects('prepare-one-shot').filter(e => e.descriptor.kind === 'voice' && e.token.anchor.para === 4).length, 1)
  assert.equal(h.effects('prepare-one-shot').filter(e => e.descriptor.kind !== 'voice').length, 1)
  assert.equal(Object.values(h.state.ledger).filter(e => e.status === 'skipped' && e.descriptor.kind !== 'voice').length, 2)
  h.dispatch({type: 'PAGE', index: 5})
  assert.equal(h.last('prepare-one-shot').token.anchor.para, 6)
  assert.ok(h.effects('prepare-one-shot').some(e => e.descriptor.kind === 'title'))
})

test('ready groups commit atomically; unknown/keep retain last-good; immediate clear need not wait', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  accept(h)
  const accepted = h.state.accepted
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  const token = h.last('project').token
  h.dispatch({type: 'PROJECTION_PENDING', token})
  h.readyProjection(token, {background: {kind: 'unknown'}, avatars: {kind: 'keep'}, music: groups('new').music})
  assert.equal(h.state.accepted.scene, accepted.scene)
  assert.equal(h.state.accepted.avatars, accepted.avatars)
  assert.equal(h.state.accepted.music.identity, 'music:new')
  assert.equal(h.state.accepted.provenanceByChannel.background, accepted.provenanceByChannel.background)
  assert.equal(h.state.accepted.provenanceByChannel.music.token, token)
  assert.throws(() => h.readyProjection(token, {background: {kind: 'set', value: {scene: 'incomplete'}}}), /Incomplete presentation/)
  assert.equal(h.state.accepted.scene, accepted.scene)
  h.readyProjection(token, {background: groups('new').background, 'figure:actor':groups('new')['figure:actor'], ambience: {kind: 'keep'}, widgets: {kind: 'keep'}, cg: {kind:'keep'}}) // settle the independent CG visual group
  assert.equal(h.state.accepted.scene.identity, 'new')
  assert.equal(h.state.accepted.figures[0].identity, 'figure:new')
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  const late = h.last('project').token
  h.dispatch({type: 'CLEAR', source: s, groups: ['music'], reason: 'music.stop'})
  assert.equal(h.state.accepted.music, null)
  assert.equal(h.state.accepted.scene.identity, 'new')
  h.readyProjection(late, groups('resurrect'))
  assert.equal(h.state.accepted.music, null)
  h.dispatch({type: 'CLEAR', source: s, groups: ['visual'], reason: 'scene.clear'})
  for (const field of ['scene', 'lighting', 'figures', 'ruler']) assert.equal(h.state.accepted[field], null)
})

test('scoped revoke does not stop unrelated music and late completions cannot revive it', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  accept(h)
  const music = h.state.accepted.music
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  const token = h.last('project').token
  h.dispatch({type: 'REVOKE', source: s, groups: ['avatars'], reason: 'avatar-disabled'})
  assert.equal(h.state.accepted.music, music)
  assert.equal(h.state.accepted.avatars, null)
  h.readyProjection(token, groups('late'))
  assert.equal(h.state.accepted.music, music)
  assert.equal(h.state.accepted.avatars, null)
})

for (const boundary of ['sessionId', 'authorityEpoch', 'branchId']) {
  test(boundary + ' boundary explicitly revokes context and cancels old work', () => {
    const h = createStageRuntimeHarness(); start(h); accept(h)
    const oldRead = h.last('read-director').token, oldProjection = h.last('project').token
    h.dispatch({type: 'TURN_CHANGED', source: source({[boundary]: 'new'})})
    assert.equal(h.state.accepted.scene, null)
    assert.equal(h.effects('revoke-presentation').length, 1)
    const next = h.state
    h.replyRead(oldRead, direction(100, 6, {phase: 'done', complete: true}))
    h.readyProjection(oldProjection, groups('stale'))
    assert.equal(h.state, next)
    assert.equal(h.watches.size, 1)
  })
}

test('history stays selected while live advances; re-entry has a new visit but never replays old callbacks', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  h.replyRead(h.state.observation.flight, direction(1, 6, {entries: [events(1, 'sfx')]}))
  const oldShot = h.last('prepare-one-shot').token
  h.dispatch({type: 'HISTORY_JUMP', source: s, text: text(2, pages()), anchor: page(1).anchor})
  const historyVisit = h.state.cursor.visitId
  h.replyRead(h.state.observation.flight, direction(1, 6, {entries: [events(1, 'sfx')]}))
  assert.equal(h.clock.size, 0)
  h.readyOneShot(oldShot)
  const latest = source({turn: 2, sourceKey: 'node-2'})
  h.dispatch({type: 'TURN_CHANGED', source: latest})
  assert.equal(h.state.source, s)
  assert.equal(h.state.latestSource, latest)
  assert.equal(h.state.cursor.visitId, historyVisit)
  h.dispatch({type: 'RESUME_LIVE', source: s, text: text(2, pages())})
  h.replyRead(h.state.observation.flight, direction(1, 6, {entries: [events(1, 'sfx')]}))
  assert.equal(h.effects('prepare-one-shot').length, 2)
  assert.notEqual(h.last('prepare-one-shot').token.key, oldShot.key)
  h.readyOneShot(h.last('prepare-one-shot').token)
  assert.equal(h.effects('play-one-shot').length, 1)
})

test('off/error and send failures are readable degradation; complete empty entries is valid', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  accept(h)
  const accepted = h.state.accepted
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(2, pages())})
  for (const [revision, phase] of [[2, 'off'], [3, 'error']]) {
    h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: s, envelope: {revision, phase}})
    assert.equal(indicators(h.state).awaitingDirection, false)
    assert.equal(indicators(h.state).degraded, phase)
    assert.equal(h.state.text.hasReadableText, true)
    assert.equal(h.state.accepted, accepted)
  }
  h.dispatch({type: 'SEND_ACK', source: source({generation: 2})})
  h.dispatch({type: 'SEND_FAILED', source: h.state.source, error: 'send failed'})
  assert.equal(indicators(h.state).writing, false)
  assert.equal(indicators(h.state).awaitingDirection, false)
  assert.equal(indicators(h.state).error, 'send failed')
  h.dispatch({type: 'TEXT_APPEND', source: h.state.source, text: text(1, [page(1)])})
  h.replyRead(h.state.observation.flight, direction(1, 0, {phase: 'done', complete: true}))
  assert.equal(status(h.state), 'directed')
  assert.equal(h.last('project').at, 0)
  assert.deepEqual(h.last('project').entries, [])
  h.readyProjection(h.last('project').token, {background: {kind: 'keep'}, 'figure:actor':{kind:'keep'}, music: {kind: 'unknown'}})
  assert.equal(h.state.accepted, accepted)
})

test('stale resource diagnostics and closed-stage one-shot completions cannot affect the current request', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  h.replyRead(h.state.observation.flight, direction(1, 6, {entries: [events(1, 'sfx')]}))
  const shot = h.last('prepare-one-shot').token, old = h.last('project').token
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  const current = h.state.projection
  h.dispatch({type: 'PROJECTION_FAILED', token: old, error: 'old failure'})
  h.dispatch({type: 'PROJECTION_PENDING', token: old})
  assert.equal(h.state.projection, current)
  assert.equal(h.state.pending.error, null)
  h.dispatch({type: 'STAGE_OPEN', opened: false})
  h.readyOneShot(shot)
  h.dispatch({type: 'STAGE_OPEN', opened: true})
  h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: s, envelope: direction(2, 6, {entries: [events(1, 'sfx', 'act')]})})
  assert.equal(h.effects('play-one-shot').length, 0)
  assert.equal(h.effects('prepare-one-shot').length, 1)
  h.dispatch({type: 'PAGE', index: 1})
  h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: s, envelope: direction(3, 6, {entries: [events(1, 'sfx', 'act'), events(2, 'sfx')]})})
  const nextShot = h.last('prepare-one-shot').token
  h.dispatch({type: 'ONE_SHOT_FAILED', token: nextShot})
  h.readyOneShot(nextShot)
  assert.equal(h.effects('play-one-shot').length, 0)
})
