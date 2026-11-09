import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createTavernScriptHostAdapter} from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import {createTavernScriptDispatch} from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import {createStoryTimeline} from '../tavern-plugin/lib/domain/story-timeline.js'
import {createBackgroundTaskCoordinator} from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import {applyMvuSettlementEffect} from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import {projectTavernHelperContext} from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import {helperClient} from './fixtures/helper-host-harness.mjs'
const tick=()=>new Promise(r=>setImmediate(r))

for(const append of [false,true]) for(const rows of [20,400]) test(`MVU ${rows} floors (append=${append}): bounded wire and atomic scoped commit including historical edits`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-delta-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let visits=0, fullReads=0
 const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root,onIndexedMessageVisit:()=>visits++})})
 await persistence.write({id:'c',sessionId:'s',mode:'story',timeline:{schemaVersion:1,branchId:'b',revision:1,checkpoints:Array.from({length:rows},(_,i)=>({id:'checkpoint-'+i,beforeRevision:i})),operations:{},participants:{}},mvu:{enabled:true},messages:Array.from({length:rows},(_,i)=>({role:'assistant',turn:i+1,text:'body',swipeId:0,variables:[{stat_data:{hp:10,padding:'x'.repeat(4096)},schema:{}}],mvu:{pending:i===rows-1}}))})
 let fullUpdates=0,conflict=true
 const coordinator=createBackgroundTaskCoordinator({timeline:createStoryTimeline(),store:{readChat:persistence.read,writeChat:persistence.write,
  updateChat:(...args)=>{fullUpdates++;return persistence.update(...args)},readSlice:persistence.readSlice,
  patchChat:async(...args)=>{
   // A display capture wins the first revision. Retry must preserve it.
   if(conflict){conflict=false;await persistence.update('c',d=>{d.messages[0].displayRuntime={captured:true};return d})}
   return persistence.patch(...args)
  }}})
 const task=await coordinator.begin(await persistence.read('c'),'settlement')
 let browser=projectTavernHelperContext(await persistence.read('c'))
 const gate=createTavernScriptDispatch();t.after(()=>gate.dispose('s'));gate.touch('s','browser',true)
 const adapter=createTavernScriptHostAdapter({resolveChat:()=>{fullReads++;return persistence.read('c')},writeChat:persistence.write,
  resolveSettlementBase:()=>persistence.readSettlementBase('c'),
  resolveChatSlice:(_s,indices)=>persistence.readSlice('c',indices),resolveChangedChatSlice:(_s,revision)=>persistence.readChangedSlice('c',revision),
  readCard:async()=>({}),worldBooks:{bound:async()=>null},scriptDispatch:gate})
 // Advance storage after the browser baseline, proving changed-floor synchronization.
 await persistence.update('c',d=>{d.messages[1].text='new history';
  if(append)d.messages.push({role:'user',turn:rows+1,text:'next'}, {role:'assistant',turn:rows+1,text:'new body',swipeId:0,variables:[{stat_data:{hp:10,padding:'x'.repeat(4096)},schema:{}}],mvu:{pending:true}})
  return d})
 const targetId=append ? rows+1 : rows-1
 visits=0
 const settlement=adapter.settleMvuUpdate({operationId:task.operationId,branchId:task.basedOn.branchId,basedOnRevision:task.basedOn.revision,
  sessionId:'s',messageId:targetId,swipeId:0,compactResult:true,storyText:'body',command:'<UpdateVariable/>',baselineVariables:browser.messages.at(-1).variables})
 while(!gate.status('s').busy) await tick()
 const offer=await adapter.claimWork('s','browser',true,'',{workContextVersion:1,appendContextVersion:1,complete:true,chatId:'c',stateRevision:browser.stateRevision,lifecycleRevision:0,messageCount:rows})
 assert.ok(offer.event.context.contextDelta)
 assert.equal(fullReads,0,'settlement must not load full history')
 assert.ok(visits<=(append ? 512 : 256),`dispatch visited ${visits} indexed nodes`)
 assert.ok(JSON.stringify(offer).length<(append ? 65000 : 45000),JSON.stringify(offer).length)
 browser=helperClient.applyTavernVariableReceipt(browser,offer.event.context.contextDelta)
 assert.equal(browser.messages[1].message,'new history')
 if(append){assert.equal(browser.messages.length,rows+2);assert.equal(browser.turnMessageIds[String(rows+1)],rows+1)}
 gate.start('s',offer.event.id,offer.leaseToken,'browser')
 const recovered=await adapter.transactionContext('s',offer.event.id)
 assert.match(recovered.messages.at(-1).message, /UpdateVariable/,'a lost dispatch baseline recovers the command, not only the saved body')
 for(const index of [targetId,2]){
  const variables={stat_data:{hp:7,padding:'x'.repeat(4096)},schema:{}}
  const receipt=await adapter.updateVariables('s',{type:'message',message_id:index},variables,0,offer.event.id)
  assert.ok(receipt.contextDelta && !receipt.context)
  assert.ok(JSON.stringify(receipt).length<12000)
  browser=helperClient.applyTavernVariableReceipt(browser,receipt.contextDelta)
  assert.equal(browser.messages[index].variables.stat_data.hp,7)
 }
 gate.complete('s',offer.event.id,[targetId],'browser',offer.leaseToken)
 const result=await settlement
 assert.equal(result.context,undefined)
 assert.equal(result.variables.stat_data.hp,7)
 assert.equal((await persistence.read('c')).messages[2].variables[0].stat_data.hp,10,'draft did not leak')
 const completed=await task.commit({messageIndices:[2,targetId],stateChanged:true,apply(d,scope){applyMvuSettlementEffect(d,result.effect,scope);d.messages.at(-1).mvu={pending:false,receipt:{status:'updated'}}}})
 assert.equal(completed.status,'committed')
 assert.equal(fullUpdates,0,'commit must use a single scoped CAS, not full update')
 const disk=await createChatJournalStore({dataRoot:root}).read('c')
 assert.deepEqual(disk.timeline.checkpoints,Array.from({length:rows},(_,i)=>({id:'checkpoint-'+i,beforeRevision:i})),'scoped metadata must preserve historical rollback checkpoints')
 assert.equal(disk.messages[2].variables[0].stat_data.hp,7)
 assert.equal(disk.messages.at(-1).mvu.pending,false)
 assert.equal(disk.messages[0].displayRuntime.captured,true)
 assert.equal(disk.messages[3].variables[0].stat_data.hp,10)
 await assert.rejects(adapter.updateVariables('s',{type:'message',message_id:2},{},0,offer.event.id),/迟到/)
})

for(const reason of ['old-turn-change','old-client']) test(`append dispatch retains full fallback: ${reason}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'mvu-layout-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const db=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 const row=turn=>({role:'assistant',turn,text:'body',variables:[{stat_data:{hp:10},schema:{}}]})
 await db.write({id:'c',sessionId:'s',mvu:{enabled:true},messages:[row(1),row(2)]})
 const browser=projectTavernHelperContext(await db.read('c'))
 await db.update('c',c=>{if(reason==='old-turn-change')c.messages[0].turn=10;c.messages.push(row(3));return c})
 const gate=createTavernScriptDispatch();t.after(()=>gate.dispose('s'));gate.touch('s','browser',true)
 const adapter=createTavernScriptHostAdapter({resolveChat:()=>db.read('c'),writeChat:db.write,resolveSettlementBase:()=>db.readSettlementBase('c'),
  resolveChangedChatSlice:(_s,r)=>db.readChangedSlice('c',r),readCard:async()=>({}),worldBooks:{bound:async()=>null},scriptDispatch:gate})
 const pending=adapter.settleMvuUpdate({operationId:'test-layout',sessionId:'s',messageId:2,swipeId:0,compactResult:true,storyText:'body',command:'<UpdateVariable/>'})
 for(let tries=0;!gate.status('s').busy;tries++){assert.ok(tries<1000,'dispatch must become ready');await tick()}
 const offer=await adapter.claimWork('s','browser',true,'',{workContextVersion:1,appendContextVersion:1,complete:true,chatId:'c',stateRevision:browser.stateRevision,lifecycleRevision:0,messageCount:2,...(reason==='old-client'?{appendContextVersion:undefined}:{})})
 assert.equal(offer.event.context.contextDelta,undefined)
 assert.equal(offer.event.context.turnMessageIds[reason==='old-turn-change'?'10':'1'],0)
 assert.equal(offer.event.context.turnMessageIds['3'],2)
 gate.dispose('s');await assert.rejects(pending,/执行器已断开/)
})
