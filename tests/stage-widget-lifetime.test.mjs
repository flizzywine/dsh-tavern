import test from 'node:test'
import assert from 'node:assert/strict'
import {createWidgetVariableService} from '../tavern-plugin/lib/domain/widget-variable-service.js'

const abandoned = () => ({id:'chat',_storageRevision:1,timeline:{operations:{edit:{id:'edit',kind:'variables.edit',status:'running',owner:'previous'}}}})
const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}

test('widget recovery cannot write when its index arrives after disposal',async()=>{
  const gate=deferred();let writes=0,reads=0
  const service=createWidgetVariableService({index:()=>{reads++;return gate.promise},patch:()=>{writes++}})
  const recovery=service.recover('session')
  service.dispose();gate.resolve(abandoned());await recovery
  await service.recover('session')
  assert.equal(writes,0);assert.equal(reads,1)
  assert.equal(service.invalidate({sessionId:'session',viewId:'view',viewEpoch:1}),false)
})

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

test('active widget recovery preserves existing orphan operation cancellation',async()=>{
  let written
  const service=createWidgetVariableService({index:async()=>abandoned(),patch:async(id,revision,changes,metadata)=>{
    metadata.assertCurrent();written={id,revision,changes}
  }})
  await service.recover('session')
  assert.deepEqual(written,{id:'chat',revision:1,changes:[{op:'set',path:['timeline','operations','edit','status'],value:'cancelled'}]})
  service.dispose()
})
