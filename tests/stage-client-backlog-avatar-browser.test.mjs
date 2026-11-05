// art.backlog.avatar (C3): the art layer's face column, the real view, skin adapter and stage CSS in Chromium. A speaker's face
// comes from the stage's resolver (avatarOf) through the canonical speaker resolver (bubbleCharacter), never a raw alias; an
// unresolved speaker keeps an empty column of the same width (or the placeholder); narration and the player's rows have none.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const client=name=>readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name,import.meta.url),'utf8')
const fixture=JSON.parse(await readFile(new URL('./fixtures/stage-skins/backlog-avatar.json',import.meta.url),'utf8'))

const svg=fill=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="${fill}"/></svg>`)
const FACE=svg('#c03a5a'),YOU=svg('#3a5ac0')
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const skinOf=document=>{
  const files=Object.fromEntries(contract.stageSkinFiles(document).map(name=>[name,{url:svg('#1a1a1a'),image:{naturalWidth:200,naturalHeight:120}}]))
  const art=adapter.stageSkinArt(document,files);assert.ok(art,'the art layer draws');return {marks:art.marks,tokens:art.tokens,looks:adapter.stageSkinBacklog(document)}
}
// 摩尔加纳 is the alias the text wrote; the card character's canonical id (morgana) is what the faces are keyed by.
const PAGES=[{kind:'line',alias:'摩尔加纳',mood:'开心',text:'把这句话记下来，这是一句足够长的台词，好让它在手机上折成好几行。'},{kind:'line',alias:'无名',text:'没有头像的人。'},{kind:'narration',text:'旁白：夜色降临。'}]
  .map((page,i)=>({...page,para:i+1,voice:{id:'v'+i,owner:'o'}}))

async function open(browser,skin,viewport,faces){
  const page=await browser.newPage({viewport}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  const sources=(await Promise.all(['labels.cjs','backlog-rows.cjs','backlog-history.cjs','backlog-paging.cjs','backlog-voice.cjs','backlog-view.cjs'].map(client))).join('\n')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${sources}
    window.avatarCalls=[];
    window.mountBacklog=(skin,pages,faces)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage'),h=React.createElement,player={get:()=>null,subscribe:()=>()=>{}};
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      const ransom=createStageLabels({React,Icon:()=>null,document,getComputedStyle,ResizeObserver,requestAnimationFrame,cancelAnimationFrame});
      const backlogRows=createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]});
      const backlogHistory=createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}});
      const backlogPaging=createStageBacklogPaging({React,hasOlder:()=>false});
      const backlogVoice=createStageBacklogVoice({player});
      const VoiceButton=()=>h('button',{type:'button',className:'fork-voice-button','aria-label':'重播这一句'},'▶');
      const PackImage=({src,alt})=>h('img',{src,alt});
      const bubbleCharacter=(config,entry)=>entry.alias==='摩尔加纳'?{alias:'morgana'}:null;
      const view=createStageBacklogView({React,window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},
        bubbleCharacter,galQuoted:t=>t,VoiceButton,PackImage,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,ransom,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame});
      window.root?.unmount();
      window.root=ReactDOM.createRoot(stage);
      window.root.render(h(view.Backlog,{sessionId:'s',turn:1,page:pages.length-1,pages:pages.map(p=>({...p,voice:{...p.voice,click(){}}})),looks:skin.looks,inputs:{1:'我们走吧。'},
        colorOf:()=>'',avatarOf:(alias,mood)=>{avatarCalls.push([alias,mood]);return faces[alias]?{identity:alias,src:faces[alias]}:null},nameOf:a=>a,voiceOf:()=>null,onJump(){},onClose(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,pages,faces])=>mountBacklog(skin,pages,faces),[skin,PAGES,faces])
  return {page,errors}
}
const rows=page=>page.evaluate(()=>{
  const box=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
  return [...document.querySelectorAll('.fork-gal-backlog-col > *')].map(row=>{
    const avatar=row.querySelector(':scope > .fork-gal-backlog-avatar'),img=avatar?.querySelector('img'),glyph=avatar?.querySelector('i')
    return {role:row.dataset.blRole,avatar:box(avatar),empty:avatar?.hasAttribute('data-empty'),src:img?.getAttribute('src'),filter:img && getComputedStyle(img).filter,
      glyph:glyph?.textContent,shown:avatar && getComputedStyle(avatar).display,text:box(row.querySelector('.fork-gal-backlog-text, :scope > p')),row:box(row)}
  })
})
const apart=(a,b)=>a.right<=b.left+0.5 || b.right<=a.left+0.5 || a.bottom<=b.top+0.5 || b.bottom<=a.top+0.5

test('a 390 px phone: the resolver\'s face in grey, an empty column of the same width, none on narration or the player\'s row',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const {page,errors}=await open(browser,skinOf(contract.stageSkinForDevice(fixture,'mobile')),{width:390,height:844},{morgana:FACE})
  const list=await rows(page)
  assert.deepEqual(errors,[])
  const [face,blank,narration]=list.filter(row=>row.role==='speech' || row.role==='narration'),you=list.find(row=>row.role==='player')
  assert.equal(face.src,FACE,'the img shows avatarOf\'s face')
  assert.deepEqual((await page.evaluate(()=>avatarCalls)).find(([alias])=>alias==='morgana'),['morgana','开心'],'resolved through the canonical speaker, with the mood')
  assert.match(face.filter,/grayscale\(1\)/,'tone mono')
  assert.equal(face.shown,'block')
  assert.equal(blank.empty,true);assert.equal(blank.src,undefined);assert.equal(blank.glyph,undefined)
  assert.ok(Math.abs(blank.avatar.width-face.avatar.width)<0.5 && face.avatar.width>40,`the empty column keeps its width (${blank.avatar.width} / ${face.avatar.width})`)
  assert.ok(Math.abs(blank.text.left-face.text.left)<0.5,'the words start at the same place with or without a face')
  for(const row of [face,blank])assert.ok(apart(row.text,row.avatar),`the words ${JSON.stringify(row.text)} clear the face ${JSON.stringify(row.avatar)}`)
  assert.equal(narration.avatar,null,'narration has no face node')
  assert.equal(you.avatar,null,'player false: the player\'s row has no face node')
  assert.ok(Math.max(...list.map(row=>row.row.right))<=390,'no sideways overflow')
})

test('wide: the placeholder disc for an unresolved speaker, the face in colour, the player\'s face with avatar.player',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  {
    const {page,errors}=await open(browser,skinOf(fixture),{width:1920,height:1080},{morgana:FACE})
    const list=await rows(page)
    assert.deepEqual(errors,[])
    const [face,blank]=list.filter(row=>row.role==='speech')
    assert.equal(face.src,FACE);assert.doesNotMatch(face.filter,/grayscale/,'no tone: the face\'s own colours')
    assert.equal(blank.empty,false);assert.equal(blank.glyph,'无','placeholder initial: the name\'s first glyph')
    for(const row of [face,blank])assert.ok(apart(row.text,row.avatar),'the words clear the face')
    assert.equal(list.find(row=>row.role==='narration').avatar,null)
    await page.close()
  }
  const doc=structuredClone(fixture);doc.art.backlog.avatar.player=true
  const {page,errors}=await open(browser,skinOf(doc),{width:1920,height:1080},{morgana:FACE,'你':YOU})
  const you=(await rows(page)).find(row=>row.role==='player')
  assert.deepEqual(errors,[])
  assert.equal(you.src,YOU,'the player\'s face from the resolver');assert.ok(apart(you.text,you.avatar))
  // a resolver with no face for the player: no node, no placeholder
  await page.evaluate(([skin,pages])=>mountBacklog(skin,pages,{}),[skinOf(doc),PAGES])
  assert.equal((await rows(page)).find(row=>row.role==='player').avatar,null)
})

test('a skin without an avatar draws no face column',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const doc=structuredClone(fixture);delete doc.art.backlog.avatar;delete doc.devices
  const {page,errors}=await open(browser,skinOf(doc),{width:1920,height:1080},{morgana:FACE})
  assert.deepEqual(errors,[])
  assert.equal(await page.locator('.fork-gal-backlog-avatar, [data-bl-avatar]').count(),0)
})
