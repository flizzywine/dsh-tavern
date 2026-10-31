import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSceneTextures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-textures.cjs')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
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
test('unload settles pending decode and upload without allowing late GPU allocations',async()=>{
 let uploaded
 const f=fixture({upload:()=>new Promise(resolve=>uploaded=resolve)}),a=f.cache.load('decode'),b=f.cache.load('upload')
 const rejectA=assert.rejects(a,/cancelled/),rejectB=assert.rejects(b,/cancelled/)
 f.images[1].finish();await tick();assert.equal(f.allocated.length,1)
 f.owner.dispose();await Promise.all([rejectA,rejectB]);f.images[0].finish();uploaded();await tick()
 assert.equal(f.allocated.length,1);assert.equal(f.allocated[0].destroyed,1);await assert.rejects(f.cache.load('late'),/cancelled/)
})
test('upload failure frees the failed texture and allows another load',async()=>{
 const f=fixture({upload:async()=>{throw Error('upload failed')}}),first=f.cache.load('a'),rejected=assert.rejects(first,/upload failed/)
 f.images[0].finish();await rejected;await tick();assert.equal(f.cache.size,0);assert.equal(f.allocated[0].destroyed,1)
 const second=f.cache.load('a');assert.notEqual(first,second);const cancelled=assert.rejects(second,/cancelled/);f.owner.dispose();await cancelled
})
test('fallback image handlers are installed before src and detached after success',async()=>{
 let image
 class Image{constructor(){image=this}set src(value){this.onload()}}
 const f=fixture({Image});await f.cache.load('cached');assert.equal(image.onload,null);assert.equal(image.onerror,null);f.owner.dispose()
})
