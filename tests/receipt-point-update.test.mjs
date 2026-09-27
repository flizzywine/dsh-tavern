import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {createMvuReceiptIndex} from '../tavern-plugin/lib/domain/mvu-receipt-index.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`changing one of ${count} alert receipts has bounded projection and wire cost`,t=>{
 let visits=0
 const project=createMvuReceiptIndex({shared:true,maxBytes:32*1024*1024,onVisit:()=>visits++})
 const chat={id:'c',_storageRevision:1,messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,mvu:{receipt:{status:'error',summary:'old'}}}))}
 let clientVisits=0
 const context=vm.createContext({})
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/indexed-array.js',import.meta.url),'utf8').replace(/^export .*$/gm,'')+'\n'+fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-view-sync.js',import.meta.url),'utf8'),context)
 context.createSessionViewReader.indexApi=context.createIndexedArrayApi({visit:()=>clientVisits++})
 const begin=context.createSessionViewReader()
 const before=project(chat,{},null)
 const sync=createSessionViewSync(),first=sync('s',{mvuReceipts:before})
 const initial=begin('s').accept(JSON.parse(JSON.stringify(first))).view
 const request=begin('s')
 const messages=chat.messages.slice();messages[count-1]={...messages[count-1],mvu:{receipt:{status:'error',summary:'changed'}}}
 visits=0
 const after=project({...chat,messages,_storageRevision:2},{},{baseRevision:1,indices:[count-1]})
 assert.ok(visits<256,`${visits} index visits`)
 const result=sync('s',{mvuReceipts:after},first.viewCursor)
 assert.deepEqual(result.viewDelta.set,[[['mvuReceipts',count-1],{turn:count,receipt:{status:'error',summary:'changed'}}]])
 clientVisits=0
 const merged=request.accept(JSON.parse(JSON.stringify(result))).view
 const mergeVisits=clientVisits
 assert.ok(clientVisits<64,`${clientVisits} browser index visits`)
 assert.ok(visits<512,`${visits} projection and transport index visits`)
 assert.equal(merged.mvuReceipts[count-1].receipt.summary,'changed')
 assert.equal(initial.mvuReceipts[count-1].receipt.summary,'old')
 t.diagnostic(`${count} alerts: ${visits} server and ${mergeVisits} browser index visits`)
 assert.equal(before[count-1].receipt.summary,'old')
 assert.equal(after[0],before[0])
})

const json=value=>JSON.parse(JSON.stringify(value))
test('point updates preserve duplicate-turn winners and classification fallbacks',()=>{
 const project=createMvuReceiptIndex({shared:true})
 let chat={id:'c',_storageRevision:1,messages:[
  {role:'assistant',turn:1,mvu:{receipt:{status:'error',summary:'shadowed'}}},
  {role:'assistant',turn:1,mvu:{receipt:{status:'error',summary:'winner'}}},
  {role:'assistant',turn:2,mvu:{receipt:{status:'updated',summary:'quiet'}}}
 ]}
 let actual=project(chat,{},null)
 function step(messages,indices,activity={}) {
  const baseRevision=chat._storageRevision
  chat={...chat,_storageRevision:baseRevision+1,messages}
  actual=project(chat,activity,{baseRevision,indices})
  const expected=createMvuReceiptIndex()(chat,activity,null)
  assert.deepEqual(json(actual),expected)
 }
 const first=actual
 step(chat.messages.map((m,i)=>i===0 ? {...m,mvu:{receipt:{status:'error',summary:'still shadowed'}}}:m),[0])
 assert.equal(actual,first)
 step(chat.messages.map((m,i)=>i===1 ? {...m,mvu:{receipt:{status:'partial',summary:'winner changed'}}}:m),[1])
 assert.equal(actual[0].receipt.summary,'winner changed')
 step(chat.messages.map((m,i)=>i===1 ? {...m,mvu:{receipt:{status:'updated',summary:'now quiet'}}}:m),[1])
 step([...chat.messages,{role:'assistant',turn:3,mvu:{pending:true}}],[3])
 step(chat.messages.slice(0,2),[])
 step(chat.messages,[1],{role:'settlement',reason:'interrupted'})
 step(chat.messages.map((m,i)=>i===1 ? {...m,mvu:{receipt:{status:'updated',summary:'during interruption'}}}:m),[1],{role:'settlement',reason:'interrupted'})
})

test('receipt wire protocol reconstructs mutable fallback, append, truncate, null and deletion',()=>{
 const context=vm.createContext({})
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/indexed-array.js',import.meta.url),'utf8').replace(/^export .*$/gm,'')+'\n'+fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-view-sync.js',import.meta.url),'utf8'),context)
 const begin=context.createSessionViewReader(),sync=createSessionViewSync()
 const row=turn=>({turn,receipt:{status:'error',summary:String(turn)}})
 for(const view of [{mvuReceipts:[row(1)]},{mvuReceipts:[row(1),row(2)]},{mvuReceipts:[row(2)]},{mvuReceipts:null},{},{mvuReceipts:[]}]){
  const request=begin('s')
  const result=sync('s',view,request.cursor)
  assert.deepEqual(json(request.accept(json(result)).view),view)
 }
})
