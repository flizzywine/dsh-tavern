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
