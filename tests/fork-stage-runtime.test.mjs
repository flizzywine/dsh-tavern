// resource readiness is per background/figure slot, not a visual transaction.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
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
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

test('timeline: send -> stream -> partial -> done -> failed refresh -> renewal -> history -> skip', () => {
  const h = createStageRuntimeHarness(), s = source()
  assert.equal(status(h.state), 'idle')
  h.dispatch({type: 'SEND', source: s})
  assert.equal(status(h.state), 'awaiting-text')
  assert.equal(indicators(h.state).writing, true)
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(1, pages(), true)})
  assert.equal(status(h.state), 'streaming-without-direction')
  assert.equal(indicators(h.state).writing, false)
  assert.equal(h.state.cursor.anchor.para, 1)
  const value = groups()
  accept(h, direction(1, 2), value)
  assert.equal(status(h.state), 'director-partial')
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(2, pages())})
  h.replyRead(h.state.observation.flight, direction(2, 6, {phase: 'done', complete: true}))
  h.readyProjection(h.last('project').token, value)
  assert.equal(status(h.state), 'directed')
  const accepted = h.state.accepted
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  h.dispatch({type: 'PROJECTION_FAILED', token: h.last('project').token, error: 'offline'})
  assert.equal(h.state.accepted, accepted)
  // Transport renewal is deliberately NOT a kernel event. The owner renews its
  // handle; unchanged opaque descriptors can be re-accepted without rewriting them.
  for (let i = 0; i < 3; i++) {
    h.dispatch({type: 'REFRESH_BEGIN', source: s})
    h.readyProjection(h.last('project').token, value)
    assert.equal(h.state.accepted.scene, accepted.scene)
    assert.equal(h.state.accepted.music, accepted.music)
    assert.deepEqual(h.state.accepted.figures, accepted.figures)
  }
  h.dispatch({type: 'HISTORY_JUMP', source: s, text: text(2, pages()), anchor: page(4).anchor})
  assert.equal(status(h.state), 'historical-read')
  assert.equal(h.state.accepted.scene, accepted.scene)
  assert.equal(h.state.accepted.provenanceByChannel.background.token.visitId, 1)
  h.replyRead(h.state.observation.flight, direction(2, 6, {phase: 'done', complete: true, entries: [events(4, 'sfx')]}))
  assert.equal(h.last('project').transition, 'snap')
  h.readyProjection(h.last('project').token, value)
  assert.equal(h.state.accepted.ruler, accepted.ruler)
  assert.equal(h.effects('prepare-one-shot').length, 0)
  // Skip only marks fast reading; the stage turns the pages. History still plays nothing.
  h.dispatch({type: 'SKIP_START'})
  assert.equal(status(h.state), 'skipping')
  assert.equal(h.state.cursor.anchor.para, 4)
  h.dispatch({type: 'PAGE', index: 5})
  assert.equal(h.last('project').transition, 'snap')
  assert.equal(h.effects('prepare-one-shot').length, 0)
  h.dispatch({type: 'SKIP_END'})
  assert.equal(status(h.state), 'historical-read')
  assert.ok(h.effects('read-director').every(read => read.readOnly))
  assert.equal(h.calls.some(call => /generate|retry-task/.test(call.type)), false)
})

test('two turns without any transcript/UI: next flush exposes text and keeps last-good while awaiting', () => {
  const h = createStageRuntimeHarness(), first = start(h)
  accept(h, direction(1, 6, {phase: 'done', complete: true}))
  const accepted = h.state.accepted
  const second = source({turn: 2, sourceKey: 'node-2'})
  h.dispatch({type: 'SEND_ACK', source: second})
  assert.equal(status(h.state), 'awaiting-text')
  assert.equal(h.state.accepted, accepted)
  h.replyRead(h.state.observation.flight, {revision: 1, phase: 'running'})
  h.dispatch({type: 'TEXT_APPEND', source: second, text: text(1, [page(1)], true)})
  assert.equal(h.state.text.hasReadableText, true)
  assert.equal(h.state.director.phase, 'running')
  assert.equal(h.state.accepted, accepted)
  h.dispatch({type: 'ACCEPT_PREFIX', source: second, envelope: direction(2, 1)})
  h.readyProjection(h.last('project').token, groups('second'))
  assert.equal(h.state.accepted.scene.identity, 'second')
  h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: second, envelope: direction(3, 1, {phase: 'done', complete: true})})
  assert.equal(status(h.state), 'directed')
  assert.equal(h.watches.has(JSON.stringify(Object.values(first))), false)
  assert.equal(h.watches.size, 1)
})

test('pending, errors, empty prefix and same-branch regeneration cannot synthesize clear/neutral', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  accept(h)
  const accepted = h.state.accepted, presents = h.effects('present').length
  for (const event of [
    {type: 'READ_PENDING', source: s}, {type: 'READ_FAILED', source: s, error: 'timeout'},
    {type: 'REFRESH_BEGIN', source: s},
    {type: 'TEXT_APPEND', source: s, text: text(2, pages(), true)},
    {type: 'SEND_ACK', source: source({generation: 2})}
  ]) {
    h.dispatch(event)
    assert.equal(h.state.accepted, accepted)
  }
  const next = h.state.source
  assert.equal(h.state.director.baseline, null) // Pending carry is not the new generation's baseline.
  h.dispatch({type: 'ACCEPT_PREFIX', source: next, envelope: direction(1, 0)})
  h.dispatch({type: 'SEND_CANCELLED', source: next})
  h.replyRead(h.state.observation.flight, {phase: 'unknown', revision: 2})
  assert.equal(indicators(h.state).awaitingDirection, false)
  assert.equal(indicators(h.state).writing, false)
  assert.equal(h.state.accepted, accepted)
  assert.equal(h.effects('present').length, presents)
  assert.equal(h.effects('revoke-presentation').length, 0)
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

test('later subtitle cards skip late events, partial->done preserves ordinals, equal SFX media plays twice', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(2, [page(1), page(1, 20), page(2)])})
  h.dispatch({type: 'PAGE', index: 1})
  const entries = [events(1, 'sfx'), events(2, 'sfx', 'sfx')]
  h.replyRead(h.state.observation.flight, direction(1, 2, {entries}))
  assert.equal(h.effects('prepare-one-shot').length, 0)
  assert.equal(Object.values(h.state.ledger)[0].status, 'skipped')
  h.dispatch({type: 'PAGE', index: 2})
  const shots = h.effects('prepare-one-shot')
  assert.equal(shots.length, 2)
  assert.notEqual(shots[0].token.key, shots[1].token.key)
  for (const shot of shots) h.readyOneShot(shot.token)
  h.dispatch({type: 'DIRECTOR_SNAPSHOT', source: s, envelope: direction(2, 2, {entries, phase: 'done', complete: true})})
  for (const shot of shots) h.readyOneShot(shot.token)
  assert.equal(h.effects('play-one-shot').length, 2)
  assert.equal(h.effects('prepare-one-shot').length, 2)
})

test('projection completion requires full source, director, visit, anchor and request identity', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  accept(h)
  const accepted = h.state.accepted
  h.dispatch({type: 'REFRESH_BEGIN', source: s})
  const token = h.last('project').token
  const wrong = [
    {...token, id: token.id + 1}, {...token, direction: {...token.direction, prefixRevision: 200}},
    {...token, direction: {...token.direction, bindingKey: 'other'}},
    {...token, visitId: token.visitId + 1}, {...token, anchor: page(2).anchor},
    ...Object.keys(s).map(key => ({...token, source: {...s, [key]: 'different'}}))
  ]
  for (const stale of wrong) {
    h.readyProjection(stale, groups('wrong'))
    assert.equal(h.state.accepted, accepted)
  }
  assert.equal(h.effects('release-projection').length, wrong.length)
  h.dispatch({type: 'PAGE', index: 1})
  h.readyProjection(token, groups('old-page'))
  assert.equal(h.state.accepted, accepted)
  h.readyProjection(h.last('project').token, groups('new-page'))
  assert.equal(h.state.accepted.scene.identity, 'new-page')
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

test('text snapshots are versioned, reconcile absolute read offset, and late voice descriptors are observed', () => {
  const h = createStageRuntimeHarness(), s = start(h)
  h.dispatch({type: 'READ_PROGRESS', source: s, readThrough: 30})
  h.dispatch({type: 'TEXT_RECONCILE', source: s, text: text(2, [page(1), page(1, 20), page(1, 40), page(2)])})
  assert.equal(h.state.cursor.anchor.offset, 20)
  assert.equal(h.state.cursor.readThrough, 30)
  h.dispatch({type: 'TEXT_RECONCILE', source: s, text: text(1, [])})
  h.dispatch({type: 'TEXT_APPEND', source: source({generation: 0}), text: text(10, [])})
  assert.equal(h.state.text.revision, 2)
  h.dispatch({type: 'PAGE', index: 3})
  h.dispatch({type: 'TEXT_APPEND', source: s, text: text(3, [page(1), page(2, 0, {voice: {identity: 'late-voice'}})])})
  assert.equal(h.last('prepare-one-shot').descriptor.kind, 'voice')
  h.dispatch({type: 'TEXT_RECONCILE', source: s, text: text(4, [])})
  assert.equal(h.state.text.hasReadableText, false)
  assert.equal(indicators(h.state).writing, false)
})

test('pure reducer never mutates frozen inputs and media identities remain opaque strings', () => {
  let state = freeze(createStageRuntimeState())
  const s = freeze(source())
  for (const event of [
    {type: 'SEND_ACK', source: s},
    {type: 'TEXT_APPEND', source: s, text: text(1, pages())},
    {type: 'DIRECTOR_SNAPSHOT', source: s, envelope: direction(1, 6)}
  ]) state = freeze(reduceStageRuntime(state, freeze(event)).state)
  const opaque = 'pack/ref|hash?literal=%2F#unchanged'
  const value = freeze(groups(opaque))
  const result = reduceStageRuntime(state, freeze({type: 'PROJECTION_READY', token: state.projection.token, groups: value}))
  assert.equal(result.state.accepted.scene.identity, opaque)
  assert.equal(result.state.accepted.scene, value.background.value.scene)
  assert.equal(result.state.accepted.ruler, value.background.value.ruler)
  assert.equal(state.accepted.scene, null)
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

// No application globals, CommonJS loader, DOM, or shared browser closure.
test('runtime kernel runs in an isolated browser realm with explicit collaborators', () => {
  const factory = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/stage-runtime-kernel.cjs', import.meta.url), 'utf8') + '\ncreateStageRuntimeKernel', {})
  const isolated = factory({
    performanceStateKernel: require('../tavern-plugin/packages/dsh-presentation-protocol/src/performance-state.cjs'),
    modProjectionKernel: require('../tavern-plugin/src/client/mod-projection.cjs'),
    phoneBeatKernel: require('../tavern-plugin/src/client/phone-beat.cjs'),
    performanceKindsKernel: require('../tavern-plugin/src/client/stage-performance-kinds.cjs'),
  })
  let local = createStageRuntimeState(), remote = isolated.createStageRuntimeState()
  const s = source()
  for (const event of [
    {type: 'SEND_ACK', source: s},
    {type: 'TEXT_APPEND', source: s, text: text(1, pages(), true)},
    {type: 'DISPOSE'},
    {type: 'TEXT_APPEND', source: s, text: text(2, pages(), false)},
  ]) {
    const expected = reduceStageRuntime(local, event)
    const actual = isolated.reduceStageRuntime(remote, event)
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
    local = expected.state
    remote = actual.state
  }
  assert.equal(remote.disposed, true)
})
