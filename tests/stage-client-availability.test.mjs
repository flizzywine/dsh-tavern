import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {watchStageAvailability}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/availability.cjs')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('server availability releases and restores a single client activation',async()=>{
 let state='ready',notify,mounts=0,stops=0,unsubscribed=0
 const release=watchStageAvailability({source:{read:async()=>({status:state}),subscribe:fn=>{notify=fn;return()=>unsubscribed++}},activate:()=>{mounts++;return()=>stops++}})
 await flush();assert.equal(mounts,1)
 await notify();assert.equal(mounts,1)
 state='disabled';await notify();assert.equal(stops,1)
 state='loading';await notify();assert.equal(mounts,1)
 state='ready';await notify();assert.equal(mounts,2)
 state='failed';await notify();assert.equal(stops,2)
 release();release();assert.equal(unsubscribed,1)
})
test('late ready reads cannot remount after a newer disabled read or disposal',async()=>{
 const reads=[];let notify,mounts=0
 const stop=watchStageAvailability({source:{read:()=>new Promise(resolve=>reads.push(resolve)),subscribe:fn=>{notify=fn;return()=>{}}},activate:()=>{mounts++;return()=>{}}})
 notify();reads[1]({status:'disabled'});await flush()
 reads[0]({status:'ready'});await flush();assert.equal(mounts,0)
 notify();stop();reads[2]({status:'ready'});await flush();assert.equal(mounts,0)
})
test('failed authority read releases stage and a later reconnect can recover',async()=>{
 let broken=false,notify,stops=0,mounts=0;const errors=[]
 const stop=watchStageAvailability({source:{read:async()=>{if(broken)throw Error('offline');return {status:'ready'}},subscribe:fn=>{notify=fn;return()=>{}}},activate:()=>{mounts++;return()=>stops++},report:error=>errors.push(error.message)})
 await flush();broken=true;await notify();assert.equal(stops,1);assert.deepEqual(errors,['offline'])
 broken=false;await notify();assert.equal(mounts,2);stop()
})
