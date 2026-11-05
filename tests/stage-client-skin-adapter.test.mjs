import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
import {readFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {createStageSkinAdapter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-adapter.cjs')
const {createStageSkinMotion}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-motion.cjs')
const {createStageSkinBacklog}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/skin-backlog.cjs')
const create=()=>createStageSkinAdapter({contract,motion:createStageSkinMotion(),backlog:createStageSkinBacklog()})
const fonts={resolve:()=>({family:'serif'})}
test('skin scope restores every applied surface on unload and rejects late applications',()=>{
 const dom=new JSDOM('<div></div><div></div>'),skin=create(),roots=[...dom.window.document.querySelectorAll('div')]
 roots[0].style.setProperty('--gal-skin-bg','original');roots[0].setAttribute('data-fk-skin','previous')
 const restore=skin.applyStageSkin(roots[0],contract.BUILTIN_STAGE_SKINS.classic,fonts)
 skin.applyStageSkin(roots[1],contract.BUILTIN_STAGE_SKINS.crt,fonts)
 assert.equal(roots[0].getAttribute('data-fk-skin'),'classic')
 skin.applyStageSkinMode(roots[0],{marks:{'data-fk-skin-mode':'debate'},tokens:{'--mode-font':'20'}})
 skin.dispose();restore();skin.dispose()
 assert.equal(roots[0].style.getPropertyValue('--gal-skin-bg'),'original');assert.equal(roots[0].getAttribute('data-fk-skin'),'previous')
 assert.equal(roots[0].hasAttribute('data-fk-skin-mode'),false);assert.equal(roots[1].hasAttribute('data-fk-skin'),false)
 skin.applyStageSkin(roots[1],contract.BUILTIN_STAGE_SKINS.classic,fonts)()
 assert.equal(roots[1].hasAttribute('data-fk-skin'),false);dom.window.close()
})
test('skin motion composes sprite frames and ordered enter/leave wipes without host state',()=>{
 const m=createStageSkinMotion(),skin={art:{textbox:{next:{frames:{columns:2,rows:1,fps:8}}}},transitions:{choices:{enter:{ms:200,wipe:{shape:'left'}},leave:{ms:120,delay:30,wipe:{shape:'circle'}}}}}
 const css=m.stageSkinMotionKeyframes(skin)
 assert.match(css,/@keyframes fork-skin-frames-next/);assert.match(css,/@keyframes fork-skin-tx-choices-enter/);assert.match(css,/circle\(0% at 50% 50%\)/)
 assert.equal(m.stageSkinTransitionTokens(skin)['--tx-choices-pick-ms'],'150')
 assert.equal(m.stageSkinTxEase([.1,.2,.3,1]),'cubic-bezier(0.1,0.2,0.3,1)')
})
test('all built-in skins project tokens and backlog geometry through plugin modules',()=>{
 const skin=create()
 for(const document of Object.values(contract.BUILTIN_STAGE_SKINS)){
  const tokens=skin.stageSkinTokens(document,fonts)
  assert.equal(tokens['--gal-skin-bg'],document.textbox.paint.bg)
  const backlog=skin.stageSkinBacklog({...document,backlog:{layout:'overlay'}})
  assert.equal(backlog.roles.speech.look,'bubble');assert.equal(backlog.roles.narration.look,'band')
  assert.ok(backlog.style['--bl-close'].startsWith('url('))
 }
 skin.dispose()
})
test('art.menu letters and font.menu: marks, focus scale and the menu face only for a skin that sets them',()=>{
 const skin=create()
 const files=Object.fromEntries(['art/sheet.svg','art/row.svg','art/row-on.svg','art/title.svg'].map(name=>[name,{url:'blob:'+name,image:{naturalWidth:200,naturalHeight:80}}]))
 const doc=extra=>({schema:'dsh.skin/1',id:'menu-probe',label:'menu',textbox:{paint:{bg:'#0b0b0b',fg:'#ffffff',accent:'#ff4d5e'}},nameplate:{shape:'plain',paint:{bg:'#0b0b0b',fg:'#ffffff'}},font:{},textFx:{reveal:'type'},
  art:{screen:1080,screenWidth:1920,menu:{sheet:'art/sheet.svg',rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10,align:'end',...extra?.rows},
   title:{image:'art/title.svg',x:240,y:40,text:[150,350,95],font:96,...extra?.title},...extra?.menu}}})
 const lettered=doc({rows:{letter:'ransom',focusScale:1.2},title:{letter:'ransom'},menu:{glyphTiles:{shape:'square',tiles:[{ground:'#ffffff',ink:'#000000'}]}}})
 assert.equal(contract.validateStageSkin(lettered).art.menu.rows.letter,'ransom')
 const {marks,tokens}=skin.stageSkinArt(lettered,files,'skin.json')
 assert.deepEqual([marks['data-fk-skin-art-menu-letter'],marks['data-fk-skin-art-menu-title-letter'],tokens['--art-mr-focus-scale'],tokens['--art-mr-origin']],['ransom','ransom','1.2','100% 50%'])
 const plain=skin.stageSkinArt(doc(),files,'skin.json')
 assert.deepEqual([plain.marks['data-fk-skin-art-menu-letter'],plain.marks['data-fk-skin-art-menu-title-letter'],plain.tokens['--art-mr-focus-scale']],[undefined,undefined,undefined])
 const asked=[],menuFonts={resolve:(_,options)=>{asked.push(options);return {family:options.part==='menu'?'menu-face':'serif'}}}
 assert.equal(skin.stageSkinPanelTokens({...doc(),font:{menu:'some-face'}},menuFonts,'classic')['--gal-ui-menu-font'],'menu-face')
 assert.equal(asked.find(options=>options.part==='menu').skinWins,true,'a decoration face, like the title face')
 assert.equal('--gal-ui-menu-font' in skin.stageSkinPanelTokens(doc(),menuFonts,'classic'),false)
})
test('art.portrait.behind marks the stage so the box art draws over the face; undeclared, no mark',()=>{
 const skin=create()
 const doc=portrait=>contract.validateStageSkin({schema:'dsh.skin/1',id:'face-probe',label:'face',textbox:{paint:{bg:'#0b0b0b',fg:'#ffffff'}},nameplate:{shape:'plain',paint:{bg:'#0b0b0b',fg:'#ffffff'}},font:{},textFx:{reveal:'type'},
  art:{screen:1080,screenWidth:1920,portrait:{left:40,bottom:40,size:320,...portrait}}})
 assert.equal(skin.stageSkinArt(doc({behind:true}),{},'skin.json').marks['data-fk-skin-portrait-behind'],'')
 assert.equal('data-fk-skin-portrait-behind' in skin.stageSkinArt(doc({}),{},'skin.json').marks,false)
 skin.dispose()
})
const themeCss=()=>readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css',import.meta.url),'utf8')
const menuDoc=extra=>({schema:'dsh.skin/1',id:'menu-probe',label:'menu',textbox:{paint:{bg:'#0b0b0b',fg:'#ffffff',accent:'#ff4d5e'}},nameplate:{shape:'plain',paint:{bg:'#0b0b0b',fg:'#ffffff'}},font:{},textFx:{reveal:'type'},
 art:{screen:1080,screenWidth:1920,menu:{sheet:'art/sheet.svg',rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10,align:'end'},
  title:{image:'art/title.svg',x:240,y:40,text:[150,350,95],font:96},...extra}}})
const menuFiles=Object.fromEntries([['art/sheet.svg',[1600,1080]],['art/row.svg',[200,80]],['art/row-on.svg',[200,80]],['art/title.svg',[200,80]]].map(([name,[w,h]])=>[name,{url:'blob:'+name,image:{naturalWidth:w,naturalHeight:h}}]))
test('art.menu sheet and motion.parts: the sheet at its own aspect, the drawn parts lead the items over a stationary ground',()=>{
 const skin=create()
 const parts={sheet:{ms:180,origin:[0.508,0.5],keys:[{at:0,sx:0.02},{at:0.7,sx:1.03},{at:1}]},title:{ms:240,delay:120,steps:3,keys:[{at:0,dy:-70,rot:-25,scale:1.4},{at:1}]}}
 const doc=menuDoc({motion:{enter:{pose:{dx:-160,rot:-6},ms:160,stagger:35,delay:150,ease:'back'},parts}})
 assert.deepEqual(Object.keys(contract.validateStageSkin(doc).art.menu.motion.parts),['sheet','title'])
 const {marks,tokens}=skin.stageSkinArt(doc,menuFiles,'skin.json')
 assert.equal(marks['data-fk-skin-art-menu-parts'],'sheet title')
 assert.deepEqual(['--art-menu-sheet-w','--art-menu-sheet-h','--art-mm-enter-delay','--art-mp-title-delay','--art-mp-title-tf','--art-mp-sheet-origin'].map(key=>tokens[key]),['1600','1080','150ms','120ms','steps(3, end)','50.8% 50%'])
 assert.equal(marks['data-fk-skin-art-menu-motion'],'enter','parts is no item stage')
 const frames=skin.stageSkinMotionKeyframes(doc)
 assert.match(frames,/@keyframes fork-skin-menu-title\{0%\{transform:translate\(calc\(0 \* var\(--mu\)\),calc\(-70 \* var\(--mu\)\)\) rotate\(-25deg\) scale\(1\.4\)\}/)
 assert.match(frames,/@keyframes fork-skin-menu-sheet\{0%\{transform:[^}]*scale\(0\.02,1\)\}/)
 const plain=skin.stageSkinArt(menuDoc(),menuFiles,'skin.json')
 assert.deepEqual([plain.marks['data-fk-skin-art-menu-parts'],plain.tokens['--art-mm-enter-delay']],[undefined,undefined])
 assert.doesNotMatch(skin.stageSkinMotionKeyframes(menuDoc()),/fork-skin-menu-/)
 const css=themeCss()
 assert.match(css,/calc\(var\(--art-mm-enter-delay, 0ms\) \+ var\(--i\) \* var\(--art-mm-enter-stagger\)\)/)
 for (const part of ['sheet','title','keys','signal']) assert.match(css,new RegExp(`animation: fork-skin-menu-${part} var\\(--art-mp-${part}-ms\\)`),part)
 // the animated sheet (::after) drops its spread; the ground round it stands on the stationary ::before at the sheet's rest box
 const animated=css.slice(css.indexOf('[data-fk-skin-art-menu-parts~="sheet"]'),css.indexOf('[data-fk-skin-art-menu-parts~="title"]'))
 assert.match(animated,/::after \{[^}]*animation: fork-skin-menu-sheet[^}]*box-shadow: none; \}/)
 assert.match(animated,/:not\(\[data-dialog\]\)::before \{[^}]*width: calc\(var\(--sw\) \* var\(--su\)\);[^}]*box-shadow: 0 0 0 200vmax var\(--gal-ui-surface\); \}/)
 assert.match(css,/\[data-fk-skin-art-menu-sheet\]:not\(\.is-film\) > \.fork-gal-menu::after \{ --sw: var\(--art-menu-sheet-w\); --sh: var\(--art-menu-sheet-h\);/)
})
test('art.backlog.narrow: a phone unit compiled to a mark and token, its rules only under the phone breakpoint, the voice control at its anchor',()=>{
 const skin=create()
 const files=Object.fromEntries(['art/paper.png','art/play.png'].map(name=>[name,{url:'blob:'+name,image:{naturalWidth:48,naturalHeight:40}}]))
 const doc=voice=>({schema:'dsh.skin/1',id:'log-probe',label:'log',textbox:{paint:{bg:'#f4ead8',fg:'#2b2118',accent:'#8a3b12'}},nameplate:{shape:'plain',paint:{bg:'#5a3a1e',fg:'#ffffff'}},font:{},textFx:{reveal:'type'},
  art:{screen:720,screenWidth:1280,voice:{image:'art/play.png'},backlog:{sheet:'art/paper.png',font:22,list:[160,90,900,560],pitch:30,text:[120,880],gap:12,voice,
   name:{x:120,y:-6,h:36,font:26,head:34},narrow:{unit:0.18}}}})
 for (const [voice,anchor] of [[[20,4,48,40],'row'],[{anchor:'name',at:[8,-2]},'name']]) {
  const {marks,tokens}=skin.stageSkinArt(doc(voice),files,'skin.json')
  assert.deepEqual([marks['data-fk-skin-art-backlog-narrow'],tokens['--art-bl-nu'],marks['data-fk-skin-art-backlog-voice']],['','0.18px',anchor])
 }
 const wide=doc([20,4,48,40]);delete wide.art.backlog.narrow
 assert.equal(skin.stageSkinArt(wide,files,'skin.json').marks['data-fk-skin-art-backlog-narrow'],undefined)
 const css=themeCss(),block=css.slice(css.indexOf('/* art backlog: phone.'),css.indexOf('/* ==== end stage skin: art screens ==== */'))
 assert.ok(block.includes('@media (max-width: 640px) {'))
 for (const selector of block.replace(/\/\*[\s\S]*?\*\//g,'').match(/^\s*\.fork-gal-stage\[[^{]+/gm)) assert.match(selector,/^\s*\.fork-gal-stage\[data-fk-skin-art-backlog-narrow\][^{]*:not\(\.is-film\)/,selector)
 assert.match(block,/--mu: var\(--art-bl-nu\)/)
 assert.match(block,/\[data-fk-skin-art-backlog-voice="row"\][^{]*\{ position: absolute;/)
 // anchor name: after the name, moved by at (design px in the phone unit), the 6px touch margin kept
 assert.match(block,/\[data-fk-skin-art-backlog-voice="name"\][^{]*\{ margin-left: calc\(var\(--art-bl-voice-x, 0\) \* var\(--mu\) - 6px\); translate: 0 calc\(var\(--art-bl-voice-y, 0\) \* var\(--mu\)\); \}/)
})