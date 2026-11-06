// 舞台借用 (stage lease) automatic voice against the stage's reveal, on the real mounted stage (built stage client,
// controller, typewriter and speech handle). A lease line types while the stage is still covered (here: the performance
// kinds are not read yet, so stageRevealed is false); it must not be marked read before the stage is revealed, or its
// first showing never speaks (the lease voice effect skips a read line). Once revealed it speaks once, automatically.
// A line already read (the lease taken again) and lines passed under SKIP do not speak.
import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {stageThemeCss} from './helpers/stage-theme-css.mjs'
import {mountedStageShell} from './helpers/mounted-stage-shell.mjs'

// Actor keys differ from names; every line is spoken by a resolved character with a voice.
const config={enabled:true,voice:{enabled:true},characters:[{alias:'c-81q',name:'小林',color:'#e0609a',voice:'fixture/k',voiceKey:'v-k',voiceLanguage:'zh'}],
  stage:{textLanguage:'zh',face:'off',music:false,theme:'classic'}}
const LINES=[{id:'L1',speaker:'小林',text:'我先说。',emotion:'生气'},{id:'L2',speaker:'小林',text:'今晚谁出局？'},{id:'L3',speaker:'小林',text:'天亮了。'}]

// The host's in-memory stageLeases (plugin-extensions.js): publish / release / get / subscribe / attach.
const fixture=`;(()=>{
  const leases=new Map(),watchers=new Set(),notify=()=>watchers.forEach(fn=>fn());
  window.stageLeasesFixture={publish(id,lease){leases.set(id,Object.freeze(lease));notify()},release(id,owner){if(leases.get(id)?.owner===owner){leases.delete(id);notify()}},
    get:id=>leases.get(id)||null,subscribe:(id,fn)=>{watchers.add(fn);return()=>watchers.delete(fn)},attach:()=>()=>{}};
  window.plays=[];
  let open;window.kindsGate=new Promise(resolve=>{open=resolve});window.revealStage=()=>open({kinds:[]});
  window.stageShellOptions=host=>{
    const base=host.options(),player={...base.speech.player,play:async(resource,request)=>{window.plays.push({automatic:request.automatic,handoff:request.handoff,text:document.querySelector('.fork-gal-box .fork-gal-text')?.textContent||''})}};
    return {speech:{player,available:()=>true,speechInput:segment=>({text:segment.text,mood:segment.mood||null}),character:host.voice.character,language:()=>'zh',open:async()=>null},
      // the performance kinds are read only when the test reveals the stage
      performances:{...base.performances,read:()=>window.kindsGate},
      // the lease resolves its speakers through the core's resolver (the offline stub resolves none)
      sourceWidgets:{...base.sourceWidgets,figureResolution:{resolveFigureName:(...args)=>base.speaker.resolve(...args)}}};
  };
})();`
const seams=[["const host = ctx.get('tavernStageFrontend');","const host = Object.assign(ctx.get('tavernStageFrontend'),{stageLeases:window.stageLeasesFixture});"]]

async function openStage(browser){
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}):r.abort())
  await page.goto('https://stage.test/')
  await page.addStyleTag({content:await stageThemeCss()+'\nmain{position:fixed;inset:0}.fork-gal-stage{position:absolute;inset:0;background:#556}*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}'})
  await page.exposeFunction('hostDirection',()=>({phase:'off',revision:0,generation:0,token:null}))
  await page.exposeFunction('hostProjection',()=>{throw Error('Director is off')})
  await page.exposeFunction('hostLease',()=>{throw Error('No media')})
  await page.addScriptTag({content:await browserReactScript()+';const React=modules.react,ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};window.stageShellConfig='+JSON.stringify(config)+';'+fixture+mountedStageShell({seams})})
  return {page,errors}
}
const shown=(page,text)=>page.waitForFunction(text=>document.querySelector('.fork-gal-box .fork-gal-text')?.textContent.includes(text),text)
const plays=page=>page.evaluate(()=>window.plays)
const publish=(page,lines=LINES)=>page.evaluate(lines=>window.stageLeasesFixture.publish('session',{owner:'werewolf',scene:{actors:[{name:'小林'}],lines},hud:null,props:{}}),lines)

test('a lease line typed under the cover speaks once when the stage is revealed; a read line and skipped lines do not',{timeout:60000},async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const {page,errors}=await openStage(browser)
  await publish(page)
  await shown(page,'我先说')
  // the typewriter finishes while the stage is still covered
  await page.waitForFunction(()=>!document.querySelector('.fork-gal-box.is-speaking'))
  await page.waitForTimeout(300)
  assert.deepEqual(await plays(page),[],'nothing speaks before the reveal')
  await page.evaluate(()=>window.revealStage())
  await page.waitForFunction(()=>window.plays.length>0,null,{timeout:5000}).catch(()=>{})
  await page.waitForTimeout(300)
  const first=await plays(page)
  assert.equal(first.length,1,'the first lease line speaks once after the reveal: '+JSON.stringify(first))
  assert.equal(first[0].automatic,true);assert.equal(first[0].handoff,true)
  assert.match(first[0].text,/我先说/)

  // resume: the lease taken again shows the line already read; it does not speak again
  await page.evaluate(()=>window.stageLeasesFixture.release('session','werewolf'))
  await page.waitForFunction(()=>!document.querySelector('[data-stage-lease]'))
  await publish(page)
  await shown(page,'我先说')
  await page.waitForTimeout(400)
  assert.equal((await plays(page)).length,1,'a read line is not voiced again on resume')

  // skip is silent: the unread lines it passes do not speak
  await page.locator('.fork-gal-controls [data-action="skip"]').click()
  await shown(page,'天亮了')
  await page.waitForTimeout(400)
  assert.equal((await plays(page)).length,1,'lines passed under SKIP are not voiced: '+JSON.stringify(await plays(page)))
  assert.deepEqual(errors,[])
})
