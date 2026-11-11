import test from 'node:test'
import assert from 'node:assert/strict'
import {createConversationReadLanes,withConversationReadLane,conversationReadLane} from '../tavern-plugin/lib/domain/conversation-read-lanes.js'
import {createDecodedJsonCache} from '../tavern-plugin/lib/domain/incremental-json-state.js'

const deferred = () => {let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve}}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('joining a decoded recovery subtree promotes queued and subsequent physical reads', async () => {
  const schedule=createConversationReadLanes({concurrency:2}), cache=createDecodedJsonCache(), gate=deferred(), lanes=[]
  const occupied=schedule(()=>gate.promise,'background')
  const recovery=withConversationReadLane('background',()=>cache.load('shared',async()=>{
    await schedule(()=>lanes.push(conversationReadLane())).promise
    await schedule(()=>lanes.push(conversationReadLane())).promise
    return {value:42}
  }))
  await tick()
  assert.deepEqual(lanes,[])
  const player=cache.load('shared',()=>assert.fail('duplicate decode'))
  const result=await player
  assert.deepEqual(lanes,['foreground','foreground'])
  result.value=0
  assert.deepEqual(await recovery,{value:42})
  gate.resolve(); await occupied.promise
})

test('promotion follows an already pending nested decoder', {timeout:1000}, async t => {
  const schedule=createConversationReadLanes({concurrency:2}),cache=createDecodedJsonCache(),gate=deferred(),lanes=[]
  t.after(()=>gate.resolve())
  const occupied=schedule(()=>gate.promise,'background')
  const recovery=withConversationReadLane('background',()=>cache.load('outer',()=>cache.load('inner',async()=>{
    await schedule(lane=>lanes.push(lane)).promise
    await schedule(lane=>lanes.push(lane)).promise
    return {nested:true}
  })))
  await tick()
  assert.deepEqual(lanes,[])
  assert.deepEqual(await cache.load('outer',()=>assert.fail('duplicate outer decode')),{nested:true})
  assert.deepEqual(lanes,['foreground','foreground'])
  await recovery
  gate.resolve();await occupied.promise
})

test('recovery uses one physical read and queued foreground work wins the next slot', async () => {
  const schedule=createConversationReadLanes({concurrency:2}), gates=[deferred(),deferred(),deferred(),deferred()], started=[]
  const read=(id,lane) => schedule(async()=>{started.push(id); await gates[id].promise; return id},lane)
  const a=read(0,'background'), b=read(1,'background'), c=read(2,'foreground'), d=read(3,'foreground')
  await tick()
  assert.deepEqual(started,[0,2])
  gates[0].resolve(); await a.promise; await tick()
  assert.deepEqual(started,[0,2,3])
  gates[2].resolve(); gates[3].resolve(); await Promise.all([c.promise,d.promise]); await tick()
  assert.deepEqual(started,[0,2,3,1])
  gates[1].resolve(); assert.equal(await b.promise,1)
})

test('a foreground join promotes queued recovery work without duplicating the read', async () => {
  const schedule=createConversationReadLanes({concurrency:2}), gate=deferred(), started=[]
  const active=schedule(()=>gate.promise,'background')
  const shared=schedule(lane=>{assert.equal(lane,'foreground'); started.push('shared'); return 42},'background')
  await tick(); assert.deepEqual(started,[])
  shared.promote(); shared.promote()
  assert.equal(await shared.promise,42)
  assert.deepEqual(started,['shared'])
  gate.resolve(); await active.promise
})

test('failed reads release admission and background context does not leak into foreground requests', async () => {
  const schedule=createConversationReadLanes({concurrency:1}), failure=new Error('disk failure')
  const recovery=withConversationReadLane('background',()=>{
    assert.equal(conversationReadLane(),'background')
    return schedule(async()=>{await tick(); assert.equal(conversationReadLane(),'background'); throw failure})
  })
  assert.equal(conversationReadLane(),'foreground')
  const player=schedule(()=>{assert.equal(conversationReadLane(),'foreground'); return 17})
  await assert.rejects(recovery.promise,error=>error===failure)
  assert.equal(await player.promise,17)
})
