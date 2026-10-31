import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigurePose}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-pose.cjs')
const {galFlatLayout,galFlatActAt,galEase}=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
function sprite(width=100,height=200,input=null){return {texture:{width,height},figureInput:input,forkHeadTop:.1,position:{set(...value){this.value=value}},scale:{set(...value){this.value=value}}}}
function fixture(){
 const actions=[],owner=createStageFigurePose({flatLayout:galFlatLayout,ease:galEase,actionAt(...args){actions.push(args);return galFlatActAt(...args)},resolve:input=>({mode:'physical',x:input.stageX,y:20,scale:2,support:{x:input.stageX,y:400},poseSpan:200,restHead:{x:input.stageX,top:30,chin:80,width:40}})})
 const pose=owner.create({kind:'static',phase:0,period:4500}),input={sprite:sprite(),fading:[],now:0,reduced:false,idle:{on:false,dx:0,scaleX:1,tapY:1,rotation:0},framing:{},W:800,H:600,x:.5,flip:1,lift:0,size:1,ground:0}
 return {owner,pose,input,actions}
}
test('legacy placement preserves flip, fade bounds and current head independently of older portraits',()=>{
 const e=fixture(),old={sprite:sprite(150,300),start:0};const result=e.pose.update({...e.input,flip:-1,now:130,fading:[old]})
 assert.ok(e.input.sprite.scale.value[0]<0);assert.ok(result.restBody.height>0);assert.ok(result.localHead.top>=result.restHead.top)
 assert.ok(Math.abs(old.sprite.alpha-.5)<1e-9);assert.deepEqual(result.remaining,[old]);assert.deepEqual(result.retired,[])
 const retired=e.pose.update({...e.input,now:260,fading:[old]});assert.deepEqual(retired.retired,[old]);assert.deepEqual(retired.remaining,[])
 e.owner.dispose();const position=e.input.sprite.position.value;assert.equal(e.pose.update({...e.input,x:.9}),null);assert.equal(e.input.sprite.position.value,position)
})
test('physical sizing reports calibrated head and keeps static idle transform separate',()=>{
 const e=fixture();e.input.sprite.figureInput={source:'a'}
 const result=e.pose.update({...e.input,x:.25,flip:-1,idle:{on:true,scaleY:1.1,dx:.1,scaleX:.9,tapY:.8,rotation:.2}})
 assert.deepEqual(result.localHead,{x:200,top:30,chin:80,width:40});assert.equal(result.resolved.mode,'physical')
 assert.deepEqual(e.input.sprite.position.value,[220,400]);assert.equal(e.input.sprite.scale.value[0],-1.8);assert.ok(Math.abs(e.input.sprite.scale.value[1]-1.76)<1e-9);assert.equal(e.input.sprite.rotation,.2)
 e.owner.dispose()
})
test('action nonce keeps timing across frames and resets only for a new command',()=>{
 const e=fixture();const command={nonce:1,name:'jump'}
 e.pose.update({...e.input,command,now:100});e.pose.update({...e.input,command,now:120})
 assert.deepEqual(e.actions.slice(0,2),[['jump',0,false],['jump',20,false]])
 e.pose.update({...e.input,command:{...command,nonce:2},now:200,reduced:true});assert.deepEqual(e.actions.at(-1),['jump',0,true])
 e.owner.dispose();assert.throws(()=>e.owner.create({}),/disposed/)
})
