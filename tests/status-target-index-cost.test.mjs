import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {createIndexedArrayApi} from '../tavern-plugin/lib/domain/indexed-array.js'
const options={regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
for(const count of [20,400,10000])test(`status target update avoids scanning ${count} message turns`,async()=>{
 let changes,reads=0
 const cache=createIncrementalReplyView({maxBytes:128*1024*1024,readChanges:async()=>changes})
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i===0?count+100:i+1,bodyEdit:true,text:'<StatusPlaceHolderImpl/>'}))
 let chat={id:'status',_storageRevision:1,messages}
 const first=await cache.project(chat,options,options,{shared:true})
 assert.equal(first.statusView.targetTurn,count+100)
 const next=messages.slice();next[0]={...messages[0],turn:1}
 chat={...chat,_storageRevision:2,messages:new Proxy(next,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})}
 changes={baseRevision:1,chat,messageCount:count,denseMessages:true,indices:[0]}
 const result=await cache.project(chat,options,options,{shared:true})
 assert.equal(result.statusView.targetTurn,count)
 assert.ok(reads<10,`message reads: ${reads}`)
 assert.equal(first.statusView.targetTurn,count+100)
})

test('maximum aggregation preserves old versions and recomputes after removal and truncation',()=>{
 const index=createIndexedArrayApi({maximum:value=>value ?? -Infinity})
 const first=index.from([5,90,7,80])
 const removed=index.update(first,[[1,undefined]])
 assert.equal(index.maximum(removed),80);assert.equal(index.maximum(first),90)
 const truncated=index.update(removed,[],3)
 assert.equal(index.maximum(truncated),7)
 assert.equal(index.maximum(index.update(truncated,[],0)),-Infinity)
})
