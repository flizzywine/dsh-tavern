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

// An observer whose initializer is still running when the request ends (bug:stage-voice-no-play).
function lateObserver() {
  const host=createPresentationObservers(),seen=[],gate={};let lifetime
  const ready=new Promise(resolve=>{gate.open=resolve})
  host.register('late',{beginReply:async(_s,_t,signal)=>{lifetime=signal;await ready;return {update:text=>seen.push(['update',text]),finish:()=>seen.push(['finish']),cancel:()=>seen.push(['cancel'])}}})
  return {host,seen,open:gate.open,aborted:()=>lifetime.aborted,reply:host.openReply({sessionId:'game',turn:1})}
}

test('a late observer after a stopped reply gets its whole text and finish, not a cancel',async()=>{
  const late=lateObserver();await tick()
  late.reply.append('one ');late.reply.append('two');late.reply.finish(true,true)
  assert.equal(late.aborted(),false,'a successful request does not end the work it admitted')
  late.open();await tick();await tick()
  assert.deepEqual(late.seen,[['update','one two'],['finish']]);late.host.dispose()
})

test('a late observer after a tool-call step gets the text so far and stays open',async()=>{
  const late=lateObserver();await tick()
  late.reply.append('before the tool');late.reply.finish(true,false)
  late.open();await tick();await tick()
  assert.deepEqual(late.seen,[['update','before the tool']]);late.host.dispose()
})

test('a late observer after a cancelled or failed request is released without text',async()=>{
  for(const end of [reply=>reply.cancel(),reply=>reply.finish(false)]){
    const late=lateObserver();await tick()
    late.reply.append('partial');end(late.reply)
    assert.equal(late.aborted(),true)
    late.open();await tick();await tick()
    assert.deepEqual(late.seen,[['cancel']]);late.host.dispose()
  }
})
