import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor } from '../tavern-plugin/lib/domain/body-editor.js'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { locateUserInputFloor, userInputEditsOf } from '../tavern-plugin/lib/domain/input-floor.js'

function fixture(text = '原输入') {
  const session = Session.create('user-input-edit')
  appendSessionEvent(session, 'turn/start', { turn: 5 })
  appendSessionEvent(session, 'user/message', { id: 'u5', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'r5' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 5, step: 1, message: { id: 'a5', role: 'assistant', content: [{ type: 'text', text: '旧回复' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn: 5, reason: { kind: 'completed' } })
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text }, { role: 'assistant', turn: 5, native: { turn: 5 }, text: '旧回复' }] }
  const agent = { get session() { return session }, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value
  })
  return { session, editor, get chat() { return chat }, set chat(value) { chat = value } }
}

test('玩家输入按回合定位，编辑后模型上下文和存档文字一起更新', async () => {
  const h = fixture()
  assert.equal(locateUserInputFloor(h.session, 5)?.seq, 1)
  const edit = await h.editor.readUser(h.session.id)
  assert.equal(edit.role, 'user')
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '原输入' }])
  const saved = await h.editor.saveUser(h.session.id, { token: edit.token, texts: ['改过的输入'] })
  assert.equal(saved.messages[0].text, '改过的输入')
  assert.equal(saved.messages[0].bodyEdit.role, 'user')
  assert.deepEqual(userInputEditsOf(saved), { 5: '改过的输入' })
  assert.deepEqual(h.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['改过的输入'])
  // 再次编辑写入的是上一次的替换副本，仍然找得到
  const second = await h.editor.readUser(h.session.id)
  assert.deepEqual(second.parts, [{ kind: 'text', text: '改过的输入' }])
  await h.editor.saveUser(h.session.id, { token: second.token, texts: ['再改一次'] })
  assert.deepEqual(h.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['再改一次'])
})

test('过期的令牌与空输入拒绝写入；运行中的回合可读，保存排队到回合结束', async () => {
  const h = fixture(), edit = await h.editor.readUser(h.session.id), before = structuredClone(h.chat)
  await assert.rejects(h.editor.saveUser(h.session.id, { token: 'stale', texts: ['新'] }), /重新打开/)
  await assert.rejects(h.editor.saveUser(h.session.id, { token: edit.token, texts: [''] }), /不能为空/)
  const agent = { get session() { return h.session }, phase: { kind: 'running' } }
  let queuedChat = h.chat
  const busyEditor = createBodyEditor({
    chats: { forSession: async () => structuredClone(queuedChat), update: async (_id, fn) => { queuedChat = fn(structuredClone(queuedChat)); queuedChat._storageRevision++; return structuredClone(queuedChat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value
  })
  const duringRun = await busyEditor.readUser(h.session.id)
  assert.deepEqual(duringRun.parts, [{ kind: 'text', text: '原输入' }])
  assert.equal(duringRun.token, edit.token)
  const queued = await busyEditor.saveUser(h.session.id, { token: duringRun.token, texts: ['排队后的输入'] })
  assert.equal(queued.queued, true)
  assert.equal(busyEditor.queuedCount(h.session.id), 1)
  assert.equal(queuedChat.messages[0].text, '原输入')
  agent.phase.kind = 'idle'
  assert.equal(await busyEditor.flushQueued(h.session.id), 1)
  assert.equal(queuedChat.messages[0].text, '排队后的输入')
  assert.deepEqual(h.chat, before)
})

// 故事列表按位置编辑玩家输入：messageIndex 选行，turn 缺失/重复都不影响定位；
// 原生楼层只在正文一致时同步，否则保存存档后交给原生修复。
function storyUserFixture() {
  const session = Session.create('story-user-edit')
  const add = (turn, text) => {
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  }
  add(5, '原输入')
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    messages: [{ role: 'user', text: '原输入' }, { role: 'assistant', turn: 5, text: '回复' }] }
  const agent = { get session() { return session }, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value,
  })
  return { session, editor, get chat() { return chat }, setMessages(rows) { chat = { ...chat, messages: rows } },
    inputs() { return session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text) } }
}

test('故事直选：陈旧 revision、越界、role 不符与过期 token 都拒绝写入', async () => {
  const h = storyUserFixture(), before = structuredClone(h.chat)
  await assert.rejects(h.editor.readUser(h.session.id, { messageIndex: 0, revision: 7 }), /重新打开编辑/)
  await assert.rejects(h.editor.readUser(h.session.id, { messageIndex: 9, revision: 1 }), /刷新/)
  await assert.rejects(h.editor.readUser(h.session.id, { messageIndex: 1, revision: 1 }), /已变化/)
  await assert.rejects(h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1, role: 'assistant' }), /已变化/)
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1 })
  await assert.rejects(h.editor.saveUser(h.session.id, { token: 'stale', messageIndex: 0, revision: 1, role: 'user', texts: ['新'] }), /重新打开编辑/)
  await assert.rejects(h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 0, revision: 1, role: 'user', texts: [''] }), /不能为空/)
  assert.deepEqual(h.chat, before)
  // 存档计数/版本推进不再作废面板 token：行正文没变就照常写入。
  const bumped = await h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 0, revision: 3, role: 'user', texts: ['新'] })
  assert.equal(bumped.messages[0].text, '新')
})
