import { announceHelperDocument } from './fixtures/helper-document-handshake.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createHelperChatDataHost } from './fixtures/helper-chat-data-host.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
const baseline = () => ({chatId:'c',stateRevision:4,lifecycleRevision:2,chatVariables:{old:1},messages:[{message_id:0,message:'old',variables:{hp:1}}]})
const delta = extra => ({version:1,chatId:'c',baseRevision:4,stateRevision:5,lifecycleRevision:2,chatVariables:{hp:2},...extra})

test('delta shares untouched history, preserves aliases and rejects discontinuities', () => {
 const before=baseline(), apply=helperClient.applyTavernVariableReceipt
 const after=apply(before,delta())
 assert.equal(after.messages,before.messages);assert.equal(before.chatVariables.old,1)
 assert.equal(after.chatVariables.hp,2)
 assert.equal(apply(before,delta({baseRevision:3})),null)
 assert.equal(apply(before,delta({lifecycleRevision:3})),null)
 assert.equal(apply(before,delta({chatId:'other'})),before)
 assert.equal(apply(before,delta({lifecycleRevision:1})),before)
 assert.equal(apply(after,delta()),after)
 before.messages[0].mes='old'
 const message=apply(before,delta({chatVariables:undefined,messageId:0,message:{message:'new',variables:{hp:8}}}))
 assert.equal(message.messages[0].mes,'new');assert.equal(before.messages[0].mes,'old')
})

test('old receipts and old full responses cannot restore state after a switch or newer revision', async () => {
 for(const change of [{chatId:'other'}, {lifecycleRevision:3}, {stateRevision:8}]){
  const run=helperHostHarness(baseline())
  const pending=run.window.replaceVariables({hp:2},{type:'chat'})
  run.receive({type:'dsh-tavern-helper-context',context:{...baseline(),...change,chatVariables:{fresh:true}}})
  run.reply(run.calls()[0],{updated:true,contextDelta:delta()})
  await pending
  assert.equal(run.window.getVariables({type:'chat'}).fresh,true)
  assert.equal(run.calls().length,1)
 }
 const run=helperHostHarness({...baseline(),stateRevision:8})
 const pending=run.window.replaceVariables({hp:2},{type:'chat'})
 run.reply(run.calls()[0],{updated:true,context:{...baseline(),chatVariables:{stale:true}}})
 await pending
 assert.equal(run.window.getVariables({type:'chat'}).stale,undefined)
})

test('read-only recovery failures reject the waiting caller', async () => {
 const run=helperHostHarness(baseline())
 const pending=run.window.replaceVariables({hp:2},{type:'chat'})
 run.reply(run.calls()[0],{updated:true,contextDelta:delta({baseRevision:5,stateRevision:6})})
 await tick()
 run.reply(run.calls()[1],'read failed',false)
 await assert.rejects(pending,/read failed/)
 assert.equal(run.calls().length,2)
})

for (const mismatch of [false,true]) test('parent runtime forwards compact receipts or resynchronizes without replay: '+mismatch,async()=>{
 const listeners={},sent=[],calls=[],mutations=[];let frame
 const hostWindow={crypto:{randomUUID:()=> 'receipt-test'},setTimeout,clearTimeout,addEventListener(name,fn){listeners[name]=fn},removeEventListener(){}}
 const root={isConnected:true,appendChild(){},remove(){}}
 const document={body:{appendChild(){}},createElement(tag){
  if(tag==='div')return root
  return frame={contentWindow:{postMessage(message){sent.push(message)}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn},remove(){}}
 }}
 const runtime=helperClient.createTavernHelperScriptRuntime({window:hostWindow,document,mutationCoalesceMs:0,
  async rpc(method){calls.push(method);return method==='getTavernHelperContext'
   ? {context:{...baseline(),stateRevision:6,chatVariables:{hp:2,concurrent:1}}}
   : {updated:true,contextDelta:delta(mismatch?{baseRevision:5,stateRevision:6}:{})}},
  reportError(){},resolveError(){},onMutation(id,method,result){mutations.push(result)}
 })
 runtime.sync('audit',{chatId:'c',tavernHelper:baseline(),tavernHelperScripts:[{id:'a',content:'void 0'}]})
 frame.listeners.load()
 announceHelperDocument(frame,listeners.message,'receipt-test')
 listeners.message({source:frame.contentWindow,data:{token:'receipt-test',type:'dsh-tavern-helper-subscriptions',ready:true,names:['MESSAGE_RECEIVED']}})
 await tick()
 listeners.message({source:frame.contentWindow,data:{token:'receipt-test',type:'dsh-tavern-helper-call',method:'updateTavernHelperVariables',requestId:'1',args:{option:{type:'chat'},variables:{hp:2}},scriptId:'a',lifecycleRevision:2}})
 await tick();await tick()
 const result=sent.find(m=>m.type==='dsh-tavern-helper-response').result
 assert.equal(calls.filter(m=>m==='updateTavernHelperVariables').length,1)
 assert.equal(calls.includes('getTavernHelperContext'),mismatch)
 assert.equal(!!result.contextDelta,!mismatch)
 assert.equal(!!result.context,mismatch)
 assert.equal(mutations.at(-1).context.chatVariables.hp,2)
 runtime.dispose()
})

test('compact receipts retain unsaved plugin data and stable chat references',async t=>{
 const host=await createHelperChatDataHost();t.after(host.cleanup)
 const invoke=host.invoke
 host.invoke=(method,args)=>method==='updateTavernHelperVariables'
  ? host.adapter.updateVariables(args.sessionId,args.option,args.variables,args.expectedLifecycleRevision,args.eventId,args.contextBaseline)
  : invoke(method,args)
 const run=await host.connect(), row=run.api.chat[0], chat=run.api.chat
 row.phone={draft:'unsaved'};run.api.chatMetadata.draft='metadata'
 for(const type of ['chat','message','script'])await run.window.replaceVariables({hp:8},{type,message_id:0,script_id:'a'})
 assert.equal(run.api.chat,chat);assert.equal(run.api.chat[0],row)
 assert.equal(row.phone.draft,'unsaved');assert.equal(run.api.chatMetadata.draft,'metadata')
 await run.api.saveChat()
 const saved=await host.open().read('audit')
 assert.equal(saved.messages[0].tavernPluginData.phone.draft,'unsaved')
 assert.equal(saved.tavernPluginMetadata.draft,'metadata')
})
