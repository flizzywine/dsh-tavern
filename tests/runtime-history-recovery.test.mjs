import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recoverRuntimeHistory} from '../tavern-plugin/lib/domain/runtime-history-recovery.js'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createTavernConversationRegistry} from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

function ports(overrides={}) {
  return {recoverRegeneration:async()=>{},readSlice:async()=>undefined,readChat:()=>assert.fail('unexpected full history read'),
    restoreChat:()=>assert.fail('unexpected preset restoration'),writeChat:()=>assert.fail('unexpected history write'),
    syncSummary:async()=>{},recoverHandoff:async()=>{},recoverCandidates:async()=>{},scanSettlement:()=>{},...overrides}
}

test('startup summary reads no history payload and publishes exactly the full Chat summary',async t=>{
  const root=await mkdtemp(join(tmpdir(),'startup-summary-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const store=createChatJournalStore({dataRoot:root,newConversations:true})
  const chat=await store.update('a',()=>({id:'a',sessionId:'s',cardPath:'cards/a.json',cardName:'A',title:'Game',mode:'story',
    createdAt:100,updatedAt:200,lastOpenedAt:150,backgroundHistoryIds:['old'],candidateAgent:{sessionId:'stale'},
    timeline:{participants:{background:{sessionId:'current'}},checkpoints:[{participants:{background:{sessionId:'historic'}}}],
      operations:{old:{kind:'agent',role:'settlement',status:'completed',startedSessionId:'settlement-history'}}},
    foregroundFrames:{large:'frame'.repeat(100000)},messages:[{role:'assistant',text:'body'.repeat(100000),turn:1}],_storageRevision:1}))
  const io=[],cold=createChatJournalStore({dataRoot:root,onNativeIO:event=>io.push(event)})
  const summaries=[],order=[]
  function registry() {
    let index={chats:[]}
    return {value:()=>index,registry:createTavernConversationRegistry({store:{readLinks:async()=>({}),updateLinks:async()=>{},
      readIndex:async()=>index,updateIndex:async fn=>{index=await fn(index)||index},readChat:async()=>chat,writeChat:async()=>{},removeChat:async()=>{}}})}
  }
  const full=registry(),selected=registry()
  await full.registry.sync(chat)
  // The row exists before restart; recovery republishes its metadata and keeps the stored preview (index.js passes metadataOnly).
  await selected.registry.sync(chat)
  await recoverRuntimeHistory({chats:[{id:'a'}]},ports({
    readSlice:cold.readSlice,recoverRegeneration:async()=>order.push('regeneration'),
    syncSummary:async value=>{summaries.push(value); await selected.registry.sync(value,{metadataOnly:true})},
    recoverHandoff:async ids=>{assert.deepEqual(ids,['a']);order.push('handoff')},
    recoverCandidates:async ids=>{assert.deepEqual(ids,['a']);order.push('candidates')},scanSettlement:()=>order.push('settlement')
  }))
  assert.deepEqual(selected.value(),full.value())
  assert.ok(io.some(event=>event.kind==='read'))
  assert.ok(selected.value().chats[0].backgroundHistoryIds.includes('historic'))
  assert.ok(selected.value().chats[0].backgroundHistoryIds.includes('settlement-history'))
  assert.deepEqual(summaries[0].messages,[])
  assert.deepEqual(summaries[0].timeline,chat.timeline)
  assert.ok(io.every(event=>event.bytes<65536),'no historical bodies or foreground frames are decoded')
  assert.deepEqual(order,['regeneration','handoff','candidates','settlement'])
  assert.deepEqual(await cold.read('a'),chat)
})

test('retired preset restoration still owns a full writable Chat and missing chats are omitted',async()=>{
  const full={id:'a',bypassPlanId:'retired',messages:[{role:'assistant',text:'original'}]},written=[],synced=[]
  await recoverRuntimeHistory({chats:[{id:'a'},{id:'deleted'}]},ports({
    readSlice:async id=>id==='a'?{chat:{id,bypassPlanId:'retired',messages:[]}}:undefined,
    readChat:async()=>full,restoreChat:async chat=>{assert.equal(chat,full);chat.bypassPlanId='';return true},
    writeChat:async chat=>written.push(chat),syncSummary:async chat=>synced.push(chat),
    recoverHandoff:async ids=>assert.deepEqual(ids,['a']),recoverCandidates:async ids=>assert.deepEqual(ids,['a'])
  }))
  assert.deepEqual(written,[full]);assert.deepEqual(synced,[full])
})
