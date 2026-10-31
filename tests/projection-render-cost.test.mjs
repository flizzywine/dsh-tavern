import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from './fixtures/client-vm.mjs'
function harness(){
 const context=vm.createContext({isPlayMode:mode=>mode==='story'})
 const main=fs.readFileSync(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8')
 const functions=main.slice(main.indexOf('function tavernProjectionForTurn('),main.indexOf('function TavernMvuReceipt('))
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/indexed-array.js',import.meta.url),'utf8').replace(/^export .*$/gm,'')+'\n'+fs.readFileSync(new URL('../tavern-plugin/src/client/modules/session-view-sync.js',import.meta.url),'utf8')+'\n'+functions,context)
 let visits=0
 context.createSessionViewReader.indexApi=context.createIndexedArrayApi({visit:()=>visits++})
 return {context,begin:context.createSessionViewReader(),reset:()=>visits=0,visits:()=>visits}
}
for(const count of [20,400,10000])test(`render projection and story turn queries avoid ${count} history rows`,()=>{
 const h=harness();let reads=0
 const projections=Array.from({length:count},(_,i)=>({version:2,get turn(){reads++;return i+1},text:'old'}))
 const mappings=Object.fromEntries(Array.from({length:count},(_,i)=>[i+1,i+101]))
 const tracked=new Proxy(mappings,{get(t,k,r){reads++;return Reflect.get(t,k,r)}})
 const first=h.begin('s').accept({viewCursor:'a',view:{mode:'story',replyProjections:projections,regeneratedDshTurns:tracked}}).view
 reads=0
 assert.equal(h.context.tavernProjectionForTurn(first,1).text,'old')
 assert.equal(h.context.tavernStoryTurnForDshTurn(first,count+100),count)
 assert.equal(h.context.tavernLatestProjectionTurn(first),count)
 assert.ok(reads<8,`${reads} historical values read`)
 h.reset()
 const next=h.begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['replyProjections',count-1],{version:2,turn:count,text:'new'}]],remove:[]}}).view
 assert.ok(h.visits()<64,`${h.visits()} merge index visits`)
 reads=0
 assert.equal(h.context.tavernProjectionForTurn(next,count).text,'new')
 assert.equal(h.context.tavernProjectionForTurn(first,count).text,'old')
 assert.ok(reads<8)
})
