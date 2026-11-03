// The browser is the zero-config default; a compatible service never yields to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createTts } from '../src/service.js'
import { browserFallback } from '../src/voice-resolver.js'
import { validateVoiceSpec } from '../src/shared/voice-schema.js'
import { pcmWav } from '../src/providers/audio.js'

const voice = {defaultSource:'cloud',sources:{cloud:{provider:'fish-audio',kind:'voice-id',voiceId:'akane'}}}, binding = {voice:'akane'}
const fish = (id, extra = {}) => ({id,kind:'fish-audio',revision:'one',capabilities:{paid:false},health:async () => ({state:'ready'}),catalog:async () => [],synthesize:async () => pcmWav(Buffer.alloc(64,1)),...extra})

test('zero services resolve to the browser descriptor, live and read-only, without binding a service', async t => {
  const tts = createTts(); t.after(() => tts.dispose())
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

// A source names its own service instance; ids differ from labels on purpose.
test('a source speaks through its own serviceId, else the sole compatible service; several unnamed is SERVICE_REQUIRED', async t => {
  const tts = createTts(); t.after(() => tts.dispose())
  const cloned = id => ({defaultSource:'clone',sources:{clone:{provider:'fish-audio',kind:'voice-id',voiceId:'akane',...(id ? {serviceId:id} : {})}}})
  tts.registerProvider('test',fish('svc-a',{label:'Fish Audio'}))
  // one compatible service + an unknown serviceId → that service
  assert.equal((await tts.resolveVoiceService({voice:cloned('svc-gone'),binding})).effective.serviceId,'svc-a')
  tts.registerProvider('test',fish('svc-b',{label:'Fish Audio（本地）'}))
  assert.equal((await tts.resolveVoiceService({voice:cloned('svc-b'),binding})).effective.serviceId,'svc-b')
  assert.equal(tts.chooseService(cloned('svc-b').sources.clone,await tts.listServices()).id,'svc-b')
  assert.deepEqual(await tts.resolveVoiceService({voice:cloned(),binding}),{effective:null,issues:[{code:'SERVICE_REQUIRED'}]})
  assert.equal(tts.chooseService(cloned().sources.clone,await tts.listServices()),undefined)
  assert.equal(browserFallback(cloned('svc-b').sources.clone,await tts.listServices()),null)
})

test('a portable source may name its service; the id is validated on write', () => {
  const spec = serviceId => ({name:'Akane',language:'ja',defaultSource:'clone',sources:{clone:{kind:'voice-id',provider:'fish-audio',voiceId:'akane',serviceId}}})
  assert.equal(validateVoiceSpec(spec('svc-drama')).sources.clone.serviceId,'svc-drama')
  assert.throws(() => validateVoiceSpec(spec('http://x')),{code:'INVALID_INPUT'})
})

test('a chosen service reports its own failure and never falls back to the browser', async t => {
  const tts = createTts(); t.after(() => tts.dispose())
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
  vm.runInNewContext(source,{exports,require:() => ({createElement:() => null}),fetch:async () => ({ok:true,json:async () => ({configured:[],running:[]})}),EventSource,AbortController,Date,Set,setTimeout,clearTimeout})
  exports.apply({provide:(key,value) => { provided.set(key,value); return () => provided.delete(key) },effect:fn => fn(),inject:() => {},slots:{inject:() => {}}})
  events.onmessage({data:JSON.stringify({enabled:true})}); await Promise.resolve()
  assert.equal(provided.get('ttsClient').available(),true)
})
