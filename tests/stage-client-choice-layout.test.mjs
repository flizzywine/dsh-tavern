import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageChoiceLayout}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/choice-layout.cjs')
function style(){const values=new Map();return {getPropertyValue:name=>values.get(name)||'',setProperty:(name,value)=>values.set(name,value),removeProperty:name=>values.delete(name)}}
test('choice image slices snap to whole device pixels at fractional scaling',()=>{
 const module=createStageChoiceLayout({getComputedStyle:row=>({height:String(row.height),borderImageSource:'url(bar)'})})
 assert.deepEqual([1,1.25,1.5,1.75,2].map(module.galPixelStep),[1,4,2,4,1])
 const row={height:31,style:style()},list={height:65,style:style(),children:[row],getBoundingClientRect(){}}
 assert.equal(module.galSnapChoices(list,1.5),true)
 assert.equal(list.style.getPropertyValue('--fk-step'),'2px')
 assert.equal(list.style.getPropertyValue('--fk-snap-h'),'68px')
 assert.equal(row.style.getPropertyValue('--fk-snap-h'),'32px')
 assert.equal(module.galSnapChoices(list,1.5),false)
})
test('oversized art menu scales to its room and releases obsolete snap heights',()=>{
 const module=createStageChoiceLayout({getComputedStyle:()=>({getPropertyValue:()=> '1px'})})
 const row={style:style()},list={style:style(),children:[row],scrollHeight:200,clientHeight:100}
 row.style.setProperty('--fk-snap-h','40px')
 assert.equal(module.galFitChoices(list),true)
 assert.equal(list.style.getPropertyValue('--art-choice-fit'),'0.5')
 assert.equal(row.style.getPropertyValue('--fk-snap-h'),'')
 assert.equal(module.galFitChoices(list),false)
})
