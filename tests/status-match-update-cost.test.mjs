import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {projectRuntimeReplyHistory} from '../tavern-plugin/lib/domain/runtime-content-projection.js'
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
 const history=projectRuntimeReplyHistory(messages,options)
 assert.deepEqual(JSON.parse(JSON.stringify(next)),{...projectPersistentStatusView(messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked})
})

test('status incremental output matches fresh projection after append, truncation and source removal',async()=>{
 let changes,chat={id:'edits',_storageRevision:1,messages:[{role:'assistant',turn:1,greeting:true,bodyEdit:true,text:'<StatusPlaceHolderImpl/>'}]}
 const cache=createIncrementalReplyView({readChanges:async()=>changes})
 async function check(){
  const history=projectRuntimeReplyHistory(chat.messages,options)
  assert.deepEqual(await cache.project(chat,options,options),{...projectPersistentStatusView(chat.messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked})
 }
 await check()
 for(const messages of [[...chat.messages,{role:'assistant',turn:2,bodyEdit:true,text:'<StatusPlaceHolderImpl/>'}],chat.messages,[]]){
  const baseRevision=chat._storageRevision;chat={...chat,_storageRevision:baseRevision+1,messages}
  changes={baseRevision,chat,messageCount:messages.length,denseMessages:true,indices:Array.from({length:messages.length},(_,i)=>i)}
  await check()
 }
})

test('legacy source dependencies are rechecked even when projection identity is unchanged',async()=>{
 const {createImmutableOrderedJsonIndex}=await import('../tavern-plugin/lib/domain/freeze-json.js')
 const index=createImmutableOrderedJsonIndex()
 const projections=index.from([[0,{version:2,turn:1,text:'legacy',parts:[{kind:'html',content:'<script>legacy()</script>',statusRule:0}]}]])
 const summary={latestTurn:2}
 const firstMessages=[{role:'assistant',turn:1,text:'<StatusPlaceHolderImpl/>'}]
 const first=projectPersistentStatusView(firstMessages,projections,options,summary)
 assert.equal(first.projections[0].parts.length,0)
 const nextMessages=[{role:'assistant',turn:1,text:'no marker'}]
 const next=projectPersistentStatusView(nextMessages,projections,options,{latestTurn:2,previous:summary.next})
 assert.equal(next.projections[0].parts.length,1)
 assert.equal(first.projections[0].parts.length,0)
})
