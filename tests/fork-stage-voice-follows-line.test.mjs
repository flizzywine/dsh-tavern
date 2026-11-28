// A voiced page's automatic voice follows its line, not the director (bug:stage-voice-no-play, owner 11-28): turning to a
// page (by hand or by auto) speaks it whether its round was directed, its director failed or never ran; the director only
// lines its performance up with the voice, waiting for a direction on its way at most a moment.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
import {createStageRuntimeHarness, runtimeSource, runtimeText, runtimePage, runtimeDirection} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {stageRuntimeIndicators} = require('../tavern-plugin/src/client/stage-runtime.cjs')
const {createStagePlayback} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/playback.cjs')
const {stageAutoDelay, stageAutoRemaining} = require('../tavern-plugin/src/client/stage-auto-timing.cjs')

const WAIT = 1500
const line = n => ({voice: {kind: 'voice', alias: 'actor', text: 'Line ' + n, mood: 'calm', lineIdentity: [1, n]}})
const voiced = h => h.effects('prepare-one-shot').filter(call => call.descriptor.kind === 'voice').map(call => call.descriptor.text)

function round({director = true, streaming = false} = {}) {
  const h = createStageRuntimeHarness(), source = runtimeSource()
  h.dispatch({type: 'SESSION_INPUTS', settings: {config: {stage: {director}}}})
  h.dispatch({type: 'TURN_CHANGED', source, text: runtimeText(1, [runtimePage(1, 0, line(1)), runtimePage(2, 0, line(2)), runtimePage(3, 0, line(3))], streaming)})
  return {h, source, read: envelope => h.replyRead(h.activeReads.at(-1).token, envelope),
    turn: n => h.dispatch({type: 'PAGE', index: n - 1})}
}
const missing = revision => ({phase: 'unknown', revision})

for (const [name, envelope] of [['missing on the host', missing(3)], ['cancelled (no direction left)', missing(5)],
  ['failed', {phase: 'error', revision: 4, error: 'DIRECTION_FAILED'}]]) {
  test(`a round whose director is ${name}: the landing page and every page turned to speak at once`, t => {
    const {h, read, turn} = round(); t.after(() => h.dispose())
    read(envelope)
    assert.deepEqual(voiced(h), ['Line 1'], 'the landing page speaks without waiting')
    assert.equal(h.state.voiceWait, null, 'no direction is coming, so nothing waits any more')
    h.clock.advance(0)
    turn(2); turn(3)
    assert.deepEqual(voiced(h), ['Line 1', 'Line 2', 'Line 3'])
  })
}

test('a direction on its way: the voice waits for it and speaks the moment its prefix reaches the page', t => {
  const {h, read, turn} = round(); t.after(() => h.dispose())
  assert.equal(h.effects('schedule-voice-wait').at(-1)?.delay, WAIT, 'an unread round waits at most the voice wait')
  read(runtimeDirection(1, 1))
  assert.deepEqual(voiced(h), ['Line 1'], 'the prefix sealed through the page releases it before the wait ends')
  assert.equal(h.effects('cancel-timer').length >= 1, true, 'the voice wait is cancelled')
  turn(2)
  assert.deepEqual(voiced(h), ['Line 1'], 'a running director not yet through page 2 is waited for')
  assert.equal(stageRuntimeIndicators(h.state).awaitingVoiceDirection, true, 'auto holds while the voice waits')
  h.clock.advance(WAIT - 1)
  assert.deepEqual(voiced(h), ['Line 1'], 'normal direction keeps the performance and the voice aligned')
})

test('a direction that is late: after the voice wait the page speaks anyway', t => {
  const {h, read, turn} = round(); t.after(() => h.dispose())
  read(runtimeDirection(1, 1)); turn(2)
  h.clock.advance(WAIT)
  assert.deepEqual(voiced(h), ['Line 1', 'Line 2'])
  assert.equal(stageRuntimeIndicators(h.state).awaitingVoiceDirection, false)
})

test('the director off, or a round read back with its direction short of the page, never waits', t => {
  const off = round({director: false}); t.after(() => off.h.dispose())
  assert.deepEqual(voiced(off.h), ['Line 1'])
  const short = round(); t.after(() => short.h.dispose())
  short.read(runtimeDirection(2, 1, {phase: 'done', complete: true}))
  short.turn(3)
  assert.deepEqual(voiced(short.h), ['Line 1', 'Line 3'])
})

test('an old round with no direction record, revisited, speaks its settled page', t => {
  const h = createStageRuntimeHarness(); t.after(() => h.dispose())
  h.dispatch({type: 'SESSION_INPUTS', settings: {config: {stage: {director: true}}}})
  h.dispatch({type: 'TURN_CHANGED', source: runtimeSource({turn: 2}), text: runtimeText(1, [runtimePage(1)])})
  h.dispatch({type: 'HISTORY_JUMP', source: runtimeSource({turn: 1}), text: runtimeText(2, [runtimePage(1, 0, {voice: {...line(1).voice, text: 'Old line'}})]),
    anchor: {paragraphId: 'paragraph-1', para: 1, offset: 0}})
  h.replyRead(h.activeReads.at(-1).token, missing(7))
  assert.deepEqual(voiced(h), [], 'a history page plays only once the reader settles on it')
  h.dispatch({type: 'HISTORY_DWELL', visitId: h.state.cursor.visitId, anchor: h.state.cursor.anchor, kinds: ['core.voice']})
  assert.deepEqual(voiced(h), ['Old line'])
})

// auto's dwell on a voiced page counts from its voice: while the voice still waits for its direction, auto does not turn.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
test('auto does not turn a page whose voice still waits for its direction; its wait starts after the voice', () => {
  let at = 10000, serial = 0
  const jobs = new Map(), calls = []
  const clock = {setTimeout: (fn, ms) => (jobs.set(++serial, {fn, ms}), serial), clearTimeout: id => jobs.delete(id),
    setInterval: (fn, ms) => (jobs.set(++serial, {fn, ms}), serial), clearInterval: id => jobs.delete(id), subscribeAudio: () => () => {}, isAudible: () => true}
  const playback = createStagePlayback({React, clock, player: {get: () => null}, subtitles: {voiceTime: () => 2},
    timing: {delay: stageAutoDelay, remaining: stageAutoRemaining}, handoffDelay: delay => delay, now: () => at})
  const frame = {sessionId: 'a', runtime: {cursor: {mode: 'live', visitId: 1, anchor: {paragraphId: 'p', offset: 0}}, text: {pages: []},
    indicators: {awaitingDirection: false, awaitingVoiceDirection: true}, store: {dispatch() {}}},
  reading: {autoWait: 700, autoSpeed: 1}, auto: true, skipping: false, hidden: false, overlay: false, typed: true, current: {text: 'a'}, atEnd: false, awaiting: false, sceneHolding: false,
  line: {turn: 1, page: 0, card: 0, inputCard: 0, transitioning: false, subtitles: {text: 'a', cards: []}, inputSubtitles: {text: ''}, lastCard: true, voice: null,
    audioBusy: false, voiceEnded: false, heldMs: 0, film: false, pageCount: 2},
  performance: {replayable: [], holds: [], blocking: false, dialogueHeld: false, busy: false}}
  function View() { playback.usePlayback(frame, {advance: () => calls.push('advance'), finishSkip() {}, finishTyping() {}}); return null }
  const mount = document.createElement('div'); document.body.append(mount); const root = createRoot(mount)
  const render = () => act(() => root.render(React.createElement(View)))
  try {
    render()
    assert.equal(jobs.size, 0, 'no auto turn is scheduled while the voice waits')
    // the wait ends and the voice plays
    at += WAIT; frame.runtime = {...frame.runtime, indicators: {awaitingDirection: false, awaitingVoiceDirection: false}}
    frame.line = {...frame.line, voice: {owner: 'a:stage', id: 'p'}, audioBusy: true}; render()
    assert.equal(jobs.size, 0, 'auto waits for the playing voice')
    at += 3000; frame.line = {...frame.line, audioBusy: false, voiceEnded: true}; render()
    const [job] = jobs.values()
    assert.equal(job.ms, stageAutoDelay(700, 1, true, 'a'), 'the post-voice wait counts from the voice, not from the page turn')
  } finally { playback.dispose(); act(() => root.unmount()); mount.remove() }
})
