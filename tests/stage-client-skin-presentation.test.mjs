import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const base='../tavern-plugin/packages/dsh-tavern-stage/src/client/'
const {createStageSkinPresentation}=require(base+'skin-presentation.cjs')
const {createStageSkinAdapter}=require(base+'skin-adapter.cjs')
const {createStageSkinMotion}=require(base+'skin-motion.cjs')
const {createStageSkinBacklog}=require(base+'skin-backlog.cjs')
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
test('skin selection waits for pages, withdraws immediately and unload restores mounted DOM in StrictMode',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const pendingFonts=[];let provided=0
 const listeners=new Set(),fonts={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>0,resolve:()=>({family:'serif'}),ensure:async()=>{},provide:async()=>{provided++}}
 const skin=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
 const module=createStageSkinPresentation({React,Event:dom.window.Event,fonts,skin:{...skin,stageSkinFontFaces:()=>[{id:'bundled',load:()=>new Promise(resolve=>pendingFonts.push(resolve))}]},appearance:contract.stageSkinAppearance,files:()=>({})})
 let active;const shown={current:null}
 function View({candidate,page='one',film=false}){const ref=React.useRef();active=module.useSkin(ref,candidate,page,film,'classic',{shown});return React.createElement('section',{ref})}
 const root=createRoot(dom.window.document.getElementById('root'))
 const a={document:contract.BUILTIN_STAGE_SKINS.classic},b={url:'bundle',document:{...contract.BUILTIN_STAGE_SKINS.gothic,font:{faces:[{id:'bundled'}]}}}
 const render=props=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View,props))))
 try{
  await render({candidate:a});const node=dom.window.document.querySelector('section')
  assert.equal(active.id,'classic');assert.equal(node.getAttribute('data-fk-skin'),'classic');assert.equal(listeners.size,1)
  await render({candidate:b});assert.equal(active.id,'classic')
  await render({candidate:b,page:'two'});assert.equal(active.id,'gothic');assert.equal(shown.current.id,'gothic')
  await render({candidate:null,page:'two'});assert.equal(active,null);assert.equal(node.hasAttribute('data-fk-skin'),false)
  await render({candidate:b,page:'three',film:true});assert.equal(active.id,'gothic');assert.equal(node.hasAttribute('data-fk-skin'),false);assert.ok(node.style.getPropertyValue('--gal-ui-font'))
  module.dispose();assert.ok(pendingFonts.length>0);for(const resolve of pendingFonts)resolve(new Blob(['font']));await act(async()=>{});assert.equal(provided,0);assert.equal(listeners.size,0);assert.equal(node.style.getPropertyValue('--gal-ui-font'),'');assert.equal(node.hasAttribute('data-fk-fonts'),false)
 }finally{await act(async()=>root.unmount());module.dispose();skin.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
})
test('skin control borrowing preserves owning controls while excluding their timer',()=>{
 const module=createStageSkinPresentation({skin:{},appearance:d=>d})
 const own={document:{id:'controls',quickMenu:{layout:'orb'},hud:{timer:{hide:true},reveal:'edge'}}}
 const lent=module.controls({id:'scene'},null,own)
 assert.equal(lent.id,'controls');assert.deepEqual(lent.hud,{reveal:'edge'});assert.deepEqual(lent.buttons,[])
 assert.equal(module.controls({art:{buttons:{}}},null,own),null)
 assert.equal(module.performed({builtin:true,document:{id:'classic'}},'"classic"'),false)
 module.dispose()
})
