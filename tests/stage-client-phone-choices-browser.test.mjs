// Portrait phone (390 x 844), a skin with numbered bar art (a number cell in the bar's fixed left slice): a long suggestion
// wraps in its own row, its words start past the number cell (never on it) and run across the bar instead of the desktop
// text column mirrored by the trailing control's room. The markup is the stage's real Choices, the CSS is the stage's themes.css.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {chromium} from 'playwright'
const require=createRequire(import.meta.url)
const {createStageChoices}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/choices.cjs')
const {createStageChoiceLayout}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/choice-layout.cjs')
const css=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css',import.meta.url),'utf8')

// a 1200 x 84 bar: number cell 96 wide (numeral centred at 42), text column [120, 1160]
const SKIN={'--gal-ui-choice-size':'13px','--art-choice':'none','--art-choice-off':'none','--art-choice-w':'1200','--art-choice-h':'84','--art-choice-l':'120','--art-choice-r':'1160',
 '--art-choice-y':'42','--art-choice-font':'30','--art-choice-pitch':'46','--art-choice-gap':'18','--art-choice-st':'12','--art-choice-sr':'40','--art-choice-sb':'12','--art-choice-sl':'96',
 '--art-choice-align':'left','--art-choice-justify':'flex-start','--art-choice-num-x':'42','--art-choice-num-font':'30','--art-choice-num-dy':'0'}
const CHOICES=['跟着她走出教室，在走廊尽头叫住她，问她刚才那句话到底是什么意思，为什么要躲着我','在走廊尽头叫住她','深夜的旧公寓里，直播平台突然弹出一条私信邀请，她的头像在屏幕上亮起']

function markup() {
 const h=React.createElement,getComputedStyle=()=>({getPropertyValue:()=>''}),noop=()=>{}
 const view=createStageChoices({React,window:{addEventListener:noop,removeEventListener:noop,matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop})},
  document:{addEventListener:noop,removeEventListener:noop,activeElement:null},layout:createStageChoiceLayout({React,getComputedStyle}),sounds:{play(){}},useSounds(){},
  episode:()=>({first:0,start:0}),waitLines:['wait'],TextArea:()=>h('textarea'),Icon:({size})=>h('svg',{width:size,height:size}),StageWaitStop:()=>null,StageWaitLines:()=>null,
  getComputedStyle,setTimeout,clearTimeout,requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
 const html=renderToStaticMarkup(h(view.Choices,{sessionId:'s',messageId:'m',panel:{phase:'ready',choices:CHOICES.map(text=>({type:'action',text}))},running:false,decode:String,
  commands:{clear(){},generate(){},stop(){}},executeSlash:async()=>{},fallbackRef:{current:null}}))
 view.dispose()
 return html
}

test('portrait phone: numbered choice words start past the number cell and use the bar width',{timeout:60000},async t => {
 const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(() => browser.close())
 const page=await browser.newPage({viewport:{width:390,height:844}})
 await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0}.fork-gal-stage{position:fixed;inset:0}</style></head><body></body></html>`)
 const rows=await page.evaluate(({skin,html}) => {
  const root=document.createElement('div')
  root.className='fork-gal-stage';root.setAttribute('data-fk-skin-choices','');root.setAttribute('data-fk-skin-choices-number','')
  for (const [k,v] of Object.entries(skin)) root.style.setProperty(k,v)
  root.innerHTML=html;document.body.append(root)
  return [...root.querySelectorAll('.fork-gal-choice[data-index]')].map(row => {
   const main=row.querySelector('.fork-gal-choice-main'),ms=getComputedStyle(main),range=document.createRange(),b=row.getBoundingClientRect()
   range.selectNodeContents(main.querySelector('.fork-gal-choice-text') || main)
   const rects=[...range.getClientRects()].filter(r => r.width > 0)
   return {rowLeft:b.left,rowWidth:b.width,textLeft:Math.min(...rects.map(r => r.left)),lines:new Set(rects.map(r => Math.round(r.top))).size,
    column:main.clientWidth-parseFloat(ms.paddingLeft)-parseFloat(ms.paddingRight),cell:96*parseFloat(skin['--gal-ui-choice-size'])/30}
  })
 },{skin:SKIN,html:markup()})
 assert.equal(rows.length,CHOICES.length)
 assert.ok(rows[0].lines >= 2,'the long choice wraps')
 for (const [i,row] of rows.entries()) {
  assert.ok(row.textLeft-row.rowLeft >= row.cell,`choice ${i} starts ${Math.round(row.textLeft-row.rowLeft)} px in, on its number cell (${Math.round(row.cell)} px)`)
  assert.ok(row.textLeft-row.rowLeft <= row.cell+16,`choice ${i} starts just past its number cell (${Math.round(row.textLeft-row.rowLeft)} px)`)
  assert.ok(row.column >= 0.7*row.rowWidth,`choice ${i} wraps in ${Math.round(row.column)} of ${Math.round(row.rowWidth)} px`)
 }
})
