import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageLooks}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/looks.cjs')
const {createStageLookShaders}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/look-shaders.cjs')
const {createStageLookMath}=require('../tavern-plugin/shared/stage-look-math.cjs')
const {galMatrix:matrix,galClamp01:clamp,galEase:ease}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
const {stageLighting:lighting,stageLookLayer:layer}=require('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-light.cjs')
const {stageLookFadeMs:fade}=require('../tavern-plugin/src/client/stage-effects.cjs')
const math=createStageLookMath({matrix,clamp,lighting,layer})
const {createStageSceneGraphics}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')
const useFilter=createStageSceneGraphics({}).useFilter
function fixture(){
 const made=[],nodes=[],images=[],textures=[]
 class Filter{constructor(v,f,uniforms){this.uniforms=uniforms;this.destroyCount=0;made.push(this)}destroy(){this.destroyCount++;assert.equal(this.destroyCount,1)}}
 const point=()=>({set(){}})
 class Container{constructor(){this.children=[];this.position=point();this.anchor=point();nodes.push(this)}addChild(node){this.children.push(node);node.parent=this}destroy(o){if(o?.children)for(const child of [...this.children])child.destroy();if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.children=[];this.destroyed=true}}
 class Sprite extends Container{constructor(texture){super();this.texture=texture}}
 class Texture{constructor(base){this.height=16;this.width=256;this.destroyCount=0;textures.push(this)}destroy(){this.destroyCount++;assert.equal(this.destroyCount,1)}}
 Texture.WHITE={};Texture.EMPTY={};Texture.BLACK={}
 class Image{constructor(){images.push(this)}decode(){return new Promise(resolve=>{this.complete=resolve})}}
 const chain=()=>({slots:new Map(),set(name,value){if(value)this.slots.set(name,value);else this.slots.delete(name)},refresh(){}})
 const filters={world:chain(),figures:chain()},overlay=new Container()
 const PIXI={Filter,Container,Sprite,Texture,BaseTexture:class{},MIPMAP_MODES:{OFF:0},SCALE_MODES:{LINEAR:1},WRAP_MODES:{CLAMP:0},BLEND_MODES:{SCREEN:1,ADD:2},filters:{KawaseBlurFilter:Filter,AdvancedBloomFilter:Filter,OldFilmFilter:Filter}}
 const manager=createStageLooks({math,shaders:createStageLookShaders(),art:()=>new Texture(),matrix,clamp,ease,fade,useFilter,weather:{kinds:[],matrix:()=>matrix.identity()},colors:{mix:(a,b)=>a},Image})
 const env={PIXI,filters,overlay,app:{renderer:{resolution:1}},tune:f=>f}
 return {manager,env,made,nodes,images,textures,filters,overlay}
}
test('shared look math preserves neutral grade, bounded params and picture time correction',()=>{
 const neutral=math.galLookNormalize({})
 assert.deepEqual(math.galLookMatrix(neutral),matrix.identity())
 const extreme=math.galLookNormalize({exposure:100,gamma:0,vignette:{color:'#abc'},bloom:{amount:2},grain:1,motes:{kind:'bokeh',amount:1}})
 assert.equal(extreme.exposure,4);assert.deepEqual(extreme.gamma,[0.1,0.1,0.1]);assert.deepEqual(extreme.vignette.color,[170/255,187/255,204/255])
 const low=math.galLookPlan(extreme,'low')
 assert.equal(low.bloom,false);assert.equal(low.film,false);assert.deepEqual(low.motes,[])
 const registry=math.galLookRegistry([{id:'night',time:true,params:{gain:0.5,standIn:{gain:0.8}}}],1)
 assert.deepEqual(math.galLayerCorrection(registry,'night','night'),matrix.identity())
 assert.deepEqual(math.galLayerCorrection(registry,'night','day'),matrix.scale(0.4,0.4,0.4))
})
test('look renderer routes time grading and releases every owned pass and overlay',()=>{
 const f=fixture(),renderer=f.manager.create(f.env)
 const desc={packLayers:{timeWorld:math.galLookNormalize({gamma:2}),moodWorld:math.galLookNormalize({bloom:{amount:1},distortion:0.2,grain:0.2,soften:0.1}),timeGradeTarget:'figures',id:'test',grade:'night',lighting:{time:'night',mood:'test'}}}
 renderer.tick(desc,0,800,600,'high')
 assert.ok(f.filters.figures.slots.has('timeGrade'));assert.equal(f.filters.world.slots.has('timeGrade'),false)
 assert.ok(f.filters.world.slots.has('screenGrade'));assert.ok(f.filters.world.slots.has('bloom'));assert.ok(f.filters.world.slots.has('soften'))
 assert.ok(renderer.ui(matrix.identity(),{}))
 f.manager.dispose();renderer.destroy();renderer.tick(desc,100,800,600,'high')
 assert.equal(f.filters.world.slots.size,0);assert.equal(f.filters.figures.slots.size,0);assert.equal(f.overlay.children.length,0)
 assert.ok(f.made.length>=7);assert.ok(f.made.every(filter=>filter.destroyCount===1))
 assert.equal(renderer.ui(matrix.identity(),{}),null)
})
test('late image decode cannot create GPU textures after plugin unload',async()=>{
 const f=fixture(),renderer=f.manager.create(f.env)
 renderer.tick({packLayers:{timeWorld:math.GAL_LOOK_NEUTRAL,moodWorld:math.galLookNormalize({lut:'/lut.png'}),timeGradeTarget:'world'}},0,800,600,'high')
 await Promise.resolve();assert.equal(f.images.length,1)
 f.manager.dispose();f.images[0].complete();await Promise.resolve();await Promise.resolve()
 assert.equal(f.textures.length,0);assert.equal(f.images[0].onload,null)
})
test('failed filter setup rolls back earlier allocations',()=>{
 const f=fixture();let calls=0
 assert.throws(()=>f.manager.create({...f.env,tune:filter=>{if(++calls===2)throw new Error('tuning failed');return filter}}),/tuning failed/)
 assert.equal(f.made.length,2);assert.ok(f.made.every(filter=>filter.destroyCount===1))
 assert.equal(f.filters.world.slots.size,0);f.manager.dispose()
})
