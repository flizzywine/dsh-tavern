import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSceneTextures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-textures.cjs')
function fixture(options={}){
 const images=[],allocated=[]
 class Image{constructor(){images.push(this)}decode(){return new Promise((resolve,reject)=>{this.finish=resolve;this.fail=reject})}}
 class BaseTexture{constructor(){this.realWidth=10;this.realHeight=10}destroy(){}}
 class Texture{constructor(base){this.baseTexture=base;this.destroyed=0;allocated.push(this)}destroy(){assert.equal(++this.destroyed,1)}}
 const owner=createStageSceneTextures({Image,now:()=>10,keepBytes:400,...options}),cache=owner.create({PIXI:{BaseTexture,Texture},upload:options.upload})
 return {owner,cache,images,allocated}
}
test('scene cache shares decoding, retains current visit within budget and evicts older pictures',async()=>{
 const f=fixture();const a=f.cache.load('a');assert.equal(a,f.cache.load('a'));f.images[0].finish();await a
 f.cache.prune(['a'],1);f.cache.prune([],1);assert.equal(f.cache.size,1)
 const b=f.cache.load('b');f.images[1].finish();await b;f.cache.prune(['b'],2);f.cache.prune([],3)
 assert.equal(f.cache.get('a'),undefined);assert.equal(f.allocated[0].destroyed,1);assert.equal(f.cache.get('b').ready,true)
 f.owner.dispose();assert.equal(f.allocated[1].destroyed,1);assert.equal(f.cache.size,0)
})
