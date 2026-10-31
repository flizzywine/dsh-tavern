import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageModNotifications}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/mod-notifications.cjs')
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function snapshot(){
 const pages=Array.from({length:6},(_,index)=>({anchor:{paragraphId:String(index),para:index+1,offset:0},kind:'narration',text:'text '+index,pending:false}))
 return {source:{turn:1,sourceKey:'s',generation:1,branchId:'b',authorityEpoch:1},cursor:{anchor:pages[0].anchor,mode:'history',readThrough:0},text:{pages},opened:true,visible:true,disposed:false}
}
test('session observer bounds plans, suppresses duplicates and restores them after reconnect',async()=>{
 let state=snapshot();const sent=[]
 const mod=createStageModNotifications({getSnapshot:()=>state,send:input=>sent.push(input),browseMs:1000})
 mod.reannounce('s');await flush();assert.equal(sent.length,1);assert.equal(sent[0].pages.length,4)
 const previous=state;state={...state,text:{...state.text}}
 mod.observe('s',{type:'TEXT'},previous,state);await flush();assert.equal(sent.length,1)
 mod.reannounce('s');await flush();assert.equal(sent.length,2);assert.equal(sent[1].pages.length,4)
 mod.dispose()
})
test('rapid history navigation retains page intent and read completion text',async()=>{
 let state=snapshot(),at=10;const sent=[]
 const mod=createStageModNotifications({getSnapshot:()=>state,send:input=>sent.push(input),browseMs:1000,now:()=>at})
 mod.reannounce('s');await flush();at=20
 const previous=state;state={...state,cursor:{...state.cursor,anchor:state.text.pages[1].anchor}}
 mod.observe('s',{type:'NAVIGATE'},previous,state);await flush()
 assert.equal(sent.find(row=>row.event==='page.changed').rapid,true)
 const before=state;state={...state,cursor:{...state.cursor,readThrough:state.text.pages[1].text.length}}
 mod.observe('s',{type:'READ_PROGRESS'},before,state);await flush()
 assert.equal(sent.find(row=>row.event==='text.revealed').revealed.text,'text 1');mod.dispose()
})
test('disposal suppresses queued active notifications but delivers final inactive receipt in order',async()=>{
 let state=snapshot(),finish;const sent=[]
 const mod=createStageModNotifications({getSnapshot:()=>state,send:input=>{sent.push(input);if(sent.length===1)return new Promise(resolve=>finish=resolve)},browseMs:1000})
 mod.reannounce('s');await flush();mod.reannounce('s')
 const previous=state;state={...state,disposed:true,opened:false}
 mod.observe('s',{type:'DISPOSE'},previous,state);mod.dispose();mod.reannounce('s')
 finish();await flush()
 assert.deepEqual(sent.map(row=>row.event),['activity.changed','session.disposed']);assert.equal(sent[1].active,false)
})
test('transport and reporter failures do not break the next notification',async()=>{
 const state=snapshot();let attempts=0
 const mod=createStageModNotifications({getSnapshot:()=>state,send:()=>{if(++attempts===1)throw Error('transport')},report:()=>{throw Error('report')},browseMs:1000})
 mod.reannounce('s');await flush();mod.reannounce('s');await flush();assert.equal(attempts,2);mod.dispose()
})

test('presented receipts use the session notification queue and suppress inactive or superseded pages',async()=>{
 let state=snapshot();const sent=[]
 const mod=createStageModNotifications({getSnapshot:()=>state,send:input=>sent.push(input),browseMs:1000})
 mod.presented('s',{performanceId:'scene:1',phase:'entry'});await flush()
 assert.equal(sent[0].event,'performance.presented');assert.equal(sent[0].performanceId,'scene:1');assert.equal(sent[0].phase,'entry')
 mod.presented('s',{performanceId:'old',phase:'exit'})
 state={...state,source:{...state.source,generation:2}};await flush();assert.equal(sent.length,1)
 state={...state,opened:false};mod.presented('s',{performanceId:'hidden',phase:'entry'});await flush();assert.equal(sent.length,1)
 mod.dispose();mod.presented('s',{performanceId:'disposed',phase:'entry'});await flush();assert.equal(sent.length,1)
})
