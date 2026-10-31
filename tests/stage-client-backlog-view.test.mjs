import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const factory=name=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name+'.cjs')
for(const name of ['backlog-rows','backlog-history','backlog-paging','backlog-voice','backlog-view'])factory(name)
test('backlog composes real modules in StrictMode and fences controls on disposal',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
 const previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const document=dom.window.document,listeners=new Set(),signals=new Set(),jumps=[]
 const player={get:()=>null,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}
 const backlogRows=factory('backlog-rows').createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]})
 const backlogHistory=factory('backlog-history').createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:(_,fn)=>{signals.add(fn);return()=>signals.delete(fn)}})
 const backlogPaging=factory('backlog-paging').createStageBacklogPaging({React,hasOlder:()=>false})
 const backlogVoice=factory('backlog-voice').createStageBacklogVoice({player})
 const view=factory('backlog-view').createStageBacklogView({React,window:dom.window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},bubbleCharacter:()=>null,galQuoted:text=>text,VoiceButton:()=>null,PackImage:()=>null,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout})
 const root=createRoot(document.getElementById('root')),modules=[view,backlogVoice,backlogPaging,backlogHistory]
 try{
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(view.Backlog,{sessionId:'s',turn:1,page:0,pages:[{kind:'line',text:'hello',alias:'a',para:1}],inputs:{1:'player input'},colorOf:()=>'',avatarOf:()=>'',nameOf:()=> 'Alice',onJump:(...args)=>jumps.push(args),onClose(){}}))))
  assert.match(document.body.textContent,/hello/);assert.match(document.body.textContent,/player input/)
  const row=document.querySelector('.fork-gal-backlog-row')
  await act(async()=>row.click());assert.equal(jumps.length,1)
  assert.equal(listeners.size,1);assert.equal(signals.size,1)
  modules.forEach(module=>module.dispose())
  await act(async()=>row.click());assert.equal(jumps.length,1)
  assert.equal(listeners.size,0);assert.equal(signals.size,0)
 }finally{
  await act(async()=>root.unmount());modules.forEach(module=>module.dispose());dom.window.close()
  ;[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous
 }
})
