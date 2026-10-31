import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const {createStageRegenerate}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/regenerate.cjs')
test('regeneration submits host commands and stops pending work on plugin unload',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
 const previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const h=React.createElement,document=dom.window.document,busy=[],stops=[];let resolve,closed=0,submitted=0
 const Segmented=({options,value,onChange,disabled})=>h('div',null,options.map(([id,label])=>h('button',{key:id,type:'button',role:'radio','aria-checked':value===id,disabled,onClick:()=>onChange(id)},label)))
 const view=createStageRegenerate({React,window:dom.window,document,report(){},sounds:{play(){}},useSounds(){},episode:()=>({first:0,start:0}),waitLines:['wait'],Segmented,TextArea:()=>h('textarea'),StageWaitStop:({onStop})=>h('button',{type:'button',onClick:onStop},'stop'),StageWaitLines:()=>null})
 const root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(h(React.StrictMode,null,h(view.Regenerate,{sessionId:'s',turn:3,messageId:'m',commands:{submit(){submitted++;return new Promise(done=>resolve=done)},stop(...args){stops.push(args);return Promise.resolve()}},onBusy:value=>busy.push(value),onClose:()=>closed++}))))
  await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(submitted,1);assert.deepEqual(busy,[true])
  view.dispose();assert.deepEqual(stops,[['s','body']]);assert.deepEqual(busy,[true,false])
  await act(async()=>{resolve(null);await Promise.resolve()})
  assert.equal(closed,0);assert.deepEqual(busy,[true,false])
 }finally{
  await act(async()=>root.unmount());view.dispose();dom.window.close()
  ;[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous
 }
})
