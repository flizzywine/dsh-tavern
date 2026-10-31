import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageSkinResources}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-resources.cjs')
test('skin bundle ownership survives StrictMode and releases current, held and late pins on unload',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const subscriptions=new Set(),requests=[],releases=[],timers=new Map();let value
 const session={subscribe(fn){subscriptions.add(fn);return ()=>subscriptions.delete(fn)},getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})}
 const module=createStageSkinResources({React,getSession:()=>session,getResourceOwner:()=>({acquire(descriptor){return new Promise(resolve=>requests.push({descriptor,resolve}))}}),setTimeout(fn){timers.set(fn,fn);return fn},clearTimeout:id=>timers.delete(id)})
 function View({revision}){value=module.useConfig('s',{document:{id:'skin'},resource:{kind:'bundle',identity:'skin',revision}},'default');return null}
 const root=createRoot(dom.window.document.getElementById('root'))
 const render=revision=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View,{revision}))))
 const settle=async(index)=>act(async()=>requests[index].resolve({handle:{url:'bundle-'+index,identity:'skin'},release(){releases.push(index)}}))
 try{
  await render(1);assert.equal(requests.length,2);assert.equal(value.loading,true)
  await settle(0);assert.deepEqual(releases,[0]);assert.equal(value.loading,true)
  await settle(1);assert.equal(value.skin.url,'bundle-1')
  await render(2);assert.equal(value.pending,true);await settle(2)
  await render(3);assert.equal(value.skin.url,'bundle-2');assert.equal(subscriptions.size,1)
  module.dispose();assert.equal(subscriptions.size,0);assert.deepEqual(releases,[0,1,2])
  await settle(3);assert.deepEqual(releases,[0,1,2,3]);assert.equal(timers.size,0)
  module.prefetch('s',{kind:'bundle'});assert.equal(requests.length,4)
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
 assert.deepEqual(releases,[0,1,2,3])
})
test('prefetch returns a late pin without retaining ownership after disposal',async()=>{
 let resolve,released=0
 const module=createStageSkinResources({React,getSession:()=>({getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:2}})}),getResourceOwner:()=>({acquire:()=>new Promise(done=>resolve=done)})})
 module.prefetch('s',{kind:'bundle'});module.dispose();resolve({release(){released++}});await Promise.resolve()
 assert.equal(released,1)
})
