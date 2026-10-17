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

test('后台任务通过一个 interface 原子开始、重载并提交时间线结果', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(harness.current(), 'settlement')
  assert.equal(task.participantRequest.role, 'background')
  assert.equal(harness.writes.length, 1)

  const result = await task.commit({
    stateChanged: true,
    participant: task.participant({ traceSessionId: 'background-1', traceBoundary: 42 }),
    apply(draft) { draft.posture = '门边站立。' }
  })

  assert.equal(result.status, 'committed')
  assert.equal(result.chat.posture, '门边站立。')
  assert.equal(harness.writes.length, 2)
  assert.equal(harness.current().timeline.participants.background.sessionId, 'background-1')
})

test('展示刷新插入结算提交时，后台基于最新 Chat 原子保留双方消息差量', async () => {
  let value = {
    id: 'chat-1', mode: 'story',
    messages: [{ role: 'assistant', text: '正文', displayRuntime: null, mvu: { pending: true } }],
    posture: '', candidates: null, settleStatus: 'idle', settleError: null,
    _storageRevision: 1
  }
  let tail = Promise.resolve()
  const persistence = createChatPersistence({
    now: () => 1000,
    data: {
      async readJson() { return structuredClone(value) },
      async updateJson(_path, updater) {
        const current = tail.then(async function () {
          const next = await updater(structuredClone(value))
          if (next !== undefined) value = structuredClone(next)
          return structuredClone(value)
        })
        tail = current.catch(function () {})
        return await current
      },
      async remove() {}
    }
  })
  let injectDisplayRefresh = false
  async function refreshDisplay() {
    await persistence.update('chat-1', function (chat) {
      chat.messages[0].displayRuntime = { dom: '<p>正文</p>' }
      return chat
    }, { source: 'display.capture' })
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-1', now: () => 1000 })
  const coordinator = createBackgroundTaskCoordinator({
    timeline,
    store: {
      readChat: chatId => persistence.read(chatId),
      async writeChat(chat, metadata) {
        if (injectDisplayRefresh) {
          injectDisplayRefresh = false
          await refreshDisplay()
        }
        return await persistence.write(chat, metadata)
      },
      async updateChat(chatId, mutation, metadata) {
        if (injectDisplayRefresh) {
          injectDisplayRefresh = false
          await refreshDisplay()
        }
        return await persistence.update(chatId, mutation, metadata)
      }
    }
  })

  const task = await coordinator.begin(await persistence.read('chat-1'), 'settlement')
  injectDisplayRefresh = true
  const result = await task.commit({
    stateChanged: true,
    apply(chat) { chat.messages[0].mvu = { pending: false, modified: true } }
  })

  assert.deepEqual(result.chat.messages[0].displayRuntime, { dom: '<p>正文</p>' })
  assert.deepEqual(result.chat.messages[0].mvu, { pending: false, modified: true })
})

test('manual interruption unlocks background and rejects late state writes and stale stop requests', async () => {
  const h = coordinatorHarness();
  const task = await h.coordinator.begin(h.current(), 'settlement');
  const stopped = await h.coordinator.recover(h.current(), { operationId: task.operationId });
  assert.equal(stopped.activity.busy, false);
  assert.equal(stopped.activity.reason, 'interrupted');
  const late = await task.commit({ apply(chat) { chat.posture = 'late write'; } });
  assert.equal(late.status, 'stale');
  assert.equal(h.current().posture, '');
  const next = await h.coordinator.begin(h.current(), 'settlement');
  const stale = await h.coordinator.recover(h.current(), { operationId: task.operationId });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.activity.busy, true);
  assert.equal(stale.activity.operationId, next.operationId);
});

test('replacement binding survives stale failure receipts and subsequent retries', async () => {
  const h = coordinatorHarness()
  const seed = await h.coordinator.begin(h.current(), 'settlement')
  await seed.commit({ participant: seed.participant({ sessionId: 'old', boundary: 42 }) })
  const task = await h.coordinator.begin(h.current(), 'settlement')
  await task.bindSession('replacement')
  assert.equal(h.current().timeline.participants.background.sessionId, 'replacement')
  assert.equal(h.current().timeline.participants.background.syncedRevision, null)
  await task.fail({ sessionId: 'old', boundary: 42 })
  assert.equal(h.current().timeline.participants.background.sessionId, 'replacement')
  assert.equal(h.current().timeline.participants.background.boundary, null)
  assert.equal(h.current().timeline.participants.background.syncedRevision, null)
  for (let n = 0; n < 3; n++) {
    const retry = await h.coordinator.begin(h.current(), 'settlement')
    assert.equal(retry.participantRequest.sessionId, 'replacement')
    await retry.bindSession('replacement')
    await retry.fail({ traceSessionId: 'replacement' })
  }
})

test('replacement identity survives interruption before result and recovery', async () => {
  const h = coordinatorHarness()
  const seed = await h.coordinator.begin(h.current(), 'settlement')
  await seed.commit({ participant: seed.participant({ sessionId: 'old', boundary: 42 }) })
  const task = await h.coordinator.begin(h.current(), 'settlement')
  await task.bindSession('replacement')
  await h.coordinator.recover(h.current())
  const retry = await h.coordinator.begin(h.current(), 'settlement')
  assert.equal(retry.participantRequest.sessionId, 'replacement')
  await assert.rejects(task.bindSession('late-old'), /过期/)
  assert.equal(h.current().timeline.participants.background.sessionId, 'replacement')
})

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

test('fast begin rechecks busy guards after a concurrent operation wins the CAS',async()=>{
 const timeline=createStoryTimeline()
 let chat=timeline.apply({chat:{id:'c',_storageRevision:1,messages:[]},intent:{kind:'ensure'}}).chat
 let writes=0
 const coordinator=createBackgroundTaskCoordinator({timeline,store:{readChat:async()=>chat,writeChat:async()=>{writes++},updateChat:async()=>{},patchChat:async()=>{
  chat=timeline.apply({chat,intent:{kind:'agent.begin',role:'candidate'}}).chat
  chat._storageRevision++
  return undefined
 }}})
 await assert.rejects(coordinator.begin(structuredClone(chat),'settlement',{reuseSnapshot:true}),/后台 Agent 正在执行/)
 assert.equal(writes,0)
 assert.equal(Object.values(chat.timeline.operations).filter(op=>op.role==='settlement').length,0)
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

test('人物设计发布在校验之后执行，发布失败不提交档案，过期任务不发布', async () => {
  const run = coordinatorHarness()
  const task = await run.coordinator.begin(run.current(), 'character-design')
  await assert.rejects(task.commit({ apply: chat => { chat.characterDesignDocument = { characters: [] } }, beforePersist: async () => { throw new Error('世界书写入失败') } }), /世界书写入失败/)
  assert.equal(run.current().characterDesignDocument, undefined)
  await task.fail()
  let published = false
  const result = await task.commit({ beforePersist: async () => { published = true } })
  assert.equal(result.status, 'stale')
  assert.equal(published, false)
})

// PR #113's retry protection, retaining request idempotency and timeline guards.
import { createSettlementProgressGuard } from '../tavern-plugin/lib/domain/settlement-progress-guard.js'
test('three stale commits without progress interrupt the task and allow an explicit retry', async () => {
  const h = coordinatorHarness(), notices = []
  const task = await h.coordinator.begin(h.current(), 'settlement')
  const retry = createSettlementProgressGuard({ backgroundTasks: h.coordinator, onStopped: value => notices.push(value) })
  assert.equal(await retry(h.current()), true)
  assert.equal(await retry(h.current(), new Error('stale failure')), true)
  assert.equal(await retry(h.current()), false)
  assert.equal(h.coordinator.activity(h.current()).phase, 'failed')
  assert.equal(notices.length, 1)
  assert.equal((await task.commit({ apply(chat) { chat.posture = 'late' } })).status, 'stale')
  assert.equal(h.current().posture, '')
  const next = await h.coordinator.begin(h.current(), 'settlement')
  assert.notEqual(next.operationId, task.operationId)
})
test('new story revisions reset the stale retry budget', async () => {
  const h = coordinatorHarness()
  await h.coordinator.begin(h.current(), 'settlement')
  const retry = createSettlementProgressGuard({ backgroundTasks: h.coordinator })
  for (let revision = 0; revision < 6; revision++) {
    h.current().timeline.revision = revision
    assert.equal(await retry(h.current()), true)
  }
  assert.equal(h.coordinator.activity(h.current()).phase, 'running')
})
test('late circuit interruption cannot stop a changed branch or completed task', async () => {
  for (const change of ['branch', 'complete']) {
    const h = coordinatorHarness()
    const task = await h.coordinator.begin(h.current(), 'settlement')
    const expectedState = { branchId: h.current().timeline.branchId, revision: h.current().timeline.revision, lifecycleRevision: 0, phase: 'running' }
    if (change === 'branch') h.current().timeline.branchId = 'new-branch'
    else await task.commit({ stateChanged: false })
    const before = h.writes.length
    const result = await h.coordinator.recover(h.current(), { operationId: task.operationId, expectedState })
    assert.equal(result.status, 'stale')
    assert.equal(h.writes.length, before)
  }
})
