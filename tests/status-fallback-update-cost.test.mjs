import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
import {projectRuntimeReplyHistory} from '../tavern-plugin/lib/domain/runtime-content-projection.js'
const options={regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
const panelId=projectPersistentStatusView([{role:'assistant',turn:2}],[],options).statusView.viewId
for(const count of [20,400,10000])test(`sidebar fallback reads only the changed message among ${count}`,async()=>{
 let changes,reads=0,checks=0
 const cache=createIncrementalReplyView({maxBytes:128*1024*1024,readChanges:async()=>changes,onStatusFallback:()=>checks++})
 const frame={placement:'sidebar',panelId,partIndex:3}
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,bodyEdit:true,text:'body'+i,...i===0 || i===count-1?{displayRuntime:{frames:[frame]}}:{}}))
 let chat={id:'fallback',_storageRevision:1,messages}
 const old=await cache.project(chat,options,options,{shared:true})
 assert.equal(old.statusView.sourceTurn,count)
 const next=messages.slice();next[count-1]={...messages[count-1],displayRuntime:{frames:[]}}
 chat={...chat,_storageRevision:2,messages:new Proxy(next,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})}
 changes={baseRevision:1,chat,messageCount:count,denseMessages:true,indices:[count-1]}
 checks=0
 const result=await cache.project(chat,options,options,{shared:true})
 assert.equal(checks,1);assert.ok(reads<10,`message reads: ${reads}`)
 assert.equal(result.statusView.sourceTurn,1);assert.equal(result.statusView.sourcePartIndex,3)
 assert.equal(old.statusView.sourceTurn,count)
})

test('opening declarations retain priority over receipts and survive transitions and truncation',async()=>{
 let changes,chat={id:'priority',_storageRevision:1,messages:[
  {role:'assistant',turn:1,greeting:true,text:'<StatusPlaceHolderImpl/>',projectionText:'opening',bodyEdit:true},
  {role:'assistant',turn:2,text:'later',bodyEdit:true,displayRuntime:{frames:[{placement:'sidebar',panelId,partIndex:4}]}}
 ]}
 const cache=createIncrementalReplyView({readChanges:async()=>changes})
 async function check(expected){
  const result=await cache.project(chat,options,options)
  const history=projectRuntimeReplyHistory(chat.messages,options)
  assert.deepEqual(result,{...projectPersistentStatusView(chat.messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked})
  assert.equal(result.statusView?.sourceTurn,expected)
 }
 await check(1)
 const baseRevision=chat._storageRevision
 chat={...chat,_storageRevision:2,messages:[{...chat.messages[0],text:'no marker'},chat.messages[1]]}
 changes={baseRevision,chat,messageCount:2,denseMessages:true,indices:[0]}
 await check(2)
 chat={...chat,_storageRevision:3,messages:chat.messages.slice(0,1)}
 changes={baseRevision:2,chat,messageCount:1,denseMessages:true,indices:[]}
 await check(undefined)
})
