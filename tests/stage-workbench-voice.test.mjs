import test from 'node:test'
import assert from 'node:assert/strict'
import {workbenchFixture} from './fixtures/workbench-features.mjs'
import {createReadingPresetStore} from '../tavern-plugin/packages/dsh-tavern-tts/src/reading-presets.js'

test('reading creation preserves active rules; activating requires separate global approval',async t=>{
  const store=createReadingPresetStore()
  await store.edit({id:'default',expectedRevision:0,op:'add',entry:{forms:'Alice',reading:'Alis'}})
  const before=await store.activeEntries()
  const f=await workbenchFixture({tts:{call:(method,args)=>store[({createReadingPreset:'create',setActiveReadingPreset:'setActive'})[method]](args)}})
  t.after(()=>f.close())
  f.setApproval('allowed-once')
  const created=await f.invoke('voice_patch',{action:'reading-create',name:'Spare'})
  assert.equal(created.ok,true)
  assert.equal(created.data.active,'default')
  assert.deepEqual(await store.activeEntries(),before)
  f.setApproval('rejected')
  const denied=await f.invoke('voice_patch',{action:'reading-active',id:created.data.id})
  assert.equal(denied.error.code,'APPROVAL_REJECTED')
  assert.equal((await store.list()).active,'default')
  f.setApproval('allowed-once')
  assert.equal((await f.invoke('voice_patch',{action:'reading-active',id:created.data.id})).ok,true)
  assert.equal((await store.list()).active,created.data.id)
  assert.deepEqual(await store.activeEntries(),[])
  assert.equal(f.approvals.length,3)
})

// A figure's voice names its own service (source.serviceId); the engine keeps no per-kind service map.
test('voice engine-services is retired: the action is unknown and stage writes reject voiceServices',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  assert.equal(Object.hasOwn(f.engine.read().values,'voiceServices'),false)
  // the tool schema has no engine-services action any more.
  await assert.rejects(async()=>f.invoke('voice_read',{action:'engine-services'}),/Cannot encode/)
  await assert.rejects(async()=>f.invoke('voice_patch',{action:'engine-services',expectedRevision:f.engine.read().revision,voiceServices:{qwen:'voice-primary'}}),/Cannot encode/)
  f.setApproval('allowed-once')
  const calls=f.calls.filter(c=>c.method==='saveAssetEngineSettings').length
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{voiceServices:{}}})).error.code,'UNKNOWN_FIELD')
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,calls)
})

test('reading returns normalized TTS settings without writes or approval and retains card authority',async t=>{
  const {readingOf}=await import('../tavern-plugin/packages/dsh-tavern-tts/src/settings.js')
  const calls=[],settings={}
  const f=await workbenchFixture({tts:{call(method,args){calls.push({method,args});assert.equal(method,'reading');return readingOf(settings)}}})
  t.after(()=>f.close())
  const fresh={dialogueVoice:null,narrator:{enabled:false,voice:null},readAloud:{voice:null,auto:false}}
  assert.deepEqual((await f.invoke('voice_read',{action:'reading'})).data,fresh)
  settings.reading={dialogueVoice:{browser:'Dialogue'},narrator:{enabled:true,voice:{browser:'Narrator'}},readAloud:{voice:{browser:'Reader'},auto:true}}
  const before=structuredClone(settings)
  assert.deepEqual((await f.invoke('voice_read',{action:'reading'})).data,before.reading)
  assert.deepEqual(settings,before)
  assert.deepEqual(calls,[{method:'reading',args:{}},{method:'reading',args:{}}])
  assert.equal(f.approvals.length,0)
  assert.equal(f.paidCalls,0)
  f.chat.mode='story'
  assert.equal((await f.invoke('voice_read',{action:'reading'})).error.code,'CARD_MODE_REQUIRED')
  assert.equal(calls.length,2)
})

test('reading without the TTS service retains the unavailable error',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  assert.equal((await f.invoke('voice_read',{action:'reading'})).error.code,'ASSET_UNAVAILABLE')
})
