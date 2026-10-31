import test from 'node:test'
import assert from 'node:assert/strict'
import {createReplyStreamObserver} from '../tavern-plugin/lib/domain/reply-stream-observer.js'
const deferred = () => {let resolve, reject;const promise = new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick = () => new Promise(resolve=>setImmediate(resolve))

test('slow initialization does not block text and receives the latest snapshot',async()=>{
  const gate=deferred(), seen=[]
  const stream=createReplyStreamObserver({begin:()=>gate.promise})
  stream.append('a');stream.append('b')
  gate.resolve({update:text=>seen.push(text)})
  await stream.ready
  assert.deepEqual(seen,['ab'])
  stream.finish(true)
})

test('async updates are serialized and coalesce without losing final text',async()=>{
  const gate=deferred(),seen=[]
  const stream=createReplyStreamObserver({begin:()=>({update:text=>{seen.push(text);return seen.length===1?gate.promise:undefined}})})
  await stream.ready
  stream.append('a');stream.append('b');stream.append('c');stream.finish(true)
  assert.deepEqual(seen,['a'])
  gate.resolve();await tick()
  assert.deepEqual(seen,['a','abc'])
})

for(const completed of [true,false])test(`late initialization after finish(${completed}) releases exactly once`,async()=>{
  const gate=deferred();let cancelled=0,updates=0
  const stream=createReplyStreamObserver({begin:()=>gate.promise})
  await tick();stream.append('text');stream.finish(completed)
  gate.resolve({update:()=>updates++,cancel:()=>cancelled++})
  await stream.ready;stream.cancel()
  assert.equal(cancelled,1);assert.equal(updates,0)
})

for(const asyncFailure of [true,false])test(`observer update failure is isolated (async=${asyncFailure})`,async()=>{
  let cancelled=0;const errors=[]
  const stream=createReplyStreamObserver({begin:()=>({update(){if(asyncFailure)return Promise.reject(new Error('broken'));throw new Error('broken')},cancel:()=>{cancelled++;return Promise.reject(new Error('cleanup'))}}),warn:error=>errors.push(error.message)})
  await stream.ready;stream.append('a');await tick();stream.append('b');stream.cancel()
  assert.equal(cancelled,1);assert.deepEqual(errors,['broken','cleanup'])
})

test('aborted requests never initialize, even with a failing diagnostic callback',async()=>{
  const controller=new AbortController();controller.abort();let began=0
  const stream=createReplyStreamObserver({signal:controller.signal,begin:()=>began++,warn:()=>{throw Error('logger')}})
  await stream.ready;assert.equal(began,0)
})

test('initialization rejection is contained even when diagnostics throw',async()=>{
  const stream=createReplyStreamObserver({begin:()=>Promise.reject(Error('init')),warn:()=>{throw Error('logger')}})
  await stream.ready;stream.append('still playing');stream.finish(true)
})
