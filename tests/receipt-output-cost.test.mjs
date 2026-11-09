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
