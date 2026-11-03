import test from 'node:test'
import assert from 'node:assert/strict'
import {createJobs} from '../src/jobs.js'
const tick=()=>new Promise(setImmediate)
test('long warmup jobs survive five minutes, remain cancellable, and expire on the negotiated bound',async()=>{
  let now=0,signal
  const jobs=createJobs({now:()=>now,timeoutMs:()=>725000,resolveGrant:()=>({}),checkGrant:()=>{},ticket:()=>'',synthesize:(_input,options)=>{signal=options.signal;return new Promise(()=>{})}})
  const first=jobs.submit({},{principal:'test',scope:'test'});assert.equal(first.timeoutMs,725000)
  now=300001;assert.equal(jobs.poll(first.requestId,'test').state,'running');assert.equal(signal.aborted,false)
  now=729999;assert.equal(jobs.poll(first.requestId,'test').state,'running')
  now=730000;assert.throws(()=>jobs.poll(first.requestId,'test'),{code:'JOB_GONE'});assert.equal(signal.aborted,true)
  const second=jobs.submit({},{principal:'test',scope:'test'});jobs.cancel(second.requestId,'test');assert.equal(signal.aborted,true);jobs.dispose()
})
test('completed warmup job returns to the ordinary five-minute retention',async()=>{
  let now=0
  const jobs=createJobs({now:()=>now,timeoutMs:()=>725000,resolveGrant:()=>({}),checkGrant:()=>{},ticket:()=>'',synthesize:async()=>({key:'fixture'})})
  const job=jobs.submit({},{principal:'test',scope:'test'});await tick()
  assert.equal(jobs.poll(job.requestId,'test').state,'ready')
  now=300000;assert.throws(()=>jobs.poll(job.requestId,'test'),{code:'JOB_GONE'});jobs.dispose()
})
