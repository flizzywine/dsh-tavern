import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor } from '../tavern-plugin/lib/domain/body-editor.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'

// A save submitted while a turn runs waits for the round to end; these tests play
// the turn's end themselves, because the hook that does it lives in the host.
function fixture(text = '原正文') {
  const session = Session.create('body-edit-queue')
  appendSessionEvent(session, 'user/message', { id: 'user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'reply', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text, sourceText: text, swipes: [text], swipeId: 0 }], settleStatus: 'done' }
  const agent = { session, phase: { kind: 'idle', lastTurn: 2 } }
  let busy = false
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision += 1; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline(), activity: () => ({ busy }), project: async text => projectReplyLayers(text), present: async value => value
  }
  return { editor: createBodyEditor(options), get chat() { return chat }, session, agent, options,
    busy(value) { busy = value }, change(fn) { fn(chat) } }
}

test('a queued edit applies once the turn ends, not while it still runs', async () => {
  const h = fixture()
  const edit = await h.editor.read(h.session.id)
  h.agent.phase.kind = 'running'
  const saved = []
  const queued = await h.editor.save(h.session.id, { token: edit.token, texts: ['排队后的正文'] },
    { onSaved: () => saved.push(h.chat.messages.at(-1).text) })
  assert.equal(queued.queued, true)
  assert.equal(h.editor.queuedCount(h.session.id), 1)
  assert.equal(h.chat.messages.at(-1).text, '原正文')
  // Still generating: the replay holds the edit instead of writing it.
  assert.equal(await h.editor.flushQueued(h.session.id), 0)
  assert.equal(h.editor.queuedCount(h.session.id), 1)
  assert.equal(h.chat.messages.at(-1).text, '原正文')
  assert.deepEqual(saved, [])
  h.agent.phase.kind = 'idle'
  assert.equal(await h.editor.flushQueued(h.session.id), 1)
  assert.equal(h.editor.queuedCount(h.session.id), 0)
  assert.equal(h.chat.messages.at(-1).text, '排队后的正文')
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '排队后的正文')
  assert.deepEqual(saved, ['排队后的正文'])
})
