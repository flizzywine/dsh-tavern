import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createAmbience} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/ambience.cjs')
test('ambience unload releases late pins and cannot restart its player', async () => {
  let finish, changed, selectorDisposed = 0, disposed = 0, released = 0, played = 0
  const state = {accepted:{ambience:{version:1,layers:[{identity:'rain',slot:'weather',url:{resource:true}}]}},source:{turn:1},cursor:{}}
  const ambience = createAmbience({
    player:() => ({apply:() => played++,whenSettled:() => Promise.resolve(),stop(){},dispose:() => disposed++}),
    session:() => ({select:select => ({
      getSnapshot:() => select(state),subscribe:fn => {changed=fn},dispose:() => selectorDisposed++,
    })}),
    owner:() => ({acquire:() => new Promise(resolve => {finish=resolve})}),
    authority:source => source,
  })
  ambience.activate('s')
  assert.equal(played,1)
  ambience.dispose();ambience.dispose()
  finish({handle:{url:'blob:rain'},release:() => released++})
  await Promise.resolve()
  changed()
  ambience.activate('other')
  await ambience.present(state.accepted.ambience,true)
  ambience.performance({identity:'late'})
  assert.equal(played,1)
  assert.equal(disposed,1)
  assert.equal(released,1)
  assert.equal(selectorDisposed,1)
})

test('soundscape disposal continues across a failed mixer release and settles fades', async () => {
  const {createSoundscapePlayer} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/soundscape.cjs')
  const released = [], frames = new Set()
  let id = 0
  class Audio {
    constructor() {this.id=++id}
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    removeAttribute() {}
    load() {}
    play() {return Promise.resolve()}
  }
  const player = createSoundscapePlayer({
    Audio,now:() => 0,
    requestFrame:fn => {frames.add(fn);return fn},cancelFrame:fn => frames.delete(fn),
    mixer:{bind(){},level:() => 0,release:node => {released.push(node.id);if(node.id===1)throw new Error('mixer failure')}},
  })
  player.apply({version:1,layers:['place','weather'].map(slot => ({slot,identity:slot,url:'blob:'+slot,gain:1}))})
  const settled = player.whenSettled()
  assert.throws(() => player.dispose(),/cleanup failed/)
  await settled
  assert.deepEqual(released,[1,2])
  assert.equal(frames.size,0)
  assert.equal(player.snapshot().disposed,true)
  player.dispose()
  player.apply({version:1,layers:[{slot:'place',identity:'new',url:'blob:new',gain:1}]})
  assert.equal(id,2)
})
test('ambience disposal releases all pins even if subscription and audio cleanup fail', () => {
  const released = []
  const state = {accepted:{ambience:{layers:['a','b'].map(identity => ({identity,url:'blob:'+identity}))}},source:{},cursor:{}}
  const ambience = createAmbience({
    player:() => ({apply(){},whenSettled:() => Promise.resolve(),stop(){throw new Error('stop')},dispose:() => released.push('player')}),
    session:() => ({select:select => ({getSnapshot:() => select(state),subscribe(){},dispose(){throw new Error('subscription')}})}),
    owner:() => ({retain:identity => ({handle:{url:'blob:'+identity},release:() => {
      released.push(identity);if(identity==='a')throw new Error('pin')
    }})}),
    authority:source => source,
  })
  ambience.activate('s')
  assert.throws(() => ambience.dispose(),/cleanup failed/)
  assert.deepEqual(released,['a','b','player'])
  ambience.dispose()
})
