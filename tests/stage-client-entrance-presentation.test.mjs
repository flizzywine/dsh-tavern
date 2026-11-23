import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageEntrancePresentation}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/entrance-presentation.cjs')
test('entrance gate, skip and unload follow real React StrictMode lifecycle',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const timers=new Map(),frames=new Map(),ports=[],observers=[];let next=0,result
 dom.window.setTimeout=fn=>{timers.set(++next,fn);return next};dom.window.clearTimeout=id=>timers.delete(id)
 dom.window.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};dom.window.cancelAnimationFrame=id=>frames.delete(id)
 dom.window.ResizeObserver=class{constructor(fn){this.fn=fn;this.stops=0;observers.push(this)}observe(){}disconnect(){this.stops++}}
 const module=createStageEntrancePresentation({React,window:dom.window,renderer:{supported:()=>true,start(_canvas,_run,_size,onEvent){const port={onEvent,messages:[],stops:0,input(data){this.messages.push(data)},size(){},stop(){this.stops++}};ports.push(port);return port}},media:{},video:{},contract:{stageEntranceDuration:()=>300},safety:()=>({}),reading:{get:()=>({})}})
 const store={},entrance={document:{layers:{},phases:[],palette:{base:'#000000'},background:'base'}}
 function View({ready}){result=module.useEntrance(store,entrance,{phase:ready?'revealing':'loading',visible:false});return result.element}
 const root=createRoot(dom.window.document.getElementById('root'))
 const render=ready=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View,{ready}))))
 try{
  await render(false);assert.equal(ports.length,2);assert.equal(ports[0].stops,1);assert.equal(result.gate.visible,false)
  await act(async()=>ports[1].onEvent({type:'started'}));await render(true)
  await act(async()=>dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))
  assert.ok(ports[1].messages.some(m=>m.skip));assert.equal(dom.window.document.querySelector('.fork-gal-entrance').dataset.skip,'black')
  await act(async()=>ports[1].onEvent({type:'cover'}));assert.equal(result.stageAttr,'covered');assert.equal(result.gate.phase,'revealing')
  const lateFrames=[...frames.values()],lateEvent=ports[1].onEvent
  module.dispose();assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(ports[1].stops,1);assert.ok(observers.every(o=>o.stops===1))
  await act(async()=>{lateFrames.forEach(fn=>fn());lateEvent({type:'done'})})
  const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',cancelable:true});dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,false)
  assert.equal(result.stageAttr,'covered')
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
})
