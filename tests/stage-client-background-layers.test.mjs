import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageBackgroundLayers}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/background-layers.cjs')
const m=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
function fixture(){
 const sprites=[],filters=[]
 class Sprite{constructor(texture){this.texture=texture;this.anchor=this.position=this.scale={set(){}};this.destroyed=0;sprites.push(this)}destroy(){assert.equal(++this.destroyed,1)}}
 class Filter{constructor(){this.destroyed=0;filters.push(this)}destroy(){assert.equal(++this.destroyed,1)}}
 const module=createStageBackgroundLayers({matrix:m.galMatrix,ease:m.galEase,clamp:m.galClamp01,cover:m.galCover,transitionFrame:()=>({incoming:.5,mask:.5}),wipeRect:m.galWipeRect,irisSize:m.galIrisSize})
 const args={PIXI:{Sprite,filters:{ColorMatrixFilter:Filter}},screen:{width:800,height:600},container:{addChild(){}},generated:{wipe:{width:100,height:4},iris:{}},tune:f=>f,url:'a',texture:{width:800,height:600},plan:{kind:'wipe',duration:500},now:0,correction:m.galMatrix.identity(),grade:'day',version:1}
 return {module,args,sprites,filters}
}
test('background layer owns transition masks and correction filters across finish and unload',()=>{
 const f=fixture(),layer=f.module.create(f.args)
 assert.equal(layer.paint(100).incoming,.5);assert.equal(layer.sprite.alpha,.5);assert.equal(f.sprites.length,2)
 layer.setCorrection(m.galMatrix.scale(.5,.5,.5),'night',2,100,0);layer.paint(100);assert.equal(f.filters.length,1)
 layer.finish();assert.equal(layer.mask,null);assert.equal(f.sprites[1].destroyed,1)
 f.module.dispose();layer.destroy();assert.equal(f.sprites[0].destroyed,1);assert.equal(f.filters[0].destroyed,1);assert.equal(layer.paint(200),null)
 assert.throws(()=>f.module.create(f.args),/disposed/)
})
test('background layer setup failure rolls back created sprites',()=>{
 const f=fixture();f.args.container.addChild=()=>{throw Error('attach failed')}
 assert.throws(()=>f.module.create(f.args),/attach failed/);assert.ok(f.sprites.every(sprite=>sprite.destroyed===1));f.module.dispose()
})
