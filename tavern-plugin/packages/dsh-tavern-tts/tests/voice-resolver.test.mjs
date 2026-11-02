// The browser is the zero-config default; a chosen default service never yields to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createTts } from '../src/service.js'
import { browserFallback } from '../src/voice-resolver.js'
import { pcmWav } from '../src/providers/audio.js'

const voice = {defaultSource:'cloud',sources:{cloud:{provider:'fish-audio',kind:'voice-id',voiceId:'akane'}}}, binding = {voice:'akane'}
const fish = (id, extra = {}) => ({id,kind:'fish-audio',revision:'one',capabilities:{paid:false},health:async () => ({state:'ready'}),catalog:async () => [],synthesize:async () => pcmWav(Buffer.alloc(64,1)),...extra})

test('zero services resolve to the browser descriptor, live and read-only, without binding a service', async t => {
  const tts = createTts({defaultServiceId:() => ''}); t.after(() => tts.dispose())
  for (const readOnly of [false, true]) {
    const resolved = await tts.resolveVoiceService({voice,binding},{readOnly})
    assert.deepEqual(resolved,{effective:{serviceId:'browser',browser:{voice:null},capabilities:{browser:true,paid:false,billing:'free'}},issues:[]})
  }
  assert.equal(tts.pendingCount(),0)
  // A service that cannot speak this source does not hold the browser back; a compatible one is used as before.
  tts.registerProvider('test',{...fish('qwen'),kind:'qwen'})
  assert.equal((await tts.resolveVoiceService({voice,binding})).effective.serviceId,'browser')
  tts.registerProvider('test',fish('cloud'))
  assert.equal((await tts.resolveVoiceService({voice,binding})).effective.serviceId,'cloud')
  // A source not set up yet still says what it lacks.
  assert.deepEqual(await tts.resolveVoiceService({voice:{defaultSource:'cloud',sources:{cloud:{provider:'fish-audio',kind:'voice-id'}}},binding}),{effective:null,issues:[{code:'VOICE_NOT_FOUND'}]})
})

test('with a default service set, its absence or failure is reported unchanged and never falls back to the browser', async t => {
  assert.equal(browserFallback(voice.sources.cloud,[],'fish-local'),null)
  const tts = createTts({defaultServiceId:() => 'fish-local'}); t.after(() => tts.dispose())
  assert.deepEqual(await tts.resolveVoiceService({voice,binding}),{effective:null,issues:[{code:'SERVICE_REQUIRED'}]})
  const off = tts.registerProvider('test',fish('fish-local',{health:async () => ({state:'credentials-required'})}))
  assert.deepEqual(await tts.resolveVoiceService({voice,binding}),{effective:null,issues:[{code:'CREDENTIALS_REQUIRED'}]})
  off()
  tts.registerProvider('test',fish('fish-local',{synthesize:async () => { throw Object.assign(new Error('FISH_REQUEST_FAILED'),{code:'FISH_REQUEST_FAILED'}) }}))
  const pool = {schemaVersion:1,id:'v',label:'Voice',enabled:true,kind:'fish-audio',languages:['ja'],params:{referenceId:'akane'}}
  tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[pool],bindings:{v:'fish-local'}})
  const {grant} = tts.grantConsumer({source:'card',principal:'user',scope:'card'})
  await assert.rejects(tts.synthesize({voice:{source:'card',id:'v'},mood:'default',text:'こんにちは',language:'ja'},{grant,scope:'card'}),{code:'FISH_REQUEST_FAILED'})
  assert.equal((await tts.resolveVoiceService({voice,binding})).effective.serviceId,'fish-local')
})

test('ttsClient is available with zero configured services', async () => {
  const source = await readFile(new URL('../src/client.js',import.meta.url),'utf8')
  const exports = {}, provided = new Map(); let events
  class EventSource { constructor() { events = this } close() {} }
  vm.runInNewContext(source,{exports,require:() => ({createElement:() => null}),fetch:async () => ({ok:true,json:async () => ({defaultServiceId:'',configured:[],running:[]})}),EventSource,AbortController,Date,Set,setTimeout,clearTimeout})
  exports.apply({provide:(key,value) => { provided.set(key,value); return () => provided.delete(key) },effect:fn => fn(),inject:() => {},slots:{inject:() => {}}})
  events.onmessage({data:JSON.stringify({enabled:true})}); await Promise.resolve()
  assert.equal(provided.get('ttsClient').available(),true)
})
