import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
function harness(){
 const context=vm.createContext({})
 const files=['../tavern-plugin/lib/domain/indexed-array.js','../tavern-plugin/lib/domain/ordered-numeric-index.js','../tavern-plugin/src/client/modules/session-view-sync.js','../tavern-plugin/src/client/modules/live-tavern-view.js']
 vm.runInContext(files.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^export .*$/gm,'')).join('\n'),context)
 return context
}
for(const count of [20,400,10000])test(`empty wire refresh avoids notifying ${count} subscribers`,async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 const first=begin('s').accept({viewCursor:'a',receiptSync:1,view:{tavernHelper:{messages:[]},replyProjections:[],mvuReceipts:[]}}).view
 let notifications=0
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[],remove:[],receiptDelta:{set:[],remove:[]}}})})
 live.setView('s',first)
 for(let i=0;i<count;i++)live.subscribe('s',()=>notifications++)
 const snapshot=live.getSnapshot('s');notifications=0
 jobs.shift()();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(notifications,0)
 assert.equal(live.getSnapshot('s'),snapshot)
 assert.equal(begin('s').cursor,'b','cursor still advances after an empty delta')
})

test('deduplicated refresh still publishes failures, recovery and real header changes',async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 const first=begin('s').accept({viewCursor:'a',view:{statusBarPlacement:'sidebar'}}).view
 let mode='error',cursor='a',sequence=0,notifications=0
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  if(mode==='error')throw new Error('offline')
  const next=String(++sequence),request=begin('s')
  const result=request.accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:mode==='changed'?[[['statusBarPlacement'],'body']]:[],remove:[]}})
  cursor=next;return result
 }})
 live.setView('s',first);live.subscribe('s',()=>notifications++);notifications=0
 async function run(){jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 await run()
 assert.equal(live.getSnapshot('s').phase,'retrying');assert.equal(notifications,1)
 mode='empty';await run()
 assert.equal(live.getSnapshot('s').phase,'ready');assert.equal(notifications,2)
 live.invalidate('s');await run();assert.equal(notifications,2)
 mode='changed';live.invalidate('s');await run()
 assert.equal(live.getSnapshot('s').view.statusBarPlacement,'body');assert.equal(notifications,3)
})
