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

const {BGM_STORAGE} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/bgm.cjs')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function leaveHarness(saved = {}, extraTracks = []) {
  const map = new Map(Object.entries(saved)), calls = []
  let identity = null, current = '', paused = true
  const music = {get:() => ({identity,current,paused}), play:(url,snap,id) => {calls.push(['play',id]);identity=id;current=url;paused=false;return new Promise(() => {})},
    pause:() => {calls.push(['pause']);paused=true}, resume:() => {calls.push(['resume']);paused=false}, stop:() => {identity=null;current='';paused=true}}
  const state = {settings:{config:{stage:{enabled:true,music:true}}},accepted:{music:{ref:{packId:'P',kind:'music',assetId:'a'},identity:'P:music:a:h',name:'A'}},
    source:{sessionId:'s',authorityEpoch:1},cursor:{mode:'live',skipping:false}}
  const store = {getSnapshot:() => state, select:fn => ({getSnapshot:() => fn(state),subscribe:() => () => {},dispose(){}})}
  const bgm = createBgmPlayer({music, session:() => store, authority:source => source.sessionId,
    storage:{getItem:key => map.has(key) ? map.get(key) : null, setItem:(key,value) => map.set(key,String(value)), removeItem:key => map.delete(key)},
    owner:() => ({retain:id => ({handle:{url:'blob:' + id},release(){}}), acquire:async item => ({handle:{url:'blob:' + item.identity},release(){}})}),
    clock:{setTimeout:fn => {fn();return 1},clearTimeout(){}},
    read:async () => ({tracks:[{ref:{packId:'P',kind:'music',assetId:'a'},identity:'P:music:a:h',name:'A',pack:'Pack',url:{resource:true,kind:'media',ref:{packId:'P',kind:'music',assetId:'a'},revision:'r1',hash:'h',identity:'P:music:a:h'}},...extraTracks]})})
  return {bgm, calls, map, plays:() => calls.filter(call => call[0] === 'play').map(call => call[1])}
}
// Every reopened stage chat used to start with its BGM paused: leaving the stage stored a pause.
test('leaving the stage holds the music for this page only; a reload plays again, the player\'s own pause is kept', async () => {
  const left = leaveHarness({'fork-bgm-sessions':JSON.stringify({s:{follow:true,manual:null,paused:true,at:1}})})
  assert.equal(left.map.has('fork-bgm-sessions'),false,'the v1 record with stored leave pauses is dropped')
  left.bgm.activate('s');await tick()
  assert.equal(left.bgm.get().paused,false);assert.deepEqual(left.plays(),['P:music:a:h'])
  left.bgm.away(true);await tick()
  assert.deepEqual(left.calls.at(-1),['pause']);assert.equal(left.bgm.get().paused,true,'the chip shows the hold')
  assert.equal(left.map.get(BGM_STORAGE),undefined,'the hold is not stored')
  left.bgm.kick();assert.deepEqual(left.calls.at(-1),['pause'],'a gesture in chat does not undo the hold')
  left.bgm.away(false);await tick()
  assert.deepEqual(left.calls.at(-1),['resume'],'opening the stage again resumes')
  left.bgm.away(true);await tick()
  const reload = leaveHarness(Object.fromEntries(left.map))
  reload.bgm.activate('s');await tick()
  assert.equal(reload.bgm.get().paused,false);assert.deepEqual(reload.plays(),['P:music:a:h'],'a reload is not a pause')
  reload.bgm.away(true);await tick();reload.bgm.pause(false);await tick()
  assert.deepEqual(reload.calls.at(-1),['resume'],'play in chat lifts the hold')
  reload.bgm.pause(true);await tick()
  const paused = leaveHarness(Object.fromEntries(reload.map))
  paused.bgm.activate('s');await tick()
  assert.equal(paused.bgm.get().paused,true,'the player\'s own pause survives a reload');assert.deepEqual(paused.plays(),[])
})


test('scene music takes the BGM channel and restores the previous choice on release', async () => {
  const ref = {packId:'P',kind:'music',assetId:'battle'}
  const track = {ref,identity:'battle',name:'Battle',url:{identity:'battle'}}
  const {bgm,plays} = leaveHarness({},[track])
  bgm.activate('s'); await tick()
  const owner = {}
  bgm.setScene('s',owner,ref); await tick()
  assert.deepEqual(plays(),['P:music:a:h','battle'])
  assert.equal(bgm.get().current.source,'scene')
  bgm.setScene('s',{},null); await tick()
  assert.equal(bgm.get().current.source,'scene')
  bgm.setScene('s',owner,null); await tick()
  assert.deepEqual(plays(),['P:music:a:h','battle','P:music:a:h'])
  bgm.dispose()
})
