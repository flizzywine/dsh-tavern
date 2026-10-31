import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSessionRuntime}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs')
const {createStageRuntimeStoreModule:createStoreModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/runtime-store.cjs')
const {createStageSessionModule:createSessionModule}=require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/session.cjs')
const kernel=require('../tavern-plugin/src/client/stage-runtime.cjs')
test('plugin runtime owns session observers and disposes all owners despite a cleanup failure',()=>{
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule}),listeners=new Set();let stops=0
 const inputs=fail=>({sessions:{list:{getSnapshot:()=>({current:null,byId:{}}),subscribe(fn){listeners.add(fn);return ()=>{listeners.delete(fn);stops++;if(fail)throw Error('unsubscribe failed')}}}}})
 assert.equal(listeners.size,0)
 const first=runtime.createSessionOwner(inputs(true)),second=runtime.createSessionOwner(inputs(false))
 assert.equal(listeners.size,0,'construction alone does not observe host sessions')
 first.start();first.start();second.start();assert.equal(listeners.size,2)
 assert.throws(()=>runtime.dispose(),/cleanup failed/);assert.equal(listeners.size,0);assert.equal(stops,2)
 runtime.dispose();first.dispose();second.dispose();assert.equal(stops,2)
 assert.throws(()=>runtime.createSessionOwner(inputs(false)),/disposed/)
})
test('explicit session teardown leaves plugin teardown idempotent',()=>{
 const runtime=createStageSessionRuntime({kernel,createStoreModule,createSessionModule});let stopped=0
 const owner=runtime.createSessionOwner({sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>stopped++}}})
 owner.start();owner.dispose();runtime.dispose();assert.equal(stopped,1)
})
