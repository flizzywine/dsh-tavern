import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageTextcardCenter}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-center.cjs')
const {TEXTCARD_VERT_INK}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-vert-ink.cjs')
test('vertical optical centring uses first font family and measured ink bounds',()=>{
 const center=createStageTextcardCenter({metrics:TEXTCARD_VERT_INK})
 assert.equal(center.vertical({fontFamily:'Other, Noto Serif SC',fontWeight:'400'},'？'),null)
 const table=center.vertical({fontFamily:'Noto Serif SC',fontWeight:'400'},'？')
 assert.ok(table)
 let detached=0
 const doc={createRange:()=>({setStart(){},setEnd(){},getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:100,width:100,height:100}),detach(){detached++}})}
 const result=center.offset(doc,{dataset:{tcCenter:'xy'}},{left:0,right:100,top:0,bottom:100},[{text:{nodeValue:'？'},style:{fontFamily:'Noto Serif SC',fontWeight:'400'},vertical:true,size:100}])
 const [x,y]=result.split(' ').map(parseFloat)
 assert.ok(Math.abs(x-(table[1]-table[0])/20)<0.051)
 assert.ok(Math.abs(y-(table[3]-table[2])/20)<0.051)
 assert.equal(detached,1);center.dispose()
})
test('font listener moves with the document and is released on plugin unload',()=>{
 function fonts(){const listeners=new Set();return {status:'loaded',listeners,addEventListener(_,fn){listeners.add(fn)},removeEventListener(_,fn){listeners.delete(fn)}}}
 const first=fonts(),second=fonts(),center=createStageTextcardCenter()
 assert.equal(center.cacheable({fonts:first}),true);assert.equal(first.listeners.size,1)
 center.cacheable({fonts:second});assert.equal(first.listeners.size,0);assert.equal(second.listeners.size,1)
 const late=[...second.listeners][0];center.dispose();late()
 assert.equal(second.listeners.size,0);assert.equal(center.cacheable({fonts:first}),false)
})
