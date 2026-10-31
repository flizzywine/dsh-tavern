import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSkinFrame}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-frame.cjs')
const {createStageSkinShape}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-shape.cjs')
test('readout timers stop on disposal and ignore a queued tick',()=>{
 const timers=new Map();let id=0,writes=0,cleanup
 const React={useState:fn=>[fn(),()=>writes++],useEffect:fn=>{cleanup=fn()},createElement:()=>null}
 const frame=createStageSkinFrame({React,clock:{setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(id){timers.delete(id)}}})
 frame.Readout({readout:{label:'TIME'}})
 const tick=[...timers.values()][0]
 frame.dispose();tick();cleanup()
 assert.equal(writes,0);assert.equal(timers.size,0)
 assert.equal(frame.band({pattern:'rule',colors:['red','blue']},'bottom').boxShadow,'0 -4px 0 blue')
})
test('shape owns observers, resize, fonts and scheduled measurements',()=>{
 const listeners=new Set(),frames=new Map(),observers=[];let id=0,cleanup
 const events={addEventListener(_,fn){listeners.add(fn)},removeEventListener(_,fn){listeners.delete(fn)}}
 class Observer{constructor(fn){this.fn=fn;this.closed=false;observers.push(this)}observe(){}disconnect(){this.closed=true}}
 const span={closest:()=>({querySelector:()=>({textContent:'text'})}),querySelector:()=>({getBoundingClientRect:()=>({height:100})})}
 let writes=0
 const React={useRef:()=>({current:span}),useState:value=>[value,()=>writes++],useLayoutEffect:fn=>{cleanup=fn()},createElement:()=>null}
 const module=createStageSkinShape({React,window:events,document:{fonts:events,createRange:()=>({selectNodeContents(){},getClientRects:()=>[{left:0,right:40,top:0,bottom:20,width:40}]})},MutationObserver:Observer,ResizeObserver:Observer,clock:{requestAnimationFrame(fn){frames.set(++id,fn);return id},cancelAnimationFrame(id){frames.delete(id)}}})
 const shape={view:[0,0,100,100],boxes:[{parts:[]}]}
 module.Shape({shape,page:'page'})
 observers[0].fn();const late=[...frames.values()][0]
 assert.equal(frames.size,1)
 module.dispose();const previous=writes
 late();observers.forEach(observer=>observer.fn());cleanup()
 assert.equal(writes,previous);assert.equal(frames.size,0);assert.equal(listeners.size,0)
 assert.ok(observers.every(observer=>observer.closed))
})
