import test from 'node:test'
import assert from 'node:assert/strict'
import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createMvuWorkingCopy, projectMvuReceipt } from '../tavern-plugin/lib/domain/mvu-working-copy.js'

test('MVU working copy copies only touched floors and produces bounded receipts', () => {
  const chat = {id:'c',_storageRevision:5,messages:Array.from({length:400},(_,i)=>({text:'body',variables:[{stat_data:{hp:i,large:'x'.repeat(4096)}}]}))}
  const work = createMvuWorkingCopy(chat, 'e')
  work.touch(399).variables[0].stat_data.hp = 9
  assert.equal(work.chat.messages[0],chat.messages[0])
  assert.equal(chat.messages[399].variables[0].stat_data.hp,399)
  const receipt = projectMvuReceipt(work, [{messageId:399}])
  assert.ok(JSON.stringify(receipt).length < 12000)
  assert.equal(receipt.baseSequence,0)
  assert.equal(receipt.sequence,1)
})

test('transaction receipts are ordered independently of persisted revision', () => {
  const before={chatId:'c',stateRevision:5,lifecycleRevision:0,transaction:{eventId:'e',sequence:0},messages:[{message_id:0,variables:{hp:1}},{message_id:1,variables:{hp:2}}]}
  const delta={version:2,kind:'transaction',chatId:'c',stateRevision:5,lifecycleRevision:0,eventId:'e',baseSequence:0,sequence:1,messages:[{message_id:1,variables:{hp:9}}]}
  const after=helperClient.applyTavernVariableReceipt(before,delta)
  assert.equal(after.messages[1].variables.hp,9)
  assert.equal(after.messages[0],before.messages[0])
  assert.equal(helperClient.applyTavernVariableReceipt(after,delta),after)
  assert.equal(helperClient.applyTavernVariableReceipt(before,{...delta,baseSequence:1,sequence:2}),null)
  assert.equal(helperClient.applyTavernVariableReceipt(before,{...delta,eventId:'old'}),before)
})

test('real iframe dispatch delta preserves MVU character identity and synchronizes only changed rows', async () => {
  const initial={chatId:'c',stateRevision:5,lifecycleRevision:0,characterName:'测试卡',messages:[{message_id:0,role:'assistant',message:'history',swipes:['history'],variables:{stat_data:{hp:10}}},{message_id:1,role:'assistant',message:'body',swipes:['body'],variables:{stat_data:{hp:10}}}]}
  const run=helperHostHarness(initial)
  const historical=run.window.SillyTavern.getContext().chat[0]
  run.receive({type:'dsh-tavern-helper-context',contextDelta:{version:2,kind:'dispatch',chatId:'c',lifecycleRevision:0,baseRevision:5,stateRevision:5,eventId:'e',messageCount:2,header:{},messages:[{...initial.messages[1],message:'body + update'}]}})
  await new Promise(r=>setImmediate(r))
  const latest=run.window.getChatMessages(1)[0]
  assert.equal(latest.name,run.window.SillyTavern.name2)
  assert.equal(latest.message,'body + update')
  assert.equal(run.window.SillyTavern.getContext().chat[0],historical)
  run.receive({type:'dsh-tavern-helper-context',contextDelta:{version:2,kind:'transaction',chatId:'c',lifecycleRevision:0,stateRevision:5,eventId:'e',baseSequence:0,sequence:1,messages:[{...initial.messages[1],variables:{stat_data:{hp:9}}}]}})
  await new Promise(r=>setImmediate(r))
  assert.equal(run.window.getVariables({type:'message',message_id:1}).stat_data.hp,9)
  assert.equal(run.window.SillyTavern.getContext().chat[0],historical)
})

test('parent defers committed refresh during a transaction and never publishes draft mutations',async t=>{
 const listeners={},sent=[],mutations=[];let frame
 const hostWindow={crypto:{randomUUID:()=> 'transaction-test'},setTimeout,clearTimeout,addEventListener(name,fn){listeners[name]=fn},removeEventListener(){}}
 const root={isConnected:true,appendChild(){},remove(){}}
 const document={body:{appendChild(){}},createElement(tag){if(tag==='div')return root;return frame={contentWindow:{postMessage(m){sent.push(m)}},listeners:{},addEventListener(n,fn){this.listeners[n]=fn},remove(){}}}}
 const initial={chatId:'c',stateRevision:5,lifecycleRevision:0,messages:[{message_id:0,role:'assistant',message:'body',variables:{hp:10}}]}
 const delta={version:2,kind:'transaction',chatId:'c',stateRevision:5,lifecycleRevision:0,eventId:'e',baseSequence:0,sequence:1,messages:[{...initial.messages[0],variables:{hp:9}}]}
 const runtime=helperClient.createTavernHelperScriptRuntime({window:hostWindow,document,mutationCoalesceMs:0,rpc:async()=>({updated:true,transactional:true,contextDelta:delta}),reportError(){},resolveError(){},onMutation(...args){mutations.push(args)}})
 t.after(()=>runtime.dispose())
 const view={chatId:'c',tavernHelper:initial,tavernHelperScripts:[{id:'a',content:'void 0'}]}
 runtime.sync('s',view);frame.listeners.load()
 const send=data=>listeners.message({source:frame.contentWindow,data:{token:'transaction-test',...data}})
 send({type:'dsh-tavern-helper-subscriptions',ready:true,names:['MESSAGE_RECEIVED']})
 const pending=runtime.emit('MESSAGE_RECEIVED',[0],{...initial,transaction:{eventId:'e',sequence:0}},[],'e')
 runtime.sync('s',{...view,tavernHelper:{...initial,stateRevision:6}})
 assert.equal(runtime.inspect().contextBaseline.transaction.eventId,'e')
 send({type:'dsh-tavern-helper-call',method:'updateTavernHelperVariables',requestId:'1',eventId:'e',args:{option:{type:'message',message_id:0},variables:{hp:9}},scriptId:'a',lifecycleRevision:0})
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r))
 assert.equal(runtime.inspect().contextBaseline.transaction.sequence,1)
 assert.equal(mutations.length,0)
 send({type:'dsh-tavern-helper-event-complete',eventId:'e',args:[0]})
 await pending
 assert.equal(runtime.inspect().contextBaseline.transaction,undefined)
 assert.equal(runtime.inspect().contextBaseline.stateRevision,6)
})
