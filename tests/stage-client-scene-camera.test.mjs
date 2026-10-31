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
test('close shot has a safe zoom kick and missing target returns the neutral shot',()=>{
 const camera=module.create(),framing={x:.5,y:.4,zoom:1.3,ay:.4,zoomMax:1.4}
 const result=camera.step({...base,now:0,spec:{shot:'close',target:'actor'},framing,kick:.5})
 assert.equal(result.closeOn,'actor');assert.equal(result.safe.zoom,1.4)
 const missing=module.create().step({...base,now:0,spec:{shot:'close',target:'actor'}})
 assert.equal(missing.closeOn,'');assert.equal(missing.current.zoom,1)
 const tight=module.create().step({...base,now:0,spec:{shot:'close',target:'actor'},hasTarget:true})
 assert.equal(tight.closeOn,'actor');assert.equal(tight.current.zoom,1)
})
test('rotation clamp covers every screen corner within backdrop overscan',()=>{
 for(const rotation of [-.6,0,.6]){
  const cam=module.clamp({zoom:.5,fx:1.4,fy:-.2,ax:.5,ay:.42,rotation},1000,600,.018)
  for(const [x,y] of [[0,0],[1000,0],[0,600],[1000,600]]){
   const dx=(x-cam.ax*1000)/cam.zoom,dy=(y-cam.ay*600)/cam.zoom
   const wx=cam.fx*1000+dx*Math.cos(rotation)+dy*Math.sin(rotation),wy=cam.fy*600-dx*Math.sin(rotation)+dy*Math.cos(rotation)
   assert.ok(wx>=-18-1e-6&&wx<=1018+1e-6);assert.ok(wy>=-10.8-1e-6&&wy<=610.8+1e-6)
  }
 }
})
test('skip shortens a new shot and snap removes its transition',()=>{
 const camera=module.create();camera.step({...base,now:0})
 assert.equal(camera.step({...base,now:1,spec:{shot:'push'},skipping:true}).ms,200)
 const snapped=camera.step({...base,now:2,spec:{shot:'dutch'},snap:true});assert.equal(snapped.ms,0);assert.equal(snapped.current.zoom,1.08)
})
