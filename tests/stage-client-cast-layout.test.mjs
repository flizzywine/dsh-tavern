import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageCastLayout}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast-layout.cjs')
function setup(){
 let calls=0,fail=false
 const owner=createStageCastLayout({mix:(a,b,elapsed)=>Math.min(1,Math.max(0,elapsed/700)),calculate({boxTop,framing}){calls++;if(fail)throw Error('layout failed');return {fit:boxTop/100,drop:0,top:boxTop,ruler:framing?.ruler,spread:1,head:20,count:1,x:{a:.5},visible:['a']}}})
 const view=owner.create(),input={plan:{cast:['a'],priority:['a']},figures:[],W:800,H:600,now:0,top:100,ruler:{to:180},loaded:0,crops:{}}
 return {owner,view,input,get calls(){return calls},fail(value){fail=value}}
}
test('cast layout caches repeated frames and eases fit while suppressing unchanged position reports',()=>{
 const e=setup(),first=e.view.update(e.input);assert.equal(first.report.width,800);assert.equal(e.view.fit(0).fit,1)
 assert.equal(e.view.update({...e.input,now:20}).layout,first.layout);assert.equal(e.calls,1)
 const next={...e.input,top:50,now:100};assert.equal(e.view.update(next).report,null)
 assert.equal(e.view.fit(450).fit,.75);assert.equal(e.view.fit(800).fit,.5)
 e.view.update({...next,instant:true,now:200});assert.equal(e.view.fit(200).fit,.5)
 e.owner.dispose();assert.equal(e.view.layout,null);assert.deepEqual(e.view.project([]),[])
 assert.equal(e.view.update(e.input).layout,null);assert.throws(()=>e.owner.create(),/disposed/)
})
test('skin ruler changes land immediately and projection parks unavailable figures without mutating inputs',()=>{
 const e=setup();e.view.update(e.input)
 e.view.update({...e.input,top:50,plan:{...e.input.plan,framing:{ruler:200}},now:1});assert.equal(e.view.fit(1).fit,.5)
 const source=[{key:'a',alias:'a',kind:'static',x:.2},{key:'b',alias:'b',kind:'spine',speaking:true,audio:'voice',act:{}}]
 const projected=e.view.project(source);assert.equal(projected[0].x,.5);assert.equal(projected[1].parked,true);assert.equal(projected[1].audio,null);assert.equal(source[1].speaking,true)
 assert.equal(e.view.project(source),projected)
 e.view.update({...e.input,plan:null});assert.equal(e.view.project(source)[1].speaking,true);assert.deepEqual(e.view.target,{fit:1,drop:0})
 e.owner.dispose()
})
test('failed layout calculation can retry unchanged input',()=>{
 const e=setup();e.fail(true);assert.throws(()=>e.view.update(e.input),/layout failed/)
 e.fail(false);assert.ok(e.view.update(e.input).layout);assert.equal(e.calls,2);e.owner.dispose()
})
