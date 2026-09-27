import test from 'node:test'
import assert from 'node:assert/strict'
import {createImmutableOrderedJsonIndex} from '../tavern-plugin/lib/domain/freeze-json.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const options={regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
const projection=turn=>({turn,text:'legacy',parts:[{kind:'html',content:'<script>old()</script>',statusRule:0}]})
for(const count of [20,400,10000])test(`legacy source change rematches one dependency among ${count}`,()=>{
 const index=createImmutableOrderedJsonIndex()
 const rows=index.from(Array.from({length:count},(_,i)=>[i,projection(i+1)]))
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'<StatusPlaceHolderImpl/>'}))
 const initial={latestTurn:count}
 const before=projectPersistentStatusView(messages,rows,options,initial)
 const changed=messages.slice();changed[count-1]={...changed[count-1],text:'removed'}
 let matches=0,filters=0
 const nextSummary={latestTurn:count,previous:initial.next,messageIndices:[count-1],onMatch:()=>matches++,onFilter:()=>filters++}
 const after=projectPersistentStatusView(changed,rows,options,nextSummary)
 assert.equal(matches,1);assert.equal(filters,1)
 assert.equal(after.statusView.sourceTurn,count-1)
 assert.equal(before.statusView.sourceTurn,count)
 assert.equal(after.projections[count-1].parts.length,1)
 assert.deepEqual(JSON.parse(JSON.stringify(after)),projectPersistentStatusView(changed,rows,options))
})

test('duplicate source owners invalidate only when the selected first source changes',()=>{
 const rows=createImmutableOrderedJsonIndex().from([[0,projection(1)],[1,projection(1)],[2,projection(2)]])
 let messages=[{role:'assistant',turn:1,text:'<StatusPlaceHolderImpl/>'},{role:'assistant',turn:1,text:'later'},{role:'assistant',turn:2,text:'<StatusPlaceHolderImpl/>'}]
 const initial={latestTurn:2};projectPersistentStatusView(messages,rows,options,initial)
 let matches=0
 messages=messages.map((row,i)=>i===1?{...row,text:'edited nonowner'}:row)
 const second={latestTurn:2,previous:initial.next,messageIndices:[1],onMatch:()=>matches++}
 projectPersistentStatusView(messages,rows,options,second);assert.equal(matches,0)
 messages=messages.map((row,i)=>i===0?{role:'user',text:'user'}:row);matches=0
 const third={latestTurn:2,previous:second.next,messageIndices:[0],onMatch:()=>matches++}
 const result=projectPersistentStatusView(messages,rows,options,third)
 assert.equal(matches,2)
 assert.equal(result.projections[0].parts.length,1);assert.equal(result.projections[1].parts.length,1)
 assert.equal(result.projections[2].parts.length,0)
})


test('shared legacy parts refresh every owner only when the last removal disappears',()=>{
 const part={kind:'html',content:'<script>old()</script>',statusRule:0}
 const rows=createImmutableOrderedJsonIndex().from([[0,{turn:1,parts:[part]}],[1,{turn:2,parts:[part]}],[2,projection(3)]])
 let messages=[{role:'assistant',turn:1,text:'<StatusPlaceHolderImpl/>'},{role:'assistant',turn:2,text:'<StatusPlaceHolderImpl/>'},{role:'assistant',turn:3,text:'<StatusPlaceHolderImpl/>'}]
 const first={latestTurn:3};const initial=projectPersistentStatusView(messages,rows,options,first)
 let filters=0
 messages=messages.map((row,i)=>i===0?{...row,text:'removed'}:row)
 const second={latestTurn:3,previous:first.next,messageIndices:[0],onFilter:()=>filters++}
 const retained=projectPersistentStatusView(messages,rows,options,second)
 assert.equal(filters,0,'another matching owner still removes the shared part')
 assert.equal(retained.projections[0].parts.length,0)
 messages=messages.map((row,i)=>i===1?{...row,text:'removed'}:row)
 const third={latestTurn:3,previous:second.next,messageIndices:[1],onFilter:()=>filters++}
 const visible=projectPersistentStatusView(messages,rows,options,third)
 assert.equal(filters,2)
 assert.equal(visible.projections[0].parts.length,1);assert.equal(visible.projections[1].parts.length,1)
 assert.equal(visible.projections[2],retained.projections[2])
 assert.equal(initial.projections[0].parts.length,0)
 assert.deepEqual(JSON.parse(JSON.stringify(visible)),projectPersistentStatusView(messages,rows,options))
})
