import test from 'node:test'
import assert from 'node:assert/strict'
import {createWidgetVariableService} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/widget-variable-service.js'

const abandoned = () => ({id:'chat',_storageRevision:1,timeline:{operations:{edit:{id:'edit',kind:'variables.edit',status:'running',owner:'previous'}}}})
const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}

test('widget recovery rechecks lifetime at the storage publication boundary',async()=>{
  const gate=deferred();let entered=false,published=false
  const service=createWidgetVariableService({index:async()=>abandoned(),patch:async(id,revision,changes,metadata)=>{
    entered=true;await gate.promise;metadata.assertCurrent();published=true
  }})
  const recovery=service.recover('session')
  await new Promise(resolve=>setImmediate(resolve));assert.equal(entered,true)
  service.dispose();gate.resolve()
  await assert.rejects(recovery,{code:'STAGE_UNAVAILABLE'})
  assert.equal(published,false)
})
