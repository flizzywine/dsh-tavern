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

test('receipt index retains alerts, quiet tail, duplicate turns and live interruption without polluting cache',()=>{
 let activity={}
 const receipts=createSessionStateView({activity:()=>activity,evidence:()=>({})})
 const row=(turn,status)=>({role:'assistant',turn,mvu:{receipt:{status,summary:String(turn)}}})
 let chat={id:'receipt',_storageRevision:1,messages:[row(1,'error'),row(2,'updated'),row(3,'updated'),row(4,'updated'),row(5,'updated')]}
 assert.deepEqual(receipts.receipts(chat).map(r=>r.turn),[1,3,4,5])
 activity={reason:'interrupted',role:'settlement'}
 const interrupted=receipts.receipts(chat,{baseRevision:1,indices:[]})
 assert.deepEqual(interrupted.map(r=>r.turn),[1,2,3,4,5])
 assert.equal(interrupted.at(-1).receipt.status,'interrupted')
 interrupted[0].receipt.summary='outside mutation'
 activity={}
 assert.equal(receipts.receipts(chat,{baseRevision:1,indices:[]})[0].receipt.summary,'1')
 chat={...chat,_storageRevision:2,messages:chat.messages.slice()}
 chat.messages[0]=row(1,'updated')
 assert.deepEqual(receipts.receipts(chat,{baseRevision:1,indices:[0]}).map(r=>r.turn),[3,4,5])
 chat={...chat,_storageRevision:3,messages:[...chat.messages,row(4,'partial')]}
 const appended=receipts.receipts(chat,{baseRevision:2,indices:[5]})
 assert.deepEqual(appended.map(r=>r.turn),[3,4,5])
 assert.equal(appended.find(r=>r.turn===4).receipt.status,'updated','quiet duplicate overrides alert, preserving prior semantics')
 chat={...chat,_storageRevision:4,messages:[row(7,'pending')]}
 assert.deepEqual(receipts.receipts(chat,{baseRevision:3,indices:[0]}).map(r=>r.turn),[7])
})

test('turn mapping falls back for structural changes, and variable-only projections stay immutable',()=>{
 const chat={id:'turns',messages:[{role:'assistant',turn:1,text:'a',variables:[{hp:10}]}]}
 const first=projectTavernHelperContext(chat,{indexed:true})
 const next={...chat,messages:[{...chat.messages[0],turn:2}]}
 const changed=projectTavernHelperContext(next,{indexed:true,previousContext:first,previousMessages:first.messages,dirtyIndices:new Set([0]),layoutChanged:true})
 assert.deepEqual(changed.turnMessageIds,{'2':0})
 assert.deepEqual(first.turnMessageIds,{'1':0})
 assert.throws(()=>{first.messages[0].variables.hp=100},TypeError)
 assert.equal(projectTavernHelperContext(chat).messages[0].variables.hp,10)
})

import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
test('journal display input carries layout evidence and detaches only accessed floors',async t=>{
 const root=await mkdtemp(join(tmpdir(),'upstream-view-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let visits=0
 const store=createChatJournalStore({dataRoot:root,onIndexedMessageVisit:()=>visits++,frameLimit:1e6,byteLimit:1e9})
 await store.update('c',()=>({id:'c',_storageRevision:1,messages:Array.from({length:400},(_,i)=>({role:'assistant',turn:i+1,text:'body',variables:[{hp:10}]}))}))
 await store.patch('c',1,[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',399,'variables',0,'hp'],value:9}])
 visits=0
 const delta=await store.readViewDelta('c',1)
 assert.equal(delta.layoutChanged,false)
 assert.equal(delta.chat.messages[399].variables[0].hp,9)
 assert.equal(delta.chat.messages[0].variables,undefined)
 assert.ok(visits<64,`display input visited ${visits} index nodes`)
 delta.chat.messages[399].variables[0].hp=100
 assert.equal((await store.readSlice('c',[399])).chat.messages[0].variables[0].hp,9)
 await store.patch('c',2,[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['messages',399,'turn'],value:800}])
 assert.equal((await store.readViewDelta('c',2)).layoutChanged,true)
})
