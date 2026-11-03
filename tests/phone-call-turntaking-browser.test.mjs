// Turn-taking and barge-in on a call (phone-call.md「轮换与插话」), judged on the production phone-call.js
// with a scripted microphone, recognizer, model and voice (tests/helpers/phone-call-harness.mjs).
// A backchannel, noise or her own echo never cuts her off or buys a model request; words do, within the budget;
// an answer after she has finished is answered.
// TURNTAKING_SOURCE=<phone-call.js> runs another version (a BEFORE table); TURNTAKING_OUT=<json> writes every
// scenario's metrics; TURNTAKING_ASSERT=0 only measures.
import test, {after} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {runCall} from './helpers/phone-call-harness.mjs'

const source = process.env.TURNTAKING_SOURCE || undefined, out = process.env.TURNTAKING_OUT, judge = process.env.TURNTAKING_ASSERT !== '0'
const table = {}
after(async () => { if (out) await writeFile(out, JSON.stringify(table, null, 2)) })

const quiet = seconds => [seconds, 0.001], sound = seconds => [seconds, 0.3]
const HER_LONG = {segments:[{say:'今天真是个好天气呢，', seconds:4}]}
async function scenario(t, name, spec, check) {
  const result = await runCall(t, spec, {source})
  table[name] = result.metrics
  assert.deepEqual(result.errors, [])
  if (judge) check(result.metrics, result)
}

test('a short 嗯 while she speaks is a backchannel: she goes on, nothing is asked of the model', async t => {
  await scenario(t, 'backchannel-while-speaking', {mic:[quiet(1.5), sound(0.3), quiet(6)], utterances:[{text:'嗯。'}], turns:{t1:HER_LONG}, waitMs:7000}, (m, result) => {
    assert.equal(result.state.lines.some(line => line.role === 'player'), false)
    assert.equal(result.calls.filter(call => call.method === 'phoneCallHeard').at(-1).args.timing.backchannels, 1)
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.requests, []); assert.equal(m.completed, 1)
    assert.ok(m.duckedMs.length && m.duckedMs[0] <= 80, 'her voice ducked at once: ' + m.duckedMs)
  })
})

test('words spoken over her cut her off within the budget and become the next turn', async t => {
  await scenario(t, 'interruption-while-speaking', {mic:[quiet(1.5), sound(1.4), quiet(6)], utterances:[{text:'等一下我想问你一件事'}], turns:{t1:HER_LONG, t2:{segments:[{say:'好呀你说。', seconds:1}]}}, waitMs:8000}, m => {
    assert.equal(m.bargeIns, 1); assert.deepEqual(m.requests, ['等一下我想问你一件事'])
    assert.ok(m.yieldsMs[0] <= 800, 'time to yield ' + m.yieldsMs)
  })
})

test('a few words that end before the live line confirms them still cut her off, at the pause', async t => {
  await scenario(t, 'short-interruption', {mic:[quiet(1.5), sound(0.5), quiet(6)], utterances:[{text:'不是不是'}], turns:{t1:HER_LONG, t2:{segments:[{say:'那是什么？', seconds:1}]}}, waitMs:8000}, m => {
    assert.equal(m.bargeIns, 1); assert.deepEqual(m.requests, ['不是不是'])
    assert.ok(m.yieldsMs[0] <= 1200, 'time to yield ' + m.yieldsMs)
  })
})

test('noise and 嗯 while she is still thinking neither cancel her reply nor ask again', async t => {
  await scenario(t, 'noise-and-filler-while-thinking', {mic:[quiet(1.5), sound(1.0), quiet(1.5), sound(0.3), quiet(1.2), sound(0.3), quiet(6)],
    utterances:[{text:'你今天在干什么呀'}, {text:'。'}, {text:'嗯。'}], turns:{t1:{segments:[{say:'喂。', seconds:0.4}]}, t2:{delayMs:4000, segments:[{say:'在家看书呢。', seconds:1}]}}, waitMs:10000}, m => {
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.requests, ['你今天在干什么呀']); assert.equal(m.completed, 2)
  })
})

test('her own words coming back through the microphone are an echo, not the player', async t => {
  await scenario(t, 'echo-while-speaking', {mic:[quiet(1.5), sound(0.8), quiet(6)], utterances:[{text:'今天真是个好天气'}], turns:{t1:HER_LONG}, waitMs:7000}, m => {
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.requests, []); assert.equal(m.completed, 1); assert.ok(m.ignored.includes('echo'), String(m.ignored))
  })
})

test('a long sound without any words still yields to the player after 1.5 s', async t => {
  await scenario(t, 'sustained-no-words', {mic:[quiet(1.5), sound(2.0), quiet(6)], utterances:[{text:''}], turns:{t1:HER_LONG}, waitMs:7000}, m => {
    assert.equal(m.bargeIns, 1); assert.deepEqual(m.requests, []); assert.ok(m.yieldsMs[0] >= 1400 && m.yieldsMs[0] <= 2000, 'time to yield ' + m.yieldsMs)
  })
})

test('嗯 after she has finished is the player\'s answer and is answered', async t => {
  await scenario(t, 'answer-after-her', {mic:[quiet(2.5), sound(0.3), quiet(6)], utterances:[{text:'嗯。'}], turns:{t1:{segments:[{say:'要去吗？', seconds:0.5}]}, t2:{segments:[{say:'那走吧。', seconds:0.5}]}}, waitMs:7000}, m => {
    assert.deepEqual(m.requests, ['嗯。']); assert.equal(m.completed, 2)
  })
})

// Backchannels of every kind (phone-call.md「附和的判定」): news receipts and agreements of several characters, a
// backchannel that a real turn follows, her own next words leaking in behind one, and an answer in her last words.
test('这样啊 / 原来如此 while she speaks are backchannels too', async t => {
  await scenario(t, 'phrase-backchannels', {mic:[quiet(1.5), sound(0.4), quiet(1.2), sound(0.5), quiet(6)], utterances:[{text:'这样啊。'}, {text:'原来如此。'}], turns:{t1:{segments:[{say:'今天真是个好天气呢，', seconds:6}]}}, waitMs:9500}, (m, result) => {
    assert.equal(result.state.lines.some(line => line.role === 'player'), false)
    assert.equal(result.calls.filter(call => call.method === 'phoneCallHeard').at(-1).args.timing.backchannels, 2)
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.requests, []); assert.equal(m.completed, 1); assert.deepEqual(m.ignored, ['backchannel', 'backchannel'])
  })
})

test('a backchannel that goes on into words is an interruption', async t => {
  await scenario(t, 'backchannel-then-words', {mic:[quiet(1.5), sound(1.2), quiet(6)], utterances:[{text:'好啊那我们去吧'}], turns:{t1:HER_LONG, t2:{segments:[{say:'走。', seconds:0.5}]}}, waitMs:8000}, m => {
    assert.equal(m.bargeIns, 1); assert.deepEqual(m.requests, ['好啊那我们去吧']); assert.ok(m.yieldsMs[0] <= 1200, 'time to yield ' + m.yieldsMs)
  })
})

test('对，但是… is an objection, not agreement', async t => {
  await scenario(t, 'agreement-then-but', {mic:[quiet(1.5), sound(0.6), quiet(6)], utterances:[{text:'对，但是'}], turns:{t1:HER_LONG, t2:{segments:[{say:'但是什么？', seconds:0.5}]}}, waitMs:8000}, m => {
    assert.equal(m.bargeIns, 1); assert.deepEqual(m.requests, ['对，但是'])
  })
})

test('her next words behind a backchannel are her echo, not an interruption', async t => {
  await scenario(t, 'echo-behind-backchannel', {mic:[quiet(1.5), sound(0.3), quiet(6)], utterances:[{text:'嗯，然后。'}], turns:{t1:{segments:[{say:'然后我们就去了面包店，', seconds:4}]}}, waitMs:7000}, m => {
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.requests, []); assert.equal(m.completed, 1); assert.deepEqual(m.ignored, ['echo'])
  })
})

test('好 over her last words answers them once she has finished', async t => {
  await scenario(t, 'answer-in-her-last-words', {mic:[quiet(1.9), sound(0.3), quiet(6)], utterances:[{text:'好。'}], turns:{t1:{segments:[{say:'要不要一起去？', seconds:2.6}]}, t2:{segments:[{say:'那走吧。', seconds:0.5}]}}, waitMs:8000}, (m, result) => {
    assert.equal(m.bargeIns, 0); assert.deepEqual(m.ignored, ['backchannel']); assert.deepEqual(m.requests, ['好。']); assert.equal(m.completed, 2)
    assert.equal(result.calls.filter(call => call.method === 'phoneCallHeard' && call.args.turnId === 't1').at(-1).args.timing.backchannels, 0)
    assert.ok(result.events.some(event => event.name === 'answer-later'), 'answered after her: ' + result.events.map(event => event.name).join(','))
  })
})

test('a sound that recognizes as punctuation alone is never a turn', async t => {
  await scenario(t, 'punctuation-when-idle', {mic:[quiet(2.5), sound(0.3), quiet(6)], utterances:[{text:'。'}], turns:{t1:{segments:[{say:'喂。', seconds:0.4}]}}, waitMs:6000}, m => {
    assert.deepEqual(m.requests, []); assert.equal(m.completed, 1)
  })
})
