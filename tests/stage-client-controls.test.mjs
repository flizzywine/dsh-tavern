import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {createStageInput}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/input.cjs')
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
