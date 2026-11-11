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
import { createSettlementParticipants } from '../tavern-plugin/lib/domain/settlement-participants.js'

async function savedRound(t) {
  const root = await mkdtemp(join(tmpdir(), 'settlement-participants-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const timeline = createStoryTimeline()
  const opened = timeline.apply({ chat: { id: 'c', mode: 'story', messages: [] }, intent: { kind: 'ensure' } }).chat
  const body = timeline.apply({ chat: opened, intent: { kind: 'body.begin', turn: 1, userText: '开门' } })
  const round = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' }, apply(chat) { chat.messages.push({ role: 'user', text: '开门', turn: 1 }, { role: 'assistant', text: '门开了', turn: 1, mvu: { pending: true } }) } }).chat
  await p.write(round)
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    readChat: p.read, writeChat: p.write, readState: p.readSessionState, readSlice: p.readSlice,
    updateChat: p.update, patchChat: p.patch
  } })
  return { p, coordinator }
}

function mvuEngine() {
  return {
    settings: () => ({ posture: false }), target: () => ({ messageId: 1, swipeId: 0 }), runs: () => true,
    run: async () => ({ text: '', posture: '', mvuResult: { receipt: { status: 'updated' } } }),
    completion: ({ mvuTarget }) => ({
      messageIndices: [mvuTarget.messageId], stateChanged: true,
      apply(draft) { draft.messages[mvuTarget.messageId].mvu = { pending: false } }
    }),
    recordFailure() { return true }
  }
}

test('a participant adds to the settlement commit and hears the saved chat', async t => {
  const { p, coordinator } = await savedRound(t)
  const participants = createSettlementParticipants()
  let heard = null
  participants.register('stage', {
    capture: (snapshot, target, result) => {
      assert.equal(target.messageId, 1)
      assert.equal(result.receipt.status, 'updated')
      return draft => { draft.messages[target.messageId].stageItems = { status: 'final' } }
    },
    settled: (snapshot, chat, target) => { heard = chat.messages[target.messageId] }
  })
  const run = createSettlementRun({
    backgroundTasks: coordinator, chatPersistence: { readWindow: async () => null },
    readChat: id => p.read(id), readChatCard: async () => ({}), worldBookScanDepth: async () => 2,
    mvuSettlementEngine: mvuEngine(), settlementParticipants: participants
  })
  await run.runSettlement('c')
  const saved = await p.read('c')
  assert.equal(saved.settleStatus, 'done')
  assert.deepEqual(saved.messages[1].mvu, { pending: false })
  assert.deepEqual(saved.messages[1].stageItems, { status: 'final' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(heard?.stageItems, { status: 'final' })
})

test('a failing participant is reported and the settlement commits as the core made it', async t => {
  const { p, coordinator } = await savedRound(t)
  const reports = []
  const participants = createSettlementParticipants({ warn: report => reports.push(report.owner + ':' + report.phase) })
  participants.register('broken-capture', { capture: () => { throw new Error('capture') } })
  participants.register('broken-apply', { capture: () => () => { throw new Error('apply') }, settled: () => { throw new Error('settled') } })
  const run = createSettlementRun({
    backgroundTasks: coordinator, chatPersistence: { readWindow: async () => null },
    readChat: id => p.read(id), readChatCard: async () => ({}), worldBookScanDepth: async () => 2,
    mvuSettlementEngine: mvuEngine(), settlementParticipants: participants
  })
  await run.runSettlement('c')
  const saved = await p.read('c')
  assert.equal(saved.settleStatus, 'done')
  assert.deepEqual(saved.messages[1].mvu, { pending: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reports.sort(), ['broken-apply:capture', 'broken-apply:settled', 'broken-capture:capture'])
})

test('participants hear closed and retrying inside the core write; an owner registers once', () => {
  const participants = createSettlementParticipants()
  const seen = []
  const unregister = participants.register('stage', {
    closed: (chat, messageId) => seen.push('closed:' + messageId),
    retrying: message => seen.push('retrying:' + message.turn)
  })
  assert.throws(() => participants.register('stage', {}), /Duplicate/)
  participants.closed({ messages: [] }, 3)
  participants.retrying({ turn: 4 })
  unregister()
  participants.closed({ messages: [] }, 5)
  assert.deepEqual(seen, ['closed:3', 'retrying:4'])
})
