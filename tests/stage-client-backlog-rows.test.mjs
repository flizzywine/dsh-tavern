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
test('a mod stage feature supplies its 履历 renderer: the textcard row comes from mods/textcard/client',()=>{
 const require=createRequire(import.meta.url)
 const {createStageFeatures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/features.cjs')
 const features=createStageFeatures();features.register('textcard',require('../tavern-plugin/mods/textcard/client/stage.cjs'))
 const rows=createStageBacklogRows({renderers:features.backlogRenderers()})
 const declaration={kind:'dsh.textcard.card',backlog:{renderer:'textcard',role:'notice'}}
 const row=payload=>rows.backlogPerformanceEntry(declaration,{payload},{turn:1,id:{performance:'t'}})
 const after=row({style:'word',parts:['原来你一直都知道。'],placement:'after'})
 assert.deepEqual([after.parts,after.place,after.role],[['原来你一直都知道。'],'end','notice'])
 assert.equal(row({style:'word',parts:['冥土']}).place,'before')
})