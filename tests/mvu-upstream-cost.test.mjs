import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {projectTavernHelperContext} from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import {createSessionStateView} from '../tavern-plugin/lib/domain/chat-session-state.js'
for(const count of [20,400,10000]) test(`upstream variable-only projections avoid history at ${count}`,async()=>{
 let reads=0
 const rows=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'body '+i,bodyEdit:true,variables:[{hp:10}],mvu:{modified:true}}))
 const messages=new Proxy(rows,{get(t,k,r){if(/^\d+$/.test(String(k)))reads++;return Reflect.get(t,k,r)}})
 const chat={id:'c',_storageRevision:1,messages}
 const replies=createIncrementalReplyView({maxBytes:32*1024*1024,readChanges:async()=>({baseRevision:1,chat:{_storageRevision:2},messageCount:count,denseMessages:true,indices:[count-1]})})
 const receipts=createSessionStateView({activity:()=>({}),evidence:()=>({})})
 const first=await replies.project(chat,{}, {},{shared:true})
 assert.equal(replies.stats().entries,1,"fixture must fit its explicit warm-cache budget")
 const helper=projectTavernHelperContext(chat,{indexed:true})
 receipts.receipts(chat,{baseRevision:0,indices:null})
 rows[count-1]={...rows[count-1],variables:[{hp:9}],mvu:{modified:true,receipt:{status:'updated',summary:'hp 9'}}};chat._storageRevision=2
 reads=0
 const second=await replies.project(chat,{}, {},{shared:true})
 assert.ok(reads<32,`reply projection read ${reads} floors`)
 assert.equal(second.projections,first.projections,'variable-only edits reuse immutable prose')
 reads=0
 const next=projectTavernHelperContext(chat,{previousContext:helper,previousMessages:helper.messages,dirtyIndices:new Set([count-1]),layoutChanged:false,indexed:true})
 assert.ok(reads<32,`helper projection read ${reads} floors`)
 assert.equal(next.turnMessageIds,helper.turnMessageIds)
 reads=0
 const result=receipts.receipts(chat,{baseRevision:1,indices:[count-1]})
 assert.ok(reads<32,`receipt projection read ${reads} floors`)
 assert.equal(result.at(-1).receipt.summary,'hp 9')
})

import {freezeJson} from '../tavern-plugin/lib/domain/freeze-json.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000]) test(`immutable prose and turn hashes stay bounded at ${count}`,()=>{
 let reads=0
 const prose=Array.from({length:count},(_,i)=>({turn:i+1,text:'body'}))
 const turns={}
 for(let i=0;i<count;i++)Object.defineProperty(turns,String(i+1),{enumerable:true,get(){reads++;return i}})
 const projections=new Proxy(prose,{get(t,k,r){if(/^\d+$/.test(String(k)))reads++;return Reflect.get(t,k,r)}})
 const view={replyProjections:freezeJson(projections),tavernHelper:{turnMessageIds:freezeJson(turns),messages:[]}}
 const sync=createSessionViewSync(),first=sync('s',view,undefined,{revision:1})
 reads=0
 const next=sync('s',view,first.viewCursor,{revision:2,dirtyMessageIndices:new Set()})
 assert.equal(reads,0)
 assert.deepEqual(next.viewDelta.set,[])
})
