import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageControls}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
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
 assert.equal(controls.shortcuts(false).some(row=>row[2]==='danmaku'),false)
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
