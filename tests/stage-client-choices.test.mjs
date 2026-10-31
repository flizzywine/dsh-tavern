import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageChoices}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/choices.cjs')
const {createStageChoiceLayout}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/choice-layout.cjs')
test('choices send through host and cancel delayed picks when unloaded',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
 const previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const h=React.createElement,document=dom.window.document,sends=[],timers=new Map();let id=0,delay=0
 const getComputedStyle=()=>({getPropertyValue:()=>String(delay)})
 const view=createStageChoices({React,window:dom.window,document,layout:createStageChoiceLayout({React,getComputedStyle}),sounds:{play(){}},useSounds(){},episode:()=>({first:0,start:0}),waitLines:['wait'],TextArea:()=>h('textarea'),Icon:()=>null,StageWaitStop:()=>null,StageWaitLines:()=>null,getComputedStyle,setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(id){timers.delete(id)},requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
 const root=createRoot(document.getElementById('root')),fallbackRef={current:null}
 const props={sessionId:'s',messageId:'m',panel:{phase:'ready',choices:[{text:'hello|world'}]},running:false,decode:String,commands:{clear(){},generate(){},stop(){}},executeSlash:async(...args)=>sends.push(args),fallbackRef}
 try{
  await act(async()=>root.render(h(React.StrictMode,null,h(view.Choices,props))))
  await act(async()=>document.querySelector('[data-index="0"] .fork-gal-choice-main').click())
  assert.deepEqual(sends,[['/send hello｜world|/trigger','s']])
  delay=250
  await act(async()=>document.querySelector('[data-index="0"] .fork-gal-choice-main').click())
  assert.equal(timers.size,1);const late=[...timers.values()][0],fallback=fallbackRef.current
  view.dispose();late()
  assert.equal(fallback('late'),false);assert.equal(fallbackRef.current,null)
  assert.equal(timers.size,0);assert.equal(sends.length,1)
 }finally{
  await act(async()=>root.unmount());view.dispose();dom.window.close()
  ;[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous
 }
})
