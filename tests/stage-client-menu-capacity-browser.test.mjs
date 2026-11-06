// The Esc menu's card-page rows and its capacity on the real menu (menu.cjs), skin adapter and stage CSS in Chromium, under two
// drawn skins: a tile grid on a device frame (art.menu.tiles with placed lens tiles, plain / plainFocus and minScale) and image
// bars (art.menu.rows). A card page's row is the same element as a built-in row, so the skin alone draws it: under the pointer
// it takes the same look as a built-in row. With 9 entries every row stays inside the menu's area; with more, the tile grid
// first tightens, then scrolls inside its fit height (focus kept in view, an indicator at each clipped edge, the placed tiles
// staying put), and the bars scroll inside rows.fit. At 390 px both skins fall back to the shared panel, whose rows stay on screen.
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

const paint={textbox:{paint:{bg:'#101418',fg:'#e6fffb',accent:'#7ff5e6',onAccent:'#04161b'}},nameplate:{shape:'plain',paint:{bg:'#101418',fg:'#e6fffb'}},font:{},textFx:{reveal:'type'}}
const row={image:'art/row.svg',focus:'art/row-focus.svg'}
const TILES=contract.validateStageSkin({schema:'dsh.skin/1',id:'menu-capacity-tiles',label:'镜片',...paint,art:{screen:1080,screenWidth:1920,menu:{
  frame:{image:'art/case.svg',x:560,y:40},dim:.5,
  tiles:{x:100,y:80,w:600,h:60,pitch:[0,72],cols:1,fit:420,minScale:.8,plain:'art/row.svg',plainFocus:'art/row-focus.svg',
    art:{resume:{image:'art/lens.svg',focus:'art/lens-focus.svg',at:[120,700]},config:{image:'art/lens.svg',focus:'art/lens-focus.svg',at:[480,700]},
      backlog:row,gallery:row,regenerate:row,keys:row,leave:row},
    label:{y:30,font:30,ink:'#e6fffb',focusInk:'#04161b',align:'start',x:24}}}}})
const ROWS=contract.validateStageSkin({schema:'dsh.skin/1',id:'menu-capacity-rows',label:'横条',...paint,art:{screen:1080,screenWidth:1920,menu:{
  rows:{images:{plain:'art/bar.svg',focus:'art/bar-focus.svg'},slice:[8,8,8,8],text:[24,560,30],font:28,x:640,y:180,gap:10,fit:640,ink:'#e6fffb',focusInk:'#04161b'}}}})
const svg=(w,h,fill)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`)
const ART={'art/case.svg':[800,1000,'#2b2e33'],'art/row.svg':[600,60,'#15181c'],'art/row-focus.svg':[600,60,'#7ff5e6'],'art/lens.svg':[200,200,'#3a3e44'],
  'art/lens-focus.svg':[200,200,'#7ff5e6'],'art/bar.svg':[600,60,'#15181c'],'art/bar-focus.svg':[600,60,'#7ff5e6']}
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
function skinOf(document){
  const files=Object.fromEntries(contract.stageSkinFiles(document).map(name=>{const [w,h,fill]=ART[name];return [name,{url:svg(w,h,fill),image:{naturalWidth:w,naturalHeight:h}}]}))
  const art=adapter.stageSkinArt(document,files);assert.ok(art,document.id+' draws its art');return art
}
const pages=n=>[{id:'status',label:'状态',shortcut:'s',menu:true},{id:'map',label:'地图',shortcut:'m',menu:true},
  ...Array.from({length:n-2},(_,i)=>({id:'p'+i,label:'页面'+(i+1),menu:true}))]

async function open(browser,skin,viewport,pageCount){
  const page=await browser.newPage({viewport}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage is-menu" data-theme="classic" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${await client('menu.cjs')}
    window.mountMenu=(skin,pages)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage');
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      const store={select:()=>({subscribe:()=>()=>{},getSnapshot:()=>false,dispose(){}})};
      const menu=createStageMenu({React,window,document,sounds:{play(){}},getSession:()=>store});
      window.opened=[];
      ReactDOM.createRoot(stage).render(React.createElement(menu.Menu,{sessionId:'s',latestTurn:1,controls:[],pages,
        onClose(){},onPage:id=>window.opened.push(id),onBacklog(){},onGallery(){},onConfig(){},onKeys(){},onLatest(){},onLeave(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,pages])=>mountMenu(skin,pages),[{marks:skin.marks,tokens:skin.tokens},pages(pageCount)])
  return {page,errors}
}
// The look of one row: its paint (the tile image, a bar's border image, the ground) and its words' ink.
const look=(page,id)=>page.locator(`.fork-gal-menu-item[data-item="${id}"]`).evaluate(el=>{
  const own=getComputedStyle(el),tile=getComputedStyle(el,'::before'),words=getComputedStyle(el.querySelector('b'))
  return {tile:tile.backgroundImage,bar:own.borderImageSource,ground:own.backgroundColor,ink:words.color,active:el.classList.contains('is-active'),focused:document.activeElement===el}
})
// read after the list's scroll event has marked its edges (two frames)
const boxes=async page=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.evaluate(()=>{
  const list=document.querySelector('.fork-gal-menu-list'),area=list.getBoundingClientRect()
  return {area:{top:area.top,bottom:area.bottom,left:area.left,right:area.right},more:list.dataset.more || '',
    rows:[...list.querySelectorAll('.fork-gal-menu-item')].map(el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el)
      return {id:el.dataset.item,placed:style.position==='absolute',top:box.top,bottom:box.bottom,left:box.left,right:box.right,height:box.height}}),
    indicators:[...document.querySelectorAll('.fork-gal-menu-more')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.edge)}
})}
const inside=(box,area)=>box.top>=area.top-1 && box.bottom<=area.bottom+1 && box.left>=area.left-1 && box.right<=area.right+1

for(const [name,doc] of [['tiles',TILES],['rows',ROWS]]){
  test(`${name}: a card page's row takes the built-in rows' look under the pointer; 9 entries stay inside the menu area`,{timeout:90000},async t=>{
    const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
    const {page,errors}=await open(browser,skinOf(doc),{width:1920,height:1080},2)
    assert.deepEqual(await page.locator('.fork-gal-menu-item').evaluateAll(els=>els.map(el=>el.dataset.item)),
      ['resume','backlog','page:status','page:map','gallery','regenerate','config','keys','leave'],'the card pages are rows in the menu order (and its focus order)')
    const rest=await look(page,'page:map')
    await page.locator('.fork-gal-menu-item[data-item="gallery"]').hover()
    const builtIn=await look(page,'gallery')
    await page.locator('.fork-gal-menu-item[data-item="page:map"]').hover()
    const card=await look(page,'page:map')
    assert.ok(card.active && card.focused,'the hovered card row is the focused row')
    assert.deepEqual({...card,active:0,focused:0},{...builtIn,active:0,focused:0},'the hovered card row looks as a hovered built-in row')
    assert.notDeepEqual(card,rest,'the card row has a hover look')
    // keyboard: ↓ from the card row walks on to 回想, the same roving focus
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.item),'gallery')
    await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter')
    assert.deepEqual(await page.evaluate(()=>window.opened),['map'])
    const {area,rows}=await boxes(page)
    const viewport={top:0,left:0,bottom:1080,right:1920}
    assert.equal((await boxes(page)).more,'','9 entries need no scrolling')
    for(const row of rows.filter(row=>!row.placed))assert.ok(inside(row,area) && inside(row,viewport),`${row.id} stays inside the menu area: ${JSON.stringify(row)} in ${JSON.stringify(area)}`)
    assert.deepEqual(errors,[])
  })
}

test('tiles: more rows tighten, then scroll inside fit with an indicator, focus kept in view and the placed tiles put',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  {
    // 9 entries: 7 grid rows close their gaps (pitch 72 -> 60) and fit without scaling below 1
    const {page}=await open(browser,skinOf(TILES),{width:1920,height:1080},2)
    const {rows,more,indicators}=await boxes(page),grid=rows.filter(row=>!row.placed)
    assert.equal(more,'');assert.deepEqual(indicators,[])
    assert.ok(Math.abs(grid[1].top-grid[0].bottom)<1,'the gaps closed first')
    await page.close()
  }
  const {page,errors}=await open(browser,skinOf(TILES),{width:1920,height:1080},12)
  const before=await boxes(page),grid=before.rows.filter(row=>!row.placed),placed=before.rows.filter(row=>row.placed)
  assert.ok(before.area.bottom-before.area.top<=420*1080/1080+1,'the grid holds its fit height')
  assert.ok(grid[0].height>=60*.8-1,'not scaled below minScale: '+grid[0].height)
  assert.equal(before.more,'down');assert.deepEqual(before.indicators,['down'])
  assert.deepEqual(placed.map(row=>row.id),['resume','config'])
  await page.keyboard.press('End')
  const after=await boxes(page),last=after.rows.find(row=>row.id==='leave')
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.item),'leave')
  assert.ok(inside(last,after.area),'the focused last row is in view: '+JSON.stringify([last,after.area,after.more]))
  assert.equal(after.more,'up');assert.deepEqual(after.indicators,['up'])
  assert.deepEqual(after.rows.filter(row=>row.placed).map(({top,left})=>({top,left})),placed.map(({top,left})=>({top,left})),'the placed tiles stay put')
  // Home: the placed 回到舞台 (no scroll for it); ↓ then the first grid row, scrolled back into view
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown')
  const top=await boxes(page)
  assert.ok(inside(top.rows.find(row=>row.id==='backlog'),top.area));assert.equal(top.more,'down')
  assert.deepEqual(errors,[])
})

test('at 390 px both skins keep every card and built-in row on screen in the shared panel',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  for(const doc of [TILES,ROWS]){
    const {page,errors}=await open(browser,skinOf(doc),{width:390,height:844},2)
    const {rows}=await boxes(page)
    assert.equal(rows.length,9)
    for(const row of rows)assert.ok(inside(row,{top:0,left:0,bottom:844,right:390}),doc.id+' '+row.id+' on screen: '+JSON.stringify(row))
    assert.deepEqual(errors,[])
    await page.close()
  }
})

test('rows: more bars than fit scroll inside it with an indicator, the focused bar kept in view',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const {page,errors}=await open(browser,skinOf(ROWS),{width:1920,height:1080},6)
  const before=await boxes(page)
  assert.ok(before.area.bottom-before.area.top<=640*1080/1080+1,'the bars hold their fit height')
  assert.equal(before.more,'down');assert.deepEqual(before.indicators,['down'])
  await page.keyboard.press('End')
  const after=await boxes(page)
  assert.ok(inside(after.rows.find(row=>row.id==='leave'),after.area),'the focused last bar is in view')
  assert.equal(after.more,'up');assert.deepEqual(after.indicators,['up'])
  await page.mouse.move(960,400);await page.mouse.wheel(0,-2000);await page.waitForTimeout(100)
  assert.equal((await boxes(page)).more,'down','the wheel scrolls the list back')
  assert.deepEqual(errors,[])
})