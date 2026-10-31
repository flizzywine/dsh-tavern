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
for(const fault of ['render','effect','loader'])test(`stage ${fault} failure preserves native chat and offers an independent exit`,async()=>{
 const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://example.test'}),{window}=dom,document=window.document
 const before={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(globalThis,{window,document,IS_REACT_ACT_ENVIRONMENT:true})
 const active=signal('s'),enabled=signal(true);let fail=true,chatUnmounts=0,generated=0,forced=0,covered=false
 const navigation={galStageAvailable:enabled,galActive:active,galMenuRequest:{request(){}},galEscapeLock(){},galEnter:id=>active.set(id),
  galCoverChat(){covered=true;document.querySelector('#chat').hidden=true},galUncover(){covered=false;document.querySelector('#chat')?.removeAttribute('hidden')},
  galLeave(){/* simulate a broken controller's pending leave animation */},galLeaveNow(){forced++;active.set('')}}
 function Stage(){if(fail&&fault==='render')throw Error('stage render failed');React.useEffect(()=>{if(fail&&fault==='effect')throw Error('stage effect failed')},[]);return React.createElement('div',{'data-stage-content':true},'stage')}
 const views=createStageViews({React,ReactDOM,window,document,navigation,GalStage:Stage,Icon:()=>null,
  useBubbles:()=>({cardPath:'card',config:{enabled:true}}),useGalEntryLoader:()=>{if(fail&&fault==='loader')throw Error('loader failed');return 'ready'}})
 function Chat(){React.useEffect(()=>()=>chatUnmounts++,[]);return React.createElement('section',{id:'chat'},React.createElement('textarea',{defaultValue:'unsent text'}),React.createElement('button',{onClick:()=>generated++},'generate'))}
 function App(){return React.createElement(React.Fragment,null,React.createElement(Chat),React.createElement(views.Host,{sessionId:'s'}))}
 const errors=[],root=createRoot(document.getElementById('app'),{onCaughtError:error=>errors.push(error)})
 try {
 await act(async()=>root.render(React.createElement(App)))
 assert.ok(errors.length);assert.equal(chatUnmounts,0);assert.equal(covered,false);assert.equal(document.querySelector('#chat').hidden,false)
 assert.equal(document.querySelector('textarea').value,'unsent text');assert.equal(document.querySelectorAll('.fork-gal-mount').length,0)
 act(()=>document.querySelector('#chat button').click());assert.equal(generated,1)
 act(()=>document.querySelector('[data-stage-failure] button').click());assert.equal(forced,1);assert.equal(active.get(),'')
 fail=false;await act(async()=>navigation.galEnter('s'))
 assert.ok(document.querySelector('[data-stage-content]'));assert.equal(covered,true);assert.equal(chatUnmounts,0)
 act(()=>views.dispose());assert.equal(document.querySelectorAll('.fork-gal-mount').length,0);assert.equal(covered,false)
 }finally{views.dispose();act(()=>root.unmount());window.close();Object.assign(globalThis,{window:before.window,document:before.document,IS_REACT_ACT_ENVIRONMENT:before.act})}
})
