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
