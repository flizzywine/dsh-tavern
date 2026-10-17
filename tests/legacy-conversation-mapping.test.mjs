import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createLegacyConversationMapping} from '../tavern-plugin/lib/domain/legacy-conversation-mapping.js'

function chat(count=5){
 const variables={stat_data:{gold:10,inventory:['key']},schema:{gold:'number'}}
 return JSON.parse(JSON.stringify({id:'old',sessionId:'session',_storageRevision:17,
  messages:Array.from({length:count},(_,i)=>({role:i%2?'assistant':'user',text:'message '+i,sourceText:'source '+i,turn:i+1,
   swipeId:1,swipes:['a','b'],variables:[{stat_data:{gold:0}},variables],mvuBaseline:{swipeId:1,variables},
   mvu:{pending:true,pendingSubmission:{operations:[{type:'set',path:'gold',value:11}]},delivery:{prepared:true,effect:{gold:11}}},
   tavernPluginData:{template_rendered:{hash:'test',swipe:1}},custom:{nullable:null,empty:[],unknown:'preserve'}})),
  variables:{local:'chat-local'},posture:'standing',scriptState:{cursor:3},settleStatus:'pending',
  timeline:{branchId:'branch',revision:5,checkpoints:[{beforeRevision:14}],operations:{job:{status:'running'}}},
  nativeCommits:{5:{requestId:'request'}},tavernHelperScriptVariables:{script:{value:2}},
  unknownExtension:{some:{nested:'preserve'}}}))
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'legacy-mapping-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const io=[],store=createConversationPageStore({root,onIO:e=>io.push(e)})
 return {root,io,store,mapping:createLegacyConversationMapping({store})}
}

test('non-JSON or invalid messages are rejected before publishing a target',async t=>{
 const {mapping,store}=await fixture(t)
 for(const source of [{id:'old',messages:[null]},{id:'old',messages:[],lost:undefined},{id:'old',messages:[],date:new Date()}, {id:'old',messages:new Array(2)}]){
  await assert.rejects(mapping.importChat('shadow',source))
  assert.equal(await store.openConversation('shadow'),undefined)
 }
})

test('interrupted mapping never publishes a partial target and can be retried',async t=>{
 const {store,mapping}=await fixture(t),source=chat()
 let writes=0
 const interrupted=createLegacyConversationMapping({store:{...store,writeRecord:async(...args)=>{
  if(++writes===2)throw Error('interrupted record write')
  return store.writeRecord(...args)
 }}})
 await assert.rejects(interrupted.importChat('shadow',source),/interrupted/)
 assert.equal(await store.openConversation('shadow'),undefined)
 await mapping.importChat('shadow',source)
 assert.deepEqual(await mapping.exportChat('shadow'),source)
})
