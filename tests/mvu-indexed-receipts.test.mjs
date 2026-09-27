import test from 'node:test'
import assert from 'node:assert/strict'
import { createIndexedArrayApi } from '../tavern-plugin/lib/domain/indexed-array.js'
import { helperClient } from './fixtures/helper-host-harness.mjs'
for (const count of [20,400,10000]) test(`warm browser receipt visits bounded nodes at ${count} floors`,()=>{
 let visits=0
 const api=createIndexedArrayApi({valid:r=>Boolean(r&&!r.stub),visit:()=>visits++})
 helperClient.applyTavernVariableReceipt.indexApi=api
 const before={chatId:'c',lifecycleRevision:0,stateRevision:5,transaction:{eventId:'e',sequence:0},messages:api.from(Array.from({length:count},(_,i)=>({message_id:i,message:'body',variables:{hp:10}})))}
 visits=0
 const after=helperClient.applyTavernVariableReceipt(before,{version:2,kind:'transaction',chatId:'c',lifecycleRevision:0,stateRevision:5,eventId:'e',baseSequence:0,sequence:1,messages:[{message_id:count-1,message:'body',variables:{hp:9}}]})
 assert.ok(visits<=64,`receipt visited ${visits} nodes`)
 assert.equal(after.messages[count-1].variables.hp,9)
 assert.equal(before.messages[count-1].variables.hp,10)
 assert.equal(before.messages[0],after.messages[0])
})

import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
test('iframe receipt leaves untouched plugin rows unvisited and preserves unsaved fields',async()=>{
 const initial={chatId:'c',stateRevision:5,lifecycleRevision:0,messages:Array.from({length:400},(_,i)=>({message_id:i,role:'assistant',message:'body',variables:{hp:10},pluginData:{custom:'old'}}))}
 const run=helperHostHarness(initial)
 run.receive({type:'dsh-tavern-helper-context',contextDelta:{version:2,kind:'dispatch',chatId:'c',lifecycleRevision:0,baseRevision:5,stateRevision:5,eventId:'e',messageCount:400,header:{},messages:[initial.messages[399]]}})
 await new Promise(r=>setImmediate(r))
 const row=run.window.SillyTavern.getContext().chat[0];let reads=0
 Object.defineProperty(row,'custom',{enumerable:true,configurable:true,get(){reads++;return 'unsaved'}})
 run.receive({type:'dsh-tavern-helper-context',contextDelta:{version:2,kind:'transaction',chatId:'c',lifecycleRevision:0,stateRevision:5,eventId:'e',baseSequence:0,sequence:1,messages:[{...initial.messages[399],variables:{hp:9}}]}})
 await new Promise(r=>setImmediate(r))
 assert.equal(reads,0,'receipt must not compare every historical plugin row')
 assert.equal(run.window.SillyTavern.getContext().chat[0],row)
 assert.equal(run.window.getVariables({type:'message',message_id:399}).hp,9)
})
