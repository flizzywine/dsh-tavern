import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createBgmPlayer} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/bgm.cjs')
test('disposed BGM ignores a late track list and cannot reactivate', async () => {
  let resolveList, reads = 0, selected = 0, stopped = 0, notifications = 0
  const player = createBgmPlayer({
    music:{get:() => ({}),stop:() => stopped++},
    session:() => {selected++;return null},
    read:() => {reads++;return new Promise(resolve => {resolveList=resolve})},
  })
  player.subscribe(() => notifications++)
  player.activate('s')
  assert.equal(player.get().loading,true)
  player.dispose();player.dispose()
  const before = notifications
  resolveList({tracks:[{ref:{packId:'p',assetId:'a'},name:'late'}]})
  await Promise.resolve();await Promise.resolve()
  player.activate('new')
  player.invalidate()
  player.follow(false)
  assert.equal(notifications,before)
  assert.equal(reads,1)
  assert.equal(selected,1)
  assert.equal(stopped,1)
  assert.deepEqual(player.acquirePerformance({}),{status:'stale'})
})
test('BGM disposal clears every owner despite selector, listener, audio and pin failures', async () => {
  const cleaned = []
  const state = {settings:{config:{stage:{enabled:true}}},cursor:{},source:{}}
  const player = createBgmPlayer({
    music:{get:() => ({}),play:() => new Promise(() => {}),stop:() => {cleaned.push('audio');throw Error('audio')}},
    session:() => ({select:select => ({getSnapshot:() => select(state),subscribe(){},dispose(){cleaned.push('selector');throw Error('selector')}})}),
    authority:() => 'auth',
    owner:() => ({retain:identity => ({handle:{url:identity},release(){cleaned.push(identity);if(identity === 'first') throw Error('pin')}})}),
    read:() => new Promise(() => {}),
  })
  player.activate('s')
  const acquire = identity => player.acquirePerformance({sessionId:'s',authority:'auth',instanceKey:identity,token:{instanceKey:identity},track:{identity,ref:{packId:'p',assetId:identity}}})
  acquire('first')
  const second = acquire('second')
  player.subscribePerformance(() => {cleaned.push('listener1');throw Error('listener')})
  player.subscribePerformance(() => cleaned.push('listener2'))
  assert.throws(() => player.dispose(),AggregateError)
  assert.deepEqual(cleaned,['selector','listener1','listener2','audio','first','second'])
  assert.equal(second.handle.update({}),false)
  assert.equal(second.handle.release({token:{instanceKey:'second'}}),false)
  assert.equal(player.get().sessionId,null)
  assert.equal(player.get().available,false)
  player.dispose();player.activate('s');player.kick()
  assert.equal(cleaned.length,6)
})
