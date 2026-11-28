// The stage queues the latest round's unvoiced lines by itself when the voice service comes up after the round was written,
// when the stage opens on a round whose service was already up, and never asks again for a line that is cached or was played.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {voiceFixture, tick} from './fixtures/native-voice-player.mjs'
const require = createRequire(import.meta.url)
const {createStageSpeech} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/speech.cjs')
const {createStageSessionObservation} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-observation.cjs')

const noop = () => {}, unsubscribe = () => noop
const feature = () => ({activate:noop, subscribe:unsubscribe, get:() => ({paused:false}), kick:noop, resume:noop, hold:noop, invalidate:noop})
const page = (text, offset) => ({pending:false, voice:{text, name:'A'}, anchor:{paragraphId:'p1', offset}})

function stage(t, {up = true, texts = ['l1', 'l2', 'l3'], opened = true} = {}) {
  t.mock.timers.enable({apis:['setTimeout']})
  const f = voiceFixture()
  t.after(() => f.player.dispose())
  const service = {up}
  const synthesize = f.client.synthesize
  let calls = 0
  f.client.synthesize = (input, options) => (calls++, service.up) ? synthesize(input, options) : Promise.reject(Object.assign(new Error('down'), {code:'SERVICE_OFFLINE'}))
  const speech = createStageSpeech({player:f.player, available:() => true, speechInput:d => ({text:d.text, mood:'calm'}),
    character:() => ({alias:'a', voiceKey:'k'}), language:() => 'zh', open:async () => f.descriptor})
  let state = {textIndex:new Map([[1, {text:{pages:texts.map(page)}}]]), source:{turn:1}, latestSource:{turn:1}, settings:{config:{voice:{enabled:true}}},
    opened, interrupted:false, cursor:{mode:'live'}, pending:null}
  const listeners = new Set()
  const store = {getSnapshot:() => state, dispatch:noop, select:() => ({subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, dispose:noop})}
  const change = patch => { state = {...state, ...patch}; for (const fn of [...listeners]) fn() }
  const lists = new Set(), settings = new Set()
  const observation = createStageSessionObservation({owner:{get:() => store}, resources:{invalidate:noop, suspend:noop, revoke:noop},
    resourceOwner:{acquire:() => Promise.reject(new Error('no media')), invalidateDerived:noop},
    selection:{current:() => 'chat', list:{subscribe:fn => { lists.add(fn); return () => lists.delete(fn) }, getSnapshot:() => ({byId:{}})}},
    settings:{subscribe:fn => { settings.add(fn); return () => settings.delete(fn) }, get:() => ({config:{characters:[]}})},
    packs:{subscribe:unsubscribe, runtimeChanged:unsubscribe}, entry:{shown:{get:() => store, subscribe:unsubscribe}, entering:() => false, hasDisplay:() => true},
    voice:speech, portraits:{select:noop, revision:noop, get:() => null, prepare:async () => {}},
    media:{music:feature(), background:feature(), ambience:feature()}, document:{hidden:false, addEventListener:noop, removeEventListener:noop}})
  t.after(() => observation.dispose())
  const sync = () => { for (const fn of settings) fn() }
  return {f, service, attempts:() => calls, observation, change, sync, texts:() => f.synths.map(s => s.input.text),
    // the observer's own timer, and the player's backoff clock
    wait:async ms => { f.advance(ms); t.mock.timers.tick(ms); for (let i = 0; i < 8; i++) await tick() }}
}

test('service started after the round: the stage asks for the unvoiced lines itself, in order, however long it was down', async t => {
  const s = stage(t, {up:false})
  s.observation.start()
  for (let i = 0; i < 4; i++) { await s.wait(1000 * 2 ** i) }
  assert.equal(s.texts().length, 0, 'nothing is synthesized while the service is down')
  assert.ok(s.attempts() >= 6, 'the lines were asked more often than a three-try budget')
  s.service.up = true
  await s.wait(35000)
  assert.deepEqual(s.texts(), ['l1', 'l2', 'l3'])
  })

test('other failures still stop after three tries', async t => {
  const s = stage(t, {texts:['l1']})
  let bad = 0
  s.f.client.synthesize = () => (bad++, Promise.reject(Object.assign(new Error('bad'), {code:'QWEN_REQUEST_FAILED'})))
  s.observation.start()
  for (let i = 0; i < 6; i++) { await s.wait(40000); s.sync() ; await s.wait(1) }
  assert.equal(bad, 3)
})

test('stage opened on a round while the service is up: every line is queued in reading order at once', async t => {
  const s = stage(t, {opened:false})
  s.observation.start()
  await s.wait(1)
  assert.deepEqual(s.texts(), ['l1', 'l2', 'l3'])
  s.change({opened:true})
  await s.wait(1)
  assert.deepEqual(s.texts(), ['l1', 'l2', 'l3'], 'opening the stage does not ask again')
})

test('cached lines are not requested again by later syncs, stage reopening or the retry timer', async t => {
  const s = stage(t)
  s.observation.start()
  await s.wait(1)
  assert.deepEqual(s.texts(), ['l1', 'l2', 'l3'])
  s.sync(); s.change({opened:false}); s.change({opened:true})
  await s.wait(60000)
  assert.deepEqual(s.texts(), ['l1', 'l2', 'l3'])
  assert.equal(s.attempts(), 3)
})
