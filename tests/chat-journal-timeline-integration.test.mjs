import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('正文 checkpoint 使用 revision cursor，并从 journal 历史完成回退', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-journal-timeline-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  let sequence = 0
  const records = createChatJournalStore({ dataRoot: root, frameLimit: 1000 })
  const persistence = createChatPersistence({ store: records, now: () => 1000 })
  const timeline = createStoryTimeline({ id(prefix) { sequence++; return prefix + '-' + sequence }, now: () => 2000 + sequence })

  let chat = {
    id: 'chat-1', mode: 'story', messages: [], posture: '门外', candidates: null,
    scriptState: null, settleStatus: 'idle', settleError: null, lastSettle: null
  }
  chat = await persistence.write(chat, { source: 'chat.create' })
  assert.equal(chat._storageRevision, 1)

  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1, userText: '开门' } })
  chat = await persistence.write(begun.chat, { source: 'foreground.prepare' })
  const completed = timeline.complete({
    chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) {
      draft.messages.push({ role: 'user', text: '开门' }, { role: 'assistant', text: '门开了' })
      draft.posture = '门内'
    }
  })
  chat = await persistence.write(completed.chat, { source: 'foreground.commit' })
  const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  chat = await persistence.write(settlement.chat, { source: 'background.settlement.begin' })
  const settled = timeline.complete({
    chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'success' }
  })
  chat = await persistence.write(settled.chat, { source: 'background.settlement.commit' })

  const checkpoint = chat.timeline.checkpoints[0]
  const bodyOperation = chat.timeline.operations[begun.value.operationId]
  assert.equal(checkpoint.beforeRevision, 1)
  assert.equal(bodyOperation.beforeRevision, 1)
  assert.equal(Object.hasOwn(checkpoint, 'before'), false)
  assert.equal(Object.hasOwn(bodyOperation, 'before'), false)

  const historical = await persistence.readRevision(chat.id, checkpoint.beforeRevision)
  const rolled = timeline.apply({ chat, intent: { kind: 'turn.rollback', beforeChat: historical } })
  chat = await persistence.write(rolled.chat, { source: 'rollback' })

  assert.deepEqual(chat.messages, [])
  assert.equal(chat.posture, '门外')
  assert.equal(chat.timeline.revision, 2)
  assert.equal(chat.timeline.checkpoints.length, 0)

  const journal = await readFile(path.join(root, 'chats/chat-1/journals/000000000002-open.jsonl'), 'utf8')
  assert.match(journal, /"source":"foreground.prepare"/)
  assert.match(journal, /"source":"foreground.commit"/)
  assert.match(journal, /"source":"rollback"/)
  assert.doesNotMatch(journal, /"before":\{/)
})
