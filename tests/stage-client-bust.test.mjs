import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageBust}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/bust.cjs')
function fixture(){
 const textures=[],renders=[];let failRender=false,failTexture=false
 class Matrix {set(...values){this.values=values;return this}append(){return this}invert(){return this}copyTo(to){return to}}
 class Sprite {constructor(texture){this.texture=texture;this.position={set(...values){this.values=values}}}destroy(){this.destroyed=true}}
 const PIXI={Matrix,Sprite,Texture:{EMPTY:{}},RenderTexture:{create(size){if(failTexture)throw Error('allocation failed');const texture={...size,dead:0,destroy(deep){assert.equal(deep,true);this.dead++}};textures.push(texture);return texture}}}
 const renderer={resolution:1,render(container,options){assert.equal(container.filters,null);if(failRender)throw Error('render failed');renders.push(options)}}
 const owner=createStageBust({ease:{outCubic:t=>1-(1-t)**3},clamp:t=>Math.max(0,Math.min(1,t)),framedHead:n=>n})
 const filters=[{}],container={visible:true,filters,transform:{localTransform:new Matrix(),updateLocalTransform(){},_parentID:2}}
 const input={spec:{alias:'a',screen:600,fit:800,width:800,head:[400,100,100],crop:[1,1,2],enter:{dx:40,alpha:0,ms:200}},subject:{container,head:{x:10,top:20,chin:70}},W:800,H:600,now:0}
 return {owner,view:owner.create({PIXI,renderer}),textures,renders,input,container,filters,failRender(){failRender=true},failTexture(){failTexture=true}}
}
test('bust owns cropped texture and subject entrance while borrowing the original figure',()=>{
 const e=fixture();e.view.tick(e.input)
 assert.deepEqual([e.textures[0].width,e.textures[0].height],[200,400]);assert.deepEqual(e.view.sprite.position.values,[300,0]);assert.equal(e.view.sprite.alpha,0)
 assert.equal(e.container.filters,e.filters);assert.equal(e.container.transform._parentID,-1)
 e.view.tick({...e.input,now:200});assert.equal(e.view.sprite.alpha,1);assert.equal(e.textures.length,1)
 e.view.tick({...e.input,spec:null});assert.equal(e.view.sprite.visible,false)
 e.view.tick({...e.input,instant:true});assert.equal(e.view.sprite.alpha,1)
 e.view.tick({...e.input,W:1600,H:1200});assert.equal(e.textures[0].dead,1);assert.equal(e.textures.length,2)
 e.owner.dispose();e.view.dispose();assert.ok(e.textures.every(t=>t.dead===1));assert.equal(e.container.destroyed,undefined)
 const count=e.renders.length;e.view.tick(e.input);assert.equal(e.renders.length,count);assert.equal(e.view.sprite.visible,false)
})
test('failed portrait rendering restores borrowed filters and invalidates the temporary parent',()=>{
 const e=fixture();e.failRender();assert.throws(()=>e.view.tick(e.input),/render failed/)
 assert.equal(e.container.filters,e.filters);assert.equal(e.container.transform._parentID,-1)
 e.owner.dispose();assert.equal(e.textures[0].dead,1)
})
test('failed resize keeps the previous portrait texture and allows cleanup',()=>{
 const e=fixture();e.view.tick(e.input);e.failTexture()
 assert.throws(()=>e.view.tick({...e.input,W:1600,H:1200}),/allocation failed/)
 assert.equal(e.view.sprite.texture,e.textures[0]);assert.equal(e.textures[0].dead,0)
 e.owner.dispose();assert.equal(e.textures[0].dead,1)
})
