import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSpineFigures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/spine-figures.cjs')
function fixture(){
 let destroyed=0,bodyDestroyed=0,updates=0
 const figure={spine:{},mood(){updates++},voice(){updates++},update(){updates++},debug:()=>({animation:'idle'}),destroy(){destroyed++}}
 const rig={spineLoadData:async()=>({textures:[]}),spineFigure:()=>figure,spineFrame:()=>[0,0,100,200],spineMeasure:()=>({headTop:.1,candidate:{auto:{}}}),spineHead:()=>({top:.1,chin:.2,x:50}),spineBody:()=>({destroy(){bodyDestroyed++;this.destroyed=true}}),spineBottomFade(){}}
 const module=createStageSpineFigures({rig,bottomFade:()=>null}),input={PIXI:{},url:'model',config:{},identity:'one',renderer:{}}
 return {module,rig,input,counts:()=>({destroyed,bodyDestroyed,updates})}
}
test('stage owns Spine figures independently and fences updates after disposal',async()=>{
 const f=fixture(),a=await f.module.prepare(f.input),b=await f.module.prepare(f.input)
 assert.deepEqual(a.frame,[0,0,100,200]);assert.equal(a.body.forkHeadTop,.1);assert.deepEqual(a.head,{top:.1,chin:.2,x:50});a.mood('happy');a.voice(1);a.update(.1)
 a.destroy();a.destroy();f.module.dispose();b.update(.2);b.destroy()
 assert.deepEqual(f.counts(),{destroyed:2,bodyDestroyed:2,updates:3});assert.equal(await f.module.prepare(f.input),null)
})

const {createSpineRig}=require('../tavern-plugin/shared/spine-rig.cjs')
const {packFigureAnatomy}=require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
// A rig at rest: slots with world boxes [x, y, w, h] (skeleton units, the spine at the origin).
function restRig(boxes){
 const names=Object.keys(boxes)
 return {skeleton:{slots:names.map(name=>({data:{name},attachment:{}}))},worldTransform:{applyInverse:p=>({x:p.x,y:p.y})},
  slotContainers:names.map(name=>({renderable:true,getBounds:()=>{const [x,y,width,height]=boxes[name];return {x,y,width,height}}}))}
}
test('a Spine figure drawn to the knees is sized by its head slot, not by its drawn bounds',()=>{
 const {spineHead}=createSpineRig({window:{},measure:{}})
 // Hair to knees, 1000 units: the face slot (head) spans 160 of them, the hair box would be no head.
 const frame=[-300,0,600,1000],rig=restRig({hair_back:[-150,0,300,420],head:[-90,40,180,160],skirt:[-200,600,400,400]})
 const head=spineHead(rig,frame)
 assert.deepEqual(head,{top:.04,chin:.2,x:300})
 const auto={figureTop:0,visibleBottom:1000,supportX:300},anatomy=packFigureAnatomy({head,heightBasis:'standing'},[600,1000],{auto})
 // 6.5 heads: the feet stand below the drawn frame, so the stage shows a knee-length figure at its full height's scale.
 assert.equal(anatomy.source,'head');assert.ok(Math.abs(anatomy.feet-(.04+.16*6.5))<1e-9);assert.ok(anatomy.feet>1)
 // A full-length rig keeps its drawn body; no plausible head slot keeps the bounds estimate.
 assert.equal(packFigureAnatomy({head:spineHead(restRig({head:[-90,0,180,120]}),frame)},[600,1000],{auto}).source,'estimated')
 assert.equal(spineHead(restRig({hair:[-90,40,180,160]}),frame),null)
 assert.equal(spineHead(restRig({head:[-300,0,600,900]}),frame),null)
 assert.deepEqual(spineHead(restRig({Face:[-90,40,180,160]}),frame),{top:.04,chin:.2,x:300})
})