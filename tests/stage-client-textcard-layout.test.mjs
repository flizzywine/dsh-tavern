import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
const {createStageTextcardLayout}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-layout.cjs')
test('textcard templates preserve text, line breaks and compound overrides',()=>{
 const dom=new JSDOM(''),layout=createStageTextcardLayout({})
 try{
 const plan={layout:'card',style:'test',dir:'h',type:{face:'serif',size:'normal'},motif:'none',accent:'#ffffff'}
 const frame={bg:'figure',fg:'auto',state:{text:'<b>原文</b>\n第二行'}}
 const {card,key}=layout.textcardNode(dom.window.document,plan,frame,{})
 assert.equal(card.querySelectorAll('.fork-tc-ln').length,2)
 assert.equal(card.querySelector('b'),null)
 assert.equal(card.textContent,'<b>原文</b>第二行')
 assert.equal(key,'figure:#ffffff')
 assert.equal(card.style.getPropertyValue('--tc-fg'),'var(--gal-tc-ink)')
 const compound=layout.textcardNode(dom.window.document,plan,{...frame,layout:'name',state:{text:'角色',sub:'NAME'}},{})
 assert.equal(compound.card.dataset.compound,'true')
 assert.equal(compound.card.dataset.layout,'name')
 assert.equal(compound.card.querySelector('.fork-tc-name').textContent,'角色')
 assert.equal(plan.layout,'card')
 }finally{dom.window.close()}
})
