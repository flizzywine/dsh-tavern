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
  const fresh = {dialogueVoice:null, narrator:{enabled:false, voice:null}}
  assert.deepEqual(tts.reading(), fresh)
  assert.deepEqual(await control.call('reading'), fresh)
  const events = []
  tts.subscribe(event => { if (event.type === 'readingChanged') events.push(event) })

  const browser = {browser:'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)'}
  assert.deepEqual(await control.call('setReading', {dialogueVoice:browser}), {...fresh, dialogueVoice:browser})
  const service = {serviceId:'fish-local', voice:'yui_v2'}
  const both = {dialogueVoice:browser, narrator:{enabled:true, voice:service}}
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
  assert.deepEqual(f.ctx.get('tts').reading(), {dialogueVoice:null, narrator:{enabled:false, voice:null}})
})
