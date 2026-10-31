import test from 'node:test'
import assert from 'node:assert/strict'
import {createPresentationObservers} from '../tavern-plugin/lib/domain/presentation-observers.js'
import {createStageStoryObserver} from '../tavern-plugin/lib/stage-story-observer.js'
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}

test('save notifications isolate sync, async and logging failures from other owners',async()=>{
  const seen=[], host=createPresentationObservers({warn(){throw Error('logging')}})
  host.register('broken',{saved(){throw Error('sync')},patched(){return Promise.reject(Error('async'))}})
  host.register('healthy',{saved:chat=>seen.push(chat.id),patched:chat=>seen.push(chat.id)})
  host.saved({id:'saved'});host.patched({id:'patched'},[])
  await tick();assert.deepEqual(seen,['saved','patched']);host.dispose()
})

test('slow observer admission cannot block another observer or reply delivery',async()=>{
  const gate=deferred(), seen=[],host=createPresentationObservers();let cancelled=0
  host.register('slow',{beginReply:()=>gate.promise})
  host.register('fast',{beginReply:()=>({update:text=>seen.push(text)})})
  const reply=host.openReply({sessionId:'game',turn:1})
  reply.append('hello');await tick();assert.deepEqual(seen,['hello'])
  reply.finish(true);gate.resolve({update(){assert.fail('late update')},cancel(){cancelled++}})
  await tick();assert.equal(cancelled,1);host.dispose()
})

test('unregister cancels only its own active stream and releases observers',async()=>{
  const host=createPresentationObservers(),seen=[];let cancelled=0
  const off=host.register('one',{beginReply:()=>({update(){},cancel(){cancelled++}}),saved(){assert.fail('removed listener')}})
  host.register('two',{beginReply:()=>({update:text=>seen.push(text)})})
  const reply=host.openReply({sessionId:'game',turn:1});await tick()
  off();off();host.saved({});reply.append('continues');await tick()
  assert.equal(cancelled,1);assert.deepEqual(seen,['continues']);reply.finish(true);host.dispose()
})

test('no providers and non-story replies never initialize optional work',async()=>{
  const host=createPresentationObservers()
  host.openReply({}).append('ordinary')
  host.register('stage',{beginReply(){assert.fail('background must not activate')}})
  const reply=host.openReply({enabled:false});reply.append('text');reply.finish(true)
  await tick();host.dispose();assert.throws(()=>host.register('late',{}),/disposed/)
})

test('stage adapter leaves ordinary cards and metadata patches out of stage reads',async()=>{
  const adapter=createStageStoryObserver({chatHeaderForSession:async()=>({cardPath:'ordinary'}),dialogueBubbles:{read:async()=>({enabled:false})},
    readStageChat(){assert.fail('ordinary stage read')},chatPersistence:{readSceneImageState(){assert.fail('metadata read')}}})
  assert.equal(await adapter.beginReply('ordinary',1),null)
  await adapter.patched({id:'chat'},[{path:['title']}])
})

test('stage patch projection finishing after unregister cannot observe the old game',async()=>{
  const gate=deferred(),host=createPresentationObservers()
  const off=host.register('stage',createStageStoryObserver({chatPersistence:{readSceneImageState:()=>gate.promise},stageDirector:{observe(){assert.fail('disposed observer')}}}))
  host.patched({id:'old'},[{path:['messages',0,'text']}]);off();gate.resolve({messages:[]});await tick();host.dispose()
})
