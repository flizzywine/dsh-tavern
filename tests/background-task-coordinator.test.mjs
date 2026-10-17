import { applyJsonChanges } from '../tavern-plugin/lib/domain/json-mutation.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'

function coordinatorHarness(options = {}) {
  let current = {
    id: 'chat-1', mode: 'story', messages: [], posture: '', candidates: null,
    settleStatus: 'idle', settleError: null
  }
  const writes = []
  let sequence = 0
  const timeline = createStoryTimeline({
    id(prefix) { sequence++; return prefix + '-' + sequence },
    now() { return 1000 + sequence }
  })
  const coordinator = createBackgroundTaskCoordinator({
    timeline,
    blocked: options.blocked,
    store: {
      async readChat() { return current },
      async writeChat(chat) { current = chat; writes.push(chat) },
      async updateChat(_chatId, mutation) {
        const next = await mutation(current)
        if (next !== undefined) current = next
        writes.push(current)
        return current
      }
    }
  })
  return { coordinator, timeline, current: function () { return current }, writes }
}

for (const conflict of [false,true,'cancel']) test(`narrow background mutations preserve concurrent history: ${conflict}`,async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {createChatJournalStore}=await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const root=await mkdtemp(join(tmpdir(),'background-patch-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const p=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  const timeline=createStoryTimeline()
  await p.write(timeline.apply({chat:{id:'c',messages:[{role:'assistant',text:'keep',variables:[{hp:1}]}]},intent:{kind:'ensure'}}).chat)
  let patches=0,updates=0
  const coordinator=createBackgroundTaskCoordinator({timeline,store:{readChat:p.read,writeChat:p.write,
    readState:p.readSessionState,readSlice:p.readSlice,readSettlementCheckpoint:p.readSettlementCheckpoint,
    updateChat:(...args)=>{updates++;return p.update(...args)},
    patchChat:async(...args)=>{
      patches++
      if(conflict)await p.update('c',chat=>{chat.messages[0].text='concurrent';if(conflict==='cancel')Object.values(chat.timeline.operations).forEach(op=>{op.status='cancelled'});return chat})
      return p.patch(...args)
    }}})
  const task=await coordinator.begin(await p.read('c'),'settlement')
  if(conflict==='cancel') {
    await assert.rejects(task.bindSession('background'),/过期/)
    assert.equal((await p.read('c')).timeline.operations[task.operationId].startedSessionId,undefined)
    return
  }
  await task.bindSession('background')
  await task.checkpointMessage(0,(_chat,message)=>{message.mvu={pendingSubmission:[1]}})
  const saved=await p.read('c')
  assert.equal(saved.timeline.operations[task.operationId].startedSessionId,'background')
  assert.deepEqual(saved.messages[0].variables,[{hp:1}])
  assert.equal(saved.messages[0].text,conflict?'concurrent':'keep')
  assert.deepEqual(saved.messages[0].mvu.pendingSubmission,[1])
  assert.equal(patches,2)
  assert.equal(updates,conflict?2:0)
  await task.commit()
  await assert.rejects(task.checkpointMessage(0,(_chat,message)=>{message.text='stale'}),/过期/)
  const restarted=createChatJournalStore({dataRoot:root})
  assert.equal((await restarted.read('c')).messages[0].text,conflict?'concurrent':'keep')
})

for (const readMethod of ['readState', 'readRecoveryState']) test(`idle recovery uses ${readMethod} and active recovery reloads the full Chat`, async () => {
  const timeline = createStoryTimeline()
  let chat = timeline.apply({ chat: { id: 'c', messages: [{ role: 'assistant', text: 'preserve' }] }, intent: { kind: 'ensure' } }).chat
  let reads = 0, writes = 0
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    readState: async () => { throw Error('must prefer recovery metadata') },
    [readMethod]: async () => ({ id: 'c', timeline: structuredClone(chat.timeline), messages: [] }),
    readChat: async () => { reads++; return structuredClone(chat) },
    writeChat: async value => { writes++; chat = value }, updateChat: async () => {}
  } })
  assert.equal((await coordinator.recover({ id: 'c' })).status, 'unchanged')
  assert.equal(reads, 0)
  chat = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'candidate' } }).chat
  await coordinator.recover({ id: 'c' })
  assert.equal(reads, 1); assert.equal(writes, 1)
  assert.equal(chat.messages[0].text, 'preserve')
})

for(const conflict of [false,true])test(`settlement begin reuses an exact snapshot without full reads; conflict=${conflict}`,async()=>{
 const timeline=createStoryTimeline()
 let chat=timeline.apply({chat:{id:'c',_storageRevision:1,messages:[{role:'assistant',text:'keep'}]},intent:{kind:'ensure'}}).chat
 let reads=0,writes=0,patches=0
 const store={readChat:async()=>{reads++;return structuredClone(chat)},writeChat:async value=>{writes++;chat=value},updateChat:async(_id,fn)=>{chat=fn(chat);return chat},
  patchChat:async(_id,revision,changes)=>{
   patches++
   if(conflict){chat._storageRevision++;chat.messages[0].text='concurrent';return undefined}
   assert.equal(revision,chat._storageRevision)
   const {applyJsonChanges}=await import('../tavern-plugin/lib/domain/json-mutation.js')
   chat=applyJsonChanges(chat,changes);chat._storageRevision++
   return {...chat,messages:[]}
  }}
 const task=await createBackgroundTaskCoordinator({timeline,store}).begin(structuredClone(chat),'settlement',{reuseSnapshot:true})
 assert.equal(patches,1)
 assert.equal(reads,conflict?1:0)
 assert.equal(writes,conflict?1:0)
 assert.equal(task.chat.messages[0].text,conflict?'concurrent':'keep')
 assert.equal(task.chat._storageRevision,chat._storageRevision)
 assert.equal(chat.timeline.operations[task.operationId].status,'running')
})

test('candidate start atomically records command and existing session before execution',async()=>{
 const h=coordinatorHarness()
 const previous=await h.coordinator.begin(h.current(),'settlement')
 await previous.commit({participant:{sessionId:'existing',lifetime:'chat',boundary:12}})
 const before=h.writes.length
 const task=await h.coordinator.begin(h.current(),'candidate',{
  requestId:'new',bindExistingSession:true,
  prepareCommit(chat,value){chat.taskMailbox={operationId:value.operationId};return true}
 })
 assert.equal(h.writes.length,before+1)
 assert.equal(task.startCommitted,true)
 assert.equal(h.current().taskMailbox.operationId,task.operationId)
 assert.equal(h.current().timeline.operations[task.operationId].startedSessionId,'existing')
 assert.equal(task.participantRequest.sessionId,'existing')
})

// PR #113's retry protection, retaining request idempotency and timeline guards.
