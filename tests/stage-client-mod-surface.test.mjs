import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
const require=createRequire(import.meta.url)
const {createStageModSurface}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/mod-surface.cjs')
const timing=require('../tavern-plugin/src/client/stage-auto-timing.cjs')
function fixture(extra={}) {
 const dom=new JSDOM('<!doctype html><main><div id="stage"></div></main>'),{window}=dom,root=window.document.getElementById('stage')
 const tasks=new Map();let serial=0
 window.setTimeout=fn=>{tasks.set(++serial,fn);return serial};window.clearTimeout=id=>tasks.delete(id)
 const plugin=createStageModSurface({window,document:window.document,timing:{validate:timing.validateStagePerformanceTiming,overlaps:timing.stagePerformanceRegionsOverlap},...extra})
 return {plugin,window,root,tasks,close(){plugin.dispose();window.close()}}
}
const definition={kind:'test',regions:['screen'],autoHold:{minMs:50,until:'complete'},media:()=>({image:{}})}
const descriptor={kind:'mod-performance',performance:{kind:'test',id:'one',source:{}}},token={id:'one',source:{turn:1}}
test('plugin stop settles pending Mod presentation and releases late media without reviving it',async()=>{
 const f=fixture();let finish,released=0,created=0,shown=[]
 try {
 const surface=f.plugin.createSurface({definitions:[definition],readMedia:()=>new Promise(resolve=>finish=resolve),createURL:()=>{created++;return 'blob:test'},revokeURL(){},onChange:rows=>shown.push(rows.length)})
 surface.reset(true);const pending=surface.play(descriptor,token)
 f.plugin.dispose();await pending
 finish({pin:{release:()=>released++}});await Promise.resolve();await Promise.resolve()
 assert.equal(released,1);assert.equal(created,0);assert.equal(shown.at(-1),0);assert.equal(f.tasks.size,0)
 surface.reset(true);await surface.play(descriptor,token);assert.equal(created,0)
 }finally{f.close()}
})
test('Mod layer shutdown removes all nodes even when a renderer throws during cleanup',()=>{
 const f=fixture();let stopped=0
 try {
 const host=f.plugin.createLayerHost({root:f.root,renderers:{'test/ui':()=>({dispose(){stopped++;throw Error('renderer cleanup')}})},geometry:()=>({width:100,height:100}),dock:{request(){},dispose(){stopped++}}})
 host.sync([{modId:'test',id:'one',entry:'ui',band:'audience',order:0,input:'none',budget:{maxNodes:20,maxVisible:20}}],{})
 assert.equal(f.root.children.length,1)
 assert.throws(()=>f.plugin.dispose(),/cleanup failed/)
 assert.equal(f.root.children.length,0);assert.equal(stopped,2)
 host.sync([],{});assert.equal(f.root.children.length,0)
 }finally{f.close()}
})
test('Mod layer construction rolls back observers and dock after partial installation failure',()=>{
 const f=fixture();let disconnected=0,dockStopped=0
 f.window.ResizeObserver=class {observe(){throw Error('observe failed')}disconnect(){disconnected++}}
 // Constructors are captured at activation, as in a real plugin reload.
 const plugin=createStageModSurface({window:f.window,document:f.window.document})
 try {
 assert.throws(()=>plugin.createLayerHost({root:f.root,renderers:{},dock:{dispose(){dockStopped++}}}),/observe failed/)
 assert.equal(disconnected,1);assert.equal(dockStopped,1)
 }finally{plugin.dispose();f.close()}
})

test('mounted Mod layers stop subscriptions and fence late reads before React unmount',async()=>{
 const f=fixture(),previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
 globalThis.window=f.window;globalThis.document=f.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 f.root.className='fork-gal-stage'
 let changed,finish,stopped=0,rendered=0,reannounced=0
 const plugin=createStageModSurface({React,window:f.window,document:f.window.document,
  sessions:()=>({get:()=>({getSnapshot:()=>({source:{sourceKey:'src'},cursor:{},visible:true})})}),
  runtime:{reannounce(){reannounced++}},readViews:()=>new Promise(resolve=>finish=resolve),
  subscribe:(id,onChange)=>{changed=onChange;return ()=>stopped++},
  renderers:{'test/ui':()=>{rendered++;return {update(){},dispose(){}}}}})
 const root=createRoot(f.root),row={modId:'test',context:{settledTurn:1,sourceKey:'src'},view:{},manifest:{uiLayers:[{id:'one',entry:'ui',band:'audience',order:0,input:'none',budget:{maxNodes:10,maxVisible:10}}]}}
 try {
 await act(async()=>root.render(React.createElement(plugin.Layers,{sessionId:'s',sourceKey:'src',stage:{turn:1},config:{}})))
 act(()=>changed({snapshot:{views:[row]}}));assert.equal(rendered,1);assert.equal(f.root.querySelectorAll('.fork-mod-ui-layer').length,1)
 act(()=>plugin.dispose());assert.equal(stopped,1);assert.equal(f.root.querySelectorAll('.fork-mod-ui-layer').length,0)
 await act(async()=>{finish({views:[row]});changed({snapshot:{views:[row]}});f.window.dispatchEvent(new f.window.Event('focus'))})
 assert.equal(rendered,1);assert.equal(reannounced,1);assert.equal(f.tasks.size,0)
 }finally{plugin.dispose();act(()=>root.unmount());f.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act}
})
