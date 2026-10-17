import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettlementJobs } from '../tavern-plugin/lib/domain/settlement-jobs.js'
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

test('shutdown aborts running work, blocks future work and finally notifications',async()=>{
  const started=gate(),end=gate();let signal,wakes=0,executions=0
  const jobs=createSettlementJobs({run:async(_id,s)=>{signal=s;executions++;started.resolve();await end.promise;s.throwIfAborted()},onSettled:()=>{wakes++}})
  const pending=jobs.start('c');await started.promise
  jobs.dispose();assert.equal(signal.aborted,true);end.resolve()
  await assert.rejects(pending,{name:'AbortError'})
  await jobs.start('c');assert.equal(executions,1);assert.equal(wakes,0)
})
test('cancelled old execution cannot remove or wake a replacement execution',async()=>{
  const old=gate(),next=gate();let count=0,wakes=0
  const jobs=createSettlementJobs({run:async()=>{await (++count===1?old.promise:next.promise)},onSettled:()=>{wakes++}})
  const first=jobs.start('c');await Promise.resolve()
  await jobs.cancel('c',{wait:false})
  const second=jobs.start('c');await Promise.resolve()
  old.resolve();await first
  assert.equal(jobs.start('c'),second);assert.equal(wakes,0)
  next.resolve();await second;assert.equal(wakes,1);jobs.dispose()
})

test('shutdown also aborts an asynchronous completion notification after run finished',async()=>{
  const entered=gate(),end=gate();let wakes=0
  const jobs=createSettlementJobs({run:async()=>{},onSettled:async(_id,signal)=>{
    entered.resolve();await end.promise;if(!signal.aborted)wakes++
  }})
  const pending=jobs.start('c');await entered.promise;jobs.dispose();end.resolve();await pending
  assert.equal(wakes,0)
})
test('pending exposes the running job and settles even when it fails',async()=>{
  const end=gate()
  const jobs=createSettlementJobs({run:async()=>{await end.promise;throw new Error('x')},onSettled:()=>{}})
  assert.equal(jobs.pending('c'),null)
  const running=jobs.start('c');const waiting=jobs.pending('c')
  end.resolve();await assert.rejects(running);await waiting
  assert.equal(jobs.pending('c'),null);jobs.dispose()
})
