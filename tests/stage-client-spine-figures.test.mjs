import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSpineFigures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/spine-figures.cjs')
function fixture(){
 let destroyed=0,bodyDestroyed=0,updates=0
 const figure={spine:{},mood(){updates++},voice(){updates++},update(){updates++},debug:()=>({animation:'idle'}),destroy(){destroyed++}}
 const rig={spineLoadData:async()=>({textures:[]}),spineFigure:()=>figure,spineFrame:()=>[0,0,100,200],spineMeasure:()=>({headTop:.1,candidate:{auto:{}}}),spineBody:()=>({destroy(){bodyDestroyed++;this.destroyed=true}}),spineBottomFade(){}}
 const module=createStageSpineFigures({rig,bottomFade:()=>null}),input={PIXI:{},url:'model',config:{},identity:'one',renderer:{}}
 return {module,rig,input,counts:()=>({destroyed,bodyDestroyed,updates})}
}
test('stage owns Spine figures independently and fences updates after disposal',async()=>{
 const f=fixture(),a=await f.module.prepare(f.input),b=await f.module.prepare(f.input)
 assert.deepEqual(a.frame,[0,0,100,200]);assert.equal(a.body.forkHeadTop,.1);a.mood('happy');a.voice(1);a.update(.1)
 a.destroy();a.destroy();f.module.dispose();b.update(.2);b.destroy()
 assert.deepEqual(f.counts(),{destroyed:2,bodyDestroyed:2,updates:3});assert.equal(await f.module.prepare(f.input),null)
})
test('late Spine loading releases textures without creating a figure',async()=>{
 const f=fixture();let resolve,released=0,created=0
 f.rig.spineLoadData=()=>new Promise(done=>resolve=done);f.rig.spineFigure=()=>{created++}
 const pending=f.module.prepare(f.input);f.module.dispose();resolve({textures:[{destroy(){released++}}]})
 assert.equal(await pending,null);assert.equal(released,1);assert.equal(created,0)
})
test('failed Spine preparation releases its rig and does not retain a broken instance',async()=>{
 const f=fixture();f.rig.spineBody=()=>{throw Error('body failed')}
 await assert.rejects(f.module.prepare(f.input),/body failed/);f.module.dispose()
 assert.equal(f.counts().destroyed,1)
})
