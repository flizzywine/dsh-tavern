import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createStoryReconciliation } from '../tavern-plugin/lib/domain/story-reconciliation.js'
import { conversationReadLane } from '../tavern-plugin/lib/domain/conversation-read-lanes.js'

const reply = (id, turn) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source: { kind: 'model', provider: 'test', model: 'test' } } })

function harness({ chat, session = Session.create('story'), agent = null, readSlice = async () => null, readWindow } = {}) {
  const reads = [], writes = []
  let saved = structuredClone(chat)
  const service = createStoryReconciliation({
    agentRegistry: new Map(agent ? [['story', agent]] : []),
    sessionStore: new Map([['story', session]]),
    chatForSession: async id => { reads.push(id); return id === 'story' ? structuredClone(saved) : undefined },
    chatSliceForSession: readSlice,
    readWindow,
    async updateChat(id, mutate, options) { const next = mutate(structuredClone(saved)); writes.push(options.source); if (next) saved = next; return saved },
    turns: { finalize: async () => assert.fail('nothing to adopt') }
  })
  return { service, session, reads, writes, saved: () => saved }
}

test('concurrent reconciles share one run, and once-only reconciles stop after a report', async () => {
  // A regeneration in progress reports without repairing, so the run needs no native rounds.
  const h = harness({ chat: { id: 'game', mode: 'story', regenInProgress: true, messages: [] } })
  appendSessionEvent(h.session, 'assistant/message', reply('tavern-opening:x', 1), { surfaceOp: 'append' })
  const [first, second] = await Promise.all([h.service.reconcileWhenIdle('story'), h.service.reconcileWhenIdle('story')])
  assert.equal(first.state, 'regenerating')
  assert.equal(second, first, 'the second caller awaits the same run')
  assert.equal(h.reads.length, 1)
  assert.equal(await h.service.reconcileWhenIdle('story', { once: true }), null)
  assert.equal(h.reads.length, 1, 'a session already reconciled is not read again')
  assert.deepEqual(h.writes, [])
})

test('background reconcile uses projected text and the next turn waits for it', async () => {
  const header = { id: 'game', mode: 'story', _storageRevision: 3, regenInProgress: true }
  const reads = []
  const h = harness({
    readSlice: async (_id, indices) => {
      assert.deepEqual(indices, [], 'read only the header through the slice API')
      return { chat: header, messageCount: 999 }
    },
    async readWindow(id, options) {
      reads.push({ id, options, lane: conversationReadLane() })
      return { chat: { id, _storageRevision: 3, messages: [] }, from: 979, to: 998, revision: 3, messageCount: 999 }
    }
  })
  const run = h.service.reconcileWhenIdle('story', { once: true, background: true })
  assert.deepEqual(reads, [])
  await h.service.waitReconcile('story')
  assert.equal((await run).state, 'regenerating')
  assert.deepEqual(reads, [{
    id: 'game', lane: 'background', options: { limit: 20, requirePartial: false, fields: ['id', '_storageRevision'],
      messageFields: ['role', 'greeting', 'turn', 'text', 'sourceText', 'projectionText', 'nativeAnchor'] }
  }])
  assert.deepEqual(h.reads, [])
})
