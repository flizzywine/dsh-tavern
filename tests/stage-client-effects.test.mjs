import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageEffects}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/effects.cjs')
const policy=require('../tavern-plugin/src/client/stage-effects.cjs')
const {createStageSceneGraphics}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')
const useFilter=createStageSceneGraphics({}).useFilter
test('filter tuning failure releases the newly allocated filter before ownership transfer',()=>{
 let destroyed=0,attached=0;const store={}
 assert.throws(()=>useFilter(store,{set(){attached++}},'grade',()=>({destroy(){destroyed++}}),true,0,()=>{throw new Error('tune failed')}),/tune failed/)
 assert.equal(destroyed,1);assert.equal(attached,0);assert.deepEqual(store,{})
})
function fixture(){
 const made=[],textures=[],disposed=[]
 class Container{constructor(){this.children=[]}addChild(n){n.parent=this;this.children.push(n)}destroy(options){if(options?.children)for(const child of [...this.children])child.destroy();if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.children=[]}}
 class Sprite extends Container{constructor(texture){super();this.texture=texture}}
 class Filter{constructor(){this.count=0;made.push(this)}refresh(){}destroy(){assert.equal(++this.count,1)}}
 const chain=()=>({slots:new Map(),set(n,f){if(f)this.slots.set(n,f);else this.slots.delete(n)},refresh(){}})
 const filters={world:chain(),backdrop:chain()},overlay=new Container()
 const PIXI={Container,Sprite,Point:class{constructor(x,y){this.x=x;this.y=y}},Texture:{WHITE:{}},BLEND_MODES:{ADD:1},filters:{KawaseBlurFilter:Filter,GlitchFilter:Filter,ShockwaveFilter:Filter}}
 const looks={create(){return {tick(){},plan:()=>({backBlur:0,motes:[]}),ui:(grade,beats)=>beats,stats:()=>({}),destroy(){disposed.push('looks')}}}}
 const weather={kinds:[],lightning:()=>0,create(){return {create(){},destroy(){},step:()=>0,dispose(){disposed.push('weather')}}}}
 const emotes={create(){return {add:()=>true,tick(){},stats:()=>({emotes:[],textures:0}),dispose(){disposed.push('emotes')}}}}
 const options={policy,useFilter,looks,weather,emotes,normalize:p=>p,window:{PIXI},canvasTexture(){const texture={count:0,destroy(){assert.equal(++this.count,1)}};textures.push(texture);return texture}}
 const manager=createStageEffects(options)
 const env={PIXI,app:{screen:{width:800,height:600}},filters,overlay,world:{toGlobal:p=>p},tune:f=>f,quality:()=> 'high',headOf:()=>({x:200,top:20,chin:80})}
 return {manager,env,made,textures,disposed,options}
}
test('effects share the flash gate and keep reduced-motion semantics',()=>{
 const f=fixture(),fx=f.manager.create(f.env),safe={photosensitive:true,reducedMotion:true}
 policy.stageFlashGate.reset();fx.tick({safety:safe},0,0,0)
 for(let i=0;i<3;i++)assert.equal(policy.stageFlashGate.admit(safe),true)
 fx.trigger({op:'beat',value:'flash'},0);assert.equal(fx.stats().beats.length,0)
 fx.trigger({op:'beat',value:'blackout'},0);assert.deepEqual(fx.stats().beats,['blackout'])
 fx.trigger({op:'beat',value:'glitch'},0);fx.trigger({op:'beat',value:'shake-3'},0)
 assert.equal(fx.stats().shakes,0);assert.deepEqual(fx.stats().beats,['blackout'])
 fx.trigger({op:'beat',value:'heartbeat'},0);fx.tick({safety:safe},100,0.1,0)
 assert.equal(fx.zoomKick(100),0);assert.ok(fx.ui(null).vignette>0)
 f.manager.dispose();policy.stageFlashGate.reset()
})
test('effects own active filters, nodes and textures and fence late ticks',()=>{
 const f=fixture(),fx=f.manager.create(f.env),desc={safety:{photosensitive:false,reducedMotion:false}}
 fx.tick(desc,0,0,0)
 for(const value of ['flash','glitch','shock','heartbeat','shake-2'])assert.equal(fx.trigger({op:'beat',value,id:'speaker'},0),true)
 fx.tick(desc,50,0.05,0.5)
 assert.ok(f.env.filters.world.slots.has('glitch'));assert.ok(f.env.filters.world.slots.has('shock'));assert.ok(f.env.filters.backdrop.slots.has('blur'))
 assert.ok(fx.ui(null).white>0);assert.ok(fx.zoomKick(50)>0)
 assert.ok(Math.abs(fx.shakeOffset(50).x)>0)
 f.manager.dispose();fx.destroy();fx.tick(desc,100,0.05,0)
 assert.equal(fx.trigger({op:'beat',value:'flash'},100),false);assert.equal(fx.zoomKick(100),0)
 assert.deepEqual(fx.shakeOffset(100),{x:0,y:0,bx:0,by:0});assert.equal(fx.ui(null),null)
 assert.equal(f.env.overlay.children.length,0);assert.equal(f.env.filters.world.slots.size,0);assert.equal(f.env.filters.backdrop.slots.size,0)
 assert.ok(f.made.every(filter=>filter.count===1));assert.ok(f.textures.every(texture=>texture.count===1))
 assert.deepEqual(f.disposed.sort(),['emotes','looks','weather'])
})
test('effect setup failure releases overlays and textures',()=>{
 const f=fixture(),manager=createStageEffects({...f.options,looks:{create(){throw new Error('look failed')}}})
 assert.throws(()=>manager.create(f.env),/look failed/)
 assert.equal(f.env.overlay.children.length,0);assert.ok(f.textures.every(t=>t.count===1))
 manager.dispose();f.manager.dispose()
})
test('filter library load is coalesced and late completion does not revive disposed scope',async()=>{
 let finish,calls=0
 const window={PIXI:{filters:{}}},manager=createStageEffects({window,filtersUrl:'/filters.js',loadScript:url=>{calls++;assert.equal(url,'/filters.js');return new Promise(resolve=>finish=resolve)}})
 const a=manager.loadFilters(),b=manager.loadFilters();assert.equal(a,b);assert.equal(calls,1)
 manager.dispose();finish();assert.equal(await a,null);assert.equal(await manager.loadFilters(),null);assert.equal(calls,1)
})
