import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageBacklogRows}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-rows.cjs')
test('history stops at current page and preserves earlier paragraph targets',()=>{
 const rows=createStageBacklogRows({voiceDescriptor:row=>row.voice})
 const index=new Map([[1,{units:[{kind:'narration',para:3,text:'earlier'}]}],[2,{}]])
 const list=rows.stageHistoryEntries(index,2,[{kind:'line',text:'seen'},{kind:'line',text:'future'}],0,{2:'input'})
 assert.deepEqual(list.map(row=>row.text).filter(Boolean),['earlier','input','seen'])
 assert.equal(list.find(row=>row.text==='earlier').targetPara,3)
 assert.equal(list.at(-1).here,true)
 assert.deepEqual(rows.galBacklogWindow([0,100,200,300,400],150,100,0),{start:1,end:3})
})
test('player input projection ignores seed trajectories and uses edited source',()=>{
 const rows=createStageBacklogRows({})
 const nodes=[{kind:'user',content:'seed'},{kind:'assistant',turn:1,messageId:'tavern-seed-trajectory:x'},{kind:'user',content:[{type:'text',text:'original'}]},{kind:'assistant',turn:2}]
 assert.deepEqual(rows.galPlayerInputs(nodes,n=>n+10,()=> 'edited'),{12:'edited'})
})
test('performance history retains paragraph placement and does not mutate text rows',()=>{
 const rows=createStageBacklogRows({})
 const entries=[{type:'page',turn:1,para:1,text:'first'},{type:'page',turn:1,para:1,text:'second'}]
 const registry={get:()=>({kind:'core.item',backlog:{renderer:'item',role:'notice'}})}
 const result=rows.stageModHistoryEntries(entries,[{turn:1,performances:[{id:'i',kind:'core.item',at:1,payload:{action:'gain',name:'钥匙',count:1}}]}],registry,new Map())
 assert.deepEqual(result.map(row=>row.text),['first','钥匙 ×1','second'])
 assert.equal(rows.backlogRole(result[1]),'notice')
 assert.equal(entries.length,2)
})
test('marked paragraphs join pages and gate voice without changing source rows',()=>{
 const rows=createStageBacklogRows({pointer:(value,key)=>value[key]})
 const entries=[{type:'page',turn:1,kind:'line',para:2,text:'hello ',voice:'audio',descriptor:'voice',anchor:{offset:0}},{type:'page',turn:1,kind:'line',para:2,text:'world',here:true,anchor:{offset:6}}]
 const snapshot=structuredClone(entries)
 const kinds=[{kind:'phone',modId:'phone',command:'mark',label:'电话',voice:{when:'audible',is:true}}]
 const direction={phase:'done',through:2,entries:[{at:2,ops:[{op:'mod.command',modId:'phone',commandId:'mark',params:{audible:false}}]}]}
 const result=rows.backlogLineKindEntries(entries,new Map([[1,direction]]),kinds)
 assert.equal(result.length,1)
 assert.equal(result[0].text,'hello world')
 assert.equal(result[0].here,true)
 assert.equal(result[0].voice,null)
 assert.equal(result[0].descriptor,null)
 assert.deepEqual(entries,snapshot)
 assert.deepEqual(rows.backlogLineKindEntries(entries,new Map([[1,{...direction,through:1}]]),kinds),entries)
})
