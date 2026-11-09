import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createStoryReconciliation } from '../tavern-plugin/lib/domain/story-reconciliation.js'

const reply = (id, turn) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source: { kind: 'model', provider: 'test', model: 'test' } } })

function harness({ chat, session = Session.create('story'), agent = null } = {}) {
  const reads = [], writes = []
  let saved = structuredClone(chat)
  const service = createStoryReconciliation({
    agentRegistry: new Map(agent ? [['story', agent]] : []),
    sessionStore: new Map([['story', session]]),
    chatForSession: async id => { reads.push(id); return id === 'story' ? structuredClone(saved) : undefined },
    chatSliceForSession: async () => null,
    async updateChat(id, mutate, options) { const next = mutate(structuredClone(saved)); writes.push(options.source); if (next) saved = next; return saved },
    turns: { finalize: async () => assert.fail('nothing to adopt') }
  })
  return { service, session, reads, writes, saved: () => saved }
}

test('an open turn in the log counts as busy: a once-only reconcile skips without reading the save', async () => {
  const h = harness({ chat: { id: 'game', mode: 'story', messages: [] } })
  appendSessionEvent(h.session, 'turn/start', { turn: 2 })
  assert.equal(await h.service.reconcileWhenIdle('story', { once: true }), null)
  assert.deepEqual(h.reads, [])
})

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

test('a failed native seed marks the save stale once, for the next fork to retry', async () => {
  const h = harness({ chat: { id: 'game', mode: 'story', messages: [] } })
  const warn = test.mock.method(console, 'warn', () => {})
  assert.equal(await h.service.seedNativeStory('story', null, '正文不一致'), null)
  assert.equal(await h.service.seedNativeStory('story', null, '正文不一致'), null)
  warn.mock.restore()
  assert.equal(h.saved().nativeSync.status, 'stale')
  assert.equal(h.saved().nativeSync.reason, '正文不一致')
  assert.deepEqual(h.writes, ['native-repair.stale', 'native-repair.stale'], 'the second mark finds it already stale and writes nothing new')
})

test('a fork seed leaves the native context intact if the target has started a turn', async t => {
  const h = harness({ chat: { id: 'game', mode: 'story', messages: [{ role: 'assistant', text: '分叉正文' }] } })
  h.service.assertBlankStoryForkTarget('story', h.session)
  appendSessionEvent(h.session, 'turn/start', { turn: 1 })
  appendSessionEvent(h.session, 'user/message', {
    id: 'new-input', role: 'user', content: [{ type: 'text', text: '已经发出的消息' }], source: { kind: 'user' }
  }, { surfaceOp: 'append' })
  const events = structuredClone(sessionEvents(h.session))
  const nodes = h.session.surface.nodes.slice()
  t.mock.method(console, 'warn', () => {})
  assert.equal(await h.service.seedNativeStory('story', h.session, '分叉初始化'), null)
  assert.deepEqual(sessionEvents(h.session), events)
  assert.deepEqual(h.session.surface.nodes, nodes)
  assert.equal(h.saved().nativeSync.status, 'stale')
})
