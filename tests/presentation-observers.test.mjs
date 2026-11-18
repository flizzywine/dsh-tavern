import test from 'node:test'
import assert from 'node:assert/strict'
import {createPresentationObservers} from '../tavern-plugin/lib/domain/presentation-observers.js'
const tick = () => new Promise(resolve => setImmediate(resolve))

test('unregister cancels only its own active stream and releases observers',async()=>{
  const host=createPresentationObservers(),seen=[];let cancelled=0
  const off=host.register('one',{beginReply:()=>({update(){},cancel(){cancelled++}}),saved(){assert.fail('removed listener')}})
  host.register('two',{beginReply:()=>({update:text=>seen.push(text)})})
  const reply=host.openReply({sessionId:'game',turn:1});await tick()
  off();off();host.saved({});reply.append('continues');await tick()
  assert.equal(cancelled,1);assert.deepEqual(seen,['continues']);reply.finish(true);host.dispose()
})

test('a reply that stopped on its own tells each observer after its last snapshot; any other end does not',async()=>{
  const host=createPresentationObservers(),seen=[]
  host.register('stage',{beginReply:()=>({update:async text=>{await tick();seen.push(text)},finish:()=>seen.push('finish')})})
  const reply=host.openReply({sessionId:'game',turn:1});await tick()
  reply.append('a');reply.append('b');reply.finish(true,true);await tick();await tick();await tick()
  assert.deepEqual(seen,['a','ab','finish'])
  for (const end of [[true,false],[false,false]]) {
    seen.length=0
    const next=host.openReply({sessionId:'game',turn:2});await tick()
    next.append('c');next.finish(...end);await tick();await tick()
    assert.equal(seen.includes('finish'),false)
  }
  host.dispose()
})
