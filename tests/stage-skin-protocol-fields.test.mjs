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

const menu=extra=>skin({menu:{sheet:'art/sheet.svg',rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10},
  title:{image:'art/title.svg',x:240,y:40,text:[150,350,95],font:96},...extra}})


test('CONFIG cycler values, value sliders, tag heads, tilted painted tabs with a lead line, words and key stickers; menu poses and a put-away top bar (§18 N32)',()=>{
  const paint={bg:'#0b0b0b',fg:'#ffffff',fgMuted:'#bdbdbd',accent:'#ffffff',onAccent:'#0b0b0b'}
  const config=extra=>({...base,config:{frame:{look:'drawer',paint},...extra}})
  const ok=extra=>contract.validateStageSkin(config(extra)).config
  const bad=extra=>assert.throws(()=>contract.validateStageSkin(config(extra)),{code:/INVALID_SKIN|SKIN_CONTRAST/})
  const c=ok({controls:{segmented:{look:'cycler'},toggle:{look:'cycler'},slider:{look:'value'}},section:{look:'tag',paint:{bg:'#d9000f',fg:'#ffffff'}},
    nav:{place:'top',tilt:[-3,2],lead:'line',platePaint:{bg:'#ffffff',fg:'#0b0b0b',onBg:'#d9000f',onFg:'#ffffff'}},words:{weight:900,skew:6,lift:1},hints:{paint:{bg:'#ffffff',fg:'#0b0b0b'}}})
  assert.deepEqual([c.controls.segmented.look,c.nav.tilt,c.words.lift],['cycler',[-3,2],1])
  for(const extra of [{nav:{tilt:[9]}},{nav:{lead:'two'}},{words:{lift:2}},{words:{skew:13}},{hints:{}},{controls:{select:{look:'cycler'}}},
    {hints:{paint:{bg:'#ffffff',fg:'#eeeeee'}}},{nav:{platePaint:{bg:'#ffffff',fg:'#0b0b0b',onBg:'#d9000f',onFg:'#ff0000'}}}])bad(extra)
  const doc=contract.validateStageSkin(menu({topbar:'hidden',rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10,poses:[{x:20,rot:-2},{x:-10}]}}))
  assert.equal(doc.art.menu.topbar,'hidden')
  for(const poses of [[],[{x:300}],[{rot:13}]])invalid(menu({rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10,poses}}).art)
})