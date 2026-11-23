import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createMessageDeletion } from '../tavern-plugin/lib/domain/message-deletion.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createSessionStateView, projectChatSessionState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

const model = { kind: 'model', provider: 'fixture', model: 'fixture' }

function fixture(kinds) {
  const session = Session.create('clear-latest-' + Math.random().toString(36).slice(2))
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    tavernHelperLifecycleRevision: 7, messages: [{ role: 'assistant', greeting: true, text: '开场白' }],
    nativeCommits: {}, userInputEdits: {}, candidates: null }
  for (const [index, kind] of kinds.entries()) {
    const turn = index + 2
    appendSessionEvent(session, 'turn/start', { turn })
    const input = appendSessionEvent(session, 'user/message',
      { id: 'in-' + turn, role: 'user', content: [{ type: 'text', text: '输入' + turn }], source: { kind: 'user', rpcId: 'request-' + turn } },
      { surfaceOp: 'append' })
    chat.messages.push({ role: 'user', turn, text: '输入' + turn, native: true, source: { kind: 'user', rpcId: 'request-' + turn } })
    chat.userInputEdits[turn] = { text: '输入' + turn, id: 'edit-' + turn, seq: input.seq, role: 'user' }
    if (kind === 'orphan' || kind === 'placeholder') {
      if (kind === 'placeholder') chat.messages.push({ role: 'assistant', turn, text: '', placeholder: true })
      appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'error', error: { message: '截断' } } })
      continue
    }
    const text = '正文' + turn
    const reply = appendSessionEvent(session, 'assistant/message', { turn, step: 1,
      message: { id: 'out-' + turn, role: 'assistant', content: [{ type: 'text', text }], source: model } },
    { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
    chat.messages.push({ role: 'assistant', turn, text, messageUid: 'reply-' + turn,
      ...(kind === 'incomplete' ? { incomplete: true } : {}),
      nativeAnchor: { formatVersion: 4, turn, input: input.seq, reply: reply.seq } })
    chat.nativeCommits[turn] = { turn, userText: '输入' + turn }
  }
  const calls = []
  const agent = { session, phase: { kind: 'idle', lastTurn: kinds.length + 1 } }
  const read = async () => structuredClone(chat)
  const activity = { busy: false }
  const options = {
    chats: {
      read, forSession: read, readCard: async () => ({}),
      async update(_id, mutate, metadata) {
        calls.push(metadata.source)
        const next = await mutate(structuredClone(chat))
        if (next !== undefined) {
          next._storageRevision = chat._storageRevision + 1
          chat = structuredClone(next)
        }
        return structuredClone(chat)
      }
    },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => activity,
    view: read
  }
  const history = createRoundHistory({ chats: options.chats, sessions: options.sessions, scripts: {}, present: read })
  const sessionState = createSessionStateView({ activity: () => activity, evidence: () => ({ session, events: sessionEvents(session) }) })
  const deps = { str: String, agentRegistry: options.sessions, sessionStore: { get: () => session },
    sessionActivity: async () => activity, reconcileStory: async () => {}, chatForSession: read,
    messageDeletion: createMessageDeletion(options), rollbackTurn: history.rollback,
    notifyPluginTimeline: (...args) => calls.push(args) }
  return { session, agent, activity, calls, deps, history,
    get chat() { return chat },
    state: () => sessionState.rollback(projectChatSessionState(chat)),
    clear: expectedTarget => createPlayHandlers(deps).clearLatestReply({ sessionId: session.id, expectedTarget }) }
}

function nodeTexts(session) {
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  return session.surface.nodes.map(seq => {
    const event = bySeq.get(seq)
    const content = event?.data?.message?.content || event?.data?.content || []
    return content.map(block => block.text || '').join('')
  })
}

for (const orphanCount of [1, 2]) test(`清理 ${orphanCount} 个只有输入的失败轮时保留已完成正文`, async () => {
  const h = fixture(['completed', ...Array(orphanCount).fill('orphan')])
  const { clearIncompleteReplyTarget } = h.state()
  assert.deepEqual(clearIncompleteReplyTarget, { kind: 'failed-tail', turn: orphanCount + 2 })
  const result = await h.clear(clearIncompleteReplyTarget)
  assert.equal(result.deletedCount, 0)
  assert.equal(result.cleared, true)
  assert.deepEqual(h.chat.messages.slice(0, 3).map(row => row.text), ['开场白', '输入2', '正文2'])
  assert.equal(h.chat.messages.filter(row => row.role === 'assistant').length, 2)
  assert.deepEqual(nodeTexts(h.session).filter(Boolean), ['输入2', '正文2'])
  assert.equal(h.chat.rollbackUndo, undefined)
  assert.ok(h.calls.includes('rollback.interrupted'))
})

test('没有未完成回复时，接口和失败尾回退均拒绝删除已完成正文', async () => {
  const h = fixture(['completed'])
  const before = structuredClone(h.chat)
  assert.equal(h.state().canClearIncompleteReply, false)
  await assert.rejects(h.clear(), /没有可清除的未完成回复/)
  await assert.rejects(h.history.rollback(h.session.id, h.chat.id, 2, { failedTailOnly: true }), /清理目标已经变化/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(nodeTexts(h.session), ['输入2', '正文2'])
  assert.deepEqual(h.calls, [])
})
