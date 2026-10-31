import test from 'node:test'
import assert from 'node:assert/strict'
import {createModelSlotRegistry} from '../tavern-plugin/lib/domain/model-slot-registry.js'
import {CORE_MODEL_MANIFESTS,modelSlotRows,resolveModelSlot} from '../tavern-plugin/lib/domain/model-slots.js'

test('core model catalog works without stage and optional slots follow their owner',async()=>{
  const registry=createModelSlotRegistry()
  registry.register('core',{rows:()=>modelSlotRows(CORE_MODEL_MANIFESTS,CORE_MODEL_MANIFESTS.map(row=>row.id))})
  assert.equal((await registry.rows()).some(row=>row.modId==='dsh.stage'),false)
  assert.equal(registry.scoring(),null)
  const off=registry.register('stage',{rows:()=>[{modId:'dsh.stage',id:'director',fallback:'foreground'}],scoring:()=>({provider:'p',model:'m'})})
  const slot=(await registry.rows()).find(row=>row.modId==='dsh.stage')
  assert.deepEqual(resolveModelSlot({slot,modId:'dsh.stage',settings:{modModels:{'dsh.stage':{director:{provider:'saved',model:'existing'}}}}}),{provider:'saved',model:'existing'})
  assert.equal(registry.scoring().model,'m');off()
  assert.equal(registry.scoring(),null)
  assert.equal((await registry.rows()).some(row=>row.modId==='dsh.stage'),false)
})

test('late model declarations cannot return after removal or replacement',async()=>{
  let resolve;const gate=new Promise(done=>resolve=done),registry=createModelSlotRegistry()
  const provider={rows:()=>gate}
  const off=registry.register('stage',provider),pending=registry.rows()
  off();const next=registry.register('stage',provider);off()
  resolve([{modId:'stage',id:'model'}])
  assert.deepEqual(await pending,[])
  assert.equal((await registry.rows()).length,1);next()
})

test('failed optional providers do not hide healthy slots or scoring configuration',async()=>{
  const registry=createModelSlotRegistry({warn(){throw Error('logger')}})
  registry.register('broken',{rows(){throw Error('rows')},scoring(){throw Error('config')}})
  registry.register('healthy',{rows:()=>[{modId:'core',id:'model'}],scoring:()=>({provider:'p'})})
  assert.deepEqual(await registry.rows(),[{modId:'core',id:'model'}]);assert.deepEqual(registry.scoring(),{provider:'p'})
})
