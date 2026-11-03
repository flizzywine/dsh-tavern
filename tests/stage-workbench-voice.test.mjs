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

test('voice engine-services shares the real engine owner and keeps stage writes out',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const before=await f.invoke('voice_read',{action:'engine-services'})
  assert.equal(before.ok,true);assert.deepEqual(before.data.voiceServices,{})
  assert.equal(before.data.revision,f.engine.read().revision)
  assert.equal(Object.hasOwn(before.data,'values'),false)
  const input={action:'engine-services',expectedRevision:before.data.revision,voiceServices:{qwen:'voice-primary'}}
  assert.equal((await f.invoke('voice_patch',input)).error.code,'APPROVAL_REJECTED')
  assert.deepEqual(f.engine.read().values.voiceServices,{})
  f.setApproval('allowed-once')
  const oldValues=structuredClone(f.engine.read().values)
  const written=await f.invoke('voice_patch',input)
  assert.equal(written.ok,true,JSON.stringify(written))
  assert.match(f.approvals.at(-1).reason,/影响所有卡片/)
  assert.deepEqual(f.engine.read().values,{...oldValues,voiceServices:input.voiceServices})
  assert.deepEqual((await f.invoke('voice_read',{action:'engine-services'})).data,written.data)
  assert.equal((await f.invoke('voice_patch',input)).error.code,'REVISION_CONFLICT')
  const calls=f.calls.filter(c=>c.method==='saveAssetEngineSettings').length
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:written.data.revision,patch:{voiceServices:{}}})).error.code,'UNKNOWN_FIELD')
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,calls)
})
