import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

async function harness(t, beforePatch, sliced = false) {
 const root=await mkdtemp(join(tmpdir(),'variable-patch-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 await persistence.write({id:'c',sessionId:'s',mode:'story',mvu:{enabled:true},tavernHelperLifecycleRevision:1,variables:{old:1},messages:[{role:'assistant',text:'history',variables:[{hp:10}]},{role:'assistant',text:'current'}]})
 const calls={writes:0,patches:[],fullReads:0,slices:[]}
 const adapter=createTavernScriptHostAdapter({resolveChat:()=>{calls.fullReads++;return persistence.read('c')},...(sliced ? {resolveChatSlice:(_session,indices,fields)=>{calls.slices.push(indices);return persistence.readSlice('c',indices,fields)},readChatRevision:persistence.readRevision} : {}),readCard:async()=>({}),worldBooks:{},scriptDispatch:{},
 writeChat:async(...args)=>{calls.writes++;return persistence.write(...args)},
 patchChat:async(...args)=>{calls.patches.push(structuredClone(args[2]));await beforePatch?.(persistence);return persistence.patch(...args)}})
 return {persistence,adapter,calls,root}
}

for(const type of ['message','chat','script'])test('变量保存只提交目标字段，重启保留结果：'+type,async t=>{
 const {persistence,adapter,calls,root}=await harness(t)
 const result=await adapter.updateVariables('s',{type,message_id:-1,script_id:'test'},{hp:7},1)
 assert.equal(result.updated,true);assert.equal(calls.writes,0);assert.equal(calls.patches.length,1)
 const saved=await persistence.read('c')
 assert.equal(saved.messages[0].variables[0].hp,10)
 assert.equal(type==='message'?saved.messages[1].variables[0].hp:type==='chat'?saved.variables.hp:saved.tavernHelperScriptVariables.test.hp,7)
 assert.equal(JSON.stringify(calls.patches).includes('history'),false)
 const reopened=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 assert.deepEqual(await reopened.read('c'),saved)
})

test('版本竞争退回原合并路径，保留并发字段',async t=>{
 const {adapter,persistence,calls}=await harness(t,p=>p.update('c',c=>({...c,title:'concurrent'})))
 await adapter.updateVariables('s',{type:'chat',localMutation:{key:'new',value:2}}, {},1)
 const saved=await persistence.read('c')
 assert.equal(calls.writes,1);assert.equal(saved.title,'concurrent');assert.deepEqual(saved.variables,{old:1,new:2})
})

test('版本竞争下同一变量冲突仍拒绝覆盖',async t=>{
 const {adapter,persistence}=await harness(t,p=>p.update('c',c=>({...c,variables:{old:3}})))
 await assert.rejects(adapter.updateVariables('s',{type:'chat'},{old:2},1),{code:'DSH_TAVERN_CHAT_CONFLICT'})
 assert.equal((await persistence.read('c')).variables.old,3)
})

test('新增稀疏 swipe 按原 JSON 存储规范化，旧快照不受影响',async t=>{
 const {adapter,persistence}=await harness(t)
 await adapter.updateVariables('s',{type:'message',message_id:0,swipe_id:3},{hp:7,missing:undefined},1)
 assert.deepEqual((await persistence.read('c')).messages[0].variables,[{hp:10},null,null,{hp:7}])
})

test('过期生命周期在写入前拒绝',async t=>{
 const {adapter,calls,persistence}=await harness(t)
 const result=await adapter.updateVariables('s',{type:'chat'},{hp:7},0)
 assert.equal(result.stale,true);assert.equal(calls.writes,0);assert.equal(calls.patches.length,0)
 assert.deepEqual((await persistence.read('c')).variables,{old:1})
})

for (const type of ['chat', 'script', 'message']) test('协商变量回执只返回变化：' + type, async t => {
 const {adapter,persistence}=await harness(t)
 const before=await persistence.read('c')
 const result=await adapter.updateVariables('s',{type,message_id:0,swipe_id:0,script_id:'test'},{hp:8},1,undefined,
  {chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1})
 assert.equal(result.context,undefined)
 assert.equal(result.contextDelta.baseRevision,before._storageRevision)
 assert.equal(result.contextDelta.stateRevision,(await persistence.read('c'))._storageRevision)
 assert.ok(JSON.stringify(result).length<1200)
})

test('变量回执基线过期或保存时竞争仍返回完整上下文',async t=>{
 const {adapter,persistence}=await harness(t,p=>p.update('c',c=>({...c,title:'concurrent'})))
 const before=await persistence.read('c')
 const result=await adapter.updateVariables('s',{type:'chat'},{hp:8},1,undefined,
  {chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1})
 assert.ok(result.context);assert.equal(result.contextDelta,undefined)
 const stale=await adapter.updateVariables('s',{type:'chat'},{hp:9},1,undefined,
  {chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1})
 assert.ok(stale.context);assert.equal(stale.contextDelta,undefined)
})

test('刷新回写相同变量不推进存储版本，空补丁仍检查版本和事务', async t => {
 const {adapter,persistence,root}=await harness(t)
 const before=await persistence.read('c')
 await adapter.updateVariables('s',{type:'message',message_id:0},{hp:10},1)
 assert.deepEqual(await persistence.read('c'),before)
 assert.deepEqual(await createChatJournalStore({dataRoot:root}).read('c'),before)
 assert.equal(await persistence.patch('c',before._storageRevision-1,[]),undefined)
 await assert.rejects(persistence.patch('c',before._storageRevision,[],{assertCurrent(){throw new Error('cancelled')}}),/cancelled/)
 assert.deepEqual(await persistence.read('c'),before)
})

for(const type of ['message','chat','script'])test('compact sliced variable update avoids full reads: '+type,async t=>{
 const {adapter,persistence,calls}=await harness(t,undefined,true)
 const before=await persistence.read('c')
 const result=await adapter.updateVariables('s',{type,message_id:-1,script_id:'test'},{hp:8},1,undefined,{chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1})
 assert.equal(calls.fullReads,0);assert.equal(calls.writes,0);assert.ok(result.contextDelta)
 assert.deepEqual(calls.slices,type==='message'?[[],[1]]:[[]])
 assert.equal((await persistence.read('c')).messages[0].variables[0].hp,10)
})

test('sliced CAS conflict preserves original-base conflict detection',async t=>{
 let once=false
 const {adapter,persistence}=await harness(t,async p=>{if(!once){once=true;await p.update('c',c=>({...c,variables:{old:3}}))}},true)
 const before=await persistence.read('c')
 await assert.rejects(adapter.updateVariables('s',{type:'chat'},{old:2},1,undefined,{chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1}),{code:'DSH_TAVERN_CHAT_CONFLICT'})
 assert.equal((await persistence.read('c')).variables.old,3)
})

test('sliced CAS conflict still merges unrelated concurrent fields',async t=>{
 let once=false
 const {adapter,persistence,calls}=await harness(t,async p=>{if(!once){once=true;await p.update('c',c=>({...c,title:'concurrent'}))}},true)
 const before=await persistence.read('c')
 const result=await adapter.updateVariables('s',{type:'chat'},{hp:8},1,undefined,{chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:1})
 assert.ok(result.context);assert.equal(calls.writes,1)
 const saved=await persistence.read('c');assert.equal(saved.title,'concurrent');assert.equal(saved.variables.hp,8)
})
