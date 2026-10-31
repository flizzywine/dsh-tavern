import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageTextcard}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-stage.cjs')
const {createStageTextcardFonts}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-fonts.cjs')
test('StrictMode creates a fresh textcard player after cleanup and removes debug on disposal',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const made=[];let result
 const module=createStageTextcard({React,window:dom.window,clock:{},plan:()=>({frames:[]}),fonts:{ensure:async()=>null,loaded:()=>true},players:{create(options){const player={closed:false,node:null,attach(node){this.node=node},snapshot:()=>({phase:'idle'}),dispose(){this.closed=true},play(){assert.equal(this.closed,false);return Promise.resolve(true)},skip:()=>true,cancel(){},log(){}};made.push(player);return player}}})
 function View(){result=module.useStage({sessionId:'s'});return result.node}
 const root=createRoot(dom.window.document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View))))
  assert.equal(made.length,2);assert.equal(made[0].closed,true);assert.equal(made[1].closed,false);assert.ok(made[1].node)
  assert.equal(await result.play({performance:{kind:'dsh.textcard',payload:{style:'card'}}}),true)
  const debug=dom.window.forkTextcardDebug;module.dispose()
  assert.equal(made[1].closed,true);assert.equal(dom.window.forkTextcardDebug,undefined);assert.equal(await debug.play({}),false)
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous}
})
test('font preparation uses the skin font service and fences late completion',async()=>{
 let resolve,calls=0
 const fonts=createStageTextcardFonts({document:{},fonts:{ensure(){calls++;return new Promise(done=>resolve=done)}}})
 const first=fonts.ensure(),second=fonts.ensure();assert.equal(first,second)
 await Promise.resolve();assert.equal(calls,1)
 fonts.dispose();resolve({family:'Noto Serif SC'});assert.equal(await first,null)
 assert.equal(fonts.loaded({}),false);assert.equal(await fonts.ensure(),null)
})
test('disposal before queued font preparation does not start a skin font request',async()=>{
 let calls=0
 const fonts=createStageTextcardFonts({document:{},fonts:{ensure(){calls++;return Promise.resolve({family:'Noto Serif SC'})}}})
 const pending=fonts.ensure();fonts.dispose()
 assert.equal(await pending,null);assert.equal(calls,0)
})
