// The stage draws no native scrollbar (theme.css «stage scrollbars»): the real Esc menu (menu.cjs), skin adapter and stage CSS
// in Chromium with an overflowing menu, and an overflowing 履历 list and CONFIG page (their stage classes). Under a skin that
// declares no scrollbars each measures a scrollbar width of 0 and still scrolls (wheel and keys; the menu keeps its focused
// row in view). A second, different skin opts the menu and the 履历 into styled ones (scrollbars.menu / .backlog): those show
// at the declared width and colour, CONFIG still shows none. Chromium runs with its scrollbars on (Playwright's headless
// default --hide-scrollbars would hide them all).
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
// two different skins: image bars with no scrollbars declared; a tile grid whose menu and 履历 show styled ones
const PLAIN=contract.validateStageSkin({schema:'dsh.skin/1',id:'scrollbars-none',label:'无滑条',...paint,art:{screen:1080,screenWidth:1920,menu:{
  rows:{images:{plain:'art/bar.svg',focus:'art/bar-focus.svg'},slice:[8,8,8,8],text:[24,560,30],font:28,x:640,y:180,gap:10,fit:400,ink:'#e6fffb',focusInk:'#04161b'}}}})
const SHOWN=contract.validateStageSkin({schema:'dsh.skin/1',id:'scrollbars-shown',label:'有滑条',...paint,
  scrollbars:{menu:{thumb:'#7ff5e6',track:'#15181c',width:8},backlog:{thumb:'#e6fffb',width:10}},
  art:{screen:1080,screenWidth:1920,menu:{tiles:{x:100,y:80,w:600,h:60,pitch:[0,72],cols:1,fit:300,minScale:.8,plain:'art/bar.svg',plainFocus:'art/bar-focus.svg',
    art:{resume:{image:'art/bar.svg',focus:'art/bar-focus.svg'}},label:{y:30,font:30,ink:'#e6fffb',focusInk:'#04161b',align:'start',x:24}}}}})
const svg=(w,h,fill)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`)
const ART={'art/bar.svg':[600,60,'#15181c'],'art/bar-focus.svg':[600,60,'#7ff5e6']}
const adapter=createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
// the stage root's skin tokens and marks, as paintStageSkin sets them
function skinOf(document){
  const files=Object.fromEntries(contract.stageSkinFiles(document).map(name=>{const [w,h,fill]=ART[name];return [name,{url:svg(w,h,fill),image:{naturalWidth:w,naturalHeight:h}}]}))
  const art=adapter.stageSkinArt(document,files)
  return {tokens:{...adapter.stageSkinTokens(document,{resolve:()=>({family:''})}),...art.tokens},marks:{...adapter.stageSkinMarks(document),...art.marks}}
}
const pages=Array.from({length:8},(_,i)=>({id:'p'+i,label:'页面'+(i+1),menu:true}))
const lines=Array.from({length:30},(_,i)=>`<p style="margin:0;height:40px">第 ${i+1} 行</p>`).join('')
// panels: the 履历 and a CONFIG page side by side (no menu over them), each overflowing its box
const PANELS='<div class="fork-gal-backlog" style="right:auto;width:600px"><div class="fork-gal-backlog-list" tabindex="0">'+lines+'</div></div>'
  +'<div class="fork-gal-config" style="left:auto;width:600px;display:block"><div class="fork-gal-config-page" tabindex="0" style="height:400px">'+lines+'</div></div>'

async function open(browser,document,surface){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" data-theme="classic" style="position:fixed;inset:0"></div>')
  await page.addStyleTag({content:await client('themes.css')+'\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  await page.addScriptTag({content:await browserReactScript()+`
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${await client('menu.cjs')}
    window.mount=(skin,surface,pages,panels)=>new Promise(resolve=>{
      const stage=document.querySelector('.fork-gal-stage');
      for(const [name,value] of Object.entries(skin.marks))stage.setAttribute(name,value);
      for(const [name,value] of Object.entries(skin.tokens))stage.style.setProperty(name,value);
      if(surface==='panels'){stage.innerHTML=panels;requestAnimationFrame(()=>requestAnimationFrame(resolve));return;}
      stage.classList.add('is-menu');
      const store={select:()=>({subscribe:()=>()=>{},getSnapshot:()=>false,dispose(){}})};
      const menu=createStageMenu({React,window,document,sounds:{play(){}},getSession:()=>store});
      ReactDOM.createRoot(stage).render(React.createElement(menu.Menu,{sessionId:'s',latestTurn:1,controls:[],pages,
        onClose(){},onPage(){},onBacklog(){},onGallery(){},onConfig(){},onKeys(){},onLatest(){},onLeave(){}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,50)));
    });
  `})
  await page.evaluate(([skin,surface,pages,panels])=>mount(skin,surface,pages,panels),[skinOf(document),surface,pages,PANELS])
  return {page,errors}
}
// the vertical scrollbar's width (box minus client minus borders), whether the content overflows, and the thumb's colour
const bar=(page,selector)=>page.locator(selector).evaluate(el=>{const s=getComputedStyle(el)
  return {width:el.offsetWidth-el.clientWidth-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),overflows:el.scrollHeight>el.clientHeight+1,
    thumb:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor}})
const top=(page,selector)=>page.locator(selector).evaluate(el=>el.scrollTop)
async function wheel(page,selector){
  const box=await page.locator(selector).boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(150)
  return top(page,selector)
}
const launch=()=>chromium.launch({headless:true,args:['--mute-audio'],ignoreDefaultArgs:['--hide-scrollbars']})
const MENU='.fork-gal-menu-list',BACKLOG='.fork-gal-backlog-list',CONFIG='.fork-gal-config-page'

test('a skin without scrollbars: the menu, 履历 and CONFIG show none and still scroll (wheel, keys)',{timeout:90000},async t=>{
  const browser=await launch();t.after(()=>browser.close())
  assert.equal(skinOf(PLAIN).marks['data-fk-scrollbars'],undefined)
  {
    const {page,errors}=await open(browser,PLAIN,'menu')
    assert.deepEqual(await bar(page,MENU).then(({width,overflows})=>({width,overflows})),{width:0,overflows:true},'the menu overflows and draws no scrollbar')
    assert.ok(await wheel(page,MENU)>0,'the menu scrolls under the wheel')
    await page.keyboard.press('Home');await page.keyboard.press('End')
    assert.ok(await page.evaluate(()=>{const list=document.querySelector('.fork-gal-menu-list').getBoundingClientRect(),row=document.activeElement.getBoundingClientRect()
      return document.activeElement.dataset.item==='leave' && row.top>=list.top-1 && row.bottom<=list.bottom+1}),'End brings the focused last row into view')
    assert.deepEqual(errors,[])
    await page.close()
  }
  const {page,errors}=await open(browser,PLAIN,'panels')
  for(const selector of [BACKLOG,CONFIG]){
    assert.deepEqual(await bar(page,selector).then(({width,overflows})=>({width,overflows})),{width:0,overflows:true},selector+' overflows and draws no scrollbar')
    await page.waitForTimeout(600) // Chromium latches a wheel gesture to the scroller it began on
    assert.ok(await wheel(page,selector)>0,selector+' scrolls under the wheel')
    await page.locator(selector).evaluate(el=>{el.scrollTop=0});await page.locator(selector).focus();await page.keyboard.press('PageDown');await page.waitForTimeout(300)
    assert.ok(await top(page,selector)>0,selector+' scrolls under PageDown')
  }
  assert.deepEqual(errors,[])
})

test('a skin that opts in: its menu and 履历 show the declared scrollbars, CONFIG none',{timeout:90000},async t=>{
  const browser=await launch();t.after(()=>browser.close())
  assert.equal(skinOf(SHOWN).marks['data-fk-scrollbars'],'menu backlog')
  {
    const {page,errors}=await open(browser,SHOWN,'menu')
    assert.deepEqual(await bar(page,MENU),{width:8,overflows:true,thumb:'rgb(127, 245, 230)'},'the menu shows its 8 px scrollbar in the skin colour')
    assert.ok(await wheel(page,MENU)>0)
    assert.deepEqual(errors,[])
    await page.close()
  }
  const {page,errors}=await open(browser,SHOWN,'panels')
  assert.deepEqual(await bar(page,BACKLOG),{width:10,overflows:true,thumb:'rgb(230, 255, 251)'},'the 履历 shows its 10 px scrollbar')
  assert.deepEqual(await bar(page,CONFIG).then(({width,overflows})=>({width,overflows})),{width:0,overflows:true},'CONFIG, not declared, shows none')
  assert.ok(await wheel(page,BACKLOG)>0)
  assert.deepEqual(errors,[])
})

test('scrollbars: only the named surfaces, a colour thumb and a bounded width', () => {
  const base={schema:'dsh.skin/1',id:'sb',label:'滑条',...paint}
  assert.ok(contract.validateStageSkin({...base,scrollbars:{config:{thumb:'#ffffff'}}}))
  for(const scrollbars of [{},{phone:{thumb:'#ffffff'}},{menu:{track:'#000000'}},{menu:{thumb:'#ffffff',width:40}},{menu:{thumb:'white'}}])
    assert.throws(()=>contract.validateStageSkin({...base,scrollbars}),undefined,JSON.stringify(scrollbars))
})
