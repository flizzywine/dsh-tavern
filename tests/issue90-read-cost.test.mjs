import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { sessionHarness } from './fixtures/issue90-session-harness.mjs'

export const seed = () => ({id:'c',sessionId:'s',mode:'story',cardPath:'card',_storageRevision:1,
  backgroundConfigVersion:1,conversationFeaturesVersion:1,messages:[{role:'user',turn:1,text:'go'},
    {role:'assistant',turn:1,text:'body',variables:[{stat_data:{large:'x'.repeat(100000)}}],mvu:{receipt:{status:'updated',changes:[]}}}]})
async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'issue90-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const store=createChatJournalStore({dataRoot:root})
  const chat=seed()
  await store.update('c',()=>chat)
  const persistence=createChatPersistence({store})
  return {root,store,persistence,chat, app:await sessionHarness(persistence,chat)}
}
test('cache miss reads full history and uses the full-read revision after a concurrent write',async t=>{
  const {persistence,chat}=await setup(t)
  const stages=[]
  const app=await sessionHarness(persistence,chat,{
    readChatCard:async()=>({}),view:async value=>{
      assert.equal(value.messages[1].text,'body')
      assert.ok(value.messages[1].variables)
      return {chatId:value.id,seenRevision:value._storageRevision}
    },requestPerformance:{stage:(name,fn)=>{stages.push(name);return fn()},state(){}}
  })
  await persistence.update('c',value=>{value.messages[1].text='body';value.counter=1;return value})
  const result=await app.get()
  assert.equal(result.revision,2)
  assert.equal(result.view.seenRevision,2)
  assert.equal(app.fullReads(),1)
  assert.ok(stages.includes('projectView'))
})

test('concurrent cache replacement keeps the old response paired with its revision',async t=>{
  const {persistence,chat}=await setup(t)
  const app=await sessionHarness(persistence,chat)
  app.context.synchronizeSessionView.peek=()=>({sessionId:'s',revision:0})
  let replace=true
  app.context.chatPersistence={...persistence,readChangedIndices:async(id,revision)=>{
    if(replace){
      replace=false
      await persistence.update('c',value=>{value.messages[1].turn=2;return value})
      await app.get()
    }
    return persistence.readChangedIndices(id,revision)
  }}
  const result=await app.get()
  assert.equal(result.revision,1)
  assert.equal(result.view.settlementTurn,1)
  assert.equal((await app.get()).view.settlementTurn,2)
  assert.equal(app.fullReads(),1)
})

test('compact state preserves live rollback, interrupted receipts, script state and undo decisions',async t=>{
  const {persistence}=await setup(t)
  await persistence.update('c',value=>{
    value.mode='script';value.scriptState={position:3};value.tavernHelperLifecycleRevision=7
    value.timeline={schemaVersion:1,branchId:'b',revision:4,updatedAt:1,participants:{},checkpoints:[],operations:{
      settle:{id:'op',kind:'agent',role:'settlement',status:'interrupted',createdAt:2}}}
    value.rollbackUndo={version:1,ready:true,branchId:'b',revision:4,lifecycleRevision:7,storageRevision:2,
      turn:1,foreground:{afterCount:0},largeSnapshot:{text:'not needed'}}
    value.importHistory={rescue:true,operationId:'import'}
    value.messages[1].importSource={operationId:'import'}
    return value
  })
  const full=await persistence.read('c'), state=await persistence.readSessionState('c')
  const app=await sessionHarness(persistence,full,{sessionDebugEvidence:()=>({events:[],session:{events:[],surface:{nodes:[]}}})})
  const compact=app.volatile(state), complete=app.volatile(full)
  assert.deepEqual(JSON.parse(JSON.stringify(compact)),JSON.parse(JSON.stringify(complete)))
  assert.equal(compact.mvuReceipts[0].receipt.status,'interrupted')
  assert.equal(compact.undoRollbackTurn,1)
  assert.equal(state.rollbackUndo.largeSnapshot,undefined)
  assert.deepEqual(state.scriptState,{position:3})
})

test('state resolution preserves aliases, recovers missing links and removes stale links without full reads',async()=>{
  const {createTavernConversationRegistry}=await import('../tavern-plugin/lib/domain/tavern-conversation-registry.js')
  let links={alias:'c',stale:'gone'}
  const records={c:{id:'c',sessionId:'original'},recovered:{id:'recovered',sessionId:'new'}}
  const registry=createTavernConversationRegistry({store:{readLinks:async()=>links,
    updateLinks:async fn=>{links=await fn(links)||links},readIndex:async()=>({chats:[{id:'c'},{id:'recovered'}]}),
    readChat:async()=>{throw Error('full read')},readChatState:async id=>structuredClone(records[id]),
    async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) await this.writeIndex(next); return next },
    writeIndex:async()=>{},writeChat:async()=>{},removeChat:async()=>{}}})
  assert.equal((await registry.resolveState('alias')).id,'c')
  assert.equal((await registry.resolveState('new')).id,'recovered')
  assert.equal(links.new,'recovered')
  assert.equal(await registry.resolveState('stale'),undefined)
  assert.equal(links.stale,undefined)
})
