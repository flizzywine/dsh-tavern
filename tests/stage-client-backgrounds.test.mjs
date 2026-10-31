import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageBackgrounds}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/backgrounds.cjs')
const {galMatrix:matrix,galEase:ease,galClamp01:clamp}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(){
 const made=[],requests=[],warnings=[]
 const owner=createStageBackgrounds({matrix,ease,clamp,transition:kind=>({kind,duration:100}),correction:()=>matrix.identity(),timeGrade:()=>({grade:matrix.identity()}),layers:{create(args){
  const layer={...args,start:args.now,destroyed:0,setCorrection(){},paint(now){return this.plan?{cover:.4,color:1,lids:0,bars:0,done:now-this.start>=100}:null},finish(){this.plan=null},destroy(){assert.equal(++this.destroyed,1)}};made.push(layer);return layer
 }}})
 const scene=owner.create({generated:{empty:{}},loadTexture:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),warn:value=>warnings.push(value)})
 const update=(id,now)=>scene.update({background:id?{identity:id,url:id}:null,grade:'day'},{version:1},now)
 return {owner,scene,made,requests,warnings,update}
}
test('background candidate failures preserve the last good picture and completion retires covered layers',async()=>{
 const f=fixture();f.update(null,0);assert.equal(f.scene.layers.length,1)
 f.update('a',10);f.requests[0].resolve({});await tick();assert.equal(f.scene.layers.length,2)
 assert.equal(f.scene.paint(111).pruned,true);assert.equal(f.scene.layers.length,1);assert.equal(f.made[0].destroyed,1)
 f.update('bad',120);f.requests[1].reject(Error('missing'));await tick();assert.equal(f.scene.pending,'');assert.equal(f.scene.layers[0].url,'a');assert.equal(f.warnings.length,1)
 f.owner.dispose();assert.equal(f.made[1].destroyed,1)
})
test('obsolete background loads including A-B-A cannot create duplicate layers',async()=>{
 const f=fixture();f.update('a',0);f.update('b',1);f.update('a',2)
 f.requests[0].resolve({});f.requests[1].resolve({});await tick();assert.equal(f.made.length,0)
 f.requests[2].resolve({});await tick();assert.equal(f.made.length,1);assert.equal(f.made[0].url,'a')
 f.update('c',3);f.owner.dispose();f.requests[3].resolve({});await tick();assert.equal(f.made.length,1)
 f.update('d',4);assert.equal(f.requests.length,4)
})
test('same-picture cut restarts its transition and grade is stepped on the common clock',()=>{
 const f=fixture();f.update(null,0);f.scene.paint(0)
 assert.deepEqual(f.scene.grade.current,matrix.identity())
 const layer=f.scene.restart(f.scene.layers[0],'black','day',10)
 assert.equal(layer.start,10);assert.equal(layer.plan.kind,'black');assert.equal(f.scene.paint(20).coverAlpha,.4)
 const copy=f.scene.layers;copy.length=0;assert.equal(f.scene.layers.length,2)
 f.owner.dispose()
})
