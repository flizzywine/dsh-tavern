import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageEntrancePresentation}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/entrance-presentation.cjs')
test('entrance gate, skip and unload follow real React StrictMode lifecycle',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const timers=new Map(),frames=new Map(),ports=[],observers=[];let next=0,result
 dom.window.setTimeout=fn=>{timers.set(++next,fn);return next};dom.window.clearTimeout=id=>timers.delete(id)
 dom.window.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};dom.window.cancelAnimationFrame=id=>frames.delete(id)
 dom.window.ResizeObserver=class{constructor(fn){this.fn=fn;this.stops=0;observers.push(this)}observe(){}disconnect(){this.stops++}}
 const module=createStageEntrancePresentation({React,window:dom.window,renderer:{supported:()=>true,start(_canvas,_run,_size,onEvent){const port={onEvent,messages:[],stops:0,input(data){this.messages.push(data)},size(){},stop(){this.stops++}};ports.push(port);return port}},media:{},video:{},contract:{stageEntranceDuration:()=>300},safety:()=>({}),reading:{get:()=>({})}})
 const store={},entrance={document:{layers:{},phases:[],palette:{base:'#000000'},background:'base'}}
 function View({ready}){result=module.useEntrance(store,entrance,{phase:ready?'revealing':'loading',visible:false});return result.element}
 const root=createRoot(dom.window.document.getElementById('root'))
 const render=ready=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View,{ready}))))
 try{
  await render(false);assert.equal(ports.length,2);assert.equal(ports[0].stops,1);assert.equal(result.gate.visible,false)
  await act(async()=>ports[1].onEvent({type:'started'}));await render(true)
  await act(async()=>dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))
  assert.ok(ports[1].messages.some(m=>m.skip));assert.equal(dom.window.document.querySelector('.fork-gal-entrance').dataset.skip,'black')
  await act(async()=>ports[1].onEvent({type:'cover'}));assert.equal(result.stageAttr,'covered');assert.equal(result.gate.phase,'revealing')
  const lateFrames=[...frames.values()],lateEvent=ports[1].onEvent
  module.dispose();assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(ports[1].stops,1);assert.ok(observers.every(o=>o.stops===1))
  await act(async()=>{lateFrames.forEach(fn=>fn());lateEvent({type:'done'})})
  const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',cancelable:true});dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,false)
  assert.equal(result.stageAttr,'covered')
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
})
test('an entrance whose load never becomes ready drops after its bound, never a permanent black veil',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const timers=new Map(),ports=[];let next=0,result
 dom.window.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};dom.window.clearTimeout=id=>timers.delete(id)
 dom.window.requestAnimationFrame=()=>++next;dom.window.cancelAnimationFrame=()=>{}
 dom.window.ResizeObserver=class{observe(){}disconnect(){}}
 const module=createStageEntrancePresentation({React,window:dom.window,renderer:{supported:()=>true,start(_canvas,_run,_size,onEvent){const port={onEvent,input(){},size(){},stop(){}};ports.push(port);return port}},media:{},video:{},contract:{stageEntranceDuration:()=>300},safety:()=>({}),reading:{get:()=>({})}})
 const store={},entrance={document:{layers:{},phases:[],palette:{base:'#000000'},background:'base'}}
 function View(){result=module.useEntrance(store,entrance,{phase:'slow',visible:false});return result.element}
 const root=createRoot(dom.window.document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(View)))
  await act(async()=>ports.at(-1).onEvent({type:'started'}))
  assert.equal(result.stageAttr,'playing');assert.equal(result.gate.phase,'loading','the entrance holds the veil while it plays')
  const bound=[...timers.values()].find(timer=>timer.ms===300+10000)
  assert.ok(bound,'a started entrance over an unready load has a timer')
  await act(async()=>bound.fn())
  assert.equal(result.stageAttr,undefined,'the entrance is dropped');assert.equal(result.gate.phase,'slow','the plain veil shows the load gate')
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
})
test('an entrance held behind a title page waits unstarted and plays its video once released (潜入月读 after 继续, owner 11-12)',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),before=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const timers=new Map(),ports=[],players=[];let next=0,result
 dom.window.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};dom.window.clearTimeout=id=>timers.delete(id)
 dom.window.requestAnimationFrame=()=>++next;dom.window.cancelAnimationFrame=()=>{}
 dom.window.ResizeObserver=class{observe(){}disconnect(){}}
 const video={player(host,source){const player={host,source,synced:[],ready:Promise.resolve(true),playable:Promise.resolve(),sync(event){this.synced.push(event)},pause(){},dispose(){this.disposed=true}};players.push(player);return player}}
 const module=createStageEntrancePresentation({React,window:dom.window,renderer:{supported:()=>true,start(_canvas,_run,_size,onEvent){const port={onEvent,messages:[],input(data){this.messages.push(data)},size(){},stop(){}};ports.push(port);return port}},media:{},video,contract:{stageEntranceDuration:()=>6800},safety:()=>({}),reading:{get:()=>({})}})
 const store={},film={bundleKey:'film',entry:'film.webm',durationMs:6808}
 const entrance={document:{layers:{video:{asset:'film'}},phases:[],palette:{base:'#000000'},background:'base'},video:film}
 function View(){result=module.useEntrance(store,entrance,{phase:'revealing',visible:false});return result.element}
 const root=createRoot(dom.window.document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(View)))
  await act(async()=>result.hold())
  for(const player of players)assert.equal(player.disposed,true,'a player made before the hold is gone')
  const made=players.length
  assert.equal(result.element,null);assert.equal(dom.window.document.querySelector('.fork-gal-entrance'),null)
  assert.equal(result.active,true,'held, it still owns this visit');assert.equal(result.gate.visible,false,'the stage stays hidden behind the page')
  for(const timer of [...timers.values()])await act(async()=>timer.fn())
  assert.equal(result.active,true,'no drop timer runs while held')
  await act(async()=>result.release())
  assert.ok(dom.window.document.querySelector('.fork-gal-entrance .fork-gal-entrance-video'),'the entrance and its video layer are mounted')
  const player=players.at(-1);assert.ok(players.length>made);assert.equal(player.source,film);assert.equal(player.disposed,undefined)
  assert.ok(player.host.classList.contains('fork-gal-entrance-video'))
  const port=ports.at(-1);assert.ok(port,'the timeline starts once the video can play')
  await act(async()=>port.onEvent({type:'video',time:0.5,rate:1,alpha:1}))
  assert.deepEqual(player.synced.at(-1),{type:'video',time:0.5,rate:1,alpha:1},'the video follows the running timeline')
  assert.ok(port.messages.some(m=>m.video),'the drawn layers hand over to the video')
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=before}
})
