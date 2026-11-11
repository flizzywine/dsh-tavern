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

// tts.reading keeps which figure 通用声音 / 旁白 speak with (none = the browser default), 旁白配音's global switch and 全文朗读's reader.
const FRESH = {general:{figure:null}, narrator:{enabled:false, figure:null}, readAloud:{voice:null, auto:false}}
const FIGURE_REF = {packId:'11111111-1111-4111-8111-111111111111', figureId:'speaker-a'}
test('fresh settings have narration off; the switch persists and fires readingChanged once per change', async t => {
  const f = await profile(t), tts = f.ctx.get('tts'), control = f.ctx.get('ttsControl')
  assert.deepEqual(tts.reading(), FRESH)
  assert.deepEqual(await control.call('reading'), FRESH)
  const events = []
  tts.subscribe(event => { if (event.type === 'readingChanged') events.push(event) })
  const on = {...FRESH, narrator:{enabled:true, figure:null}}
  assert.deepEqual(await control.call('setReading', {narrator:{enabled:true}}), on)
  assert.deepEqual(f.value('tts').reading, on)
  assert.deepEqual(tts.reading(), on)
  await control.call('setReading', {narrator:{enabled:true}})
  assert.equal(events.length, 1, 'an unchanged value fires nothing')
})

test('通用声音 / 旁白 each point at a figure; null clears it; the other keys stay', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl'), events = []
  f.ctx.get('tts').subscribe(event => { if (event.type === 'readingChanged') events.push(event) })
  assert.deepEqual(await control.call('setReading', {general:{figure:FIGURE_REF}}), {...FRESH, general:{figure:FIGURE_REF}})
  const both = await control.call('setReading', {narrator:{figure:FIGURE_REF, enabled:true}})
  assert.deepEqual(both, {...FRESH, general:{figure:FIGURE_REF}, narrator:{enabled:true, figure:FIGURE_REF}})
  assert.deepEqual(f.value('tts').reading, both)
  assert.deepEqual(await control.call('setReading', {general:{figure:null}}), {...both, general:{figure:null}})
  assert.equal(events.length, 3)
  // the stage's one-time migration writes through the same entry on the host
  assert.deepEqual((await f.ctx.get('tts').setReading({general:{figure:FIGURE_REF}})).general, {figure:FIGURE_REF})
})

test('an invalid reading patch is rejected with a readable message and nothing is written', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl')
  for (const patch of [{dialogueVoice:{browser:'Kyoko'}}, {narrator:{voice:{browser:'Kyoko'}}}, {narrator:{enabled:'yes'}}, {voice:{browser:'a'}},
    {general:{figure:{packId:'not-a-uuid', figureId:'speaker-a'}}}, {general:{figure:{packId:FIGURE_REF.packId, figureId:'../x'}}}, {general:{figure:{packId:FIGURE_REF.packId}}},
    {narrator:{figure:'speaker-a'}}, {general:{voice:{browser:'a'}}},
    {readAloud:{voice:{browser:''}}}, {readAloud:{voice:{serviceId:'Bad Id', voice:'v'}}}, {readAloud:{voice:{packId:'p', figureId:'f'}}}])
    await assert.rejects(control.call('setReading', patch), {code:'INVALID_READING_VOICE'})
  assert.match(describeTtsError('INVALID_READING_VOICE'), /朗读声音/)
  assert.equal(f.value('tts')?.reading, undefined)
  assert.deepEqual(f.ctx.get('tts').reading(), FRESH)
})

test('read-aloud owns its voice (browser, service, pack voice or template) and auto setting, one event per write', async t => {
  const f = await profile(t), control = f.ctx.get('ttsControl'), events = []
  f.ctx.get('tts').subscribe(event => { if (event.type === 'readingChanged') events.push(event) })
  for (const voice of [{browser:'Kyoko'}, {serviceId:'fish-local',voice:'reader'}, {packId:'11111111-1111-4111-8111-111111111111',voiceId:'library-clone'}, {templateId:'33333333-3333-4333-8333-333333333333'}]) {
    const before = events.length
    const result = await control.call('setReading', {readAloud:{voice,auto:true}})
    assert.deepEqual(result, {...FRESH, readAloud:{voice,auto:true}})
    assert.deepEqual(f.value('tts').reading.readAloud,result.readAloud)
    assert.equal(events.length,before + 1)
  }
  for (const voice of [{silent:true}, {packId:'bad',voiceId:'v'}, {templateId:'bad'}])
    await assert.rejects(control.call('setReading',{readAloud:{voice}}),{code:'INVALID_READING_VOICE'})
})