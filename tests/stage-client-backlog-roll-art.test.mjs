// art.backlog.roll (C4): the art layer's check line in the skin's drawing - its mark in place of the generic die, the rolled
// number in its ink and scale, the tier word on its success / fail tile - while the words stay the engine's check line
// (mods/dice/client/roll.js diceLine). The validator names the field to fix and checks each tier tile's ink on its ground at 4.5:1.
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
const fixture=JSON.parse(await readFile(new URL('./fixtures/stage-skins/backlog-roll-art.json',import.meta.url),'utf8'))

const edit=(change,side)=>{const doc=structuredClone(fixture);change(side ? doc.devices.mobile.art.backlog.roll : doc.art.backlog.roll,doc);return doc}
const refused=(doc,code,pattern)=>assert.throws(()=>contract.validateStageSkin(doc),error=>error.code===code && pattern.test(error.message),pattern.source)

test('the sample validates, its marks are collected for install, and a bad roll field or an unreadable tier tile is refused with its fix',()=>{
  const doc=contract.validateStageSkin(structuredClone(fixture))
  const files=contract.stageSkinFiles(doc)
  for(const name of ['art/court-gavel.webp','art/poster-die.svg'])assert.ok(files.includes(name),name)
  assert.equal(contract.stageSkinForDevice(doc,'mobile').art.backlog.roll.image,'art/poster-die.svg')
  refused(edit(r=>{r.tier.fail={ground:'#808080',ink:'#777777'}}),'SKIN_CONTRAST',/^art\.backlog\.roll\.tier\.fail: ink #777777 on ground #808080 is 1\.\d\d:1, needs 4\.5:1/)
  refused(edit(r=>{r.tier.success={ground:'#1d3fbf',ink:'#3050d0'}},'mobile'),'SKIN_CONTRAST',/^devices\.mobile\.art\.backlog\.roll\.tier\.success: .* needs 4\.5:1/)
  refused(edit(r=>{delete r.image}),'INVALID_SKIN',/^art\.backlog\.roll needs image: one image file/)
  refused(edit(r=>{r.size=[0,56]}),'INVALID_SKIN',/^art\.backlog\.roll\.size \[0,56\] is invalid - size \[w, h\]: the mark in design px/)
  refused(edit(r=>{r.total={ink:'gold',scale:1.6}}),'INVALID_SKIN',/roll\.total .* is invalid - total \{ink, scale\}/)
  refused(edit(r=>{r.tier.critical={ground:'#000000',ink:'#ffffff'}}),'INVALID_SKIN',/roll\.tier .* is invalid - tier \{success\?, fail\?\}/)
  refused(edit(r=>{r.color='#ffffff'}),'INVALID_SKIN',/^art\.backlog\.roll\.color is not a roll field - use image, size, total, tier/)
})

const svg=fill=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="56"><rect width="72" height="56" fill="${fill}"/></svg>`)
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const skinOf=document=>{
  const files=Object.fromEntries(contract.stageSkinFiles(document).map(name=>[name,{url:svg('#1a1a1a'),image:{naturalWidth:72,naturalHeight:56}}]))
  const art=adapter.stageSkinArt(document,files);assert.ok(art,'the art layer draws');return {marks:art.marks,tokens:art.tokens,looks:adapter.stageSkinBacklog(document)}
}
const PAGES=[{kind:'line',alias:'审判长',text:'现在宣读判定。'},{kind:'narration',text:'法槌落下。'}].map((page,i)=>({...page,para:i+1,voice:{id:'v'+i,owner:'o'}}))
// The round's open checks (native turn 7 = story turn 1): a success and a fumble.
const ROLLS=[{callId:'c1',check:'推理',roll:17,tier:'success'},{callId:'c2',check:'说服',roll:4,tier:'fumble'}]

async function open(browser,skin,viewport){
  const page=await browser.newPage({viewport}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  const dice=await readFile(new URL('../tavern-plugin/mods/dice/client/roll.js',import.meta.url),'utf8')
  const sources=(await Promise.all(['labels.cjs','backlog-rows.cjs','backlog-history.cjs','backlog-paging.cjs','backlog-voice.cjs','backlog-view.cjs'].map(client))).join('\n')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${dice}
    ${sources}
    window.mountBacklog=(skin,pages,rolls)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage'),h=React.createElement,player={get:()=>null,subscribe:()=>()=>{}};
      for(const name of [...stage.getAttributeNames()])if(name.startsWith('data-'))stage.removeAttribute(name);
      stage.removeAttribute('style');stage.style.cssText='position:fixed;inset:0';
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      const byTurn=new Map([[7,rolls]]);
      const ransom=createStageLabels({React,Icon:()=>null,document,getComputedStyle,ResizeObserver,requestAnimationFrame,cancelAnimationFrame});
      const backlogRows=createStageBacklogRows({registry:()=>({get:kind=>kind==='core.dice.roll'?{kind,backlog:{renderer:'dice',role:'notice'}}:null,list:()=>[]}),core:[]});
      const backlogHistory=createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}});
      const backlogPaging=createStageBacklogPaging({React,hasOlder:()=>false});
      const backlogVoice=createStageBacklogVoice({player});
      const VoiceButton=()=>h('button',{type:'button',className:'fork-voice-button','aria-label':'重播这一句'},'▶');
      const Icon=({name,size})=>h('svg',{className:'fork-icon','data-icon':name,width:size,height:size,'aria-hidden':true});
      const view=createStageBacklogView({React,window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,modClients:{slot:name=>name==='backlog'?[{modId:'dsh.dice',value:{kind:'core.dice.roll',use:()=>byTurn,entries:diceBacklogEntries,line:diceLine}}]:[]},useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},
        bubbleCharacter:()=>null,galQuoted:t=>t,VoiceButton,PackImage:()=>null,Icon,HelpTip:()=>null,Spinner:()=>null,ransom,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame});
      window.root?.unmount();
      window.root=ReactDOM.createRoot(stage);
      window.root.render(h(view.Backlog,{sessionId:'s',turn:1,page:pages.length-1,pages:pages.map(p=>({...p,voice:{...p.voice,click(){}}})),looks:skin.looks,textIndex:new Map([[1,{nativeTurn:7}]]),
        colorOf:()=>'',avatarOf:()=>null,nameOf:a=>a,voiceOf:()=>null,onJump(){},onClose(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,pages,rolls])=>mountBacklog(skin,pages,rolls),[skin,PAGES,ROLLS])
  return {page,errors}
}
const rollRows=page=>page.evaluate(()=>[...document.querySelectorAll('.fork-gal-backlog-roll')].map(row=>{
  const style=node=>node && getComputedStyle(node),mark=row.querySelector('.fork-gal-backlog-roll-mark'),icon=row.querySelector('.fork-icon')
  const value=row.querySelector('.fork-roll-value'),tier=row.querySelector('.fork-roll-tier'),r=mark?.getBoundingClientRect()
  return {tier:row.dataset.tier,text:row.textContent,line:diceText(row.dataset.tier==='success'?{check:'推理',roll:17,tier:'success'}:{check:'说服',roll:4,tier:'fumble'}),
    mark:mark ? {shown:style(mark).display,image:style(mark).backgroundImage,width:r.width,height:r.height} : null,icon:icon ? style(icon).display : null,
    value:{color:style(value).color,size:parseFloat(style(value).fontSize),line:parseFloat(style(value.parentElement).fontSize)},
    tile:{color:style(tier).color,ground:style(tier).backgroundColor},right:row.getBoundingClientRect().right}
}))

test('wide: the skin\'s mark replaces the die, the number takes its ink and scale, each tier its tile; the words are the engine\'s line',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const plain=structuredClone(fixture);delete plain.art.backlog.roll;delete plain.devices
  const {page,errors}=await open(browser,skinOf(plain),{width:1920,height:1080})
  const baseline=await rollRows(page)
  assert.equal(baseline.length,2,'both open checks are in the 履历')
  assert.ok(baseline.every(row=>row.mark===null && row.icon!=='none'),'without roll art: the generic die, no mark node')
  await page.evaluate(([skin,pages,rolls])=>mountBacklog(skin,pages,rolls),[skinOf(fixture),PAGES,ROLLS])
  const [success,fumble]=await rollRows(page)
  assert.deepEqual(errors,[])
  for(const [row,plain] of [[success,baseline[0]],[fumble,baseline[1]]]){
    assert.equal(row.text,plain.text,'the row reads exactly as without the skin');assert.equal(row.text,row.line,'the engine\'s check line')
    assert.equal(row.icon,'none','the generic die is hidden');assert.notEqual(row.mark.shown,'none','the mark shows')
    assert.match(row.mark.image,/^url\("data:image\/svg\+xml/,'the skin\'s mark image');assert.ok(Math.abs(row.mark.width/row.mark.height-72/56)<0.02 && row.mark.width>16,`the mark at its size (${row.mark.width}x${row.mark.height})`)
    assert.equal(row.value.color,'rgb(216, 178, 90)','total: the declared ink');assert.ok(Math.abs(row.value.size-1.6*row.value.line)<0.6,`total: scaled 1.6 (${row.value.size} / ${row.value.line})`)
  }
  assert.deepEqual(success.tile,{color:'rgb(20, 18, 26)',ground:'rgb(216, 178, 90)'},'a success on the success tile')
  assert.deepEqual(fumble.tile,{color:'rgb(255, 255, 255)',ground:'rgb(122, 18, 34)'},'a fumble on the fail tile')
  // film mode (off the art layer): the die again, no mark
  await page.evaluate(()=>document.querySelector('.fork-gal-stage').classList.add('is-film'))
  const film=await rollRows(page)
  assert.ok(film.every(row=>row.mark.shown==='none' && row.icon!=='none' && row.tile.ground==='rgba(0, 0, 0, 0)'),'film mode: the plain line')
})

test('a 390 px phone: the phone\'s own mark and success tile, the fail tile kept from the wide skin, no sideways overflow',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const phone=contract.stageSkinForDevice(contract.validateStageSkin(structuredClone(fixture)),'mobile')
  const {page,errors}=await open(browser,skinOf(phone),{width:390,height:844})
  const [success,fumble]=await rollRows(page)
  assert.deepEqual(errors,[])
  assert.notEqual(success.mark.shown,'none');assert.ok(Math.abs(success.mark.width-success.mark.height)<0.5,'the square phone mark')
  assert.deepEqual(success.tile,{color:'rgb(255, 255, 255)',ground:'rgb(29, 63, 191)'})
  assert.equal(fumble.tile.ground,'rgb(122, 18, 34)')
  assert.equal(success.text,success.line)
  assert.ok(Math.max(success.right,fumble.right)<=390,'no sideways overflow')
})
