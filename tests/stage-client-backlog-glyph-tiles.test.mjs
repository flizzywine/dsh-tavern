// art.backlog glyph tiles (C2): the 履历's speaker names and turn rule cut into glyph tiles by the name plate's ransom picker
// (labels.cjs), the backlog's own tiles (else the menu's) with one accent glyph per word, and name.align end. The validator
// requires tiles for a ransom word and keeps every tile at 4.5:1; the real view, skin adapter and stage CSS run in Chromium.
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
const fixture=JSON.parse(await readFile(new URL('./fixtures/stage-skins/backlog-glyph-tiles.json',import.meta.url),'utf8'))
const TILES=fixture.art.backlog.glyphTiles.tiles.length

const edit=change=>{const doc=structuredClone(fixture);change(doc.art.backlog,doc);return doc}
const refused=(doc,code,pattern)=>assert.throws(()=>contract.validateStageSkin(doc),error=>error.code===code && pattern.test(error.message),pattern.source)

test('the poster sample validates; a ransom word needs glyph tiles, the backlog\'s own or the menu\'s',()=>{
  contract.validateStageSkin(structuredClone(fixture))
  assert.ok(contract.stageSkinFiles(fixture).includes('art/poster-bar.webp'))
  refused(edit(b=>delete b.glyphTiles),'INVALID_SKIN',/art\.backlog: name\.letter.*needs glyph tiles/)
  refused(edit(b=>{delete b.glyphTiles;delete b.name.letter}),'INVALID_SKIN',/plates\.divider\.letter ransom needs glyph tiles/)
  // the menu's tiles stand in
  contract.validateStageSkin(edit((b,doc)=>{delete b.glyphTiles;doc.art.menu={sheet:'art/menu.webp',
    rows:{images:{plain:'art/row.webp',focus:'art/row-on.webp'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10,letter:'ransom'},
    glyphTiles:{shape:'square',tiles:[{ground:'#1a1a1a',ink:'#ffffff'}]}}}))
  // only the divider plate takes a letter; align is end only
  assert.throws(()=>contract.validateStageSkin(edit(b=>{b.plates.speech={images:[{image:'art/p.webp',ground:'#ffffff',ink:'#111111'}],slice:[8,8,8,8],letter:'ransom'}})),{code:'INVALID_SKIN'})
  assert.throws(()=>contract.validateStageSkin(edit(b=>{b.name.align='start'})),{code:'INVALID_SKIN'})
})

test('every backlog tile and the accent tile keep 4.5:1, named in the message',()=>{
  refused(edit(b=>{b.glyphTiles.accent.tile={ground:'#808080',ink:'#777777'}}),'SKIN_CONTRAST',/art\.backlog\.glyphTiles\.accent\.tile: ink #777777 on ground #808080 is 1\.\d+:1, needs 4\.5:1/)
  refused(edit(b=>{b.glyphTiles.tiles[2]={ground:'#f2c230',ink:'#ffffff'}}),'SKIN_CONTRAST',/art\.backlog\.glyphTiles\.tiles\[2\]/)
  // a phone side is checked merged, under its own name
  refused(edit((b,doc)=>{doc.devices={mobile:{art:{backlog:{glyphTiles:{shape:'square',tiles:[{ground:'#808080',ink:'#777777'}]}}}}}}),'SKIN_CONTRAST',/devices\.mobile\.art\.backlog\.glyphTiles\.tiles\[0\]/)
})

const svg=fill=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="${fill}"/></svg>`)
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const skinOf=document=>{
  const files=Object.fromEntries(contract.stageSkinFiles(document).map(name=>[name,{url:svg('#1a1a1a'),image:{naturalWidth:200,naturalHeight:100}}]))
  const art=adapter.stageSkinArt(document,files);assert.ok(art,'the art layer draws');return {marks:art.marks,tokens:art.tokens,looks:adapter.stageSkinBacklog(document)}
}
const PAGES=[['摩尔加纳','把这句话记下来。'],['A','短名。'],['摩尔加纳','再说一次。']].map(([alias,text],i)=>({kind:'line',alias,text,para:i+1,voice:{id:'v'+i,owner:'o'}}))

async function open(browser,skin,viewport){
  const page=await browser.newPage({viewport}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  const sources=(await Promise.all(['labels.cjs','backlog-rows.cjs','backlog-history.cjs','backlog-paging.cjs','backlog-voice.cjs','backlog-view.cjs'].map(client))).join('\n')
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${sources}
    window.mountBacklog=(skin,pages)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage'),h=React.createElement,player={get:()=>null,subscribe:()=>()=>{}};
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      const ransom=createStageLabels({React,Icon:()=>null,document,getComputedStyle,ResizeObserver,requestAnimationFrame,cancelAnimationFrame});
      const backlogRows=createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]});
      const backlogHistory=createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}});
      const backlogPaging=createStageBacklogPaging({React,hasOlder:()=>false});
      const backlogVoice=createStageBacklogVoice({player});
      const VoiceButton=()=>h('button',{type:'button',className:'fork-voice-button','aria-label':'重播这一句'},'▶');
      const view=createStageBacklogView({React,window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},
        bubbleCharacter:()=>null,galQuoted:t=>t,VoiceButton,PackImage:()=>null,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,ransom,getComputedStyle,ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame});
      window.root?.unmount();
      window.root=ReactDOM.createRoot(stage);
      window.root.render(h(view.Backlog,{sessionId:'s',turn:1,page:pages.length-1,pages:pages.map(p=>({...p,voice:{...p.voice,click(){}}})),looks:skin.looks,
        colorOf:()=>'',avatarOf:()=>'',nameOf:a=>a,voiceOf:()=>null,onJump(){},onClose(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,pages])=>mountBacklog(skin,pages),[skin,PAGES])
  return {page,errors}
}
const names=page=>page.evaluate(()=>[...document.querySelectorAll('.fork-gal-backlog-row.is-line')].map(row=>{
  const name=row.querySelector('.fork-gal-backlog-name b'),blocks=[...name.querySelectorAll('.fork-gal-ransom > i:not(.fork-gal-ransom-gap)')]
  return {text:name.querySelector('.fork-gal-ransom-text')?.textContent,tiles:blocks.map(i=>i.dataset.t),shown:blocks.length>0 && getComputedStyle(name.querySelector('.fork-gal-ransom')).display,
    right:name.getBoundingClientRect().right,textLeft:row.querySelector('.fork-gal-backlog-text').getBoundingClientRect().left,
    voiceLeft:row.querySelector('.fork-voice-button').getBoundingClientRect().left,
    ground:blocks.map(i=>getComputedStyle(i).backgroundColor)}
}))

test('摩尔加纳 is four tiles with one stable accent, right-aligned on the text column; the row reads its plain name',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const skin=skinOf(fixture),{page,errors}=await open(browser,skin,{width:1920,height:1080})
  const rows=await names(page)
  assert.deepEqual(errors,[])
  const [first,short,again]=rows
  assert.equal(first.text,'摩尔加纳')
  assert.equal(first.tiles.length,4,'one tile per glyph')
  assert.equal(first.tiles.filter(tile=>tile===String(TILES)).length,1,'exactly one accent glyph')
  assert.equal(first.ground[first.tiles.indexOf(String(TILES))],'rgb(214, 47, 47)','the accent tile\'s ground')
  assert.deepEqual(again.tiles,first.tiles,'the same word picks the same tiles')
  assert.equal(short.tiles.filter(tile=>tile===String(TILES)).length,1,'a one-glyph name is its own accent')
  for(const row of rows){
    assert.equal(row.shown,'inline-flex')
    assert.ok(Math.abs(row.right-row.textLeft)<=1,`name right ${row.right} on the text column ${row.textLeft}`)
    assert.ok(row.voiceLeft>=row.right-1,'the replay control stays after the name')
  }
  assert.ok(Math.abs(rows[1].right-rows[0].right)<=1,'long and short names share the right edge')
  // the accessible name: the plain name once, no glyph-by-glyph reading
  const snapshot=await page.locator('.fork-gal-backlog-row.is-line').first().ariaSnapshot()
  assert.match(snapshot,/^- button "摩尔加纳 重播这一句 /);assert.doesNotMatch(snapshot,/摩 尔/)
  // the divider: 第 1 轮 · 本轮 as tiles on its plate, its text unchanged
  const divider=await page.evaluate(()=>{const turn=document.querySelector('.fork-gal-backlog-turn');return {plate:turn.dataset.blPlate,text:turn.querySelector('.fork-gal-ransom-text').textContent,
    tiles:turn.querySelectorAll('.fork-gal-ransom > i:not(.fork-gal-ransom-gap)').length,shown:getComputedStyle(turn.querySelector('.fork-gal-ransom')).display}})
  assert.deepEqual(divider,{plate:'0',text:'第 1 轮 · 本轮',tiles:6,shown:'inline-flex'})
  // re-render: the same accent index
  await page.evaluate(([skin,pages])=>mountBacklog(skin,pages),[skin,PAGES])
  assert.deepEqual((await names(page))[0].tiles,first.tiles)
})

test('on a 390 px phone the tiles stay; a skin without the letter keeps the plain name',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  {
    const {page,errors}=await open(browser,skinOf(fixture),{width:390,height:844})
    const [first]=await names(page)
    assert.deepEqual(errors,[])
    assert.equal(first.shown,'inline-flex');assert.equal(first.tiles.length,4)
    await page.close()
  }
  const bare=edit(b=>{delete b.name.letter;delete b.name.align;delete b.plates.divider.letter;delete b.glyphTiles})
  const {page,errors}=await open(browser,skinOf(bare),{width:1920,height:1080})
  assert.deepEqual(errors,[])
  assert.equal(await page.locator('.fork-gal-backlog .fork-gal-ransom').count(),0)
  assert.equal(await page.locator('.fork-gal-backlog-name b').first().textContent(),'摩尔加纳')
})
