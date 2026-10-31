import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSceneGraphics}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')
test('scene filter chain preserves slot order, skips disabled passes and expires idle filters',()=>{
 const graphics=createStageSceneGraphics({window:{PIXI:{MSAA_QUALITY:{NONE:0}}}}),container={},area={}
 const chain=graphics.filters(container,area,['grade','glow'],true),grade={},glow={}
 chain.set('glow',glow);chain.set('grade',grade);assert.deepEqual(container.filters,[grade,glow]);assert.equal(grade.multisample,0);assert.equal(container.filterArea,area)
 grade.enabled=false;chain.refresh();assert.deepEqual(container.filters,[glow])
 const store={};let destroyed=0
 const filter=graphics.useFilter(store,chain,'blur',()=>({destroy(){destroyed++}}),true,10,()=>{})
 assert.equal(chain.get('blur'),filter);graphics.useFilter(store,chain,'blur',()=>{},false,11,()=>{})
 assert.equal(filter.enabled,false);graphics.useFilter(store,chain,'blur',()=>{},false,3011,()=>{})
 assert.equal(destroyed,1);assert.equal(chain.get('blur'),null);assert.deepEqual(store,{})
 chain.set('grade',null);chain.set('glow',null);assert.equal(container.filters,null);assert.equal(container.filterArea,null)
})
test('scene texture batch releases earlier allocations when a later canvas upload fails',()=>{
 const context=new Proxy({},{get:()=>()=>({addColorStop(){}}),set:()=>true}),destroyed=[];let allocations=0
 const graphics=createStageSceneGraphics({document:{createElement:()=>({getContext:()=>context})},paintEmpty(){},emptyPalette:()=>({})})
 const PIXI={Texture:{from(){if(++allocations===3)throw Error('upload failed');const id=allocations;return {destroy(deep){destroyed.push([id,deep])}}}}}
 assert.throws(()=>graphics.textures(PIXI,{}),/upload failed/);assert.deepEqual(destroyed,[[1,true],[2,true]])
})
