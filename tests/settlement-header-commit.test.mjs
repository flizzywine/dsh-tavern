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

// A settlement without official MVU variables commits no floor: everything it
// writes is header state. Declaring those fields keeps the commit off the
// whole-Chat path — on a long save, reading every floor to diff one posture was
// the bulk of a plain settlement.
test('无 MVU 的普通结算提交声明头部字段，不再整份写存档', async () => {
  const chat = { id: 'chat', sessionId: 'session', mode: 'story', messages: [], timeline: { schemaVersion: 1 }, _storageRevision: 1 }
  const commits = []
  const taskRun = {
    chat,
    participantRequest: {},
    participant: () => null,
    commit: async input => { commits.push(input); return { status: 'committed', chat } }
  }
  const settlementRun = createSettlementRun({
    backgroundTasks: { begin: async () => taskRun, activity: () => ({ role: 'settlement', phase: 'running' }) },
    chatPersistence: { readWindow: async () => null },
    readChat: async () => chat,
    readChatCard: async () => ({}),
    worldBookScanDepth: async () => 2,
    writeChat: async () => assert.fail('结算不该整份写存档'),
    mvuSettlementEngine: {
      settings: () => ({ posture: false }), target: () => null, runs: () => false,
      completion: () => ({ messageIndices: null, stateChanged: false, apply() {} })
    },
    plainSettlementEngine: { run: async () => ({ text: '', result: {} }) }
  })
  await settlementRun.runSettlement('chat')
  assert.equal(commits.length, 1)
  assert.deepEqual(commits[0].headerFields, ['posture', 'settleStatus', 'settleError', 'lastSettle'])
  assert.equal('messageIndices' in commits[0], false)
})

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
})
