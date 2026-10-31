import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageScene}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs')
const math=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
function fixture(phase){
 const calls=[];let serial=0
 const PIXI={Application:class{constructor(){this.view={};this.renderer={on(){},gl:{}};this.ticker={update(){}}}destroy(){calls.push('app')}},Container:class{constructor(){this.id=++serial;if(this.id===3)throw Error('node allocation')}destroy(){this.destroyed=true;calls.push('node:'+this.id)}}}
 const sceneGraphics={textures(){
  if(phase==='textures')throw Error('texture allocation')
  return {a:{destroy(){calls.push('texture');if(phase==='cleanup')throw Error('texture cleanup')}}}
 }}
 const scope=createStageScene({window:{PIXI},document:{},math,reading:{get:()=>({})},services:{resolution:()=>1},modules:{sceneGraphics}})
 const host={appendChild(){if(phase==='append')throw Error('append')}}
 return {scope,host,calls}
}
for(const phase of ['append','textures','nodes','cleanup'])test(`scene startup rollback after ${phase} failure releases prior acquisitions`,()=>{
 const h=fixture(phase)
 assert.throws(()=>h.scope.create(h.host,{}),phase==='cleanup'?/initialization failed/:/append|allocation/)
 assert.deepEqual(h.calls,phase==='append'||phase==='textures'?['app']:['node:2','node:1','texture','app'])
 h.scope.dispose();assert.equal(h.calls.filter(v=>v==='app').length,1)
 assert.throws(()=>h.scope.create(h.host,{}),/disposed/)
})

const {createStageLayeredFigures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs')
test('layered scene figures own generated textures while borrowing source images',()=>{
 const released=[],painted=[];let serial=0
 const compositor={urls:()=>['atlas'],voice:()=> 'mouth',paint:(canvas,bundle,images,voice,blink)=>painted.push([voice,blink,images.get('atlas')])}
 const scope=createStageLayeredFigures({document:{createElement:()=>({})},compositor})
 const image={},textures=new Map([['atlas',{ready:true,texture:{baseTexture:{resource:{source:image}}}}]])
 const PIXI={Texture:{from(){const id=++serial;return {baseTexture:{update(){}},destroy(){released.push(id);if(id===1)throw Error('GPU release')}}}}}
 const entry=()=>({figure:{identity:'i',spriteBundle:{revision:'r',key:'k',view:{blink:{blend:'replace'}}}},loadedIdentity:'i',sprite:{},baseTexture:{},spriteBlink:'closed'})
 const a=entry(),b=entry();assert.equal(scope.tick(a,textures,PIXI,true),true);scope.tick(b,textures,PIXI,true)
 assert.equal(painted[0][2],image);assert.deepEqual(painted[0].slice(0,2),['mouth','closed'])
 assert.throws(()=>scope.dispose(),/cleanup failed/);assert.deepEqual(released,[1,2])
 assert.equal(a.spriteTexture,null);assert.equal(b.spriteCanvas,null);assert.equal(scope.tick(a,textures,PIXI,true),false)
 scope.dispose();assert.deepEqual(released,[1,2]);assert.equal(textures.get('atlas').texture.baseTexture.resource.source,image)
})
test('missing layered image retains the base and a later ready image retries',()=>{
 let paints=0;const scope=createStageLayeredFigures({document:{createElement:()=>({})},compositor:{urls:()=>['atlas'],voice:()=> 'open',paint:()=>paints++}})
 const base={},entry={figure:{identity:'i',spriteBundle:{revision:'r',view:{}}},loadedIdentity:'i',sprite:{},baseTexture:base},textures=new Map()
 const PIXI={Texture:{from:()=>({destroy(){}})}}
 scope.tick(entry,textures,PIXI,true);assert.equal(entry.sprite.texture,base);assert.equal(paints,0)
 textures.set('atlas',{ready:true,texture:{baseTexture:{resource:{source:{}}}}});scope.tick(entry,textures,PIXI,true)
 assert.equal(paints,1);assert.notEqual(entry.sprite.texture,base);scope.dispose()
})
