import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageMonologue}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/monologue.cjs')
function setup(){
 const textures=[],dimensions=[];let fail=false
 const texture=()=>{const t={width:100,height:50,destroyed:0,destroy(deep){assert.equal(deep,true);this.destroyed++}};textures.push(t);return t}
 class Sprite{constructor(t){this.texture=t;for(const key of ['anchor','position','scale'])this[key]={set(...v){this.value=v}}}destroy(){this.destroyed=true;this.parent?.removeChild(this)}}
 const PIXI={Sprite,Texture:{EMPTY:{},from(){if(fail)throw Error('image failed');return texture()}},Point:class{constructor(x,y){this.x=x;this.y=y}}}
 const owner=createStageMonologue({canvasTexture(p,w,h,paint){dimensions.push([w,h]);paint({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){}},1,1);return texture()}})
 const world={scale:{x:2},rotation:.4,toLocal:p=>({x:p.x-10,y:p.y-20})}
 return {owner,create:()=>owner.create({PIXI,world}),textures,dimensions,fail(){fail=true}}
}
test('monologue keeps screen framing and remembered fade while switching image and procedural backdrops',()=>{
 const env=setup(),view=env.create()
 view.tick({thinking:{dim:.3,vignette:.1,fade:[.2,.4]}},.1,800,600)
 assert.equal(view.alpha,.5);assert.equal(view.sprite.visible,true);assert.deepEqual(env.dimensions,[[960,540]])
 assert.deepEqual(view.sprite.position.value,[390,280]);assert.deepEqual(view.sprite.scale.value,[4,6]);assert.equal(view.sprite.rotation,-.4)
 view.tick({thinking:{dim:.3,vignette:.1},snap:true},.1,800,600);assert.equal(view.alpha,1);assert.equal(env.textures.length,1)
 view.tick({},.1,800,600);assert.equal(view.alpha,.75)
 view.tick({thinking:{image:'a'},snap:true},.1,800,600);assert.equal(view.sprite.texture,env.textures[1])
 view.tick({thinking:{image:'b'},snap:true},.1,800,600);assert.equal(env.textures[1].destroyed,1)
 view.tick({thinking:{dim:.4,vignette:.1},snap:true},.1,800,600);assert.equal(env.textures[0].destroyed,1)
 view.tick({reducedMotion:true},.12,800,600);assert.equal(view.alpha,0);assert.equal(view.sprite.visible,false)
 env.owner.dispose();assert.ok(env.textures.every(t=>t.destroyed===1))
})
test('monologue owner disposes every layer once and ignores late ticks',()=>{
 const env=setup(),first=env.create(),second=env.create()
 for(const view of [first,second])view.tick({thinking:{image:'a'},snap:true},0,800,600)
 first.dispose();env.owner.dispose();env.owner.dispose();second.dispose()
 for(const view of [first,second]){view.tick({thinking:{image:'b'}},1,800,600);assert.equal(view.alpha,0);assert.equal(view.sprite.visible,false);assert.equal(view.sprite.destroyed,true)}
 assert.equal(env.textures.length,2);assert.ok(env.textures.every(t=>t.destroyed===1));assert.throws(()=>env.create(),/disposed/)
})
test('failed image replacement retains the last good texture until cleanup',()=>{
 const env=setup(),view=env.create();view.tick({thinking:{image:'good'},snap:true},0,800,600)
 env.fail();assert.throws(()=>view.tick({thinking:{image:'bad'}},0,800,600),/image failed/)
 assert.equal(view.sprite.texture,env.textures[0]);assert.equal(env.textures[0].destroyed,0)
 env.owner.dispose();assert.equal(env.textures[0].destroyed,1)
})
