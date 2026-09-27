import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
function harness(){
 const context=vm.createContext({})
 const main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
 const lookup=main.slice(main.indexOf('function tavernMvuReceiptForTurn('),main.indexOf('function TavernMvuReceipt('))
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/indexed-array.js',import.meta.url),'utf8').replace(/^export .*$/gm,'')+'\n'+fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-view-sync.js',import.meta.url),'utf8')+'\n'+lookup,context)
 let visits=0,lookupVisits=0
 context.createSessionViewReader.indexApi=context.createIndexedArrayApi({visit:()=>visits++})
 context.createSessionViewReader.onReceiptLookupVisit=()=>lookupVisits++
 return {context,begin:context.createSessionViewReader(),reset:()=>{visits=0;lookupVisits=0},visits:()=>visits,lookupVisits:()=>lookupVisits}
}
for(const count of [20,400,10000])test(`render receipt lookup stays bounded at ${count}`,t=>{
 const h=harness()
 const first=h.begin('s').accept({viewCursor:'a',view:{mvuReceipts:Array.from({length:count},(_,i)=>({turn:i+1,receipt:{status:'error',summary:'old'}}))}}).view
 h.reset()
 assert.equal(h.context.tavernMvuReceiptForTurn(first,1).summary,'old')
 assert.ok(h.visits()<32,`${h.visits()} lookup index visits`)
 const request=h.begin('s');h.reset()
 const next=request.accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['mvuReceipts',0],{turn:1,receipt:{status:'error',summary:'new'}}]],remove:[]}}).view
 assert.equal(h.context.tavernMvuReceiptForTurn(next,1).summary,'new')
 assert.equal(h.context.tavernMvuReceiptForTurn(first,1).summary,'old')
 assert.ok(h.visits()<64,`${h.visits()} update and lookup visits`)
 t.diagnostic(`${count} receipts: ${h.visits()} update and lookup visits`)
})

test('receipt lookup retains legacy duplicate, unusual turn and missing-turn semantics',()=>{
 const h=harness()
 let serial=0
 for(const rows of [
  [{turn:1,receipt:{summary:'first'}},{turn:'1',receipt:{summary:'last'}}],
  [{turn:-1,receipt:{summary:'negative'}},{turn:4294967295,receipt:{summary:'large'}}],
  [{turn:1.5,receipt:{summary:'fraction'}}],[]
 ]){
  const view=h.begin('s').accept({viewCursor:String(++serial),view:{mvuReceipts:rows}}).view
  for(const turn of [1,'1',-1,4294967295,1.5,99]){
   const expected=rows.findLast(row=>Number(row.turn)===Number(turn))?.receipt || null
   assert.deepEqual(h.context.tavernMvuReceiptForTurn(view,turn),expected)
  }
 }
})

test('turn changes, truncation and concurrent receipt views preserve their own lookup',()=>{
 const h=harness(),row=(turn,summary)=>({turn,receipt:{summary}})
 const first=h.begin('s').accept({viewCursor:'a',view:{mvuReceipts:[row(1,'one'),row(2,'two')]}}).view
 const slow=h.begin('s'),fast=h.begin('s')
 const newer=fast.accept({viewCursor:'new',viewDelta:{baseCursor:'a',set:[[['mvuReceipts',0],row(3,'three')]],remove:[]}}).view
 const older=slow.accept({viewCursor:'old',viewDelta:{baseCursor:'a',set:[[['mvuReceipts','length'],1]],remove:[['mvuReceipts',1]]}}).view
 assert.equal(h.context.tavernMvuReceiptForTurn(newer,1),null)
 assert.equal(h.context.tavernMvuReceiptForTurn(newer,3).summary,'three')
 assert.equal(h.context.tavernMvuReceiptForTurn(older,1).summary,'one')
 assert.equal(h.context.tavernMvuReceiptForTurn(older,2),null)
 assert.equal(h.context.tavernMvuReceiptForTurn(first,2).summary,'two')
 assert.equal(h.begin('s').cursor,'new')
})

for(const count of [20,400,10000])test(`receipt lookup membership updates stay bounded at ${count}`,t=>{
 const h=harness(),row=(turn,summary)=>({turn,receipt:{summary}})
 let view=h.begin('s').accept({viewCursor:'a',view:{mvuReceipts:Array.from({length:count},(_,i)=>row(i+1,'old'))}}).view
 function step(cursor,nextCursor,set,remove){
  const request=h.begin('s');h.reset()
  view=request.accept({viewCursor:nextCursor,viewDelta:{baseCursor:cursor,set,remove}}).view
  assert.ok(h.visits()+h.lookupVisits()<256,`${h.visits()+h.lookupVisits()} membership update visits`)
 }
 step('a','b',[[['mvuReceipts','length'],count+1],[['mvuReceipts',count],row(count+1,'appended')]],[])
 assert.equal(h.context.tavernMvuReceiptForTurn(view,count+1).summary,'appended')
 step('b','c',[[['mvuReceipts',0],row(-1,'moved')]],[])
 assert.equal(h.context.tavernMvuReceiptForTurn(view,1),null)
 assert.equal(h.context.tavernMvuReceiptForTurn(view,-1).summary,'moved')
 step('c','d',[[['mvuReceipts','length'],count]],[['mvuReceipts',count]])
 assert.equal(h.context.tavernMvuReceiptForTurn(view,count+1),null)
 t.diagnostic(`${count} receipts: membership operations bounded`)
})

for(const turn of [1,-1,1.5,Infinity,4294967295])test(`duplicate turn ${turn} updates and deletion preserve last winner without scans`,()=>{
 const h=harness(),row=summary=>({turn,receipt:{summary}})
 const first=h.begin('s').accept({viewCursor:'a',view:{mvuReceipts:Array.from({length:10000},(_,id)=>row(String(id)))}}).view
 h.reset()
 assert.equal(h.context.tavernMvuReceiptForTurn(first,turn).summary,'9999')
 assert.ok(h.visits()+h.lookupVisits()<64)
 const request=h.begin('s');h.reset()
 const next=request.accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['mvuReceipts','length'],9999],[['mvuReceipts',0],row('changed first')]],remove:[['mvuReceipts',9999]]}}).view
 assert.equal(h.context.tavernMvuReceiptForTurn(next,turn).summary,'9998')
 assert.equal(h.context.tavernMvuReceiptForTurn(first,turn).summary,'9999')
 assert.ok(h.visits()+h.lookupVisits()<256,`${h.visits()+h.lookupVisits()} visits`)
})

test('simultaneous turn swaps and duplicate promotion match reverse scanning',()=>{
 const h=harness(),row=(turn,summary)=>({turn,receipt:{summary}})
 let rows=[row(1,'a'),row(2,'b'),row(1,'c')]
 h.begin('s').accept({viewCursor:'a',view:{mvuReceipts:rows}})
 for(const [baseCursor,cursor,updates] of [
  ['a','b',[[0,row(2,'a2')],[1,row(1,'b1')]]],
  ['b','c',[[2,row(3,'c3')]]],
  ['c','d',[[1,row(NaN,'not a turn')]]]
 ]){
  rows=rows.slice();for(const [id,row] of updates)rows[id]=row
  const view=h.begin('s').accept({viewCursor:cursor,viewDelta:{baseCursor,set:updates.map(([id,row])=>[['mvuReceipts',id],row]),remove:[]}}).view
  for(const turn of [1,2,3,NaN])assert.deepEqual(h.context.tavernMvuReceiptForTurn(view,turn),rows.findLast(row=>Number(row.turn)===turn)?.receipt || null)
 }
})
