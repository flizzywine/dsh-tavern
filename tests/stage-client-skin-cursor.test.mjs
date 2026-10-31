import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageSkinCursor}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-cursor.cjs')
function fixture(fail=false){
 const timers=new Map(),listeners=new Set();let id=0,draws=0,restores=0
 const ctx={clearRect(){draws++},save(){},restore(){restores++},beginPath(){if(fail)throw Error('paint')},moveTo(){},lineTo(){},fill(){}}
 const motion={matches:false,addEventListener(_,fn){listeners.add(fn)},removeEventListener(_,fn){listeners.delete(fn)}}
 const view=createStageSkinCursor({matchMedia:()=>motion,clock:{setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(id){timers.delete(id)}}})
 return {view,timers,listeners,canvas:{getContext:()=>ctx},draws:()=>draws,restores:()=>restores}
}
test('cursor releases each mount and ignores delayed timer and media callbacks',()=>{
 const f=fixture(),stop=f.view.mount(f.canvas,{active:true})
 const late=[...f.timers.values()][0],change=[...f.listeners][0]
 assert.equal(f.timers.size,1)
 stop();const draws=f.draws();late();change()
 assert.equal(f.draws(),draws)
 assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0)
 f.view.mount(f.canvas,{active:true});f.view.mount(f.canvas,{active:true})
 assert.equal(f.listeners.size,2)
 f.view.dispose();f.view.dispose()
 assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0)
 f.view.mount(f.canvas,{active:true});assert.equal(f.timers.size,0)
})
test('static history cursor does not schedule and failed drawing rolls back',()=>{
 const still=fixture();still.view.mount(still.canvas,{active:true,snap:true})
 assert.equal(still.timers.size,0);still.view.dispose()
 const broken=fixture(true)
 assert.throws(()=>broken.view.mount(broken.canvas,{active:true}),/paint/)
 assert.equal(broken.listeners.size,0);assert.equal(broken.timers.size,0)
 assert.equal(broken.restores(),1)
})
