// Her first sound (owner 2026-10-29, 鹿目圆: a game held the GPU, the live greeting's voice came 14 s late and the call
// stayed silent): she picks up and says her cached 「喂？」 at once - read from the voice cache at dial, never synthesized at
// connect - while her written greeting follows when its own voice is ready. The player speaking over it cuts what follows,
// never the greeting. Production phone-call.js, scripted microphone, recognizer, model and voice
// (tests/helpers/phone-call-harness.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import {runCall} from './helpers/phone-call-harness.mjs'

const quiet = seconds => [seconds, 0.001], sound = seconds => [seconds, 0.3]
const GREETING = {say:'喂？', sub:'喂？', seconds:1.5}

test('her cached greeting sounds the moment she picks up, however slow her voice is', async t => {
  // Her written greeting's voice never comes (a busy GPU): the call still opens with her 「喂？」.
  const result = await runCall(t, {mic:[quiet(6)], utterances:[], greeting:GREETING,
    turns:{t1:{segments:[{say:'是我呀。', seconds:1, voiceDelayMs:30000}]}}, waitMs:3000})
  assert.deepEqual(result.errors, [])
  const greeted = result.events.find(event => event.name === 'greeting')
  assert.ok(greeted, 'no greeting: ' + result.events.map(event => event.name).join(','))
  t.diagnostic('greeting audible ' + greeted.latencyMs + ' ms after pick-up')
  assert.ok(greeted.latencyMs < 300, 'greeting audible ' + greeted.latencyMs + ' ms after pick-up')
  assert.deepEqual(result.events.filter(event => event.name === 'greeting-end').map(event => event.cut), [false])
  // From the cache: the greeting is never synthesized during the call.
  assert.deepEqual(result.calls.filter(call => call.method === 'synthesize').map(call => call.text), ['是我呀。'])
  assert.equal(result.calls.filter(call => call.method === 'phoneCallGreeted').length, 1)
  // The model knows she has said it.
  assert.match(result.calls.find(call => call.method === 'phoneCallTurn').args.said, /已经说了「喂？」/)
  assert.equal(result.state.lines[0]?.text, '喂？')
  assert.ok(result.state.lines.some(line => line.role === 'contact' && line.text === '是我呀。'), 'her reply shows as text: ' + JSON.stringify(result.state.lines))
})

test('the player speaking over her greeting cuts her reply, never the greeting', async t => {
  const result = await runCall(t, {mic:[quiet(0.4), sound(1.4), quiet(6)], utterances:[{text:'喂喂，小圆在吗'}], greeting:GREETING,
    turns:{t1:{segments:[{say:'是我。', seconds:1}]}, t2:{segments:[{say:'在呀。', seconds:0.5}]}}, waitMs:5000})
  assert.deepEqual(result.errors, [])
  const events = result.events.map(event => event.name)
  assert.ok(events.indexOf('barge-in') > events.indexOf('greeting') && events.indexOf('barge-in') < events.indexOf('greeting-end'), 'barge-in during the greeting: ' + events.join(','))
  assert.deepEqual(result.events.filter(event => event.name === 'greeting-end').map(event => event.cut), [false])
  assert.equal(result.metrics.outcomes[0], 'interrupted')
  assert.deepEqual(result.metrics.requests, ['喂喂，小圆在吗'])
  assert.equal(result.state.lines.find(line => line.role === 'contact')?.text, '喂？')
})

test('without a cached greeting she still speaks her written greeting first', async t => {
  const result = await runCall(t, {mic:[quiet(4)], utterances:[], turns:{t1:{segments:[{say:'喂，是我。', seconds:0.5}]}}, waitMs:2500})
  assert.deepEqual(result.errors, [])
  assert.equal(result.events.some(event => event.name === 'greeting'), false)
  assert.equal(result.calls.find(call => call.method === 'phoneCallTurn').args.said, '（电话接通了。你接起电话，先开口。）')
  assert.deepEqual(result.metrics.outcomes, ['completed'])
})
