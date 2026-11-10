import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createTavernScriptHostAdapter} from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'mvu-native-lazy-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const io=[],store=createChatJournalStore({dataRoot:root,newConversations:true,onNativeIO:e=>io.push(e)}),db=createChatPersistence({store})
 await db.write({id:'c',sessionId:'s',mode:'story',mvu:{enabled:true,owner:'official'},timeline:{schemaVersion:1,branchId:'b',revision:1,checkpoints:[],operations:{}},messages:Array.from({length:256},(_,i)=>({role:'assistant',turn:i+1,text:'body '+i,swipeId:0,variables:[{stat_data:{hp:i},schema:{}}]}))})
 return {db,io,root}
}

for(const full of [false,true])test(`adapter transaction edits old floors and reads its writes, full=${full}`,async t=>{
 const {db}=await fixture(t)
 let adapter,eventId,materializations=0,reads=0,regexReads=0
 const baseline=(await db.readSlice('c',[])).chat._storageRevision
 const dispatch={supportsContextProjection:true,status:()=>({ready:true}),async dispatch(_session,_name,_args,_context,options){
  eventId=options.eventId
  const initial=await options.contextForBaseline({workContextVersion:1,...(!full?{textReceiptVersion:1}:{}),complete:true,chatId:'c',stateRevision:baseline,lifecycleRevision:0,messageCount:256})
  assert.equal(initial.contextDelta.messages.length,1)
  const result=await adapter.updateVariables('s',{type:'message',message_id:20},{stat_data:{hp:77},schema:{}},0,eventId)
  assert.equal(result.contextDelta.messages[0].variables.stat_data.hp,77)
  const text=await adapter.updateMessages('s',[{message_id:255,message:'rewritten by helper'}],0,eventId)
  assert.equal(text.contextDelta.messages[0].message,'body 255')
  assert.equal(text.contextDelta.retainMessageVariables,!full||undefined)
  assert.equal(text.contextDelta.messages[0].variables?.stat_data.hp,full?255:undefined)
  if(full){
   const all=await adapter.transactionContext('s',eventId)
   assert.equal(all.messages.length,256)
   assert.equal(all.messages[20].variables.stat_data.hp,77)
   assert.equal(all.messages[2].message,'body 2')
  }
  return {handled:true}
 }}
 adapter=createTavernScriptHostAdapter({resolveChat:async()=>{reads++;throw Error('full Chat read')},writeChat:db.write,
  resolveSettlementBase:async()=>{const base=await db.readSettlementBase('c'),ensure=base.ensure;return {...base,ensure:async indices=>{if(indices===undefined)materializations++;return ensure(indices)}}},
  resolveChatSlice:(_s,indices,fields)=>db.readSlice('c',indices,fields),replyRegexScripts:async()=>{regexReads++;return []},readCard:async()=>({}),worldBooks:{bound:async()=>null},scriptDispatch:dispatch})
 const result=await adapter.settleMvuUpdate({sessionId:'s',operationId:'op',branchId:'b',basedOnRevision:1,messageId:255,swipeId:0,expectedLifecycleRevision:0,command:'update',compactResult:true,compactContext:true})
 assert.equal(reads,0)
 assert.equal(regexReads,0)
 assert.equal(materializations,full?1:0)
 assert.ok(result.effect.changes.some(change=>change.path[0]==='messages'&&change.path[1]===20))
 const {applyMvuSettlementEffect}=await import('../tavern-plugin/lib/domain/mvu-settlement-effect.js')
 const commitBase=await db.readSettlementBase('c')
 const indices=[...new Set([255,...result.effect.changes.filter(c=>c.path[0]==='messages').map(c=>c.path[1])])]
 await commitBase.ensure(indices)
 applyMvuSettlementEffect(commitBase.chat,result.effect,{messageIndices:indices})
 const saved=await db.patch('c',baseline,result.effect.changes)
 assert.ok(saved)
 assert.equal((await db.readSlice('c',[20])).chat.messages[0].variables[0].stat_data.hp,77)
 await assert.rejects(adapter.updateVariables('s',{type:'message',message_id:20},{},0,eventId),/结算已结束/)
})

test('native delta coverage survives a restart and pins its rows to the returned revision',async t=>{
 const {db,root}=await fixture(t),revision=(await db.readSlice('c',[])).chat._storageRevision
 await db.patch('c',revision,[{op:'set',path:['messages',20,'text'],value:'changed'}])
 const cold=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 const delta=await cold.readChangedSlice('c',revision,'settlement')
 assert.deepEqual(delta.indices,[20]);assert.equal(delta.layoutChanged,false)
 assert.equal(delta.chat.messages[0].text,'changed')
 await cold.patch('c',delta.revision,[{op:'set',path:['posture'],value:'new'}])
 const headers=await cold.readChangedSlice('c',delta.revision,'settlement')
 assert.deepEqual(headers.indices,[]);assert.equal(headers.chat.posture,'new')
 await cold.update('c',chat=>{chat.messages.push({role:'assistant',turn:257,text:'append'});return chat})
 const appended=await cold.readChangedSlice('c',headers.revision,'settlement')
 assert.equal(appended.layoutChanged,true);assert.equal(appended.layoutFrom,256)
 assert.deepEqual(appended.indices,[256])
})

test('native effects reject conflicting fields while allowing unrelated concurrent changes',async()=>{
 const {createMvuSettlementEffect,applyMvuSettlementEffect}=await import('../tavern-plugin/lib/domain/mvu-settlement-effect.js')
 const before={id:'c',sessionId:'s',timeline:{branchId:'b',revision:1},messages:[{swipeId:0,variables:[{hp:3,other:1}]}]}
 const after=structuredClone(before);after.messages[0].variables[0].hp=7
 const effect=createMvuSettlementEffect({operationId:'op',chatId:'c',sessionId:'s',branchId:'b',basedOnRevision:1,expectedLifecycleRevision:0,messageId:0,swipeId:0,before,after,messageIndices:[0],guardChanges:true})
 const unrelated=structuredClone(before);unrelated.messages[0].variables[0].other=9
 applyMvuSettlementEffect(unrelated,effect)
 assert.deepEqual(unrelated.messages[0].variables[0],{hp:7,other:9})
 const conflicting=structuredClone(before);conflicting.messages[0].variables[0].hp=10
 assert.throws(()=>applyMvuSettlementEffect(conflicting,effect),/并发修改/)
 assert.equal(conflicting.messages[0].variables[0].hp,10)
})
