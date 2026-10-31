import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStagePlayback}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/playback.cjs')
const {stageAutoDelay,stageAutoRemaining}=require('../tavern-plugin/src/client/stage-auto-timing.cjs')
const dom=new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
function fixture(){
 let at=10000,serial=0,audible=true,playing=null,failCancel=false
 const jobs=new Map(),listeners=new Set(),calls=[]
 const add=(fn,ms,repeat)=>{const id=++serial;jobs.set(id,{fn,ms,repeat});return id}
 const remove=id=>{jobs.delete(id);if(failCancel)throw Error('cancel failed')}
 const clock={setTimeout:(fn,ms)=>add(fn,ms,false),clearTimeout:remove,setInterval:(fn,ms)=>add(fn,ms,true),clearInterval:remove,
 subscribeAudio:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},isAudible:()=>audible}
 const playback=createStagePlayback({React,clock,player:{get:()=>playing},subtitles:{voiceTime:()=>2},timing:{delay:stageAutoDelay,remaining:stageAutoRemaining},handoffDelay:(delay,held)=>Math.max(0,delay-held),now:()=>at})
 const frame={sessionId:'a',runtime:{cursor:{mode:'live',visitId:1,anchor:{paragraphId:'p',offset:0}},text:{pages:[]},indicators:{awaitingDirection:false},store:{dispatch:event=>calls.push(event)}},
 reading:{autoWait:700,autoSpeed:1},auto:false,skipping:false,hidden:false,overlay:false,typed:true,current:{text:'a'},atEnd:false,awaiting:false,sceneHolding:false,
 line:{turn:1,page:0,card:0,inputCard:0,transitioning:false,subtitles:{text:'a',cards:[]},inputSubtitles:{text:''},lastCard:true,voice:null,audioBusy:false,heldMs:0,film:false,pageCount:2},
 performance:{replayable:['core.dice.roll'],holds:[],blocking:false,dialogueHeld:false,busy:false}}
 function View(){playback.usePlayback(frame,{advance:()=>calls.push('advance'),finishSkip:()=>calls.push('end'),finishTyping:()=>calls.push('typed')});return null}
 const mount=document.createElement('div');document.body.append(mount);const root=createRoot(mount)
 const render=()=>act(()=>root.render(React.createElement(View)))
 return {frame,jobs,calls,listeners,playback,render,setTime:value=>at=value,setPlayer:value=>playing=value,failCancel:()=>failCancel=true,
 audible(value){act(()=>{audible=value;for(const fn of listeners)fn()})},fire(){const [id,job]=jobs.entries().next().value;if(!job.repeat)jobs.delete(id);act(()=>job.fn())},
 cleanup(){try{playback.dispose()}finally{act(()=>root.unmount());mount.remove()}}}
}
test('auto keeps remaining silent reading time across foreground pause and fences late callbacks on dispose',()=>{
 const f=fixture();try{
 f.frame.auto=true;f.render();assert.equal([...f.jobs.values()][0].ms,800)
 f.setTime(10300);f.audible(false);assert.equal(f.jobs.size,0)
 f.setTime(20000);f.audible(true);assert.equal([...f.jobs.values()][0].ms,500)
 const late=[...f.jobs.values()][0].fn;f.playback.dispose();assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0)
 late();assert.deepEqual(f.calls,[])
 }finally{f.cleanup()}
})
test('intermediate voiced cards follow audio time and blocking performance holds prevent timers',()=>{
 const f=fixture();try{
 Object.assign(f.frame,{auto:true});Object.assign(f.frame.line,{lastCard:false,voice:{owner:'a:stage',id:'v'},audioBusy:true})
 f.setPlayer({owner:'a:stage',id:'v',audio:{duration:4,currentTime:1,paused:false}});f.render();assert.equal([...f.jobs.values()][0].ms,80)
 f.fire();assert.deepEqual(f.calls,[])
 f.setPlayer({owner:'a:stage',id:'v',audio:{duration:4,currentTime:2,paused:false}});f.fire();assert.deepEqual(f.calls,['advance'])
 f.frame.performance.blocking=true;f.frame.performance.busy=true;f.render();assert.equal(f.jobs.size,0)
 }finally{f.cleanup()}
})
test('skip waits for data and entry, ignores performance holds, and finishes at round end',()=>{
 const f=fixture();try{
 f.frame.skipping=true;f.frame.sceneHolding=true;f.render();assert.equal(f.jobs.size,0)
 f.frame.sceneHolding=false;f.frame.current.pending=true;f.render();assert.equal(f.jobs.size,0)
 f.frame.current.pending=false;f.frame.performance.blocking=true;f.render();assert.equal([...f.jobs.values()][0].ms,150)
 f.fire();assert.deepEqual(f.calls,['advance','typed'])
 f.frame.atEnd=true;f.render();assert.equal(f.jobs.size,0);assert.equal(f.calls.at(-1),'end')
 }finally{f.cleanup()}
})
test('history dwell cancels on page switch and never dispatches an old session callback',()=>{
 const f=fixture();try{
 f.frame.runtime.cursor.mode='history';f.render();assert.equal([...f.jobs.values()][0].ms,250)
 const old=[...f.jobs.values()][0].fn
 f.setTime(10100);f.frame.runtime.cursor={...f.frame.runtime.cursor,visitId:2};f.render();assert.equal([...f.jobs.values()][0].ms,1000)
 old();assert.deepEqual(f.calls,[])
 f.frame.sessionId='b';f.render();f.fire();assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'HISTORY_DWELL');assert.equal(f.calls[0].visitId,2)
 f.frame.overlay=true;f.render();assert.equal(f.jobs.size,0)
 }finally{f.cleanup()}
})
test('cleanup errors do not leave another clock or foreground subscription running',()=>{
 const f=fixture();try{
 f.frame.auto=true;f.frame.runtime.cursor.mode='history';f.render();assert.equal(f.jobs.size,2)
 const late=[...f.jobs.values()].map(job=>job.fn);f.failCancel()
 assert.throws(()=>f.playback.dispose(),/cleanup failed/);assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0)
 for(const callback of late)callback();assert.deepEqual(f.calls,[])
 }finally{f.cleanup()}
})
