import test from 'node:test'
import assert from 'node:assert/strict'
import { createTts } from '../src/service.js'
import { Settings, createServiceSettings, validateSettings } from '../src/settings.js'
import { hash, portableVoice, voicePreset } from '../src/core.js'
import { pcmWav } from '../src/providers/audio.js'

const neuro = {schemaVersion:1,id:'neuro-sama/neuro',label:'Neuro',kind:'azure',enabled:true,languages:['en'],params:{voiceName:'en-US-AshleyNeural',pitch:25,rate:8}}
const bella = {schemaVersion:1,id:'deepseek-whale/dafeiyu',label:'Dafeiyu',kind:'qwen',enabled:true,languages:['zh','en'],params:{voice:'Bella',model:'qwen3-tts-instruct-flash',moods:{joy:'cheerful',sad:null}}}
function fixture(t) {
  const tts = createTts(), calls = []
  let settings = Settings({}), writes = 0, failWrite = false
  const management = createServiceSettings({tts,get:() => settings,replace:async value => {if (failWrite) throw Error('write failed');settings=value;writes++},credentials:() => null,fetch:async () => {throw Error('no network')}})
  Object.assign(tts,{importVoicePresets:management.importVoicePresets}); management.sync()
  const register = (kind,id = kind) => tts.registerProvider('test',{id,kind,revision:'1',health:async () => ({state:'ready'}),catalog:async () => [],capabilities:{},synthesize:async spec => {calls.push(spec);return pcmWav(Buffer.alloc(100,1))}})
  t.after(async () => {management.dispose();await tts.dispose()})
  return {tts,management,register,calls,get settings(){return settings},get writes(){return writes},failWrite:() => {failWrite=true}}
}

test('preset validation reuses portable params and accepts namespaced cloud ids without allowing secrets', () => {
  for (const v of [neuro,bella,{...neuro,kind:'volcengine',params:{speaker:'speaker_1',speechRate:20}}]) assert.equal(voicePreset(v).id,v.id)
  assert.equal(portableVoice(neuro).params.pitch,25)
  for (const id of ['neuro','../neuro','work//name','Work/name','work/name/extra']) assert.throws(() => voicePreset({...neuro,id}),{code:'INVALID_INPUT'})
  for (const patch of [{key:'secret'},{config:{key:'secret'}},{providerId:'../provider'},{revision:{secret:'secret'}},{label:''}]) assert.throws(() => voicePreset({...neuro,...patch}),{code:'INVALID_INPUT'})
  for (const params of [{...neuro.params,pitch:51},{...neuro.params,rate:101},{...neuro.params,key:'secret'},{voiceName:'AshleyNeural'},{...neuro.params,moods:{bad:{token:'secret'}}}]) assert.throws(() => voicePreset({...neuro,params}),{code:'INVALID_PARAMS'})
  assert.throws(() => voicePreset({...bella,params:{voice:'Bella',model:'wrong'}}),{code:'INVALID_PARAMS'})
  assert.throws(() => validateSettings(Settings({voices:[neuro,neuro]})),{code:'INVALID_INPUT'})
})

test('saved presets share a base voice, list in catalogue, synthesize through existing grants, edit and delete with CAS', async t => {
  const f = fixture(t); f.register('azure')
  const first = await f.management.saveVoicePreset({preset:neuro}), second = await f.management.saveVoicePreset({preset:{...neuro,id:'neuro-sama/soft',params:{...neuro.params,pitch:5}}})
  assert.deepEqual((await f.tts.listServiceVoices()).filter(v => v.preset).map(v => [v.id,v.state]),[[neuro.id,'ready'],[second.preset.id,'ready']])
  assert.ok((await f.tts.listServiceVoices()).some(v => v.id === 'qwen/bella'))
  assert.equal(f.calls.length,0)
  const {grant} = f.tts.grantServiceConsumer({principal:'test',scope:'card'})
  const say = () => f.tts.synthesize({voiceId:neuro.id,text:'Hello',language:'en'},{grant,scope:'card'})
  await say();assert.equal(f.calls[0].params.pitch,25);assert.equal(f.calls[0].params.rate,8)
  await assert.rejects(f.management.saveVoicePreset({preset:neuro}),{code:'REVISION_CONFLICT'})
  const edited = await f.management.saveVoicePreset({preset:{...neuro,params:{...neuro.params,pitch:15}},expectedRevision:first.revision})
  await say();assert.equal(f.calls[1].params.pitch,15)
  await assert.rejects(f.management.deleteVoicePreset({id:neuro.id,expectedRevision:first.revision}),{code:'REVISION_CONFLICT'})
  await f.management.deleteVoicePreset({id:neuro.id,expectedRevision:edited.revision})
  await assert.rejects(say(),{code:'VOICE_NOT_FOUND'})
  assert.equal(f.settings.voices.length,1)
})

test('fresh import registers presets; identical is no-op, conflicts keep user values, validation and write failures are atomic', async t => {
  const f = fixture(t)
  assert.deepEqual(await f.tts.importVoicePresets({presets:[bella,neuro]}),{added:[bella.id,neuro.id],unchanged:[],conflicts:[]})
  const descriptors = await f.tts.exportVoicePresets([bella.id,neuro.id,'missing/voice'])
  assert.deepEqual(descriptors,[voicePreset(bella),voicePreset(neuro)])
  assert.deepEqual(await f.tts.importVoicePresets({presets:descriptors}),{added:[],unchanged:[bella.id,neuro.id],conflicts:[]});assert.equal(f.writes,1)
  assert.deepEqual(await f.tts.importVoicePresets({presets:[{...bella,label:'Different'}]}),{added:[],unchanged:[],conflicts:[bella.id]})
  assert.equal(f.settings.voices[0].label,bella.label);assert.equal(f.writes,1)
  await assert.rejects(f.tts.importVoicePresets({presets:[{...neuro,id:'new/voice'},{...bella,params:{key:'secret'}}]}),{code:'INVALID_PARAMS'})
  assert.equal(f.settings.voices.length,2)
  f.failWrite();await assert.rejects(f.tts.importVoicePresets({presets:[{...neuro,id:'new/voice'}]}),/write failed/)
  assert.equal((await f.tts.listServiceVoices()).some(v => v.id === 'new/voice'),false)
})

test('provider hints select the configured service, unambiguous kind fallback supports imported presets, ambiguity stays unavailable', async t => {
  const f = fixture(t)
  await f.tts.importVoicePresets({presets:[{...neuro,providerId:'original-service'}]})
  assert.equal((await f.tts.listServiceVoices()).find(v => v.id === neuro.id).state,'service-required')
  f.register('azure','azure-one')
  assert.equal((await f.tts.listServiceVoices()).find(v => v.id === neuro.id).serviceId,'azure-one')
  f.register('azure','azure-two')
  assert.equal((await f.tts.listServiceVoices()).find(v => v.id === neuro.id).state,'service-required')
  await f.management.saveVoicePreset({preset:{...neuro,providerId:'azure-two'},expectedRevision:hash(f.settings.voices[0])})
  assert.equal((await f.tts.listServiceVoices()).find(v => v.id === neuro.id).serviceId,'azure-two')
})

test('builtin base choices cannot be replaced by creating a preset; remote service descriptors export without provider secrets', async t => {
  const f = fixture(t)
  await assert.rejects(f.management.saveVoicePreset({preset:{...bella,id:'qwen/bella'}}),{code:'REVISION_CONFLICT'})
  f.tts.registerProvider('test',{id:'local-service',kind:'reference',revision:'1',capabilities:{serviceVoiceEngines:['service-engine']},health:async () => ({}),synthesize:async () => {throw Error('no synthesis')},catalog:async () => [{id:'remote/voice',label:'Remote',engine:'service-engine',revision:'v1',languages:['en'],state:'ready',params:{speed_factor:1},token:'secret',config:{key:'secret'}}]})
  const [v] = await f.tts.exportVoicePresets(['remote/voice'])
  assert.equal(v.kind,'service');assert.equal(v.voiceId,'remote/voice');assert.equal(JSON.stringify(v).includes('secret'),false)
  assert.deepEqual(await f.tts.importVoicePresets({presets:[v]}),{added:[],unchanged:['remote/voice'],conflicts:[]})
  assert.deepEqual(await f.tts.importVoicePresets({presets:[{...v,label:'Changed'}]}),{added:[],unchanged:[],conflicts:['remote/voice']})
})


test('imported service aliases retain base voice and revision through the existing synthesis path',async t => {
  const f = fixture(t), remote = {id:'remote/base',label:'Base',engine:'service-engine',revision:'server-revision',languages:['en'],state:'ready',params:{speed_factor:1}}
  f.tts.registerProvider('test',{id:'local-service',kind:'reference',revision:'1',capabilities:{serviceVoiceEngines:['service-engine']},health:async () => ({}),catalog:async () => [remote],synthesize:async spec => {f.calls.push(spec);return pcmWav(Buffer.alloc(100,1))}})
  const [base] = await f.tts.exportVoicePresets([remote.id])
  await f.tts.importVoicePresets({presets:[{...base,id:'work/alias',label:'Alias'}]})
  const {grant} = f.tts.grantServiceConsumer({principal:'test',scope:'card'})
  await f.tts.synthesize({voiceId:'work/alias',text:'Hello',language:'en'},{grant,scope:'card'})
  assert.equal(f.calls[0].voiceId,remote.id);assert.equal(f.calls[0].revision,remote.revision)
})
