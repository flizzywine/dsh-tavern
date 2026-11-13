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
test('multi-actor choices default to featured tab and switch across actor and global tabs',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
 const previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const h=React.createElement,document=dom.window.document,sends=[]
 const getComputedStyle=()=>({getPropertyValue:()=>'0'})
 const view=createStageChoices({React,window:dom.window,document,layout:createStageChoiceLayout({React,getComputedStyle}),sounds:{play(){}},useSounds(){},episode:()=>({first:0,start:0}),waitLines:['wait'],TextArea:()=>h('textarea'),Icon:()=>null,StageWaitStop:()=>null,StageWaitLines:()=>null,getComputedStyle,setTimeout,clearTimeout,requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
 const root=createRoot(document.getElementById('root'))
 const choices=[
  {type:'action',actor:'凛',text:'凛拉开拉门看向外侧'},
  {type:'action',actor:'凛',text:'凛故意压低声音试探'},
  {type:'action',actor:'我',text:'我退回走廊拐角'},
  {type:'action',actor:'我',text:'我推门走进去'},
  {type:'event',text:'走廊尽头传来脚步声'},
  {type:'scene',text:'时间来到深夜'}
 ]
 const props={sessionId:'s',messageId:'m2',panel:{phase:'ready',choices},running:false,decode:String,commands:{clear(){},generate(){},stop(){}},executeSlash:async(...args)=>sends.push(args)}
 try{
  await act(async()=>root.render(h(view.Choices,props)))
  const tabs=[...document.querySelectorAll('.fork-gal-choice-tab')]
  assert.deepEqual(tabs.map(el=>el.querySelector('.fork-gal-choice-tab-label').textContent),['精选','凛','我','全局'])
  assert.equal(tabs[0].getAttribute('aria-selected'),'true')
  assert.equal(document.querySelectorAll('.fork-gal-choice[data-index]').length,6)
  await act(async()=>tabs[3].click())
  assert.equal(document.querySelectorAll('.fork-gal-choice[data-index]').length,2)
  await act(async()=>document.querySelector('[data-index="0"] .fork-gal-choice-main').click())
  assert.deepEqual(sends,[['/send 【突发事件】走廊尽头传来脚步声|/trigger','s']])
 }finally{
  await act(async()=>root.unmount());view.dispose();dom.window.close()
  ;[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous
 }
})
