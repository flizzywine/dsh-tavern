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

test('explicit cancellation prevents restart from applying a saved effect',async t=>{
 const {root,domain}=await fixture(t)
 const first=await foreground(domain)
 await domain.submitSettlement('a',{operationId:first.settlementId,submission:{gold:20}})
 await domain.prepareSettlement('a',{operationId:first.settlementId,world:{variables:{gold:20}}})
 await domain.cancelSettlement('a',{operationId:first.settlementId})
 const fresh=createConversationState({store:createConversationPageStore({root})})
 await assert.rejects(fresh.commitSettlement('a',{operationId:first.settlementId}),{code:'CONVERSATION_STALE'})
 assert.equal((await fresh.open('a')).messageCount,2)
})

test('lost acknowledgement can be retried without repeating foreground or settlement',async t=>{
 const {store,domain}=await fixture(t)
 let lose=false
 const unreliable=createConversationState({store:{...store,commit:async(...args)=>{const result=await store.commit(...args);if(lose){lose=false;throw Error('lost acknowledgement')}return result}}})
 const input={operationId:'lost',basis:(await domain.open('a')).basis,userText:'u',assistantText:'a'}
 lose=true
 await assert.rejects(unreliable.commitForeground('a',input),/lost acknowledgement/)
 const first=await unreliable.commitForeground('a',input)
 await domain.submitSettlement('a',{operationId:first.settlementId,submission:{gold:20}})
 await domain.prepareSettlement('a',{operationId:first.settlementId,world:{variables:{gold:20}}})
 lose=true
 await assert.rejects(unreliable.commitSettlement('a',{operationId:first.settlementId}),/lost acknowledgement/)
 const receipt=await unreliable.commitSettlement('a',{operationId:first.settlementId})
 assert.equal(receipt.basis.worldRevision,1)
 assert.equal((await domain.open('a')).messageCount,2)
})

test('CAS retry preserves a concurrent metadata update and appends once',async t=>{
 const {store,domain}=await fixture(t)
 let interfere=true
 const racing=createConversationState({store:{...store,commit:async(id,change)=>{
  if(interfere){interfere=false;const view=await store.openConversation(id);await store.commit(id,{expectedRevision:view.revision,metadata:{...view.metadata,title:'concurrent'}})}
  return store.commit(id,change)
 }}})
 await foreground(racing)
 const view=await domain.open('a')
 assert.equal(view.metadata.title,'concurrent');assert.equal(view.messageCount,2)
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

test('concurrent foregrounds from the same basis cannot both commit',async t=>{
 const {domain}=await fixture(t)
 const basis=(await domain.open('a')).basis
 const results=await Promise.allSettled(['one','two'].map(operationId=>domain.commitForeground('a',{operationId,basis,userText:'u',assistantText:'a'})))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal((await domain.open('a')).messageCount,2)
})

test('bad derived changes cannot partially settle and full-world compatibility stays explicit',async t=>{
 const {domain}=await fixture(t),first=await foreground(domain)
 await domain.submitSettlement('a',{operationId:first.settlementId,submission:{gold:20}})
 await assert.rejects(domain.prepareSettlement('a',{operationId:first.settlementId,changes:[{op:'set',path:'/variables/gold',value:99},{op:'remove',path:'/missing'}]}))
 await assert.rejects(domain.prepareSettlement('a',{operationId:first.settlementId,changes:[{op:'set',path:'/variables',value:null}]}))
 assert.equal(await domain.readWorld('a',{path:'/variables/gold'}),10)
 assert.equal((await domain.readOperation('a',first.settlementId)).status,'submitted')
 await domain.prepareSettlement('a',{operationId:first.settlementId,world:{variables:{gold:20}}})
 await domain.commitSettlement('a',{operationId:first.settlementId})
 assert.equal((await domain.readSettlementDelta('a',first.settlementId)).mode,'snapshot')
})

test('v1 full-world conversations and history remain readable and upgrade on foreground',async t=>{
 const {store,domain}=await fixture(t)
 const old={variables:{gold:5},format:'incremental-world-v1'}
 await store.create('old',{metadata:{format:'conversation-state-v1'},state:{branchId:'old',storyRevision:0,worldRevision:0,lifecycleRevision:0,activeSettlementId:null,world:old},messages:[]})
 assert.deepEqual((await domain.open('old')).state.world,old)
 const fg=await domain.commitForeground('old',{operationId:'new',basis:(await domain.open('old')).basis,userText:'u',assistantText:'a'})
 await domain.submitSettlement('old',{operationId:fg.settlementId,submission:{gold:1}})
 await domain.prepareSettlement('old',{operationId:fg.settlementId,changes:[{op:'delta',path:'/variables/gold',value:1}]})
 await domain.commitSettlement('old',{operationId:fg.settlementId})
 assert.deepEqual((await domain.readMessageState('old',{position:1,side:'before'})),old)
 assert.equal(await domain.readWorld('old',{path:'/variables/gold'}),6)
})
