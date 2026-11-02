import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const factory=name=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name+'.cjs')
for(const name of ['backlog-rows','backlog-history','backlog-paging','backlog-voice','backlog-view'])factory(name)
const base={schema:'dsh.skin/1',id:'wave-sample',label:'波',textbox:{paint:{bg:'#101418',fg:'#f2f2f2'}},nameplate:{shape:'plain',paint:{bg:'#101418',fg:'#f2f2f2'}},font:{},textFx:{reveal:'type'}}
const skin=voice=>({...base,art:{screen:1080,voice}})

test('art.voice.waves: one to three arc images beside the body image, packed with the skin',()=>{
 const document=skin({image:'art/speaker.svg',focus:'art/speaker-focus.svg',waves:['art/wave-1.svg','art/wave-2.svg']})
 contract.validateStageSkin(document)
 assert.deepEqual(contract.stageSkinFiles(document).filter(name=>name.startsWith('art/wave')),['art/wave-1.svg','art/wave-2.svg'])
 for(const voice of [{box:false,waves:['art/wave-1.svg']},{image:'art/speaker.svg',waves:[]},{image:'art/speaker.svg',waves:['a.svg','b.svg','c.svg','d.svg']}])
  assert.throws(()=>contract.validateStageSkin(skin(voice)),{code:'INVALID_SKIN'})
})

test('art.voice.waves projects each arc as its own layer token on the stage',()=>{
 const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
 const image={naturalWidth:24,naturalHeight:24},files=Object.fromEntries(['art/speaker.svg','art/wave-1.svg','art/wave-2.svg','art/wave-3.svg'].map(name=>[name,{url:'blob:'+name,image}]))
 const art=adapter.stageSkinArt(skin({image:'art/speaker.svg',waves:['art/wave-1.svg','art/wave-2.svg','art/wave-3.svg']}),files)
 assert.equal(art.marks['data-fk-skin-art-voice-waves'],'3')
 assert.equal(art.tokens['--art-voice-wave-2'],'url("blob:art/wave-2.svg")')
 const plain=adapter.stageSkinArt(skin({image:'art/speaker.svg'}),files)
 assert.equal('data-fk-skin-art-voice-waves' in plain.marks,false)
})

test('backlog rows draw their replay as the speaker glyph',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
 const previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const document=dom.window.document,glyphs=[]
 const player={get:()=>null,subscribe:()=>()=>{}}
 const backlogRows=factory('backlog-rows').createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]})
 const backlogHistory=factory('backlog-history').createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}})
 const backlogPaging=factory('backlog-paging').createStageBacklogPaging({React,hasOlder:()=>false})
 const backlogVoice=factory('backlog-voice').createStageBacklogVoice({player})
 const VoiceButton=({glyph})=>{glyphs.push(glyph);return null}
 const view=factory('backlog-view').createStageBacklogView({React,window:dom.window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},bubbleCharacter:()=>null,galQuoted:text=>text,VoiceButton,PackImage:()=>null,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout})
 const root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(view.Backlog,{sessionId:'s',turn:1,page:0,pages:[{kind:'line',text:'hello',alias:'a',para:1,voice:{id:'v',owner:'o',click(){}}}],inputs:{},colorOf:()=>'',avatarOf:()=>'',nameOf:()=>'Alice',voiceOf:()=>null,onJump(){},onClose(){}})))
  assert.ok(glyphs.length>0);assert.ok(glyphs.every(glyph=>glyph==='speaker'))
 }finally{
  await act(async()=>root.unmount());[view,backlogVoice,backlogPaging,backlogHistory].forEach(module=>module.dispose());dom.window.close()
  ;[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous
 }
})

test('the speaker waves light in sequence only while playing and stand still under reduced motion',()=>{
 const css=fs.readFileSync(new URL('../tavern-plugin/lib/client-assets/theme.css',import.meta.url),'utf8')
 assert.match(css,/\.fork-voice-button\[data-voice-state="playing"\] \.fork-voice-wave \{ animation: fork-voice-wave /)
 assert.match(css,/\.fork-voice-wave\[data-wave="2"\] \{ animation-delay: \.2s; \}/)
 assert.match(css,/\.fork-voice-wave\[data-wave="3"\] \{ animation-delay: \.4s; \}/)
 assert.match(css,/\.fork-gal-stage\[data-reduced-motion\] \.fork-voice-button \.fork-voice-wave \{ animation: none; \}/)
 // a skin's waves keep its body still: playing shows the idle image, not the active one
 assert.match(css,/\[data-fk-skin-art-voice-waves\]:not\(\.is-film\) \.fork-gal-backlog-name > \.fork-voice-button\[data-voice-state="playing"\] \{ background-image: var\(--art-voice\); \}/)
})
