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
