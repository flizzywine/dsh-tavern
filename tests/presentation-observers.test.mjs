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
