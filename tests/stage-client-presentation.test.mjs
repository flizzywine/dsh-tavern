import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStagePresentation} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/presentation.cjs')
test('phone bar layout releases observers and ignores queued notifications after unmount', () => {
  let effect, disconnected=0, writes=0
  const callbacks=[], properties=new Map()
  const bar={children:[{getBoundingClientRect:()=>({width:80})},{getBoundingClientRect:()=>({width:60})}],clientWidth:100,
    style:{removeProperty:key=>properties.delete(key),setProperty:(key,value)=>{writes++;properties.set(key,value)}}}
  const Observer=class {constructor(fn){callbacks.push(fn)} observe(){} disconnect(){disconnected++}}
  const views=createStagePresentation({React:{useLayoutEffect:fn=>{effect=fn}},ResizeObserver:Observer,MutationObserver:Observer,
    getComputedStyle:()=>({display:'block',position:'static',marginLeft:'0',marginRight:'0',paddingLeft:'0',paddingRight:'0'})})
  views.useTopbarGroup(bar,true)
  const cleanup=effect()
  assert.equal(properties.get('--fk-bar-group'),'80px')
  cleanup()
  callbacks.forEach(fn=>fn())
  assert.equal(properties.size,0)
  assert.equal(writes,1)
  assert.equal(disconnected,2)
})
