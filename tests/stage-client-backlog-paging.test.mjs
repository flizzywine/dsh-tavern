import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageBacklogPaging}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-paging.cjs')
test('paging deduplicates requests, retries failures explicitly and fences disposal',async()=>{
 const pending=[],states=[]
 const paging=createStageBacklogPaging({hasOlder:()=>true,loadOlder:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))})
 const view=paging.create('s',value=>states.push(value))
 const first=view.load(10,true);await view.load(10,true)
 assert.equal(pending.length,1)
 pending[0].resolve();await first;await view.load(10,true)
 assert.equal(pending.length,1)
 const second=view.load(5,true);pending[1].reject(Error('offline'));await second
 await view.load(5,true);assert.equal(pending.length,2)
 const retry=view.load(5);assert.equal(pending.length,3)
 paging.dispose();pending[2].resolve();await retry
 assert.deepEqual(states,['loading','idle','loading','failed','loading'])
 await view.load(1);assert.equal(pending.length,3)
})
test('hydration reads each row once and accepts new cache rows',async()=>{
 const reads=[]
 const paging=createStageBacklogPaging({hydrateText:async(id,turn)=>reads.push([id,turn])})
 const view=paging.create('s',()=>{}),index=new Map([[1,{unloaded:true}]])
 view.hydrate(index,[1]);view.hydrate(index,[1]);await Promise.resolve()
 assert.deepEqual(reads,[['s',1]])
 index.set(1,{unloaded:true});view.hydrate(index,[1]);await Promise.resolve()
 assert.equal(reads.length,2)
 index.set(1,{unloaded:true});view.hydrate(index,[1]);view.dispose();await Promise.resolve()
 assert.equal(reads.length,2)
 paging.dispose()
})
