import test from 'node:test'
import assert from 'node:assert/strict'
import {createStatusSourceIndex} from '../tavern-plugin/lib/domain/status-source-index.js'
for(const count of [20,400,10000])test(`legacy source point update and lookup remain bounded at ${count} messages`,()=>{
 let visits=0,reads=0
 const index=createStatusSourceIndex({visit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'body'+i}))
 const old=index.update(null,messages)
 const next=messages.slice();next[count-1]={...messages[count-1],text:'edited'}
 const source=new Proxy(next,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 visits=0
 const changed=index.update(old,source,[count-1])
 assert.equal(index.get(changed,count),'edited');assert.equal(index.get(old,count),'body'+(count-1))
 assert.equal(reads,1);assert.ok(visits<150,`index visits: ${visits}`)
})
test('duplicate turns, role changes, default turns and truncation match first-owner semantics',()=>{
 const index=createStatusSourceIndex()
 let source=[{role:'assistant',turn:0,text:'default'},{role:'assistant',turn:2,text:'first'},{role:'assistant',turn:2,text:'second'},{role:'assistant',turn:Infinity,text:'infinite'}]
 let state=index.update(null,source)
 assert.equal(index.get(state,1),'default');assert.equal(index.get(state,2),'first');assert.equal(index.get(state,'2'),'')
 assert.equal(index.get(state,Infinity),'infinite')
 source=source.map((row,i)=>i===1?{role:'user',text:'user'}:row)
 state=index.update(state,source,[1]);assert.equal(index.get(state,2),'second')
 state=index.update(state,source.slice(0,2),[]);assert.equal(index.get(state,2),'')
 assert.equal(index.get(state,NaN),'')
})

test('legacy status matching reuses the indexed source lookup throughout a real projection pass',async()=>{
 const {createImmutableOrderedJsonIndex}=await import('../tavern-plugin/lib/domain/freeze-json.js')
 const {projectPersistentStatusView}=await import('../tavern-plugin/lib/domain/persistent-status-view.js')
 const options={regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
 const count=400
 let reads=0
 const source=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'<StatusPlaceHolderImpl/>'}))
 const messages=new Proxy(source,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 const rows=createImmutableOrderedJsonIndex().from(source.map((_,i)=>[i,{turn:i+1,text:'legacy',parts:[{kind:'html',content:'<script>old()</script>',statusRule:0}]}]))
 const summary={latestTurn:count}
 projectPersistentStatusView(messages,rows,options,summary)
 assert.ok(reads<=count*2+1,`cold source reads: ${reads}`)
 source[count-1]={...source[count-1],text:'removed'};reads=0
 const next=projectPersistentStatusView(messages,rows,options,{latestTurn:count,previous:summary.next,messageIndices:[count-1]})
 assert.ok(reads<5,`warm source reads: ${reads}`)
 assert.equal(next.statusView.sourceTurn,count-1)
 assert.equal(next.projections[count-1].parts.length,1)
})
