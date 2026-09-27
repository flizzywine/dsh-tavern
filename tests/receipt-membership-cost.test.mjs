import test from 'node:test'
import assert from 'node:assert/strict'
import {createMvuReceiptIndex} from '../tavern-plugin/lib/domain/mvu-receipt-index.js'
for(const count of [20,400,10000])test(`receipt classification updates stay bounded at ${count}`,t=>{
 let visits=0
 const project=createMvuReceiptIndex({shared:true,onVisit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,mvu:{receipt:{status:i>=count-3?'updated':'error',summary:String(i)}}}))
 const chat={id:'c',_storageRevision:1,messages}
 const before=project(chat,{},null)
 const changed=messages.slice();changed[0]={...changed[0],mvu:{receipt:{status:'updated',summary:'no longer notable'}}}
 visits=0
 const after=project({...chat,messages:changed,_storageRevision:2},{},{baseRevision:1,indices:[0]})
 assert.ok(visits<1024,`${visits} history index visits`)
 assert.equal(after.length,count-1)
 assert.equal(after[0].turn,2)
 assert.equal(before[0].turn,1)
 t.diagnostic(`${count} receipts: ${visits} visits`)
})

function reference(messages,activity){
 const rows=messages.map(m=>m.role==='assistant' && m.turn>0 && m.mvu?.receipt?{turn:m.turn,receipt:m.mvu.receipt}:null)
 const notable=new Set(['pending','error','interrupted','partial','stale'])
 const latest=messages.findLastIndex(m=>m.role==='assistant')
 const interrupted=activity.reason==='interrupted' && activity.role==='settlement' && rows[latest]?latest:-1
 const selected=rows.flatMap((row,id)=>row && (notable.has(row.receipt.status)||id===interrupted)?[id]:[])
 const quiet=[]
 for(let id=rows.length-1;id>=0 && quiet.length<3;id--)if(rows[id] && !notable.has(rows[id].receipt.status) && id!==interrupted)quiet.push(id)
 const byTurn=new Map()
 for(const id of [...selected,...quiet.reverse()]){
  const row=structuredClone(rows[id])
  if(id===interrupted)Object.assign(row.receipt,{status:'interrupted',summary:'后台结算因服务重启或异常退出而中断，请重试结算；正文和已保存变量保留。'})
  byTurn.set(row.turn,row)
 }
 return [...byTurn.values()].sort((a,b)=>a.turn-b.turn)
}
test('incremental receipt membership matches original selection across mixed changes',()=>{
 const project=createMvuReceiptIndex({shared:true})
 let messages=[],revision=0,seed=71
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed}
 const statuses=['updated','unchanged','error','pending','partial','stale']
 for(let step=0;step<300;step++){
  let indices=[]
  const action=random()%5
  if(action===0 && messages.length)messages=messages.slice(0,-1)
  else {
   const id=action===1 || !messages.length?messages.length:random()%messages.length
   messages=messages.slice()
   messages[id]={role:random()%7===0?'user':'assistant',turn:1+random()%15,mvu:{receipt:{status:statuses[random()%statuses.length],summary:String(step)}}}
   indices=[id]
  }
  const activity=random()%4===0?{role:'settlement',reason:'interrupted'}:{}
  const actual=project({id:'c',_storageRevision:++revision,messages},activity,{baseRevision:revision-1,indices})
  assert.deepEqual(Array.from(actual),reference(messages,activity),`step ${step}`)
 }
})
