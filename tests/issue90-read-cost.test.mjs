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
test('production getSession cache hit and activity query avoid full-chat reads',async t=>{
  const {app}=await setup(t)
  const result=await app.get()
  assert.equal(result.revision,1)
  assert.equal(result.view.settlementTurn,1)
  assert.equal(result.view.mvuReceipts[0].receipt.status,'updated')
  assert.equal((await app.activity()).chatId,'c')
  assert.equal(app.fullReads(),0,'cache hit and status query must not clone full history')
})

test('session state excludes heavy payloads and cannot mutate journal or later results',async t=>{
  const {store,persistence}=await setup(t)
  const state=await persistence.readSessionState('c')
  assert.equal(state.messages[1].text,undefined)
  assert.equal(state.messages[1].variables,undefined)
  state.messages[1].mvu.receipt.status='tampered'
  state.messages.length=0
  assert.equal((await persistence.read('c')).messages[1].mvu.receipt.status,'updated')
  assert.equal((await persistence.readSessionState('c')).messages.length,2)
})

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

test('compact state observes external writes, deletion, and recreated chat',async t=>{
  const {root,persistence,chat}=await setup(t)
  const external=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  await external.update('c',value=>{value.messages[1].mvu.receipt.status='error';return value})
  assert.equal((await persistence.readSessionState('c')).messages[1].mvu.receipt.status,'error')
  await external.remove('c')
  assert.equal(await persistence.readSessionState('c'),undefined)
  await external.write({...chat,_storageRevision:0})
  assert.equal((await persistence.readSessionState('c')).messages[1].mvu.receipt.status,'updated')
})

test('legacy timeline inspection retains full body for migration',async t=>{
  const {persistence}=await setup(t)
  await persistence.update('c',value=>{
    value.timeline={schemaVersion:1,branchId:'b',revision:2,checkpoints:[],participants:{},operations:{body:{
      id:'body',kind:'body',status:'foreground-completed',basedOn:{branchId:'b',revision:2},turn:1,
      userText:'go',beforeRevision:1,beforeParticipants:{}}}}
    return value
  })
  const state=await persistence.readSessionState('c')
  assert.equal(state.messages[1].text,'body')
  state.messages[1].text='changed'
  assert.equal((await persistence.read('c')).messages[1].text,'body')
})

test('journal update isolates retained drafts, returned values, aborted and throwing mutations',async t=>{
  const {persistence}=await setup(t)
  let retained
  const saved=await persistence.update('c',value=>{retained=value;value.messages[1].text='saved';return value})
  retained.messages[1].text='after-callback'
  saved.messages[1].mvu.receipt.status='after-return'
  assert.equal((await persistence.read('c')).messages[1].text,'saved')
  assert.equal((await persistence.read('c')).messages[1].mvu.receipt.status,'updated')
  const unchanged=await persistence.update('c',value=>{value.messages[1].text='discard';return undefined})
  assert.equal(unchanged.messages[1].text,'saved')
  unchanged.messages[1].text='mutated-return'
  await assert.rejects(persistence.update('c',value=>{value.messages[1].text='throw';throw Error('abort')}),/abort/)
  assert.equal((await persistence.read('c')).messages[1].text,'saved')
})

test('non-journal adapters keep defensive input and output clones',async()=>{
  let value=seed()
  const persistence=createChatPersistence({store:{read:async()=>structuredClone(value),remove:async()=>{},
    update:async(_id,fn)=>{const next=await fn(value);if(next)value=next;return value}}})
  await persistence.update('c',draft=>{draft.messages[1].text='discard';return undefined})
  assert.equal(value.messages[1].text,'body')
  const saved=await persistence.update('c',draft=>{draft.messages[1].text='saved';return draft})
  saved.messages[1].text='after-return'
  assert.equal(value.messages[1].text,'saved')
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

test('legacy feature adoption falls back to a complete draft',async t=>{
  const {persistence,chat}=await setup(t)
  await persistence.update('c',value=>{delete value.backgroundConfigVersion;return value})
  let adopted=false
  const app=await sessionHarness(persistence,chat,{
    tavernSettingsDocument:{},adoptConversationFeatures:value=>value,
    adoptConversationBackground:value=>{assert.ok(value.messages[1].variables);adopted=true;return value},
    updateChat:(id,fn,metadata)=>persistence.update(id,fn,metadata)
  })
  await app.activity()
  assert.equal(adopted,true)
  assert.equal(app.fullReads(),1)
})

test('compact projection never visits historical text, variables, delivery payloads or rollback snapshots',async()=>{
  const {projectChatSessionState}=await import('../tavern-plugin/lib/domain/chat-session-state.js')
  const chat=seed()
  const poison=(object,key)=>Object.defineProperty(object,key,{enumerable:true,get(){throw Error('heavy subtree visited: '+key)}})
  poison(chat.messages[1],'text');poison(chat.messages[1],'variables')
  poison(chat.messages[1].mvu,'pendingSubmission')
  chat.rollbackUndo={version:1,foreground:{afterCount:1}}
  poison(chat.rollbackUndo,'chat')
  const state=projectChatSessionState(chat)
  assert.equal(state.messages[1].mvu.receipt.status,'updated')
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
