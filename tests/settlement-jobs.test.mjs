import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettlementJobs } from '../tavern-plugin/lib/domain/settlement-jobs.js'
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

test('pending exposes the running job and settles even when it fails',async()=>{
  const end=gate()
  const jobs=createSettlementJobs({run:async()=>{await end.promise;throw new Error('x')},onSettled:()=>{}})
  assert.equal(jobs.pending('c'),null)
  const running=jobs.start('c');const waiting=jobs.pending('c')
  end.resolve();await assert.rejects(running);await waiting
  assert.equal(jobs.pending('c'),null);jobs.dispose()
})
