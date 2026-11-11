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

test('a queued edit drops its text when the row changed before the turn ended', async () => {
  const h = fixture()
  const edit = await h.editor.read(h.session.id)
  h.agent.phase.kind = 'running'
  await h.editor.save(h.session.id, { token: edit.token, texts: ['排队后的正文'] })
  h.change(chat => { chat.messages.at(-1).text = '别处改过的正文' })
  h.agent.phase.kind = 'idle'
  assert.equal(await h.editor.flushQueued(h.session.id), 0)
  assert.equal(h.editor.queuedCount(h.session.id), 0)
  assert.equal(h.chat.messages.at(-1).text, '别处改过的正文')
})

test('editing the same row twice while it runs keeps the last text only', async () => {
  const h = fixture()
  const edit = await h.editor.read(h.session.id)
  h.agent.phase.kind = 'running'
  await h.editor.save(h.session.id, { token: edit.token, texts: ['第一次'] })
  await h.editor.save(h.session.id, { token: edit.token, texts: ['第二次'] })
  assert.equal(h.editor.queuedCount(h.session.id), 1)
  h.agent.phase.kind = 'idle'
  assert.equal(await h.editor.flushQueued(h.session.id), 1)
  assert.equal(h.chat.messages.at(-1).text, '第二次')
})

test('a queued player-input edit rewrites the model surface when the turn ends', async () => {
  const session = Session.create('body-edit-queue-user')
  appendSessionEvent(session, 'turn/start', { turn: 5 })
  appendSessionEvent(session, 'user/message', { id: 'u5', role: 'user', content: [{ type: 'text', text: '原输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 5, step: 1, message: { id: 'a5', role: 'assistant', content: [{ type: 'text', text: '旧回复' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn: 5, reason: { kind: 'completed' } })
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text: '原输入' }, { role: 'assistant', turn: 5, native: { turn: 5 }, text: '旧回复' }] }
  const agent = { session, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision += 1; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async text => projectReplyLayers(text), present: async value => value
  })
  const edit = await editor.readUser(session.id)
  agent.phase.kind = 'running'
  const queued = await editor.saveUser(session.id, { token: edit.token, texts: ['排队后的输入'] })
  assert.equal(queued.queued, true)
  assert.equal(chat.messages[0].text, '原输入')
  agent.phase.kind = 'idle'
  assert.equal(await editor.flushQueued(session.id), 1)
  assert.equal(chat.messages[0].text, '排队后的输入')
  assert.deepEqual(session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['排队后的输入'])
})

test('the applied hook fires once per flush, and repeating a row keeps one entry', async () => {
  const h = fixture()
  const applied = []
  const editor = createBodyEditor({ ...h.options, queuedEditApplied: async sessionId => { applied.push(sessionId) } })
  const edit = await editor.read(h.session.id)
  h.agent.phase.kind = 'running'
  for (let index = 0; index < 12; index += 1) await editor.save(h.session.id, { token: edit.token, texts: ['第' + index + '次'] })
  assert.equal(editor.queuedCount(h.session.id), 1)
  h.agent.phase.kind = 'idle'
  assert.equal(await editor.flushQueued(h.session.id), 1)
  assert.deepEqual(applied, [h.session.id])
  assert.equal(h.chat.messages.at(-1).text, '第11次')
  // Nothing left: a second flush is a no-op and must not fire the hook again.
  assert.equal(await editor.flushQueued(h.session.id), 0)
  assert.deepEqual(applied, [h.session.id])
})
