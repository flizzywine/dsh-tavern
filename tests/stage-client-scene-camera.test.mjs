import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSceneCamera}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-camera.cjs')
const {galEase:ease,galClamp01:clamp}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
const module=createStageSceneCamera({ease,clamp}),base={W:1000,H:600,frame:{top:0,height:600}}
test('camera owns interpolation, visit reset and immutable snapshots',()=>{
 const camera=module.create();camera.step({...base,now:0})
 const start=camera.step({...base,spec:{zoom:2},now:100});assert.equal(start.current.zoom,1);assert.equal(start.ms,1200)
 start.from.zoom=99;start.current.zoom=99
 const halfway=camera.step({...base,spec:{zoom:2},now:700});assert.equal(halfway.current.zoom,1.5)
 const reset=camera.reset();assert.equal(reset.current,null)
 assert.equal(camera.step({...base,spec:{zoom:2},now:800}).current.zoom,2)
})
