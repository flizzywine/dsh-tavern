import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor, synchronizeBodyEdits } from '../tavern-plugin/lib/domain/body-editor.js'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { latestUserInputFloor, locateUserInputFloor, userInputEditsOf } from '../tavern-plugin/lib/domain/input-floor.js'
import { legacyMessageUid } from '../tavern-plugin/lib/domain/message-uid.js'

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

test('原生回合输入编辑不被无关 Chat revision 写入作废', async () => {
  const h = fixture()
  const edit = await h.editor.readUser(h.session.id)
  h.chat.playerName = '后台改名'
  h.chat.displayRuntime = { turn: 5, receipt: 'cache' }
  h.chat._storageRevision++
  const saved = await h.editor.saveUser(h.session.id, { ...edit, texts: ['无关写入后保存'] })
  assert.equal(saved.messages[0].text, '无关写入后保存')
  assert.equal(saved.playerName, '后台改名')
})

test('过期的令牌、空输入和运行中的回合都拒绝写入', async () => {
  const h = fixture(), edit = await h.editor.readUser(h.session.id), before = structuredClone(h.chat)
  await assert.rejects(h.editor.saveUser(h.session.id, { token: 'stale', texts: ['新'] }), /重新打开/)
  await assert.rejects(h.editor.saveUser(h.session.id, { token: edit.token, texts: [''] }), /不能为空/)
  const agent = { get session() { return h.session }, phase: { kind: 'running' } }
  const busyEditor = createBodyEditor({
    chats: { forSession: async () => structuredClone(h.chat), update: async () => { throw new Error('不该写入') } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value
  })
  await assert.rejects(busyEditor.readUser(h.session.id), /等待/)
  assert.deepEqual(h.chat, before)
})

test('刷新或迁移丢了替换副本时，标记会按回合把文字补回模型上下文', async () => {
  const h = fixture()
  h.chat = { ...h.chat, messages: [{ role: 'user', text: '编辑后', bodyEdit: { id: 'tavern-user-edit:lost', seq: 1, turn: 5, role: 'user' } }, h.chat.messages[1]] }
  await synchronizeBodyEdits(h.session, h.chat, async () => {})
  assert.deepEqual(h.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['编辑后'])
  assert.equal(sessionEvents(h.session).filter(event => event.type === 'user/message').length, 2)
})

test('替换后的输入可能落在编辑回合里，最新楼层定位仍能找回它', async () => {
  const h = fixture()
  const edit = await h.editor.readUser(h.session.id)
  await h.editor.saveUser(h.session.id, { token: edit.token, texts: ['替换后的输入'] })
  const latest = latestUserInputFloor(h.session)
  assert.ok(latest)
  assert.equal(latest.event.type, 'user/message')
  assert.equal(latest.event.data.content[0].text, '替换后的输入')
  assert.equal(latestUserInputFloor(h.session).seq, latest.seq)
})

function twoTurnFixture() {
  const session = Session.create('user-input-turns')
  for (const [turn, text] of [[2, '第一条输入'], [6, '生成视频']]) {
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'r' + turn } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  }
  // The newest input (turn 6) never reached Chat: it is a failed/pending turn.
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    messages: [{ role: 'user', text: '第一条输入' }, { role: 'assistant', turn: 2, native: { turn: 2 }, text: '回复2' }] }
  const agent = { get session() { return session }, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value
  })
  return { editor, session, get chat() { return chat } }
}

test('指定回合时读的是点击的那条输入，不是最后一条已提交的输入', async () => {
  const h = twoTurnFixture()
  const first = await h.editor.readUser(h.session.id, { turn: 2 })
  assert.deepEqual(first.parts, [{ kind: 'text', text: '第一条输入' }])
  const pending = await h.editor.readUser(h.session.id, { turn: 6 })
  assert.deepEqual(pending.parts, [{ kind: 'text', text: '生成视频' }])
})

test('还没进 Chat 的输入只写表头编辑记录，模型上下文同步替换', async () => {
  const h = twoTurnFixture()
  const edit = await h.editor.readUser(h.session.id, { turn: 6 })
  const saved = await h.editor.saveUser(h.session.id, { token: edit.token, turn: 6, texts: ['改成生成图片'] })
  assert.equal(saved.messages.length, 2)
  assert.deepEqual(saved.userInputEdits, { 6: { text: '改成生成图片', id: saved.userInputEdits[6].id, seq: saved.userInputEdits[6].seq, role: 'user' } })
  assert.deepEqual(userInputEditsOf(saved), { 6: '改成生成图片' })
  assert.deepEqual(h.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['第一条输入', '改成生成图片'])
  // 再编辑同一回合时，沿着替换链找到最新副本
  const again = await h.editor.readUser(h.session.id, { turn: 6 })
  assert.deepEqual(again.parts, [{ kind: 'text', text: '改成生成图片' }])
  await h.editor.saveUser(h.session.id, { token: again.token, turn: 6, texts: ['再改成生成音频'] })
  assert.deepEqual(h.session.deriveMessages().filter(message => message.role === 'user').map(message => message.content[0].text), ['第一条输入', '再改成生成音频'])
})

test('失败轮输入即使已移出模型上下文，编辑也只写表头记录，模型上下文不动', async () => {
  const session = Session.create('user-input-failed')
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '第一条输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '回复' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  appendSessionEvent(session, 'turn/start', { turn: 6 })
  appendSessionEvent(session, 'user/message', { id: 'u6', role: 'user', content: [{ type: 'text', text: '生成视频' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 6, step: 1, message: { id: 'a6', role: 'assistant', content: [{ type: 'text', text: '失败' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn: 6, reason: { kind: 'error' } })
  // The failed-turn cleanup replaces the input and reply with an empty plugin row.
  const failedInput = sessionEvents(session).find(event => event.data?.id === 'u6').seq
  replaceSessionSurface(session, 'user/message', { id: 'cleanup', role: 'user', content: [], source: { kind: 'plugin:dsh-tavern-failed-turn-cleanup' } },
    { start: failedInput, end: failedInput, sourceEventSeqs: [failedInput] })
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    messages: [{ role: 'user', text: '第一条输入' }, { role: 'assistant', turn: 2, native: { turn: 2 }, text: '回复' }] }
  const agent = { get session() { return session }, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    activity: () => ({ busy: false }), project: async () => ({}), present: async value => value
  })
  const edit = await editor.readUser(session.id, { turn: 6, seq: failedInput })
  assert.equal(edit.failed, true)
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '生成视频' }])
  const saved = await editor.saveUser(session.id, { token: edit.token, turn: 6, seq: failedInput, texts: ['改成生成图片'] })
  assert.equal(saved.userInputEdits['6'].text, '改成生成图片')
  assert.deepEqual(userInputEditsOf(saved), { 6: '改成生成图片' })
  assert.equal(chat.messages.length, 2)
  const again = await editor.readUser(session.id, { turn: 6, seq: failedInput })
  assert.deepEqual(again.parts, [{ kind: 'text', text: '改成生成图片' }])
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

test('故事直选：按 messageIndex 编辑玩家输入，多余回合不影响定位', async () => {
  const h = storyUserFixture()
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1 })
  assert.equal(edit.messageIndex, 0)
  assert.equal(edit.revision, 1)
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '原输入' }])
  const saved = await h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 0, revision: 1, role: 'user', texts: ['改过的输入'] })
  assert.equal(saved.messages[0].text, '改过的输入')
  assert.equal(saved.messages[1].text, '回复')
  assert.deepEqual(h.inputs(), ['改过的输入'])
})

test('故事直选：UID 输入编辑不被无关 revision 与结算写入作废', async () => {
  const h = storyUserFixture()
  const messageUid = legacyMessageUid(h.chat.messages[0], 0)
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1, messageUid })
  assert.equal(edit.messageUid, messageUid)
  h.chat.playerName = '后台改名'
  h.chat.variables = { hp: 42 }
  h.chat._storageRevision++
  const saved = await h.editor.saveUser(h.session.id, { ...edit, texts: ['无关写入后仍可编辑输入'] })
  assert.equal(saved.messages[0].text, '无关写入后仍可编辑输入')
  assert.equal(saved.playerName, '后台改名')
  assert.deepEqual(h.inputs(), ['无关写入后仍可编辑输入'])
})

test('故事直选：旧 sourceText 不覆盖玩家当前 text 或编辑后的再次读取', async () => {
  const h = storyUserFixture()
  h.setMessages([{ role: 'user', turn: 2, text: '当前输入', sourceText: '旧输入' }, { role: 'assistant', turn: 2, text: '回复' }])
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1 })
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '当前输入' }])
  const saved = await h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 0, revision: 1, role: 'user', texts: ['改后的当前输入'] })
  assert.equal(saved.messages[0].text, '改后的当前输入')
  assert.equal(saved.messages[0].sourceText, '旧输入', '兼容字段无需迁移或重写')
  const reopened = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: saved._storageRevision })
  assert.deepEqual(reopened.parts, [{ kind: 'text', text: '改后的当前输入' }])
})

test('故事直选：缺 turn 的玩家行只写存档', async () => {
  const h = storyUserFixture()
  h.setMessages([{ role: 'user', text: '无回合输入' }, { role: 'assistant', text: '回复' }])
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 0, revision: 1 })
  assert.equal(edit.turn, 0)
  await h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 0, revision: 1, role: 'user', texts: ['改成无回合'] })
  assert.equal(h.chat.messages[0].text, '改成无回合')
})

test('故事直选：重复 turn 的玩家行按位置改写，不按回合串行', async () => {
  const h = storyUserFixture()
  h.setMessages([{ role: 'user', turn: 5, text: '第一条' }, { role: 'assistant', turn: 5, text: '回复' },
    { role: 'user', turn: 5, text: '第二条' }, { role: 'assistant', turn: 5, text: '回复' }])
  const edit = await h.editor.readUser(h.session.id, { messageIndex: 2, revision: 1 })
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '第二条' }])
  const saved = await h.editor.saveUser(h.session.id, { token: edit.token, messageIndex: 2, revision: 1, role: 'user', texts: ['改写第二条'] })
  assert.equal(saved.messages[2].text, '改写第二条')
  assert.equal(saved.messages[0].text, '第一条')
})

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
