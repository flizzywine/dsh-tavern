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
    discarded: options.discarded,
    lockEvent: options.lockEvent,
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
  // A lasting conflict: binding retries ten times before the whole-Chat update.
  assert.equal(patches,conflict?11:2)
  assert.equal(updates,conflict?2:0)
  await task.commit()
  await assert.rejects(task.checkpointMessage(0,(_chat,message)=>{message.text='stale'}),/过期/)
  const restarted=createChatJournalStore({dataRoot:root})
  assert.equal((await restarted.read('c')).messages[0].text,conflict?'concurrent':'keep')
})

for (const role of ['candidate', 'worldbook-filter']) for (const readMethod of ['readState', 'readRecoveryState']) test(`idle recovery uses ${readMethod} and active ${role} recovery reloads the full Chat`, async () => {
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
  chat = timeline.apply({ chat, intent: { kind: 'agent.begin', role } }).chat
  await coordinator.recover({ id: 'c' })
  assert.equal(reads, 1); assert.equal(writes, 1)
  assert.equal(chat.messages[0].text, 'preserve')
  assert.equal(coordinator.activity(chat).busy, false)
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

// Long saves: a task writing header fields only (style reference, worldbook filter) begins
// from the caller's snapshot and commits through the header, never reading the history.
test('只写头部字段的后台任务：复用快照开始、按声明的头部字段提交，不读整份存档', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const root = await mkdtemp(join(tmpdir(), 'background-header-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const timeline = createStoryTimeline()
  await p.write(timeline.apply({ chat: { id: 'c', mode: 'story', messages: [{ role: 'user', text: '行动' }, { role: 'assistant', turn: 2, text: '正文' }] }, intent: { kind: 'ensure' } }).chat)
  let fullReads = 0, updates = 0
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    readChat: id => { fullReads++; return p.read(id) }, writeChat: p.write, readState: p.readSessionState, readSlice: p.readSlice,
    updateChat: (...args) => { updates++; return p.update(...args) }, patchChat: (...args) => p.patch(...args) } })
  const snapshot = (await p.readSlice('c', [1])).chat
  const task = await coordinator.begin(snapshot, 'style-reference', { reuseSnapshot: true })
  await task.bindSession('background-style', { stateOnly: true })
  const completed = await task.commit({ stateChanged: false, headerFields: ['styleReferences'], apply(draft) { draft.styleReferences = [{ book: '书', author: '作者', quote: '一段', afterTurn: 2 }] } })
  assert.equal(completed.status, 'committed')
  assert.deepEqual({ fullReads, updates }, { fullReads: 0, updates: 0 })
  const saved = await p.read('c')
  assert.equal(saved.styleReferences[0].book, '书')
  assert.equal(saved.messages[1].text, '正文')
  assert.equal(saved.timeline.operations[task.operationId].status, 'completed')
})

// A write landing between the caller's snapshot and begin: re-read the task state, not the history.
test('复用快照开始时撞上并发写入：只重读任务状态字段再开始，不读整份存档', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const { createTaskStateReader } = await import('../tavern-plugin/lib/domain/task-state-reader.js')
  const root = await mkdtemp(join(tmpdir(), 'background-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const timeline = createStoryTimeline()
  await p.write(timeline.apply({ chat: { id: 'c', mode: 'story', messages: [{ role: 'user', text: '行动' }, { role: 'assistant', turn: 2, text: '正文' }] }, intent: { kind: 'ensure' } }).chat)
  const snapshot = (await p.readSlice('c', [1])).chat
  const revision = snapshot._storageRevision
  await p.patch('c', revision, [{ op: 'set', path: ['title'], value: '并发写入' }], { source: 'test' })
  let fullReads = 0
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    readChat: id => { fullReads++; return p.read(id) }, writeChat: p.write, readState: p.readSessionState, readSlice: p.readSlice,
    readRecoveryState: createTaskStateReader({ readSlice: p.readSlice, readState: p.readSessionState }).read,
    updateChat: p.update, patchChat: (...args) => p.patch(...args) } })
  const task = await coordinator.begin(snapshot, 'style-reference', { reuseSnapshot: true })
  assert.equal(fullReads, 0)
  const saved = await p.read('c')
  assert.equal(saved.title, '并发写入')
  assert.equal(saved.timeline.operations[task.operationId].status, 'running')
})

// A cancelled or empty style reference fails every few turns: marking it failed is a header write.
// #394: after a body edit rewinds the background session, the candidate rebuilds
// its context from the messages it read; the task-state header must not wipe them.

test('书记忙时，排队的任务等它提交后再开始；不排队的任务仍然直接拒绝', async () => {
  const { coordinator, current } = coordinatorHarness()
  const holder = await coordinator.begin(current(), 'settlement')
  await assert.rejects(coordinator.begin(current(), 'ledger'), error => error.code === 'BACKGROUND_BUSY')
  let queued = 0
  let begun = null
  const waiting = coordinator.begin(current(), 'ledger', { queue: true, onQueued: () => queued++ }).then(task => { begun = task; return task })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(queued, 1)
  assert.equal(begun, null, 'still waiting for the slot')
  await holder.commit({ stateChanged: false })
  const ledger = await waiting
  assert.equal(coordinator.activity(current()).role, 'ledger')
  assert.equal(coordinator.activity(current()).busy, true)
  await ledger.commit({ stateChanged: false })
})

test('同一个任务不在自己后面排队：重复的一次照旧拒绝', async () => {
  const { coordinator, current } = coordinatorHarness()
  const holder = await coordinator.begin(current(), 'settlement')
  await assert.rejects(coordinator.begin(current(), 'settlement', { queue: true }), error => error.code === 'BACKGROUND_BUSY')
  await holder.commit({ stateChanged: false })
})

test('排队期间剧情回退（换了分支），排队的任务取消，不在新剧情上开始', async () => {
  const { coordinator, current } = coordinatorHarness()
  const holder = await coordinator.begin(current(), 'settlement')
  const waiting = coordinator.begin(current(), 'ledger', { queue: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  current().timeline.branchId = 'branch-after-rollback'
  await holder.commit({ stateChanged: false })
  await assert.rejects(waiting, error => error.code === 'BACKGROUND_QUEUE_CANCELLED')
  assert.equal(coordinator.activity(current()).busy, false)
})

test('排队可以中止', async () => {
  const { coordinator, current } = coordinatorHarness()
  const holder = await coordinator.begin(current(), 'settlement')
  const controller = new AbortController()
  const waiting = coordinator.begin(current(), 'ledger', { queue: true, signal: controller.signal })
  await new Promise(resolve => setTimeout(resolve, 20))
  controller.abort()
  await assert.rejects(waiting, error => error.name === 'AbortError')
  await holder.commit({ stateChanged: false })
})
