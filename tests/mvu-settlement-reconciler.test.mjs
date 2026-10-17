import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementReconciler } from '../tavern-plugin/lib/domain/mvu-settlement-reconciler.js'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('任务已持久化但全部就绪通知丢失时仍自动接续', async () => {
  const scheduled = []
  let ready = false, pending = true, resumed = 0
  const reconciler = createMvuSettlementReconciler({ list: async () => [], resolve: async () => ({ id: 'c', pending }),
    shouldResume: chat => chat.pending, isReady: () => ready,
    resume: async () => { resumed++; pending = false },
    schedule: fn => { scheduled.push(fn); return scheduled.length }, cancel() {} })
  await reconciler.wake('s')
  assert.equal(scheduled.length, 1)
  ready = true
  await scheduled.shift()()
  assert.equal(resumed, 1)
  reconciler.dispose()
})

test('dispose aborts resume adapter and suppresses the post-resume read',async()=>{
  const entered=deferred(),end=deferred();let reads=0,signal
  const r=createMvuSettlementReconciler({list:async()=>[],resolve:async()=>{reads++;return {id:'c',pending:true}},
    shouldResume:c=>c.pending,isReady:()=>true,resume:async(_id,context)=>{signal=context.signal;entered.resolve();await end.promise}})
  const running=r.wake('s');await entered.promise;r.dispose();end.resolve();await running
  assert.equal(signal.aborted,true);assert.equal(reads,1)
})
test('cancelled timer callbacks cannot start another check after a ready wake',async()=>{
  const timers=[];let ready=false,pending=true,reads=0,resumes=0
  const r=createMvuSettlementReconciler({list:async()=>[],resolve:async()=>{reads++;return {id:'c',pending}},
    shouldResume:c=>c.pending,isReady:()=>ready,resume:async()=>{resumes++;pending=false},
    schedule:fn=>{timers.push(fn);return timers.length},cancel(){}})
  await r.wake('s');ready=true;await r.wake('s')
  const before=reads;await timers[0]()
  assert.equal(reads,before);assert.equal(resumes,1);r.dispose()
})
