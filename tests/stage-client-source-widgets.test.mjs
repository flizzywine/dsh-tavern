import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageSourceWidgets}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/source-widgets.cjs')
function fixture(options={}){
 const dom=new JSDOM('<!doctype html><main class="fork-gal-stage"></main>',{url:'https://example.test'}),{window}=dom,document=window.document
 const previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
 globalThis.window=window;globalThis.document=document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const jobs=new Map(),subscriptions=new Set();let serial=0,observers=0,widgetReads=0
 const prefs={get:()=>null,subscribe:fn=>{subscriptions.add(fn);return ()=>subscriptions.delete(fn)}}
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 window.ResizeObserver=class{constructor(){observers++}observe(){}disconnect(){observers--}}
 const foreground={setInterval:fn=>{jobs.set(++serial,fn);return serial},clearInterval:id=>jobs.delete(id)}
 const context={state:null,refs:new Map()}
 const plugin=createStageSourceWidgets({React,window,document,storage:window.localStorage,foreground,
  views:{phoneLayout:{prefs,min:()=>50},admission:{shown:{get:()=>true,settled:()=>Promise.resolve()}},scene:{rects:()=>[]}},
  sessions:()=>({owner:{getWidgetContext(){widgetReads++;return context}}}),sandbox:{theme:()=>null,stopSfx(){},scroll(){}},
  playerErrorText:String,...options})
 const mount=document.querySelector('main'),root=createRoot(mount)
 return {plugin,mount,root,jobs,subscriptions,window,document,get observers(){return observers},get widgetReads(){return widgetReads},
  close(){try{plugin.dispose()}finally{act(()=>root.unmount());dom.window.close();Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act})}}}
}
test('widget controller reads plugin session context and releases geometry and preferences before unmount',()=>{
 const f=fixture();let value
 function View(){value=f.plugin.useStage({sessionId:'s',rootRef:{current:f.mount},config:{characters:[]},widgets:[],pages:[],turn:1,page:0,enabled:true,mode:'live'});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 assert.ok(f.widgetReads>0);assert.equal(value.items.length,0);assert.equal(f.observers,1);assert.equal(f.jobs.size,1);assert.ok(f.subscriptions.size>0)
 const late=[...f.jobs.values()][0]
 act(()=>f.plugin.dispose());assert.equal(f.observers,0);assert.equal(f.jobs.size,0);assert.equal(f.subscriptions.size,0)
 act(()=>late());assert.equal(f.jobs.size,0)
 }finally{f.close()}
})
test('stopping phone settings prevents queued writes after an in-flight config read',async()=>{
 let finish;const calls=[]
 const f=fixture({rpc:(method,args)=>{calls.push(method);if(method==='getModConfig')return new Promise(resolve=>finish=resolve);return Promise.resolve({sources:[]})}})
 let settings
 function View(){settings=f.plugin.usePhoneSettings({sessionId:'s'});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 let work
 await act(async()=>{work=settings.request({op:'save',key:'sound',layer:'card',value:{fixed:false}});await Promise.resolve()})
 assert.deepEqual(calls,['getModConfig','listModConfigSources'])
 act(()=>f.plugin.dispose())
 await act(async()=>{finish({schema:[],card:{},global:{},resolved:{},revision:1});await work})
 assert.deepEqual(calls,['getModConfig','listModConfigSources'])
 await assert.rejects(settings.request({op:'load'}),{name:'AbortError'})
 }finally{f.close()}
})
test('a phone config response from the prior session cannot replace the new session view',async()=>{
 const pending=new Map()
 const f=fixture({rpc:(method,args,id)=>method==='getModConfig'?new Promise(resolve=>pending.set(id,resolve)):Promise.resolve({sources:[]})})
 let settings
 function View({id}){settings=f.plugin.usePhoneSettings({sessionId:id});return null}
 try {
 act(()=>f.root.render(React.createElement(View,{id:'old'})))
 let old;await act(async()=>{old=settings.request({op:'load'})})
 act(()=>f.root.render(React.createElement(View,{id:'new'})))
 let current;await act(async()=>{current=settings.request({op:'load'})})
 await act(async()=>{pending.get('new')({schema:[],card:{},global:{},resolved:{},revision:2});await current})
 const accepted=settings.view
 await act(async()=>{pending.get('old')({schema:[],card:{},global:{},resolved:{},revision:1});await old})
 assert.equal(settings.view,accepted)
 }finally{f.close()}
})
test('a late widget avatar lease is released without warming the shared cache after stop',async()=>{
 let finish,prepared=0,released=0
 const f=fixture({characters:{character:()=>({avatarMedia:{default:{identity:'face',revision:1}}})},
  avatarCache:{subscribe:()=>()=>{},get:()=>null,ready:()=>null,prepare:()=>prepared++},
  sessions:()=>({resourceOwner:{acquire:()=>new Promise(resolve=>finish=resolve)}})})
 function View(){f.plugin.useFaces({config:{},sessionId:'s',source:{sessionId:'s',authorityEpoch:1},names:['person'],px:96});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 act(()=>f.plugin.dispose())
 await act(async()=>{finish({handle:{url:'blob:face'},release:()=>released++});await Promise.resolve()})
 assert.equal(released,1);assert.equal(prepared,0)
 }finally{f.close()}
})
