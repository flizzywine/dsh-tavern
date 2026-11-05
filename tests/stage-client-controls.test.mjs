import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {CARD_PAGE_SHORTCUT_KEYS} from '../tavern-plugin/lib/domain/card-status-panel.js'
const require=createRequire(import.meta.url)
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {createStageInput}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/input.cjs')
test('folded skins keep missing auto and skip actions in the menu',()=>{
 const controls=createStageControls()
 assert.deepEqual(controls.actionHomes(null,true).menu,[])
 const homes=controls.actionHomes({quickMenu:{layout:'orb'},resolvedArt:{buttons:[{action:'skip'}]},art:{buttons:{skip:{}}}},true)
 assert.deepEqual(homes.row,[])
 assert.deepEqual(homes.menu,['auto'])
 assert.deepEqual(homes.declared,['skip'])
 assert.equal(controls.actionFor('eye-off'),'hide')
 assert.equal(controls.drawn('eye-off',{resolvedControlIcons:{}}),false)
 assert.equal(controls.drawn('auto',{resolvedControlIcons:{}}),true)
 assert.equal(controls.keyCaps.skip,'Ctrl')
})
test('regenerate shortcut follows visibility and disabled state of the existing control',()=>{
 const controls=createStageControls()
 let clicks=0
 const button={disabled:true,getClientRects:()=>[{}],click:()=>clicks++}
 const root={querySelector:()=>button}
 assert.equal(controls.pressRegenerate(root),false)
 button.disabled=false;button.getClientRects=()=>[]
 assert.equal(controls.pressRegenerate(root),false)
 button.getClientRects=()=>[{}]
 assert.equal(controls.pressRegenerate(root),true)
 assert.equal(clicks,1)
})
test('wheel gestures finish typing once without spilling into extra page turns',()=>{
 const {wheel}=createStageControls()
 const first=wheel(null,{now:1000,deltaY:100,typed:false})
 assert.equal(first.action,'finish')
 const burst=wheel(first.state,{now:1050,deltaY:200,typed:true})
 assert.equal(burst.action,'none')
 const next=wheel(burst.state,{now:1400,deltaY:100,typed:true})
 assert.equal(next.action,'advance')
 assert.equal(wheel(next.state,{now:1410,deltaY:-100}).action,'backlog')
 assert.equal(wheel(null,{now:1,deltaY:3,deltaMode:1,typed:true}).action,'advance')
 assert.equal(wheel(null,{now:1,deltaY:1,deltaMode:2,typed:true}).action,'advance')
 assert.equal(wheel(null,{now:1,deltaY:NaN}).action,'none')
})

test('card page keys are listed after 履历 only for pages with a shortcut; no pages, no page key',()=>{
 const controls=createStageControls()
 assert.equal(controls.shortcuts().some(([,,action])=>action.startsWith('page:')),false)
 assert.equal(controls.shortcuts({pages:[{id:'map',label:'地图',menu:true}]}).some(([,,action])=>action.startsWith('page:')),false)
 const keys=controls.shortcuts({pages:[{id:'status',label:'状态',shortcut:'s',menu:true},{id:'map',label:'地图',shortcut:'m'}]})
 assert.deepEqual(keys.slice(4,6),[['状态','S','page:status'],['地图','M','page:map']])
 assert.equal(keys.some(([,,action])=>action==='status'),false)
})

test('every card page shortcut letter is free of the built-in stage keys, and the built-in letters are not offered to pages',()=>{
 const controls=createStageControls()
 const fakeRoot={querySelector:()=>({disabled:false,getClientRects:()=>[{}],click(){clicks++}})}
 let clicks=0,state={pages:[],root:fakeRoot},sent=[]
 const listeners=[]
 const window={addEventListener(type,handler){listeners.push([type,handler])},removeEventListener(){}}
 const document={hidden:false,addEventListener(){},removeEventListener(){}}
 const input=createStageInput({React:{},window,document,clock:{setTimeout:()=>1,clearTimeout(){}},controls,navigation:{galKeyboardFocus:()=>false}})
 const instance=input.attach(()=>state,action=>sent.push(action))
 const onKey=listeners.find(([type])=>type==='keydown')[1]
 const press=key=>onKey({key,preventDefault(){},stopImmediatePropagation(){},repeat:false,isComposing:false})
 const builtIn=[]
 for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  sent=[];clicks=0;press(letter)
  if (sent.length||clicks) builtIn.push(letter)
 }
 assert.deepEqual(builtIn,['a','g','h','l','v'])
 for (const letter of CARD_PAGE_SHORTCUT_KEYS) assert.equal(builtIn.includes(letter),false,letter)
 for (const letter of CARD_PAGE_SHORTCUT_KEYS) {
  sent=[];clicks=0;state={pages:[{id:'p',label:'p',shortcut:letter}],root:fakeRoot}
  press(letter)
  assert.deepEqual(sent,[{type:'page',open:true,id:'p'}],letter)
  assert.equal(clicks,0,letter)
 }
 instance.dispose()
})

test('stage entry picks one card page: a fresh chat takes its initial page, 跳过标题页 skips showOn pages, the rest is first-come',()=>{
 const {stageEnterPage}=createStageControls()
 const title={id:'title',label:'标题',showOn:{event:'stage-enter'},initial:true}
 const map={id:'map',label:'地图',showOn:{event:'stage-enter'}}
 const status={id:'status',label:'状态',shortcut:'s',menu:true}
 assert.equal(stageEnterPage({pages:[title,map],fresh:true,skip:true}),'title')
 assert.equal(stageEnterPage({pages:[title,map],fresh:true,skip:false}),'title')
 assert.equal(stageEnterPage({pages:[title,map],fresh:false,skip:false}),'map')
 assert.equal(stageEnterPage({pages:[title],fresh:false,skip:false}),null)
 assert.equal(stageEnterPage({pages:[map],fresh:false,skip:true}),null)
 assert.equal(stageEnterPage({pages:[status],fresh:true,skip:false}),null)
 assert.equal(stageEnterPage({pages:[],fresh:true,skip:false}),null)
})
