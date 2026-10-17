import test from 'node:test'
import assert from 'node:assert/strict'
import { helperHostHarness } from "./fixtures/helper-host-harness.mjs"

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

test('real iframe accepts an append dispatch and preserves synchronous historical reads',async()=>{
 const initial={chatId:'append',stateRevision:1,lifecycleRevision:0,turnMessageIds:{1:0},messages:[{message_id:0,role:'assistant',message:'old',variables:{stat_data:{hp:10}}}]}
 const run=helperHostHarness(initial)
 run.receive({type:'dsh-tavern-helper-context',contextDelta:{version:2,kind:'dispatch',chatId:'append',baseRevision:1,stateRevision:2,lifecycleRevision:0,eventId:'append-event',messageCount:2,header:{},turnMessageIdChanges:[['2',1]],messages:[{message_id:1,role:'assistant',message:'new',variables:{stat_data:{hp:9}}}]}})
 await new Promise(r=>setImmediate(r))
 assert.equal(run.window.getChatMessages(0)[0].message,'old')
 assert.equal(run.window.getChatMessages(1)[0].message,'new')
 assert.equal(run.window.getVariables({type:'message',message_id:1}).stat_data.hp,9)
 assert.equal(run.calls().length,0,'append must not fall back to fetching a full context')
})
