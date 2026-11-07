import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createConversationState} from '../tavern-plugin/lib/domain/conversation-state.js'
async function fixture(t,count=0){
 const root=await mkdtemp(join(tmpdir(),'conversation-state-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const io=[],store=createConversationPageStore({root,onIO:e=>io.push(e)}),domain=createConversationState({store})
 await domain.create('a',{world:{variables:{gold:10},posture:'standing'},messages:Array.from({length:count},(_,i)=>({id:'old'+i,text:'history '+i}))})
 io.length=0
 return {root,store,domain,io}
}
async function foreground(domain,id='turn-1'){
 const opened=await domain.open('a')
 return domain.commitForeground('a',{operationId:id,basis:opened.basis,userText:'continue',assistantText:'reward'})
}

test('settlement failure retains body and later foreground supersedes the old task',async t=>{
 const {domain}=await fixture(t)
 const first=await foreground(domain)
 await domain.failSettlement('a',{operationId:first.settlementId,error:'provider failed'})
 assert.equal((await domain.open('a')).messageCount,2)
 assert.equal((await domain.readOperation('a',first.settlementId)).status,'failed')
 await foreground(domain,'turn-2')
 assert.equal((await domain.open('a')).messageCount,4)
 await assert.rejects(domain.submitSettlement('a',{operationId:first.settlementId,submission:{gold:99}}),{code:'CONVERSATION_STALE'})
 assert.equal((await domain.open('a')).state.world.variables.gold,10)
})

const RUNTIME_HEADER='c'.repeat(64)
async function runtimeFixture(t,runtimeState){
 const root=await mkdtemp(join(tmpdir(),'conversation-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createConversationPageStore({root}),domain=createConversationState({store})
 await domain.create('r',{world:{variables:{gold:1}},metadata:{runtimeLayout:1},runtimeState})
 return {store,domain}
}
const runtimeInput=overrides=>({chatHeaderRef:RUNTIME_HEADER,chatRevision:1,worldMessage:2,worldSwipe:0,...overrides})

test('legacy runtime state without world message uid keeps working',async t=>{
 const {domain}=await runtimeFixture(t,runtimeInput({}))
 const {state}=await domain.open('r')
 assert.equal(state.worldMessage,2)
 assert.equal(state.worldSwipe,0)
 assert.equal(Object.hasOwn(state,'worldMessageUid'),false)
})

test('world message uid is preserved next to position and swipe',async t=>{
 const {domain}=await runtimeFixture(t,runtimeInput({worldMessageUid:'msg-17'}))
 const {state}=await domain.open('r')
 assert.equal(state.worldMessage,2)
 assert.equal(state.worldSwipe,0)
 assert.equal(state.worldMessageUid,'msg-17')
})

test('deleted world message keeps its uid with a null position',async t=>{
 const {domain}=await runtimeFixture(t,runtimeInput({worldMessage:null,worldMessageUid:'msg-gone'}))
 const {state}=await domain.open('r')
 assert.equal(state.worldMessage,null)
 assert.equal(state.worldMessageUid,'msg-gone')
})

test('null world message uid is kept as an explicit absence',async t=>{
 const {domain}=await runtimeFixture(t,runtimeInput({worldMessageUid:null}))
 assert.equal((await domain.open('r')).state.worldMessageUid,null)
})

for(const bad of ['',{},[]])
 test('invalid world message uid '+JSON.stringify(bad)+' is rejected',async t=>{
  await assert.rejects(runtimeFixture(t,runtimeInput({worldMessageUid:bad})),{code:'CONVERSATION_INPUT'})
 })

for(const field of ['branchId','worldRevision','lifecycleRevision'])test(field+' changes fence prepared effects',async t=>{
 const {store,domain}=await fixture(t)
 const first=await foreground(domain)
 await domain.submitSettlement('a',{operationId:first.settlementId,submission:{gold:20}})
 await domain.prepareSettlement('a',{operationId:first.settlementId,world:{variables:{gold:20}}})
 await assert.rejects(domain.prepareSettlement('a',{operationId:first.settlementId,world:{variables:{gold:30}}}),{code:'IDEMPOTENCY_CONFLICT'})
 const view=await store.openConversation('a')
 await store.commit('a',{expectedRevision:view.revision,state:{...view.state,[field]:field==='branchId'?'another-branch':1}})
 await assert.rejects(domain.commitSettlement('a',{operationId:first.settlementId}),{code:'CONVERSATION_STALE'})
 assert.equal((await domain.open('a')).state.world.variables.gold,10)
})
