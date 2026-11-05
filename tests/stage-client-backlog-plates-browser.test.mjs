// art.backlog.plates (C1) on the real 履历 view, skin adapter and stage CSS in Chromium, at 1920 x 1080 (one design px = one CSS
// px) and a 390 px phone. Speech rows cycle their plate images and poses by their place among the speech rows and read in the
// image's ink; a turned plate keeps its hit area, its highlight is the plate's box, and slant skews only the words. A skin
// without plates draws no plate.
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
const fixture=JSON.parse(await readFile(new URL('./fixtures/stage-skins/backlog-plates.json',import.meta.url),'utf8'))

// The sample's wide plates with speech poses (two, so the third speech row is back on the first) and a slant.
const POSES=[{x:-12,rot:-1.5},{x:18,y:4,rot:2}], OUT=fixture.art.backlog.plates.speech.out
const doc=structuredClone(fixture);delete doc.devices
Object.assign(doc.art.backlog.plates.speech,{poses:POSES,slant:8})
contract.validateStageSkin(doc)
const bare=structuredClone(doc);delete bare.art.backlog.plates

const svg=fill=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="${fill}"/></svg>`)
const grounds=Object.fromEntries(Object.values(fixture.art.backlog.plates).flatMap(plate=>plate.images.map(item=>[item.image,item.ground])))
const files=Object.fromEntries(contract.stageSkinFiles(doc).map(name=>[name,{url:svg(grounds[name] || '#444444'),image:{naturalWidth:200,naturalHeight:100}}]))
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const skinOf=document=>{const resources={...files,...Object.fromEntries(contract.stageSkinFiles(document).filter(name=>!files[name]).map(name=>[name,{url:svg("#f1ead9"),image:{naturalWidth:200,naturalHeight:100}}]))};const art=adapter.stageSkinArt(document,resources);assert.ok(art,'the art layer draws');return {marks:art.marks,tokens:art.tokens,looks:adapter.stageSkinBacklog(document)}}
const rgb=hex=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')'

const PAGES=[['小夜','第一句台词，说得很长很长一点，好让这一行有些分量。'],['月见里','第二句。'],[null,'夜风从窗外吹进来。'],['小夜','第三句，现在这一页。']]
  .map(([alias,text],i)=>alias ? {kind:'line',alias,text,para:i+1,voice:{id:'v'+i,owner:'o'}} : {kind:'narration',text,para:i+1})

async function open(browser,skin,viewport){
  const page=await browser.newPage({viewport}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  const sources=(await Promise.all(['backlog-rows.cjs','backlog-history.cjs','backlog-paging.cjs','backlog-voice.cjs','backlog-view.cjs'].map(client))).join('\n')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${sources}
    window.mountBacklog=(skin,pages)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage'),h=React.createElement,player={get:()=>null,subscribe:()=>()=>{}};
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      const backlogRows=createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]});
      const backlogHistory=createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}});
      const backlogPaging=createStageBacklogPaging({React,hasOlder:()=>false});
      const backlogVoice=createStageBacklogVoice({player});
      const VoiceButton=()=>h('button',{type:'button',className:'fork-voice-button'},'▶');
      const view=createStageBacklogView({React,window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},
        bubbleCharacter:()=>null,galQuoted:t=>t,VoiceButton,PackImage:()=>null,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame});
      ReactDOM.createRoot(stage).render(h(view.Backlog,{sessionId:'s',turn:1,page:pages.length-1,pages:pages.map(p=>p.voice?{...p,voice:{...p.voice,click(){}}}:p),inputs:{1:'我推开了门。'},looks:skin.looks,
        colorOf:()=>'',avatarOf:()=>'',nameOf:a=>a,voiceOf:()=>null,onJump(){},onClose(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,pages])=>mountBacklog(skin,pages),[skin,PAGES])
  return {page,errors}
}
const read=page=>page.evaluate(()=>[...document.querySelectorAll('.fork-gal-backlog-col > :is(.fork-gal-backlog-turn, .fork-gal-backlog-input, .fork-gal-backlog-card, .fork-gal-backlog-row)')].map(el=>{
  const style=getComputedStyle(el),paint=getComputedStyle(el.querySelector('.fork-gal-backlog-plate') || el),text=el.querySelector('.fork-gal-backlog-text, :scope > p, :scope > span'),voice=el.querySelector('.fork-voice-button')
  return {role:el.dataset.blRole || null,plate:el.dataset.blPlate ?? null,pose:el.dataset.blPose ?? null,here:el.classList.contains('is-here'),
    image:paint.borderImageSource,outset:paint.borderImageOutset,transform:style.transform,ink:text && getComputedStyle(text).color,textTransform:text && getComputedStyle(text).transform,
    voiceTransform:voice && getComputedStyle(voice).transform,before:(b=>({content:b.content,transform:b.transform,t:b.top,r:b.right,b:b.bottom,l:b.left}))(getComputedStyle(el,'::before'))}
}))

test('plated speech rows cycle images and poses, read in the ink and keep their hit area and highlight on the plate',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const {page,errors}=await open(browser,skinOf(doc),{width:1920,height:1080})
  const rows=await read(page),speech=rows.filter(row=>row.role==='speech'),[ink0,ink1]=fixture.art.backlog.plates.speech.images.map(item=>item.ink)
  assert.deepEqual(errors,[])
  assert.deepEqual(rows.map(row=>row.role),['divider','player','speech','speech','narration','speech'],'every role on its plate, in reading order')
  assert.deepEqual(speech.map(row=>[row.plate,row.pose]),[['0','0'],['1','1'],['0','0']],'images and poses cycle by place among the speech rows')
  assert.ok(speech[0].image.includes(encodeURIComponent('#1d1828')) && speech[1].image.includes(encodeURIComponent('#e9e2d2')),'images[0] then images[1]')
  assert.deepEqual(speech.map(row=>row.ink),[rgb(ink0),rgb(ink1),rgb(ink0)],'each body in its image ink')
  assert.equal(speech[0].outset,OUT.map(n=>n+'px').join(' '),'the plate overhangs by out')
  // the third speech row carries poses[2 % 2]: -12 px, -1.5deg
  const r=-1.5*Math.PI/180,m=speech[2].transform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number)
  for(const [got,want] of m.map((v,i)=>[v,[Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),-12,0][i]]))assert.ok(Math.abs(got-want)<1e-3,speech[2].transform)
  // slant skews the words only: the voice control and the highlight stay upright
  for(const row of speech){assert.match(row.textTransform,/^matrix\(1, 0, -?0\.1\d+, 1, 0, 0\)$/,'skewed words');assert.equal(row.voiceTransform,'none')}
  const here=rows.find(row=>row.here)
  assert.equal(here,speech[2])
  assert.equal(here.before.transform,'none')
  assert.deepEqual([here.before.t,here.before.r,here.before.b,here.before.l],OUT.map(n=>-n+'px'),'the highlight is the plate box')
  // elementFromPoint at the turned plate's centre hits that row
  const hit=await page.evaluate(([out,rot])=>{
    const row=document.querySelector('.fork-gal-backlog-row.is-here'),box=row.getBoundingClientRect(),[t,r,b,l]=out,a=rot*Math.PI/180,dx=(r-l)/2,dy=(b-t)/2
    const x=box.left+box.width/2+dx*Math.cos(a)-dy*Math.sin(a),y=box.top+box.height/2+dx*Math.sin(a)+dy*Math.cos(a)
    return document.elementFromPoint(x,y)?.closest('[data-bl-role]')===row
  },[OUT,-1.5])
  assert.equal(hit,true)
  // the other roles: the player's poses, narration's slant, the divider on its plate without the shared rule
  const player=rows.find(row=>row.role==='player'),divider=rows.find(row=>row.role==='divider'),narration=rows.find(row=>row.role==='narration')
  assert.equal(player.pose,'0');assert.notEqual(player.transform,'none');assert.equal(player.ink,rgb('#ffffff'))
  assert.match(narration.textTransform,/^matrix\(1, 0, -0\.17\d*, 1, 0, 0\)$/)
  assert.equal(divider.before.content,'none');assert.equal(divider.ink,rgb('#e8c26a'))
  // the tab order is the reading order
  const order=await page.evaluate(()=>{const list=[...document.querySelectorAll('.fork-gal-backlog-col [tabindex="0"]')];return list.map(el=>el.dataset.forkStagePara)})
  assert.deepEqual(order,['1','2','3','4'])
})

test('on a 390 px phone plated rows keep their plate and ink; a skin without plates draws none',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  {
    const {page,errors}=await open(browser,skinOf(doc),{width:390,height:844})
    const speech=(await read(page)).filter(row=>row.role==='speech')
    assert.deepEqual(errors,[])
    assert.deepEqual(speech.map(row=>row.plate),['0','1','0'])
    for(const row of speech)assert.match(row.image,/^url\("data:image\/svg/)
    assert.equal(speech[1].ink,rgb(fixture.art.backlog.plates.speech.images[1].ink))
    await page.close()
  }
  const {page,errors}=await open(browser,skinOf(bare),{width:1920,height:1080})
  const rows=await read(page)
  assert.deepEqual(errors,[])
  assert.ok(rows.every(row=>row.plate===null && row.image==='none' && row.transform==='none'),JSON.stringify(rows))
  assert.equal(await page.evaluate(()=>document.querySelector('.fork-gal-backlog-turn').hasAttribute('data-bl-role')),false)
})

for(const file of ['backlog-plates.json','backlog-plates-paper.json']) test(file + ': highlight under plate, source scale and right name voice anchor',{timeout:90000},async t=>{
  const document=JSON.parse(await readFile(new URL('./fixtures/stage-skins/'+file,import.meta.url),'utf8'));delete document.devices
  document.art.backlog.name.align='end'
  document.art.backlog.narrow={unit:.5}
  document.art.backlog.plates.speech.scale ??= .5
  contract.validateStageSkin(document)
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  for(const viewport of [{width:1920,height:1080},{width:390,height:844}]) {
    const {page,errors}=await open(browser,skinOf(document),viewport)
    assert.deepEqual(errors,[])
    for(const selector of ['.fork-gal-backlog-row.is-here','.fork-gal-backlog-row.is-line']) {
      const row=page.locator(selector).first()
      if(viewport.width<768)await row.focus()
      else await row.hover()
      const state=await row.evaluate(el=>{
        const plate=el.querySelector('.fork-gal-backlog-plate'),p=getComputedStyle(plate),before=getComputedStyle(el,'::before')
        const name=el.querySelector('.fork-gal-backlog-name b').getBoundingClientRect(),voice=el.querySelector('.fork-voice-button').getBoundingClientRect()
        return {plateZ:p.zIndex,highlightZ:before.zIndex,highlight:before.content,slice:p.borderImageSlice,width:p.borderImageWidth,gap:voice.left-name.right,nameWidth:name.width,voiceWidth:voice.width}
      })
      assert.equal(state.highlight,'""')
      assert.ok(Number(state.highlightZ)<Number(state.plateZ),'highlight paints under the plate, not over its text')
      const plate=document.art.backlog.plates.speech,scale=Array.isArray(plate.scale)?plate.scale:[plate.scale,plate.scale]
      const slice=Array.isArray(plate.slice)?plate.slice:plate.slice.edges
      const unit=viewport.width===1920?1:.5
      const edges=value=>{const n=value.split(' ').filter(v=>v!=='fill').map(parseFloat);return [n[0],n[1]??n[0],n[2]??n[0],n[3]??n[1]??n[0]]}
      assert.deepEqual(edges(state.slice),slice)
      assert.deepEqual(edges(state.width),slice.map((n,i)=>n*scale[i%2===0?1:0]*unit))
      assert.ok(Math.abs(state.gap)<16,'voice stays next to the name: '+JSON.stringify(state))
      assert.ok(state.nameWidth>0 && state.voiceWidth>0)
    }
    await page.close()
  }
})
