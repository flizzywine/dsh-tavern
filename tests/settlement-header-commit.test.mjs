import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createSettlementRun } from '../tavern-plugin/lib/domain/settlement-run.js'
import { assertConversationForkable } from '../tavern-plugin/lib/domain/conversation-fork.js'

// The same commit against a real save: the header fields land, and the store is
// never asked for the whole Chat.
test('结算只写头部字段：不读整份存档、不整份更新', async t => {
  const root = await mkdtemp(join(tmpdir(), 'settlement-header-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  let ids = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (++ids), now: () => 1000 + ids })
  const opened = timeline.apply({ chat: { id: 'c', mode: 'story', messages: [{ role: 'user', text: '行动' }, { role: 'assistant', turn: 1, text: '正文' }] }, intent: { kind: 'ensure' } }).chat
  const body = timeline.apply({ chat: opened, intent: { kind: 'body.begin', turn: 2, userText: '开门' } })
  const round = timeline.complete({
    chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' },
    apply(chat) { chat.messages.push({ role: 'user', text: '开门', turn: 2 }, { role: 'assistant', text: '门开了', turn: 2 }) }
  }).chat
  await p.write(round)
  let fullReads = 0, updates = 0
  const coordinator = createBackgroundTaskCoordinator({
    timeline,
    store: {
      readChat: id => { fullReads++; return p.read(id) },
      writeChat: p.write,
      readState: p.readSessionState,
      readSlice: p.readSlice,
      updateChat: (...args) => { updates++; return p.update(...args) },
      patchChat: (...args) => p.patch(...args)
    }
  })
  const snapshot = (await p.readSlice('c', [0, 1])).chat
  const task = await coordinator.begin(snapshot, 'settlement', { reuseSnapshot: true })
  const completed = await task.commit({
    stateChanged: false,
    headerFields: ['posture', 'settleStatus', 'settleError', 'lastSettle'],
    apply(draft) {
      draft.posture = '她转过身'
      draft.settleStatus = 'done'
      draft.settleError = null
      draft.lastSettle = { ts: 1, posture: true, raw: '' }
    }
  })
  assert.equal(completed.status, 'committed')
  assert.deepEqual({ fullReads, updates }, { fullReads: 0, updates: 0 })
  const saved = await p.read('c')
  assert.equal(saved.posture, '她转过身')
  assert.equal(saved.settleStatus, 'done')
  assert.equal(saved.lastSettle.posture, true)
  assert.equal(saved.messages[1].text, '正文')
  assert.equal(saved.timeline.operations[task.operationId].status, 'completed')
  const checkpoint = saved.timeline.checkpoints[0]
  assert.equal(checkpoint.operationId, body.value.operationId)
  const settledRevision = saved.timeline.operations[body.value.operationId].settledRevision
  assert.equal(settledRevision, saved._storageRevision)
  assert.ok(settledRevision > checkpoint.afterRevision, '已结算快照必须晚于正文 pending 快照')
  const settled = await p.readRevision('c', settledRevision)
  assert.equal(settled.settleStatus, 'done')
  assert.doesNotThrow(() => assertConversationForkable(settled, { historical: true }))
})

test('失败结算与 settledRevision 同帧落盘，不再二次整份写 Chat', async t => {
  const root = await mkdtemp(join(tmpdir(), 'settlement-failed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const timeline = createStoryTimeline()
  const opened = timeline.apply({ chat: { id: 'c', mode: 'story', messages: [] }, intent: { kind: 'ensure' } }).chat
  const body = timeline.apply({ chat: opened, intent: { kind: 'body.begin', turn: 1, userText: '开门' } })
  const round = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' }, apply(chat) { chat.messages.push({ role: 'user', text: '开门', turn: 1 }, { role: 'assistant', text: '门开了', turn: 1 }) } }).chat
  await p.write(round)
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    readChat: p.read, writeChat: p.write, readState: p.readSessionState, readSlice: p.readSlice,
    updateChat: p.update, patchChat: p.patch
  } })
  let legacyWrites = 0
  const settlementRun = createSettlementRun({
    backgroundTasks: coordinator,
    chatPersistence: { readWindow: async () => null },
    readChat: id => p.read(id), readChatCard: async () => ({}), worldBookScanDepth: async () => 2,
    writeChat: async () => { legacyWrites++ },
    mvuSettlementEngine: {
      settings: () => ({ posture: false }), target: () => null, runs: () => false,
      recordFailure(draft, _error, message) { draft.mvuFailure = message; return true }
    },
    plainSettlementEngine: { run: async () => { throw new Error('boom') } }
  })
  await settlementRun.runSettlement('c')
  const saved = await p.read('c')
  assert.equal(legacyWrites, 0)
  assert.equal(saved.settleStatus, 'failed')
  assert.equal(saved.settleError, 'boom')
  assert.equal(saved.mvuFailure, 'boom')
  const settledRevision = saved.timeline.operations[body.value.operationId].settledRevision
  assert.equal(settledRevision, saved._storageRevision)
  const settled = await p.readRevision('c', settledRevision)
  assert.equal(settled.settleStatus, 'failed')
  assert.doesNotThrow(() => assertConversationForkable(settled, { historical: true }))
})
