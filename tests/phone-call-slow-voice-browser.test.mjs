// Her voice too slow for the call (owner 2026-10-29, 鹿目圆: a game held the GPU, the local voice ran at 3.5x real time and
// the call showed only the player's lines): before any of her voice is scheduled, a reply whose voice stalls, streams
// slower than real time or fails goes on as text - shown, reported heard, the turn completed - never a silent call.
// A healthy voice still speaks (the greeting in each scenario). Production phone-call.js, scripted microphone,
// recognizer, model and voice (tests/helpers/phone-call-harness.mjs). SLOW_VOICE_SOURCE=<phone-call.js> runs another version.
import test from 'node:test'
import assert from 'node:assert/strict'
import {runCall} from './helpers/phone-call-harness.mjs'

const source = process.env.SLOW_VOICE_SOURCE || undefined
const quiet = seconds => [seconds, 0.001], sound = seconds => [seconds, 0.3]
const GREETING = {segments:[{say:'喂。', seconds:0.4}]}

async function slowReply(t, voice) {
  const result = await runCall(t, {mic:[quiet(1.5), sound(1.0), quiet(7)], utterances:[{text:'你在干什么呀'}],
    turns:{t1:GREETING, t2:{segments:[{say:'在家看书呢。', seconds:2, ...voice}]}}, waitMs:7500}, {source})
  assert.deepEqual(result.errors, [])
  assert.ok(result.state.lines.some(line => line.role === 'contact' && line.text === '在家看书呢。'), 'her reply is on the call screen: ' + JSON.stringify(result.state.lines))
  assert.deepEqual(result.calls.filter(call => call.method === 'phoneCallHeard' && call.args.turnId === 't2').at(-1)?.args.heard, [0])
  // Her words come within about two seconds of her reply, not after the stalled voice.
  const asked = result.calls.find(call => call.method === 'phoneCallTurn' && call.args.said === '你在干什么呀').at
  const shown = result.events.find(event => event.name === 'text-only')?.at ?? Infinity
  assert.ok(shown - asked < 2500, 'text after ' + Math.round(shown - asked) + ' ms')
  const textOnly = result.events.filter(event => event.name === 'text-only').map(event => event.turnId)
  assert.deepEqual(textOnly, ['t2'], 'only the slow reply goes to text: ' + result.events.map(event => event.name).join(','))
  assert.deepEqual(result.metrics.requests, ['你在干什么呀'])
  assert.deepEqual(result.metrics.outcomes, ['completed', 'completed'])
  assert.equal(result.state.status, 'listening')
  // The stage's top-right voice line (notices.cjs useVoiceStatus) reads this: 配音太慢，已转文字.
  assert.deepEqual(result.state.voice, {turn:'t2', state:'text', failed:false})
  return result
}

test('a reply whose voice never starts shows as text and the call goes on', async t => {
  await slowReply(t, {voiceDelayMs:30000})
})

test('a reply whose voice streams slower than real time shows as text', async t => {
  await slowReply(t, {rtf:3})
})
