import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createMvuReceiptIndex} from '../tavern-plugin/lib/domain/mvu-receipt-index.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
const json=value=>JSON.parse(JSON.stringify(value))
for(const count of [20,400,10000])test(`receipt removal sends only its turn at ${count}`,t=>{
 let serverVisits=0,clientVisits=0
 const project=createMvuReceiptIndex({shared:true,onVisit:()=>serverVisits++})
 const context=vm.createContext({})
 const sources=['../tavern-plugin/lib/domain/indexed-array.js','../tavern-plugin/lib/domain/ordered-numeric-index.js','../tavern-plugin/src/client/modules/session-view-sync.js']
 vm.runInContext(sources.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^export .*$/gm,'')).join('\n'),context)
 context.createSessionViewReader.receiptOrderedIndex=context.createOrderedNumericIndex({visit:()=>clientVisits++})
 const begin=context.createSessionViewReader()
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,mvu:{receipt:{status:i>=count-3?'updated':'error',summary:String(i)}}}))
 const before=project({id:'c',_storageRevision:1,messages},{},null)
 const sync=createSessionViewSync(),first=sync('s',{mvuReceipts:before},undefined,{receiptSync:1})
 const old=begin('s').accept(json(first)).view
 const request=begin('s')
 messages[0]={...messages[0],mvu:{receipt:{status:'updated',summary:'not displayed'}}}
 const after=project({id:'c',_storageRevision:2,messages},{},{baseRevision:1,indices:[0]})
 serverVisits=0;clientVisits=0
 const result=sync('s',{mvuReceipts:after},first.viewCursor,{receiptSync:request.receiptSync})
 const merged=request.accept(json(result)).view
 assert.ok(serverVisits<128,`${serverVisits} server visits`)
 assert.ok(clientVisits<128,`${clientVisits} browser visits`)
 t.diagnostic(`${count} receipts: ${serverVisits} server, ${clientVisits} browser visits`)
 assert.deepEqual(json(merged.mvuReceipts),json(after))
 assert.equal(old.mvuReceipts[0].turn,1)
 assert.deepEqual(result.viewDelta.receiptDelta,{set:[],remove:[1]})
 assert.deepEqual(result.viewDelta.set,[])
 assert.ok(JSON.stringify(result).length<500)
})

test('keyed receipts require negotiation and reset safely after cursor or source loss',()=>{
 const project=createMvuReceiptIndex({shared:true}),sync=createSessionViewSync()
 const chat={id:'c',_storageRevision:1,messages:[{role:'assistant',turn:1,mvu:{pending:true}}]}
 const view={mvuReceipts:project(chat,{},null)}
 const legacy=sync('s',view)
 assert.equal(legacy.receiptSync,undefined)
 const upgraded=sync('s',view,legacy.viewCursor,{receiptSync:1})
 assert.equal(upgraded.receiptSync,1)
 assert.ok(upgraded.view)
 const changed=sync('s',view,upgraded.viewCursor,{receiptSync:1})
 assert.deepEqual(changed.viewDelta.receiptDelta,{set:[],remove:[]})
 sync.peek(changed.viewCursor).receiptSource={deref:()=>undefined}
 const reset=sync('s',view,changed.viewCursor,{receiptSync:1})
 assert.equal(reset.receiptSync,1)
 assert.ok(reset.view)
 assert.ok(sync('s',view,reset.viewCursor).view,'downgrade establishes a positional baseline')
 assert.ok(sync('s',view,'lost',{receiptSync:1}).view)
 const plain=sync('s',{mvuReceipts:[{turn:1,receipt:{status:'pending'}}]},undefined,{receiptSync:1})
 assert.equal(plain.receiptSync,undefined)
})

import {createSessionViewReader} from '../tavern-plugin/lib/domain/session-view-reader.js'
test('session RPC forwards negotiated receipt capability to transport',async()=>{
 let options
 const chat={id:'c',_storageRevision:1,messages:[]}
 const reader=createSessionViewReader({readState:async()=>chat,readChat:async()=>chat,readChanges:async()=>null,
  project:{full:()=>({mvuReceipts:[]})},activity:()=>({}),foregroundRunning:()=>false,
  trace:{stage:(_name,fn)=>fn(),state(){}},synchronize:(_id,_view,_cursor,value)=>{options=value;return {viewCursor:'ok'}}})
 assert.equal((await reader.response({sessionId:'s',viewSync:1,receiptSync:1})).viewCursor,'ok')
 assert.equal(options.receiptSync,1)
})
