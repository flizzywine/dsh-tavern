import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigureAssets}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-assets.cjs')
function fixture(){
 const sprites=[],texture={width:100,height:200};let fail=false
 class Sprite{constructor(texture){this.texture=texture;this.dead=0;this.anchor={set(...v){this.values=v}};sprites.push(this)}destroy(options){assert.deepEqual(options,{children:true});this.dead++;this.destroyed=true}}
 const candidate={bodyX:40},metrics={headTop:()=>.1,source:src=>src,measure:()=>candidate,anatomy:()=>({headTop:.1}),record:()=>({bodyX:40}),resolve(){if(fail)throw Error('sizing failed');return {mode:'physical',supportX:30,feet:190}},bodyX:m=>m?.bodyX,bodyCentre:()=>45}
 let resolvePicture,resolveSpine;const textures={load:()=>new Promise(resolve=>resolvePicture=resolve)}
 const owner=createStageFigureAssets({metrics,spineFigures:{prepare:()=>new Promise(resolve=>resolveSpine=resolve)}})
 const scope=owner.create({PIXI:{Sprite},renderer:{},screen:{width:800,height:600},textures})
 const rig=()=>{const body=new Sprite(texture);return {body,frame:[0,0,100,200],measured:{candidate},dead:0,mood(value){this.animation=value},destroy(){this.dead++;if(!body.destroyed)body.destroy({children:true})}}}
 return {scope,owner,texture,sprites,candidate,rig,picture(){resolvePicture(texture)},spine(figure){resolveSpine(figure)},fail(){fail=true}}
}
test('figure assets prepare sizing and own sprites without owning cached textures',async()=>{
 const e=fixture(),pending=e.scope.picture({src:'a',input:{source:'a',pack:true}});e.picture();const asset=await pending
 assert.equal(asset.candidate,e.candidate);assert.deepEqual(asset.sprite.anchor.values,[.3,.95]);assert.equal(asset.sprite.forkHeadTop,.1);assert.equal(asset.sprite.forkBodyX,40)
 const second=e.scope.picture({src:'b',input:{source:'other'}});e.picture();const plain=await second
 assert.equal(plain.sprite.figureInput,null);assert.equal(plain.sprite.forkBodyX,45)
 asset.destroy();e.owner.dispose();plain.destroy();assert.ok(e.sprites.every(s=>s.dead===1));assert.equal(e.texture.destroyed,undefined)
})
test('late picture and Spine completions cannot recreate disposed figure assets',async()=>{
 const e=fixture(),picture=e.scope.picture({src:'a'}),spine=e.scope.spine({url:'rig',config:{}})
 e.owner.dispose();e.picture();const rig=e.rig();e.spine(rig)
 assert.equal(await picture,null);assert.equal(await spine,null);assert.equal(rig.dead,1);assert.equal(e.sprites.length,1)
 assert.equal(await e.scope.picture({src:'b'}),null)
})
test('picture and Spine sizing failures release partially prepared resources',async()=>{
 const e=fixture();e.fail()
 const picture=e.scope.picture({src:'a',input:{source:'a'}});e.picture();await assert.rejects(picture,/sizing failed/);assert.equal(e.sprites[0].dead,1)
 const spine=e.scope.spine({url:'rig',config:{},input:{pack:true,source:'rig'}}),rig=e.rig();e.spine(rig)
 await assert.rejects(spine,/sizing failed/);assert.equal(rig.dead,1)
 e.owner.dispose();assert.ok(e.sprites.every(s=>s.dead===1))
})
test('prepared Spine assets preserve animation and release the rig exactly once',async()=>{
 const e=fixture(),pending=e.scope.spine({url:'rig',config:{},animation:'happy',input:{pack:true,source:'rig'}}),rig=e.rig();e.spine(rig);const asset=await pending
 assert.equal(asset.spine,rig);assert.equal(rig.animation,'happy');assert.deepEqual(asset.sprite.anchor.values,[.3,.95])
 e.scope.dispose();asset.destroy();e.owner.dispose();assert.equal(rig.dead,1)
})

test('scene accepts only the newest picture request even when identity returns to A',async()=>{
 const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8'),start=source.indexOf('    function showStatic('),end=source.indexOf('    // authored blink',start)
 const pending=[],attached=[],committed=[],state={clock:0},entry={figure:{identity:'A'},container:{addChildAt(sprite){attached.push(sprite)}},fading:[]}
 const show=vm.runInNewContext(source.slice(start,end)+';showStatic',{figureAssets:{picture:()=>new Promise(resolve=>pending.push(resolve))},state,console,commitFigureReplacement:e=>committed.push(e),layeredSpriteClearScene(){},clearBlink(){}})
 show(entry,'a');entry.figure={identity:'B'};show(entry,'b');entry.figure={identity:'A'};show(entry,'a')
 const asset=()=>({sprite:{texture:{}},dead:0,destroy(){this.dead++}}),first=asset(),second=asset(),latest=asset()
 pending[2](latest);await Promise.resolve();pending[0](first);pending[1](second);await Promise.resolve()
 assert.equal(entry.figureAsset,latest);assert.deepEqual(attached,[latest.sprite]);assert.equal(committed.length,1);assert.equal(first.dead,1);assert.equal(second.dead,1);assert.equal(latest.dead,0)
})
