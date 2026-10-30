import test from 'node:test'
import assert from 'node:assert/strict'
import {replyBody} from '../tavern-plugin/lib/domain/round-body.js'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const options={regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
for(const count of [20,400,10000])test(`status matching and filtering touch one row among ${count}`,async()=>{
 let changes,matches=0,filters=0
 const cache=createIncrementalReplyView({maxBytes:128*1024*1024,readChanges:async()=>changes,onStatusMatch:()=>matches++,onStatusFilter:()=>filters++})
 let chat={id:'cost',_storageRevision:1,messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,bodyEdit:true,text:'<StatusPlaceHolderImpl/>body'+i}))}
 const old=await cache.project(chat,options,options,{shared:true})
 const messages=chat.messages.slice();messages[count-1]={...messages[count-1],text:'no panel now'}
 chat={...chat,_storageRevision:2,messages};changes={baseRevision:1,chat,messageCount:count,denseMessages:true,indices:[count-1]}
 matches=0;filters=0
 const next=await cache.project(chat,options,options,{shared:true})
 assert.equal(matches,1);assert.equal(filters,1)
 assert.equal(next.statusView.sourceTurn,count-1)
 assert.equal(old.statusView.sourceTurn,count)
 assert.equal(next.projections[0],old.projections[0])
 const history=projectReplyHistory(messages,options)
 for(const projection of history.projections)projection.body=replyBody(projection,chat)
 const expected={...projectPersistentStatusView(messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked}
 // Bound failure rendering: a 10k-row object diff can exhaust the test process.
 assert.equal(next.projections.length,expected.projections.length)
 for(let i=0;i<count;i++)assert.deepEqual(next.projections[i],expected.projections[i], 'projection '+i)
 assert.deepEqual({...next,projections:[]},{...expected,projections:[]})
})

test('status incremental output matches fresh projection after append, truncation and source removal',async()=>{
 let changes,chat={id:'edits',_storageRevision:1,messages:[{role:'assistant',turn:1,greeting:true,bodyEdit:true,text:'<StatusPlaceHolderImpl/>'}]}
 const cache=createIncrementalReplyView({readChanges:async()=>changes})
 async function check(){
  const history=projectReplyHistory(chat.messages,options)
  for(const projection of history.projections)projection.body=replyBody(projection,chat)
  assert.deepEqual(await cache.project(chat,options,options),{...projectPersistentStatusView(chat.messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked})
 }
 await check()
 for(const messages of [[...chat.messages,{role:'assistant',turn:2,bodyEdit:true,text:'<StatusPlaceHolderImpl/>'}],chat.messages,[]]){
  const baseRevision=chat._storageRevision;chat={...chat,_storageRevision:baseRevision+1,messages}
  changes={baseRevision,chat,messageCount:messages.length,denseMessages:true,indices:Array.from({length:messages.length},(_,i)=>i)}
  await check()
 }
})
