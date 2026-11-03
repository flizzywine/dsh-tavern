import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const contract=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const {figureLatinAlias}=require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')

const base={schema:'dsh.skin/1',id:'fields-sample',label:'字段',textbox:{paint:{bg:'#101418',fg:'#f2f2f2'}},nameplate:{shape:'plain',paint:{bg:'#101418',fg:'#f2f2f2'}},font:{},textFx:{reveal:'type'}}
const skin=art=>({...base,art:{screen:1080,screenWidth:1920,...art}})
const valid=art=>contract.validateStageSkin(skin(art))
const invalid=art=>assert.throws(()=>contract.validateStageSkin(skin(art)),{code:'INVALID_SKIN'})

test('portrait source may be an ordered list; a framed source needs bust, and only the live cut has a crop',()=>{
  const at={left:40,bottom:40,size:320}
  valid({portrait:{...at,source:['sprite','avatar'],bust:{head:[0,0,120]}}})
  valid({portrait:{...at,source:['bust','avatar'],bust:{head:[0,0,120],crop:[1,1,1]}}})
  invalid({portrait:{...at,source:['sprite','avatar']}})
  invalid({portrait:{...at,source:['sprite'],bust:{head:[0,0,120],crop:[1,1,1]}}})
  invalid({portrait:{...at,source:['avatar','avatar']}})
  assert.deepEqual(contract.stageSkinPortraitOrder({source:'bust'}),['bust','avatar'])
  assert.deepEqual(contract.stageSkinPortraitOrder({}),['avatar'])
})

test('the name plate takes a Latin layer from the speaker\'s first Latin alias',()=>{
  const plate={x:40,y:820,h:48,font:28}
  valid({nameplate:{...plate,latin:{x:0,y:-24,size:14,upper:true}}})
  invalid({nameplate:{...plate,latin:{x:0,y:-24}}})
  assert.equal(figureLatinAlias({aliases:['辉夜','Kaguya','kaguya-hime']}),'Kaguya')
  assert.equal(figureLatinAlias({aliases:['辉夜']}),undefined)
})

test('drawn quick actions include the shortcut list and a disabled image',()=>{
  valid({buttons:{keys:{image:'art/keys.png',left:20,top:20},auto:{image:'art/auto.png',disabled:'art/auto-off.png',right:20,top:20}}})
  invalid({buttons:{print:{image:'art/print.png',left:20,top:20}}})
})
