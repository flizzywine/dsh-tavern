import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigureBlink}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-blink.cjs')
const clockwork=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-blink-clock.cjs')
function fixture(){
 let serial=0,listener,unsubscribed=0,fail=false,allowed=true;const timers=new Map(),sprites=[],warnings=[]
 const clock={setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},subscribe(fn){listener=fn;return ()=>unsubscribed++}}
 class Sprite{constructor(texture){this.texture=texture;this.dead=0;this.position={set(...v){this.value=v}};sprites.push(this)}destroy(){this.dead++;this.destroyed=true;this.parent?.removeChild(this)}}
 const sprite={anchor:{x:.5,y:1},children:[],addChild(child){if(fail&&this.children.length===1)throw Error('attach failed');child.parent=this;this.children.push(child)},removeChild(child){this.children=this.children.filter(c=>c!==child);child.parent=null}}
 const texture={width:20,height:10},textures={get:()=>({ready:true,texture})}
 const owner=createStageFigureBlink({clock,clockwork,warn:(...args)=>warnings.push(args)}),view=owner.create({PIXI:{Sprite},textures,allowed:()=>allowed})
 const input={bundle:{key:'a',closed:'closed',half:'half',rect:[10,20,20,10],canvas:[100,100]},sprite,baseTexture:{width:100,height:100},ready:true,rhythm:1}
 const fire=()=>{const [id,task]=timers.entries().next().value;timers.delete(id);task.fn();return task}
 return {owner,view,input,timers,sprites,sprite,warnings,fire,foreground:active=>listener(active),get unsubscribed(){return unsubscribed},fail(){fail=true},allow(value){allowed=value}}
}
test('blink owner controls overlay phases, foreground restart and late timer invalidation',()=>{
 const e=fixture();e.view.update(e.input);assert.equal(e.timers.size,1);assert.deepEqual(e.sprites[0].position.value,[-40,-80])
 e.fire();assert.equal(e.view.phase(),'half');assert.equal(e.sprites[1].visible,true)
 const stale=e.timers.values().next().value.fn;e.foreground(false);assert.equal(e.view.phase(),'open');assert.equal(e.timers.size,1)
 stale();assert.equal(e.view.phase(),'open');assert.equal(e.timers.size,1)
 e.allow(false);e.fire();assert.equal(e.view.phase(),'open')
 e.owner.dispose();e.view.dispose();assert.equal(e.timers.size,0);assert.equal(e.unsubscribed,1);assert.ok(e.sprites.every(s=>s.dead===1));assert.equal(e.sprite.children.length,0)
 stale();e.view.update(e.input);assert.equal(e.timers.size,0)
})
test('replace blinking owns no overlay and clears on missing figure or invalid authored patch',()=>{
 const e=fixture();e.view.update({...e.input,bundle:{...e.input.bundle,blend:'replace'}})
 assert.equal(e.sprites.length,0);e.fire();assert.equal(e.view.phase(),'half')
 e.view.update({...e.input,ready:false});assert.equal(e.view.active,false);assert.equal(e.view.phase(),'open');assert.equal(e.timers.size,0)
 const invalid={...e.input,bundle:{...e.input.bundle,key:'bad',rect:[99,0,20,10]}}
 e.view.update(invalid);e.view.update(invalid);assert.equal(e.warnings.length,1);assert.equal(e.timers.size,0)
 e.owner.dispose()
})
test('overlay setup failure releases partially attached sprites and permits retry',()=>{
 const e=fixture();e.fail();assert.throws(()=>e.view.update(e.input),/attach failed/)
 assert.equal(e.sprite.children.length,0);assert.ok(e.sprites.every(s=>s.dead===1));assert.equal(e.view.active,false)
 e.view.update({...e.input,bundle:{...e.input.bundle,half:null}});assert.equal(e.view.active,true)
 e.owner.dispose();assert.ok(e.sprites.every(s=>s.dead===1))
})
