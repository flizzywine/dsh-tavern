import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {galResolution,galResolutionSubscribe,galFollowResolution}=require('../tavern-plugin/shared/canvas-resolution.cjs')
const {stageEmptyPalette}=require('../tavern-plugin/shared/canvas-empty.cjs')
function globalValue(t,name,value) {
 const previous=Object.getOwnPropertyDescriptor(globalThis,name)
 Object.defineProperty(globalThis,name,{configurable:true,writable:true,value})
 t.after(()=>previous?Object.defineProperty(globalThis,name,previous):delete globalThis[name])
}
test('canvas resolution follows monitor changes and ignores callbacks after unsubscribe',t=>{
 const lists=[]
 globalValue(t,'matchMedia',query=>{
  const list={query,listener:null,addEventListener(_,fn){this.listener=fn},removeEventListener(_,fn){if(this.listener===fn)this.listener=null}}
  lists.push(list);return list
 })
 const app={renderer:{},resize(){this.resized=(this.resized||0)+1}}
 const stop=galFollowResolution(app),late=lists[0].listener
 late()
 assert.equal(app.resized,1)
 assert.equal(lists[0].listener,null)
 assert.equal(lists.length,2)
 stop();stop();late()
 assert.equal(app.resized,1)
 assert.equal(lists[1].listener,null)
 assert.equal(galResolution('high',3),3)
 assert.equal(galResolution('low',3),1)
 assert.equal(galResolution('high',0.5),1)
})
test('palette removes temporary probe when color resolution fails',t=>{
 let removed=0
 const probe={style:{},remove(){removed++}}
 globalValue(t,'document',{createElement:()=>probe})
 globalValue(t,'getComputedStyle',()=>{throw new Error('style unavailable')})
 assert.throws(()=>stageEmptyPalette({appendChild(){}}),/style unavailable/)
 assert.equal(removed,1)
})
