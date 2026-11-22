// The stage on the Windows Desktop (data-windows-titlebar on <html>) asks for full screen when it stands, also when it
// comes back without a click (a reload), so the native caption buttons stay hidden; a plain browser does not ask, and a
// stage already in full screen does not ask again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import * as ReactDOM from 'react-dom'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageViews}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/views.cjs')
function signal(value){const listeners=new Set();return {get:()=>value,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},set(next){value=next;for(const fn of listeners)fn()}}}

async function mountStage({titlebar,full=false}){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://example.test'}),{window}=dom,document=window.document
  const before={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window,document,IS_REACT_ACT_ENVIRONMENT:true})
  if(titlebar)document.documentElement.setAttribute('data-windows-titlebar','')
  if(full)Object.defineProperty(document,'fullscreenElement',{value:document.documentElement,configurable:true})
  let asked=0
  document.documentElement.requestFullscreen=async()=>{asked++}
  const active=signal('s'),enabled=signal(true)
  const navigation={galStageAvailable:enabled,galActive:active,galMenuRequest:{request(){}},galEscapeLock(){},galHandoverEnd(){},galEnter:id=>active.set(id),
    galCoverChat(){},galUncover(){},galLeave(){},galLeaveNow(){active.set('')}}
  const views=createStageViews({React,ReactDOM,window,document,navigation,GalStage:()=>React.createElement('div',{'data-stage-content':true}),Icon:()=>null,
    useBubbles:()=>({cardPath:'card',config:{enabled:true}}),useGalEntryLoader:()=>'ready'})
  const root=createRoot(document.getElementById('app'))
  // The stage is already the active session when the page mounts, as after a reload: no click opened it.
  await act(async()=>root.render(React.createElement(views.Host,{sessionId:'s'})))
  const stood=!!document.querySelector('[data-stage-content]')
  views.dispose();act(()=>root.unmount());window.close()
  Object.assign(globalThis,{window:before.window,document:before.document,IS_REACT_ACT_ENVIRONMENT:before.act})
  return {asked,stood}
}

test('a plain browser is not asked without a click, and a stage already in full screen does not ask again',async()=>{
  assert.equal((await mountStage({titlebar:false})).asked,0)
  assert.equal((await mountStage({titlebar:true,full:true})).asked,0)
})
