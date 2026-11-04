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

const menu=extra=>skin({menu:{sheet:'art/sheet.svg',rows:{images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10},
  title:{image:'art/title.svg',x:240,y:40,text:[150,350,95],font:96},...extra}})
test('a phone menu (art.menu.narrow) needs its unit and the wide rows, title and signal it refines',()=>{
  const doc=contract.validateStageSkin(menu({narrow:{unit:0.3,sheet:'art/sheet-m.svg',rows:{images:{plain:'art/row-m.svg',focus:'art/row-m-on.svg'},y:300,gap:20},title:{y:40,scale:0.8}}}))
  assert.deepEqual(['art/sheet-m.svg','art/row-m.svg','art/row-m-on.svg'].filter(name=>!contract.stageSkinFiles(doc).includes(name)),[])
  for(const narrow of [{rows:{y:300}},{unit:0.3,signal:{x:0,y:0}}])invalid(menu({narrow}).art)
})

test('CONFIG rows may lean (row.slant degrees) and step in (row.step design px)',()=>{
  const config=row=>({...base,config:{frame:{look:'full',paint:{bg:'#0b0b0b',fg:'#ffffff',fgMuted:'#bdbdbd',accent:'#ffffff',onAccent:'#0b0b0b'}},row}})
  assert.deepEqual(contract.validateStageSkin(config({look:'plain',slant:-3,step:24})).config.row,{look:'plain',slant:-3,step:24})
  for(const row of [{slant:12},{step:-8},{step:65}])assert.throws(()=>contract.validateStageSkin(config(row)),{code:'INVALID_SKIN'})
})
test('menu words may be ransom glyph blocks (rows.letter, title.letter) and the focused label larger (rows.focusScale)',()=>{
  const rows={images:{plain:'art/row.svg',focus:'art/row-on.svg'},slice:[8,40,8,40],text:[100,950,42],font:46,x:-80,y:250,gap:10}
  const doc=contract.validateStageSkin(menu({rows:{...rows,letter:'ransom',focusScale:1.3},title:{x:240,y:40,text:[150,350,95],font:96,letter:'ransom'}}))
  assert.deepEqual([doc.art.menu.rows.letter,doc.art.menu.rows.focusScale,doc.art.menu.title.letter],['ransom',1.3,'ransom'])
  for(const extra of [{rows:{...rows,letter:'collage'}},{rows:{...rows,focusScale:2}},{keys:{x:0,y:900,text:[10,400,30],font:20,letter:'ransom'}}])invalid(menu(extra).art)
})

test('CONFIG: rows in one block on value plates, a value face, and a foot drawn once',()=>{
  const config=extra=>({...base,config:{frame:{look:'full',paint:{bg:'#0b0b0b',fg:'#ffffff',fgMuted:'#bdbdbd',accent:'#ffffff',onAccent:'#0b0b0b'}},...extra}})
  const doc=contract.validateStageSkin(config({row:{look:'plain',block:{label:300,control:400,place:'end'}},
    controls:{plate:{plain:'art/value.svg',focus:'art/value-on.svg'},paint:{bg:'#ffffff',fg:'#0b0b0b',fgMuted:'#6b6b6b'},font:{face:'title',weight:900}},
    foot:{image:'art/foot.svg',h:190,fit:'stretch',place:'end'}}))
  assert.deepEqual([doc.config.row.block.place,doc.config.controls.font.face,doc.config.foot.fit],['end','title','stretch'])
  assert.deepEqual(['art/value.svg','art/value-on.svg','art/foot.svg'].filter(name=>!contract.stageSkinFiles(doc).includes(name)),[])
  for(const extra of [{row:{block:{label:300}}},{controls:{font:{weight:900}}},{foot:{image:'art/foot.svg',h:190,fit:'cover'}}])
    assert.throws(()=>contract.validateStageSkin(config(extra)),{code:'INVALID_SKIN'})
  assert.throws(()=>contract.validateStageSkin(config({controls:{paint:{bg:'#ffffff',fg:'#0b0b0b',fgMuted:'#bdbdbd'}}})),{code:'SKIN_CONTRAST'})
})

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

test('font.menu names the drawn menu ransom words face; the published schema lists the same font fields',()=>{
  const doc=contract.validateStageSkin({...base,font:{body:'serif-a',menu:'poster-b'}})
  assert.equal(doc.font.menu,'poster-b')
  assert.throws(()=>contract.validateStageSkin({...base,font:{menu:'Bad Id!'}}),{code:'INVALID_SKIN'})
  const schema=require('../tavern-plugin/packages/dsh-presentation-protocol/schema/skin.schema.json')
  assert.deepEqual(Object.keys(schema.properties.font.properties),['body','name','ui','film','menu','faces'])
})