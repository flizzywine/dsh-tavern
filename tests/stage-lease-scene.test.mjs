import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {leaseScene,leaseCursor}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/lease-scene.cjs')

// Fixture ids (actorKey) differ from names and aliases on purpose.
const row=(actorKey,name,alias,figureId)=>({actorKey,name,aliases:[alias],alias:actorKey,ref:{packId:'pk-'+figureId,figureId},enabled:true})
const rows=[
 row('a-1k7','辉夜','Kaguya','f-1'),
 row('a-2b9','包豪斯','Bauhaus','f-2'),
 row('a-3x','葛城','katsuragi-a','f-3'),
 row('a-4y','葛城','katsuragi-b','f-4'),
 row('a-5','甲一','fig-five','f-5'),
 row('a-6','甲二','fig-six','f-6'),
 row('a-7','甲三','fig-seven','f-7'),
 row('a-8','甲四','fig-eight','f-8'),
]
const emotions=new Map([['生气','angry'],['平静','calm']])
const normalizeEmotion=value=>emotions.get(value) ?? value
const lease=scene=>leaseScene(scene,{rows,normalizeEmotion})

test('a focus actor dims the others and the phone standing actor is the focus actor, else the speaker',()=>{
 const focused=lease({actors:[{name:'辉夜'},{name:'包豪斯',focus:true}],lines:[{id:'L1',speaker:'辉夜',text:'x'}]})
 assert.deepEqual(focused.actors,[
  {alias:'a-1k7',emotion:undefined,focus:false,dim:true},
  {alias:'a-2b9',emotion:undefined,focus:true,dim:false}])
 assert.equal(focused.standing,'a-2b9')
 const spoken=lease({actors:[{name:'辉夜'},{name:'包豪斯'}],lines:[{id:'L1',speaker:'包豪斯',text:'x'}]})
 assert.equal(spoken.actors.some(actor=>actor.dim),false)
 assert.equal(spoken.standing,'a-2b9')
 assert.equal(lease({actors:[{name:'辉夜'}],lines:[{id:'L1',text:'旁白'}]}).standing,null)
 assert.equal(lease(null),null)
})
