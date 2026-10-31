import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageWeather}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/weather.cjs')
const {createStageEmotes}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/emotes.cjs')
const {createStageEffectColors}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/effect-colors.cjs')
const {galMatrix:matrix,galEase:ease,galClamp01:clamp}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
function fixture(){
 const textures=[],nodes=[];let canvasCount=0,draws=0
 const context=()=>new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{draws++}})
 const document={createElement(){canvasCount++;return {getContext:context,toDataURL:()=>`data:image/png;base64,${canvasCount}`}}}
 class Container{
  constructor(){this.children=[];this.destroyCount=0;nodes.push(this)}
  addChild(node){node.parent=this;this.children.push(node);return node}
  destroy(options){this.destroyCount++;if(this.destroyCount>1)throw new Error('double destroy');if(options?.children)for(const child of [...this.children])child.destroy();if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.children=[]}
 }
 const point=()=>({x:0,y:0,set(x,y=x){this.x=x;this.y=y}})
 class Sprite extends Container{constructor(texture){super();this.texture=texture;this.anchor=point();this.scale=point();this.position=point()}}
 const PIXI={Container,ParticleContainer:Container,Sprite,BLEND_MODES:{ADD:1,NORMAL:0}}
 const canvasTexture=(p,width,height,paint)=>{paint(context(),width,height);const t={width,height,destroyCount:0,destroy(){this.destroyCount++;if(this.destroyCount>1)throw new Error('texture double destroy')}};textures.push(t);return t}
 const backFx=new Container(),frontFx=new Container(),emotes=new Container(),colors=createStageEffectColors({document})
 return {PIXI,textures,nodes,canvasTexture,document,colors,backFx,frontFx,emotes,app:{screen:{width:800,height:600}},headOf:()=>({x:400,top:100,chin:200,width:120}),draws:()=>draws,canvases:()=>canvasCount}
}
test('weather systems retain quality counts and own their particle containers and textures',()=>{
 const f=fixture(),weather=createStageWeather({matrix,canvasTexture:f.canvasTexture}),runtime=weather.create(f)
 for(const kind of [...weather.kinds,'motes']){
 const specs=weather.layers(kind,'low'),system=runtime.create(kind,'low')
 assert.equal(runtime.step(system,1000,1/60,800,600),specs.reduce((n,s)=>n+s.count,0))
 assert.ok(system.layers.every(l=>l.items.every(p=>Number.isFinite(p.sprite.position.x)&&Number.isFinite(p.sprite.scale.x))))
 }
 assert.ok(f.draws()>0);assert.ok(f.backFx.children.length>0)
 weather.dispose();runtime.dispose()
 assert.equal(f.frontFx.children.length,0);assert.equal(f.backFx.children.length,0)
 assert.ok(f.textures.every(t=>t.destroyCount===1))
 assert.throws(()=>runtime.create('rain','high'),/disposed/)
 assert.deepEqual(weather.matrix(''),matrix.identity())
 assert.equal(weather.lightning(-1),0);assert.equal(weather.lightning(900),0);assert.ok(weather.lightning(50)>0)
 f.colors.dispose()
})
test('weather rolls back partially created GPU resources',()=>{
 const f=fixture(),weather=createStageWeather({matrix,canvasTexture:f.canvasTexture})
 f.PIXI.Sprite=class{constructor(){throw new Error('sprite failed')}}
 const runtime=weather.create(f)
 assert.throws(()=>runtime.create('rain','high'),/sprite failed/)
 assert.equal(f.backFx.children.length,0);assert.ok(f.textures.every(t=>t.destroyCount===1))
 weather.dispose();f.colors.dispose()
})
test('emotes follow heads, expire, reuse textures and release both scene and DOM caches',()=>{
 const f=fixture(),module=createStageEmotes({document:f.document,ease,clamp,canvasTexture:f.canvasTexture,colors:f.colors}),runtime=module.create(f)
 assert.equal(runtime.add({id:'figure',value:'invalid'},0),false)
 for(const value of ['!','?','...','sweat','anger','heart','note','gloom','sparkle','tear'])assert.equal(runtime.add({id:value,value,color:0xf06aa0},0),true)
 runtime.tick(500,800);assert.equal(runtime.stats().emotes.length,10)
 assert.ok(f.emotes.children.every(box=>box.children.every(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.alpha))))
 const textureCount=f.textures.length
 runtime.add({id:'heart',value:'heart',color:0xf06aa0},600)
 assert.equal(f.textures.length,textureCount)
 runtime.tick(3000,800);assert.equal(runtime.stats().emotes.length,0);assert.equal(f.emotes.children.length,0)
 const url=module.dataUrl('heart',0xf06aa0),count=f.canvases()
 assert.equal(module.dataUrl('heart',0xf06aa0),url);assert.equal(f.canvases(),count)
 runtime.add({id:'last',value:'heart',color:0xf06aa0},3100)
 module.dispose();runtime.tick(3200,800);runtime.dispose()
 assert.equal(f.emotes.children.length,0);assert.ok(f.textures.every(t=>t.destroyCount===1))
 assert.equal(runtime.add({id:'late',value:'heart'},3300),false)
 assert.equal(module.dataUrl('heart',0xf06aa0),null);assert.equal(f.canvases(),count)
 f.colors.dispose()
})
