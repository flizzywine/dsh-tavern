import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
function harness(){
 const context=vm.createContext({isPlayMode:mode=>mode==='story'})
 const main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
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

test('projection versions, duplicate turns, maximum and old views retain existing semantics',()=>{
 const h=harness(),row=(turn,version=2)=>({turn,version})
 const first=h.begin('s').accept({viewCursor:'a',view:{mode:'story',replyProjections:[row(1),row(1,3),row(100),row(-1)]}}).view
 assert.equal(h.context.tavernProjectionForTurn(first,1),null,'unsupported last match shadows an older supported projection')
 assert.equal(h.context.tavernLatestProjectionTurn(first),100)
 const next=h.begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['replyProjections',1],row(1,1)],[['replyProjections',2],row(2)],[['replyProjections','length'],3]],remove:[['replyProjections',3]]}}).view
 assert.equal(h.context.tavernProjectionForTurn(next,1).version,1)
 assert.equal(h.context.tavernLatestProjectionTurn(next),2)
 assert.equal(h.context.tavernLatestProjectionTurn(first),100)
 assert.equal(h.context.tavernProjectionForTurn({...next,mode:'card'},1),null)
 const empty=h.begin('s').accept({viewCursor:'c',view:{mode:'story',replyProjections:[]}}).view
 assert.equal(h.context.tavernLatestProjectionTurn(empty),0)
})

test('story turn reverse index keeps first-match ordering and mutable unregistered fallback',()=>{
 const h=harness()
 const mappings={'2':7,'1':7,'bad':9,'negative':-1}
 const view=h.begin('s').accept({viewCursor:'a',view:{regeneratedDshTurns:mappings}}).view
 assert.equal(h.context.tavernStoryTurnForDshTurn(view,7),1)
 assert.ok(Number.isNaN(h.context.tavernStoryTurnForDshTurn(view,9)))
 assert.equal(h.context.tavernStoryTurnForDshTurn(view,8),8)
 const mutable={regeneratedDshTurns:{1:10}}
 assert.equal(h.context.tavernStoryTurnForDshTurn(mutable,10),1)
 mutable.regeneratedDshTurns={2:10}
 assert.equal(h.context.tavernStoryTurnForDshTurn(mutable,10),2)
 const replaced=h.begin('s').accept({viewCursor:'b',viewDelta:{baseCursor:'a',set:[[['regeneratedDshTurns'],{3:7}]],remove:[]}}).view
 assert.equal(h.context.tavernStoryTurnForDshTurn(replaced,7),3)
 assert.equal(h.context.tavernStoryTurnForDshTurn(view,7),1)
})
