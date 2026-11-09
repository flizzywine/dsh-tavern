import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { createMessageDeletion, synchronizeMessageDeletion } from '../tavern-plugin/lib/domain/message-deletion.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createConversationPageStore } from '../tavern-plugin/lib/domain/conversation-page-store.js'
import { createConversationState } from '../tavern-plugin/lib/domain/conversation-state.js'

const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
function fixture() {
  const session = Session.create('message-delete-' + Math.random().toString(36).slice(2))
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1,
    tavernHelperLifecycleRevision: 7, messages: [], nativeCommits: {}, userInputEdits: {}, candidates: null }
  const selectors = {}
  for (const turn of [2, 3, 4]) {
    appendSessionEvent(session, 'turn/start', { turn })
    const input = appendSessionEvent(session, 'user/message', { id: 'in-' + turn, role: 'user', content: [{ type: 'text', text: '输入' + turn }], source: { kind: 'user', rpcId: 'request-' + turn } }, { surfaceOp: 'append' })
    const reply = appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'out-' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
    const nativeAnchor = { formatVersion: 4, turn, input: input.seq, reply: reply.seq }
    chat.messages.push({ role: 'user', text: '输入' + turn }, { role: 'assistant', turn, text: '正文' + turn, nativeAnchor })
    chat.nativeCommits[turn] = { turn, userText: '输入' + turn }
    chat.userInputEdits[turn] = { text: '输入' + turn, id: 'edit-' + turn, seq: input.seq, role: 'user' }
    selectors['u' + turn] = { role: 'user', turn, seq: input.seq }
    selectors['a' + turn] = { role: 'assistant', turn, storyTurn: turn, seq: reply.seq, messageId: 'out-' + turn }
  }
  chat.candidates = { messageId: 'out-3', choices: [{ type: 'action', text: '旧候选' }] }
  const calls = []
  const agent = { session, phase: { kind: 'idle', lastTurn: 4 } }
  const options = {
    chats: {
      forSession: async () => structuredClone(chat),
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
    sessions: { get: () => agent, flush: async () => { calls.push('flush') } },
    activity: () => ({ busy: false }),
    view: async () => structuredClone(chat)
  }
  return { session, agent, selectors, options, calls,
    create: () => createMessageDeletion(options),
    get chat() { return chat },
    set chat(value) { chat = value } }
}

test('compaction 覆盖的 Chat 行只删存档并记录上下文修复，不伪造 tombstone', async () => {
  const h = fixture(), nodes = h.session.surface.nodes.slice()
  const summary = replaceSessionSurface(h.session, 'user/message', { id: 'summary', role: 'user', content: [{ type: 'text', text: '摘要' }], source: { kind: 'plugin', plugin: 'compact' } },
    { start: nodes[0], end: nodes[1], sourceEventSeqs: nodes.slice(0, 2) })
  const beforeEvents = sessionEvents(h.session).length
  const result = await h.create().remove({ sessionId: h.session.id, items: [h.selectors.a2] })
  assert.equal(result.deletedCount, 1)
  assert.equal(h.chat.messageDeletion.surface.operations.length, 0)
  assert.equal(h.chat.messageDeletion.contextRepair.required, true)
  assert.equal(h.chat.messageDeletion.contextRepair.items[0].role, 'assistant')
  assert.equal(h.chat.nativeSync.status, 'stale')
  assert.equal(h.chat.nativeSync.deletionId, h.chat.messageDeletion.id)
  assert.match(h.chat.nativeSync.reason, /仍需后续上下文修复/)
  assert.equal(sessionEvents(h.session).length, beforeEvents)
  assert.ok(h.session.surface.nodes.includes(summary.seq))
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '输入3', '正文3', '输入4', '正文4'])
})

test('迁移后立即删除并重开仍保留物理 splice、来源 messageUid 与完成审计', async t => {
  const root = await mkdtemp(join(tmpdir(), 'message-delete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = fixture()
  h.chat.messages[5].variables = [{ stat_data: { gold: 44 }, schema: {} }]
  h.chat.posture = '保留姿态'
  const legacy = createChatJournalStore({ dataRoot: root })
  await legacy.update('chat', () => structuredClone(h.chat))
  await legacy.upgradeStorage('chat')
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const initial = await persistence.read('chat')
  assert.equal(initial.messages[5].messageUid, undefined, '迁移保持旧 Chat 行原样')
  const domain = createConversationState({ store: createConversationPageStore({ root: join(root, 'chats') }) })
  const sourceUid = (await domain.open('chat')).state.worldMessageUid
  assert.ok(sourceUid)
  h.options.chats = { forSession: async () => persistence.read('chat'), update: persistence.update }
  const result = await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, h.selectors.a4] })
  assert.equal(result.deletedCount, 2)
  const reopened = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const saved = await reopened.read('chat')
  assert.deepEqual(saved.messages.map(row => row.text), ['正文2', '输入3', '正文3', '输入4'])
  assert.ok(saved.messages.every(row => typeof row.messageUid === 'string' && row.messageUid))
  assert.equal(saved.messageDeletion.status, 'synchronized')
  assert.equal(saved.messageDeletion.deletedCount, 2)
  assert.equal(saved.tavernHelperLifecycleRevision, 8)
  assert.equal(saved.nativeSync, undefined)
  assert.deepEqual(await domain.readWorld('chat'), { variables: { stat_data: { gold: 44 }, schema: {} }, posture: '保留姿态' },
    '删除最新变量所在 AI 及其同步状态写都不能回滚当前 world')
  const head = await domain.open('chat')
  assert.equal(head.state.worldMessage, null)
  assert.equal(head.state.worldMessageUid, sourceUid, '来源行删除后仍保留永久 UID')
  assert.equal(head.state.worldSwipe, 0)
})

test('连续删除不会清空已脱离来源行的世界与 UID', async t => {
  const root = await mkdtemp(join(tmpdir(), 'message-delete-twice-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = fixture()
  h.chat.messages[5].variables = [{ stat_data: { gold: 44 }, schema: {} }]
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const initial = await persistence.write({ ...h.chat, _storageRevision: 0 })
  const sourceUid = initial.messages[5].messageUid
  h.options.chats = { forSession: async () => persistence.read('chat'), update: persistence.update }
  const deletion = h.create()
  await deletion.remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 5, revision: initial._storageRevision }] })
  const afterFirst = await persistence.read('chat')
  await deletion.remove({ sessionId: h.session.id, items: [{ role: 'user', messageIndex: 0, revision: afterFirst._storageRevision }] })
  const domain = createConversationState({ store: createConversationPageStore({ root: join(root, 'chats') }) })
  let head = await domain.open('chat')
  assert.equal(head.state.worldMessage, null)
  assert.equal(head.state.worldMessageUid, sourceUid)
  assert.equal(head.state.world.variables.stat_data.gold, 44)
  const rolledBack = await persistence.read('chat')
  rolledBack.messages = []
  await persistence.write(rolledBack)
  head = await domain.open('chat')
  assert.equal(head.state.worldMessage, null)
  assert.equal(head.state.worldMessageUid, null, '显式结构回退仍可清空脱离来源的世界')
  assert.deepEqual(head.state.world.variables, {})
})

test('flush 失败时 Chat 已删除且保留可恢复审计，重试同步不追加', async () => {
  const h = fixture()
  h.options.sessions.flush = async () => { throw new Error('disk full') }
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] }), /disk full/)
  assert.equal(h.chat.messageDeletion.status, 'surface-pending')
  assert.equal(h.chat.messageDeletion.surfaceError, 'disk full')
  assert.equal(h.chat.nativeSync.status, 'stale')
  assert.equal(h.chat.nativeSync.deletionId, h.chat.messageDeletion.id)
  assert.equal(h.chat.messages.some(row => row.text === '输入2'), false)
  const count = sessionEvents(h.session).length
  await synchronizeMessageDeletion(h.session, h.chat, async () => {})
  assert.equal(sessionEvents(h.session).length, count)
})

test('运行中会话与并发删除均被写锁挡在提交前', async () => {
  const h = fixture(), before = structuredClone(h.chat)
  h.agent.phase.kind = 'running'
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] }), /等待/)
  assert.deepEqual(h.chat, before)
  assert.equal(h.calls.length, 0)
})

test('同会话并发删除共享写锁，第二次不会另起 Chat 或 Surface 提交', async () => {
  const h = fixture(), read = h.options.chats.forSession
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  h.options.chats.forSession = async id => { entered(); await gate; return read(id) }
  const deletion = h.create(), first = deletion.remove({ sessionId: h.session.id, items: [h.selectors.u2] })
  await started
  await assert.rejects(deletion.remove({ sessionId: h.session.id, items: [h.selectors.a3] }), /正在删除/)
  release()
  await first
  assert.equal(h.calls.filter(call => call === 'foreground.message-delete').length, 1)
  assert.equal(h.chat.messageDeletion.deletedCount, 1)
})

test('故事直选无 nativeAnchor 且会话不支持预演时仍只删 Chat 并记录上下文修复', async () => {
  const h = fixture()
  delete h.chat.messages[3].nativeAnchor
  const originalConstructor = h.agent.session.constructor
  Object.defineProperty(h.agent.session, 'constructor', { value: {}, configurable: true })
  try {
    const nodes = h.session.surface.nodes.slice(), events = sessionEvents(h.session).length
    const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: h.chat._storageRevision }] })
    assert.equal(result.deletedCount, 1)
    assert.equal(h.chat.messageDeletion.surface.operations.length, 0)
    assert.equal(h.chat.messageDeletion.contextRepair.required, true)
    assert.equal(h.chat.nativeSync.status, 'stale')
    assert.match(h.chat.nativeSync.reason, /仍需后续上下文修复/)
    assert.equal(sessionEvents(h.session).length, events)
    assert.deepEqual(h.session.surface.nodes, nodes)
    assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
  } finally {
    Object.defineProperty(h.agent.session, 'constructor', { value: originalConstructor, configurable: true })
  }
})
