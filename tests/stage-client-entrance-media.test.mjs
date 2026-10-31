import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageEntranceMedia}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/entrance-media.cjs')
const run={media:{packId:'pack',bundleKey:'entrance',hash:'one'},doc:{layers:{plate:{frames:1,shift:true}}}}
const lease={ticket:'ticket',url:'/assets/lease/ticket/index.json'}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('entrance media coalesces reads, splits frames and releases one lease',async()=>{
 let acquired=0,released=0;const urls=[]
 const module=createStageEntranceMedia({AbortController,files:()=>['帧/color.png','shift.png'],getService:()=>({async leaseBundle(){acquired++;return lease},async releaseLease(){released++}}),fetch:async(url)=>{urls.push(url);return {ok:true,blob:async()=>url}}})
 const a=module.read(run);assert.equal(a,module.read(run));const result=await a
 assert.equal(acquired,1);assert.equal(released,1);assert.deepEqual(result,{color:[urls[0]],shift:[urls[1]]});assert.match(urls[0],/%E5%B8%A7/)
 assert.equal(module.read(run),a);module.dispose();await assert.rejects(module.read(run),{name:'AbortError'})
})
test('failed frame waits for siblings before releasing lease and allows retry',async()=>{
 let released=0,finish,attempt=0
 const module=createStageEntranceMedia({AbortController,files:()=>['bad','slow'],getService:()=>({async leaseBundle(){attempt++;return lease},async releaseLease(){released++}}),fetch:async url=>{
  if(url.endsWith('bad')&&attempt===1)return {ok:false,status:500}
  if(url.endsWith('slow')&&attempt===1)await new Promise(resolve=>finish=resolve)
  return {ok:true,blob:async()=>url}
 }})
 const read=module.read(run),failed=assert.rejects(read,/500/);await tick();assert.equal(released,0);finish();await failed;assert.equal(released,1)
 await module.read(run);assert.equal(attempt,2);assert.equal(released,2);module.dispose()
})
test('disposal aborts active fetches and releases leases that arrive after unload',async()=>{
 let grant,released=0,fetched=0
 const module=createStageEntranceMedia({AbortController,files:()=>['a'],getService:()=>({leaseBundle:()=>new Promise(resolve=>grant=resolve),async releaseLease(){released++}}),fetch:async()=>{fetched++}})
 const pending=module.read(run),cancelled=assert.rejects(pending,{name:'AbortError'});module.dispose();grant(lease);await cancelled
 assert.equal(released,1);assert.equal(fetched,0)
 let signal
 const active=createStageEntranceMedia({AbortController,files:()=>['a'],getService:()=>({async leaseBundle(){return lease},async releaseLease(){released++}}),fetch:(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(Error('cancelled')))})})
 const read=active.read(run),rejects=assert.rejects(read,{name:'AbortError'});await tick();active.dispose();await rejects
 assert.equal(signal.aborted,true);assert.equal(released,2)
})
