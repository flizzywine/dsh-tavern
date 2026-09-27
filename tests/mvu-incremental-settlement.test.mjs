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

for(const rows of [20,400]) test(`MVU ${rows} floors: bounded wire and atomic scoped commit including historical edits`,async t=>{
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
 await persistence.update('c',d=>{d.messages[1].text='new history';return d})
 visits=0
 const settlement=adapter.settleMvuUpdate({operationId:task.operationId,branchId:task.basedOn.branchId,basedOnRevision:task.basedOn.revision,
  sessionId:'s',messageId:rows-1,swipeId:0,compactResult:true,storyText:'body',command:'<UpdateVariable/>',baselineVariables:browser.messages.at(-1).variables})
 while(!gate.status('s').busy) await tick()
 const offer=await adapter.claimWork('s','browser',true,'',{workContextVersion:1,complete:true,chatId:'c',stateRevision:browser.stateRevision,lifecycleRevision:0,messageCount:rows})
 assert.ok(offer.event.context.contextDelta)
 assert.equal(fullReads,0,'settlement must not load full history')
 assert.ok(visits<=256,`dispatch visited ${visits} indexed nodes`)
 assert.ok(JSON.stringify(offer).length<45000,JSON.stringify(offer).length)
 browser=helperClient.applyTavernVariableReceipt(browser,offer.event.context.contextDelta)
 assert.equal(browser.messages[1].message,'new history')
 gate.start('s',offer.event.id,offer.leaseToken,'browser')
 const recovered=await adapter.transactionContext('s',offer.event.id)
 assert.match(recovered.messages.at(-1).message, /UpdateVariable/,'a lost dispatch baseline recovers the command, not only the saved body')
 for(const index of [rows-1,2]){
  const variables={stat_data:{hp:7,padding:'x'.repeat(4096)},schema:{}}
  const receipt=await adapter.updateVariables('s',{type:'message',message_id:index},variables,0,offer.event.id)
  assert.ok(receipt.contextDelta && !receipt.context)
  assert.ok(JSON.stringify(receipt).length<12000)
  browser=helperClient.applyTavernVariableReceipt(browser,receipt.contextDelta)
  assert.equal(browser.messages[index].variables.stat_data.hp,7)
 }
 gate.complete('s',offer.event.id,[rows-1],'browser',offer.leaseToken)
 const result=await settlement
 assert.equal(result.context,undefined)
 assert.equal(result.variables.stat_data.hp,7)
 assert.equal((await persistence.read('c')).messages[2].variables[0].stat_data.hp,10,'draft did not leak')
 const completed=await task.commit({messageIndices:[2,rows-1],stateChanged:true,apply(d,scope){applyMvuSettlementEffect(d,result.effect,scope);d.messages.at(-1).mvu={pending:false,receipt:{status:'updated'}}}})
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

test('expired offer cannot deliver a context after asynchronous projection',async t=>{
 const gate=createTavernScriptDispatch();t.after(()=>gate.dispose('s'));gate.touch('s','browser',true)
 let release
 const prepared=new Promise(r=>{release=r})
 const result=gate.dispatch('s','MESSAGE_RECEIVED',[0],null,{contextForBaseline:()=>prepared})
 const offered=gate.claimWithContext('s','browser',true)
 gate.dispose('s','browser')
 release({chatId:'c',messages:[]})
 assert.equal((await offered).event,null)
 assert.equal((await result).disposed,true)
})
