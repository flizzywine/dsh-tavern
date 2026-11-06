import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeSettingsProfile } from '../../../../tests/fixtures/native-settings-profile.mjs'
import { describeTtsError } from '../src/core.js'

const tick = () => new Promise(r => setTimeout(r, 20))
async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!await predicate()) { if (Date.now() >= deadline) assert.fail('settings did not settle'); await tick() }
}
async function profile(t) {
  const f = await nativeSettingsProfile(t, {ownerUrl:new URL('../src/index.js', import.meta.url).href, ownerId:'tts', ownerConfig:{profileId:'test'}, settings:true,
    setup(ctx) { ctx.provide('connection', {fetch:{register() { return () => {} }}}) }})
  await until(() => f.ctx.get('settings').describe().filter(row => row.ns === 'tts').every(row => row.value.forkSettingsImported === 1))
  await tick()
  t.after(() => f.ctx.fiber.dispose())
  return f
}

test('fresh settings read the browser default with narration off; bindings persist and fire readingChanged', async t => {
  const f = await profile(t), tts = f.ctx.get('tts'), control = f.ctx.get('ttsControl')
  const fresh = {dialogueVoice:null, narrator:{enabled:false, voice:null}, readAloud:{voice:null, auto:false}}
  assert.deepEqual(tts.reading(), fresh)
  assert.deepEqual(await control.call('reading'), fresh)
  const events = []
  tts.subscribe(event => { if (event.type === 'readingChanged') events.push(event) })

  const browser = {browser:'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)'}
  assert.deepEqual(await control.call('setReading', {dialogueVoice:browser}), {...fresh, dialogueVoice:browser})
  const service = {serviceId:'fish-local', voice:'yui_v2'}
  const both = {...fresh, dialogueVoice:browser, narrator:{enabled:true, voice:service}}
  assert.deepEqual(await control.call('setReading', {narrator:{enabled:true, voice:service}}), both)
  assert.deepEqual(f.value('tts').reading, both)
  assert.deepEqual(tts.reading(), both)
  assert.equal(events.length, 2)

  await control.call('setReading', {narrator:{enabled:true}})
  assert.equal(events.length, 2, 'an unchanged value fires nothing')
  assert.deepEqual(await control.call('setReading', {dialogueVoice:null}), {...both, dialogueVoice:null})
  assert.equal(events.length, 3)
})

test('an invalid reading voice is rejected with a readable message and nothing is written', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl')
  for (const patch of [{dialogueVoice:{browser:''}}, {dialogueVoice:{serviceId:'Bad Id', voice:'v'}}, {dialogueVoice:{browser:'a', voice:'v'}},
    {narrator:{voice:'yui'}}, {narrator:{enabled:'yes'}}, {voice:{browser:'a'}}, {dialogueVoice:{packId:'p', figureId:'f'}}])
    await assert.rejects(control.call('setReading', patch), {code:'INVALID_READING_VOICE'})
  assert.match(describeTtsError('INVALID_READING_VOICE'), /朗读声音/)
  assert.equal(f.value('tts')?.reading, undefined)
  assert.deepEqual(f.ctx.get('tts').reading(), {dialogueVoice:null, narrator:{enabled:false, voice:null}, readAloud:{voice:null, auto:false}})
})

test('pack voices and template references persist in both reading selections', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl')
  for (const voice of [{packId:'11111111-1111-4111-8111-111111111111',voiceId:'library-clone'}, {templateId:'33333333-3333-4333-8333-333333333333'}]) {
    const expected = {dialogueVoice:voice,narrator:{enabled:true,voice},readAloud:{voice:null,auto:false}}
    assert.deepEqual(await control.call('setReading',expected),expected)
    assert.deepEqual(f.value('tts').reading,expected)
  }
  for (const voice of [{packId:'bad',voiceId:'v'}, {templateId:'bad'}, {templateId:'33333333-3333-4333-8333-333333333333',voice:'v'}])
    await assert.rejects(control.call('setReading',{dialogueVoice:voice}),{code:'INVALID_READING_VOICE'})
})
test('read-aloud owns its voice and auto setting and emits one event per write', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl'), events = []
  f.ctx.get('tts').subscribe(event => { if (event.type === 'readingChanged') events.push(event) })
  for (const voice of [{browser:'Kyoko'}, {serviceId:'fish-local',voice:'reader'}]) {
    const before = events.length
    const result = await control.call('setReading', {readAloud:{voice,auto:true}})
    assert.deepEqual(result.readAloud,{voice,auto:true})
    assert.equal(result.dialogueVoice,null)
    assert.deepEqual(f.value('tts').reading.readAloud,result.readAloud)
    assert.equal(events.length,before + 1)
  }
  await assert.rejects(control.call('setReading',{readAloud:{voice:{silent:true}}}),{code:'INVALID_READING_VOICE'})
})

test('only the general voice accepts an explicit silent binding', async () => {
  const {patchReading} = await import('../src/settings.js')
  assert.deepEqual(patchReading({}, {dialogueVoice:{silent:true}}).dialogueVoice, {silent:true})
  assert.throws(() => patchReading({}, {narrator:{voice:{silent:true}}}), {code:'INVALID_READING_VOICE'})
  assert.throws(() => patchReading({}, {dialogueVoice:{silent:false}}), {code:'INVALID_READING_VOICE'})
})
