import test from 'node:test'
import assert from 'node:assert/strict'
import {createMvuReceiptIndex} from '../tavern-plugin/lib/domain/mvu-receipt-index.js'
import {isImmutableJson} from '../tavern-plugin/lib/domain/freeze-json.js'

for(const count of [20,400,10000])test(`unchanged ${count} alert receipts reuse bounded output`,t=>{
 let visits=0
 const project=createMvuReceiptIndex({maxBytes:32*1024*1024,shared:true,onVisit:()=>visits++})
 const chat={id:'c',_storageRevision:1,messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,mvu:{receipt:{status:'error',summary:'old error'}},variables:[{hp:10}]}))}
 const first=project(chat,{},null)
 visits=0
 const next=project({...chat,_storageRevision:2}, {},{baseRevision:1,indices:[count-1]})
 assert.equal(next,first)
 assert.ok(isImmutableJson(next))
 assert.ok(visits<64,`${visits} index nodes visited`)
 t.diagnostic(`${count} alerts: ${visits} index node visits`)
 assert.throws(()=>{next[0].receipt.status='updated'},TypeError)
})

import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
import {createSessionStateView} from '../tavern-plugin/lib/domain/chat-session-state.js'
test('internal receipt view reuse also avoids transport rehashing',()=>{
 const state=createSessionStateView({sharedReceipts:true,activity:()=>({}),evidence:()=>({})})
 const chat={id:'c',_storageRevision:1,messages:[{role:'assistant',turn:1,mvu:{pending:true}}]}
 const initial=state.receipts(chat)
 const sync=createSessionViewSync()
 const first=sync('s',{mvuReceipts:initial})
 const next=state.receipts({...chat,_storageRevision:2},{baseRevision:1,indices:[0]})
 assert.equal(next,initial)
 const stringify=JSON.stringify
 let hashes=0
 JSON.stringify=function(value,...args){if(value===next)hashes++;return stringify(value,...args)}
 try {
  assert.deepEqual(sync('s',{mvuReceipts:next},first.viewCursor).viewDelta.set,[])
  assert.equal(hashes,0)
 } finally {JSON.stringify=stringify}
})

test('receipt output invalidates for content, interruption, membership and lifecycle changes',()=>{
 const project=createMvuReceiptIndex({shared:true})
 let chat={id:'c',_storageRevision:1,messages:[{role:'assistant',turn:1,mvu:{receipt:{status:'error',summary:'old'}}}]}
 const first=project(chat,{},null)
 const interrupted=project(chat,{role:'settlement',reason:'interrupted'},{baseRevision:1,indices:[]})
 assert.equal(interrupted[0].receipt.status,'interrupted')
 assert.equal(first[0].receipt.status,'error')
 const resumed=project(chat,{}, {baseRevision:1,indices:[]})
 assert.deepEqual(resumed,first)
 chat={...chat,_storageRevision:2,messages:[{...chat.messages[0],mvu:{receipt:{status:'updated',summary:'new'}}}]}
 const changed=project(chat,{}, {baseRevision:1,indices:[0]})
 assert.equal(changed[0].receipt.summary,'new')
 assert.equal(first[0].receipt.summary,'old')
 const reset=project({...chat,tavernHelperLifecycleRevision:1,messages:[]},{},{baseRevision:2,indices:[]})
 assert.deepEqual(reset,[])
 const cold=createMvuReceiptIndex({shared:true})(chat,{},null)
 assert.deepEqual(changed,cold)
})

test('default reads detach cached receipts and output respects cache budget',()=>{
 const chat={id:'c',_storageRevision:1,messages:[{role:'assistant',turn:1,mvu:{pending:true}}]}
 const project=createMvuReceiptIndex()
 const first=project(chat,{},null)
 first[0].receipt.status='outside'
 assert.equal(project(chat,{}, {baseRevision:1,indices:[]})[0].receipt.status,'pending')
 const uncached=createMvuReceiptIndex({shared:true,maxBytes:0})
 assert.notEqual(uncached(chat,{},null),uncached(chat,{}, {baseRevision:1,indices:[]}))
})
