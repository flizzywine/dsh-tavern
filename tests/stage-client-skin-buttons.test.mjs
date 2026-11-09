import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageSkinButtons}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-buttons.cjs')
test('skin button timer dock releases replaced plates and stops scheduling after unmount',()=>{
 let effect,frame=null,scheduled=0,disconnected=0
 const observed=new Set(),attrs=new Map(),styles=new Map(),callbacks=[]
 const makePlate=()=>({getBoundingClientRect:()=>({width:50,left:100,top:20,height:30})})
 const first=makePlate();let plate=first
 const timer={classList:{contains:()=>true},querySelector:()=>plate}
 const stage={children:[timer]}
 const layer={parentElement:stage,getBoundingClientRect:()=>({left:10,top:5}),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}}
 const Observer=class {constructor(fn){callbacks.push(fn)}observe(node){observed.add(node)}unobserve(node){observed.delete(node)}disconnect(){disconnected++}}
 const views=createStageSkinButtons({React:{createElement:(type,props,...children)=>({type,props,children}),useRef:()=>({current:layer}),useLayoutEffect:fn=>{effect=fn}},ResizeObserver:Observer,MutationObserver:Observer,
 foreground:{requestAnimationFrame:fn=>{frame=fn;return ++scheduled},cancelAnimationFrame(){frame=null}}})
 views.SkinButtons({buttons:[{action:'skip',dock:0}]})
 const cleanup=effect()
 assert.equal(styles.get('--dock-x'),'90px')
 assert.equal(observed.has(first),true)
 plate=makePlate();callbacks[1]();frame()
 assert.equal(observed.has(first),false)
 assert.equal(observed.has(plate),true)
 callbacks[0]();const late=frame
 cleanup();const count=scheduled
 callbacks.forEach(fn=>fn());late()
 assert.equal(scheduled,count)
 assert.equal(styles.size,0)
 assert.equal(attrs.size,0)
 assert.equal(disconnected,3)
})
