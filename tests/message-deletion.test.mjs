import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { createMessageDeletion, normalizeMessageDeletionSelectors, synchronizeMessageDeletion } from '../tavern-plugin/lib/domain/message-deletion.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'
import { uncommittedRounds } from '../tavern-plugin/lib/domain/uncommitted-rounds.js'
import { planTranscriptRows } from '../tavern-plugin/lib/domain/transcript-row-plan.js'
import { replaceLastRound } from '../tavern-plugin/lib/domain/last-round-replacement.js'
import { recordNativeSurfaceRepair, repairNativeSurface } from '../tavern-plugin/lib/domain/native-surface-repair.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createConversationPageStore } from '../tavern-plugin/lib/domain/conversation-page-store.js'
import { createConversationState } from '../tavern-plugin/lib/domain/conversation-state.js'
import { legacyMessageUid } from '../tavern-plugin/lib/domain/message-uid.js'

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
function nodeRows(session) {
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  return session.surface.nodes.map(seq => ({ seq, event: bySeq.get(seq) }))
}
function nodeTexts(session) {
  return nodeRows(session).map(({ event }) => (event?.data?.message?.content || event?.data?.content || []).map(block => block.text || '').join(''))
}

test('单删 user：重复 selector 去重，保留同轮 AI、后续 turn 和后续编辑映射', async () => {
  const h = fixture()
  const result = await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, h.selectors.u2] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => [row.role, row.turn || null, row.text]), [
    ['assistant', 2, '正文2'], ['user', null, '输入3'], ['assistant', 3, '正文3'], ['user', null, '输入4'], ['assistant', 4, '正文4']
  ])
  assert.equal(h.chat.userInputEdits['2'], undefined)
  assert.equal(h.chat.userInputEdits['3'].text, '输入3')
  assert.equal(h.chat.nativeCommits['2'].turn, 2, '提交屏障必须保留，防止对账复活已删输入')
  assert.deepEqual(uncommittedRounds(h.session, h.chat), [])
  assert.equal(h.chat.tavernHelperLifecycleRevision, 8)
  assert.ok(h.chat.messages.every(row => typeof row.messageUid === 'string' && row.messageUid))
  assert.equal(h.chat.messageDeletion.items[0].messageUid, result.chat.messageDeletion.items[0].messageUid)
  assert.equal(h.chat.messageDeletion.status, 'synchronized')
  assert.equal(h.chat.nativeSync, undefined)
  assert.deepEqual(nodeTexts(h.session), ['', '正文2', '输入3', '正文3', '输入4', '正文4'])
  assert.equal(h.calls.filter(call => call === 'foreground.message-delete').length, 1)
})

test('删除 greeting 的配对输入时给保留开场写 openingInputDeleted', async () => {
  const h = fixture()
  h.chat.messages[1].greeting = true
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] })
  assert.equal(h.chat.messages[0].greeting, true)
  assert.equal(h.chat.messages[0].openingInputDeleted, true)
  assert.equal(h.chat.messages[2].openingInputDeleted, undefined)
})

test('删除 tombstone 使用 v4 接受的 producer-owned source kind', async () => {
  const h = fixture()
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] })
  const source = h.chat.messageDeletion.surface.operations[0].data.source
  assert.equal(source.kind, 'plugin:dsh-tavern')
  assert.equal(source.form, 'message-deletion')
  assert.notEqual(source.kind, 'plugin', 'v4 已淘汰裸 plugin 包装')
})

test('单删 AI：Helper 数字 id 可用，保留 user 补 storyTurn、清理 candidates，未选节点不动', async () => {
  const h = fixture(), userSeq = h.selectors.u3.seq
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ ...h.selectors.a3, messageId: 3 }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
  assert.equal(h.chat.messages[2].turn, 3)
  assert.equal(h.chat.candidates, null)
  assert.equal(h.chat.userInputEdits['3'].text, '输入3', 'AI 删除不擦掉仍显示输入的编辑映射')
  assert.ok(h.session.surface.nodes.includes(userSeq))
  assert.deepEqual(nodeTexts(h.session), ['输入2', '正文2', '输入3', '', '输入4', '正文4'])
})

test('AI 正文只按 storyTurn/seq/messageId 删除，原生 turn 漂移不阻塞', async () => {
  const h = fixture()
  h.chat.messages[1].nativeAnchor.turn = 99
  const result = await h.create().remove({ sessionId: h.session.id, items: [{
    role: 'assistant', storyTurn: 2, seq: h.selectors.a2.seq, messageId: 'out-2'
  }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '输入3', '正文3', '输入4', '正文4'])
  assert.deepEqual(nodeTexts(h.session), ['输入2', '', '输入3', '正文3', '输入4', '正文4'])
})

test('无 nativeAnchor 的旧正文也不再用原生 turn 过滤', async () => {
  const h = fixture()
  delete h.chat.messages[1].nativeAnchor
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ ...h.selectors.a2, turn: 99 }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '输入3', '正文3', '输入4', '正文4'])
})

test('跨轮非连续批量删除按连续区段写 tombstone，所有未选 surface 节点保持原 seq', async () => {
  const h = fixture(), before = h.session.surface.nodes.slice()
  const selected = new Set([h.selectors.u2.seq, h.selectors.a4.seq])
  const result = await h.create().remove({ sessionId: h.session.id, items: [h.selectors.a4, h.selectors.u2] })
  assert.equal(result.deletedCount, 2)
  assert.equal(h.chat.messageDeletion.surface.operations.length, 2)
  const afterKept = nodeRows(h.session).filter(({ event }) => !event.data?.id?.startsWith('tavern-message-delete:')).map(row => row.seq)
  assert.deepEqual(afterKept, before.filter(seq => !selected.has(seq)))
  assert.deepEqual(h.chat.messages.map(row => row.text), ['正文2', '输入3', '正文3', '输入4'])
  assert.equal(h.chat.messages.at(-1).turn, 4, '被删 AI 的保留 user 记录 storyTurn')
})

test('任一 stale selector 整批拒绝：Chat、Surface、生命周期均无提交', async () => {
  const h = fixture(), before = structuredClone(h.chat), events = sessionEvents(h.session).slice(), nodes = h.session.surface.nodes.slice()
  const stale = { ...h.selectors.a4, seq: h.selectors.a3.seq }
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, stale] }), /不匹配|已经变化/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(sessionEvents(h.session), events)
  assert.deepEqual(h.session.surface.nodes, nodes)
  assert.equal(h.calls.length, 0)
})

test('预演后事务内 selector 失效同样整批不落删除、不写 Surface', async () => {
  const h = fixture(), update = h.options.chats.update, events = sessionEvents(h.session).length
  h.options.chats.update = async (id, mutate, metadata) => {
    if (metadata.source === 'foreground.message-delete') h.chat.messages[1].turn = 99
    return update(id, mutate, metadata)
  }
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, h.selectors.a2] }), /已经变化|不匹配/)
  assert.equal(h.chat.messageDeletion, undefined)
  assert.equal(h.chat.tavernHelperLifecycleRevision, 7)
  assert.equal(h.chat.messages.length, 6)
  assert.ok(h.chat.messages.every(row => row.messageUid === undefined))
  assert.equal(sessionEvents(h.session).length, events)
})

test('编辑后的 user/AI 仍按原始 seq 与当前 messageId 沿 replacement 链删除', async () => {
  const h = fixture()
  replaceSessionSurface(h.session, 'user/message', { id: 'edited-user', role: 'user', content: [{ type: 'text', text: '改过的输入2' }], source: { kind: 'user' } },
    { start: h.selectors.u2.seq, end: h.selectors.u2.seq, sourceEventSeqs: [h.selectors.u2.seq] })
  h.chat.messages[0].text = '改过的输入2'
  h.chat.messages[0].bodyEdit = { id: 'edited-user', role: 'user', turn: 2, seq: h.selectors.u2.seq }
  replaceSessionSurface(h.session, 'assistant/message', { turn: 2, step: 1, message: { id: 'edited-assistant', role: 'assistant', content: [{ type: 'text', text: '改过的正文2' }], source: model } },
    { start: h.selectors.a2.seq, end: h.selectors.a2.seq, sourceEventSeqs: [h.selectors.a2.seq] })
  h.chat.messages[1].text = '改过的正文2'
  const result = await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, { ...h.selectors.a2, messageId: 'edited-assistant' }] })
  assert.equal(result.deletedCount, 2)
  assert.equal(h.chat.messageDeletion.surface.operations.length, 1, '相邻的两个 replacement 合并为一个区段')
  assert.deepEqual(nodeTexts(h.session), ['', '输入3', '正文3', '输入4', '正文4'])
})

test('AI 编辑后 selector 仍带原始 messageId 时也定位当前 replacement，而非误判为已压缩', async () => {
  const h = fixture()
  replaceSessionSurface(h.session, 'assistant/message', { turn: 2, step: 1, message: { id: 'new-current-id', role: 'assistant', content: [{ type: 'text', text: '编辑正文' }], source: model } },
    { start: h.selectors.a2.seq, end: h.selectors.a2.seq, sourceEventSeqs: [h.selectors.a2.seq] })
  h.chat.messages[1].text = '编辑正文'
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.a2] })
  assert.equal(h.chat.messageDeletion.surface.operations.length, 1)
  assert.equal(h.chat.messageDeletion.surface.operations[0].start > h.selectors.a2.seq, true)
  assert.deepEqual(nodeTexts(h.session), ['输入2', '', '输入3', '正文3', '输入4', '正文4'])
})

test('连续多个 user 后单删 AI：整组保留输入都补同一个 storyTurn', async () => {
  const h = fixture()
  h.chat.messages.splice(3, 0, { role: 'user', text: '补充输入3' })
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.a3] })
  const retained = h.chat.messages.filter(row => row.text === '输入3' || row.text === '补充输入3')
  assert.equal(retained.length, 2)
  assert.deepEqual(retained.map(row => row.turn), [3, 3])
})

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

test('重载与重复同步复用 tombstone，不重复追加事件', async () => {
  const h = fixture()
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2, h.selectors.a4] })
  const count = sessionEvents(h.session).length
  await synchronizeMessageDeletion(h.session, h.chat, async () => {})
  assert.equal(sessionEvents(h.session).length, count)
  const restored = Session.fromRestore(h.session.id, structuredClone(sessionEvents(h.session)), structuredClone(h.session.header), h.session.inheritedEventCount, 'detached')
  const restoredCount = sessionEvents(restored).length // fromRestore may add its own end-seed sentinel
  await synchronizeMessageDeletion(restored, h.chat, async () => {})
  assert.equal(sessionEvents(restored).length, restoredCount)
  assert.deepEqual(restored.surface.nodes, h.session.surface.nodes)
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

test('真实 native 删除前置行后世界 UID 随来源行迁移', async t => {
  const root = await mkdtemp(join(tmpdir(), 'message-delete-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = fixture()
  h.chat.messages[3].variables = [{ stat_data: { gold: 33 }, schema: {} }]
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const initial = await persistence.write({ ...h.chat, _storageRevision: 0 })
  const sourceUid = initial.messages[3].messageUid
  h.options.chats = { forSession: async () => persistence.read('chat'), update: persistence.update }
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] })
  const saved = await persistence.read('chat')
  assert.equal(saved.messages[2].text, '正文3')
  assert.equal(saved.messages[2].messageUid, sourceUid)
  const domain = createConversationState({ store: createConversationPageStore({ root: join(root, 'chats') }) })
  const head = await domain.open('chat')
  assert.equal(head.state.worldMessage, 2)
  assert.equal(head.state.worldMessageUid, sourceUid)
  assert.equal(head.state.worldSwipe, 0)
  assert.equal(head.state.world.variables.stat_data.gold, 33)
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

test('来源删除后的正文编辑保留世界，后续新快照才接管', async t => {
  const root = await mkdtemp(join(tmpdir(), 'message-delete-edit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = fixture()
  h.chat.messages[5].variables = [{ stat_data: { gold: 44 }, schema: {} }]
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const initial = await persistence.write({ ...h.chat, _storageRevision: 0 })
  const sourceUid = initial.messages[5].messageUid
  h.options.chats = { forSession: async () => persistence.read('chat'), update: persistence.update }
  await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 5, revision: initial._storageRevision }] })
  const afterDelete = await persistence.read('chat')
  await persistence.patch('chat', afterDelete._storageRevision, [{ op: 'set', path: ['messages', 0, 'text'], value: '点写编辑正文2' }])
  const domain = createConversationState({ store: createConversationPageStore({ root: join(root, 'chats') }) })
  let head = await domain.open('chat')
  assert.equal(head.state.worldMessage, null)
  assert.equal(head.state.worldMessageUid, sourceUid)
  assert.equal(head.state.world.variables.stat_data.gold, 44)
  const edited = await persistence.read('chat')
  edited.messages[0].text = '整档编辑正文2'
  await persistence.write(edited)
  head = await domain.open('chat')
  assert.equal(head.state.worldMessage, null)
  assert.equal(head.state.worldMessageUid, sourceUid)
  assert.equal(head.state.world.variables.stat_data.gold, 44)
  edited.messages.push({ role: 'user', text: '新行动' }, { role: 'assistant', text: '新正文', variables: [{ stat_data: { gold: 55 }, schema: {} }] })
  const appended = await persistence.write(edited)
  head = await domain.open('chat')
  assert.equal(head.state.worldMessage, appended.messages.length - 1)
  assert.equal(head.state.worldMessageUid, appended.messages.at(-1).messageUid)
  assert.notEqual(head.state.worldMessageUid, sourceUid)
  assert.equal(head.state.world.variables.stat_data.gold, 55)
})

test('删除前面输入后，后续重新生成和原生对账不会擦掉前面 AI 正文', async () => {
  const h = fixture()
  await h.create().remove({ sessionId: h.session.id, items: [h.selectors.u2] })
  const originalChat = structuredClone(h.chat)
  const assistantIndex = originalChat.messages.length - 1
  const regeneratedChat = {
    ...originalChat,
    messages: [{ role: 'user', text: '输入4' }, { role: 'assistant', turn: 4, text: '重新生成的正文4', sourceText: '重新生成的正文4' }]
  }
  const candidateMessages = regeneratedChat.messages
  const merged = replaceLastRound({ originalChat, regeneratedChat, assistantIndex })
  assert.equal(regeneratedChat.messages, candidateMessages, '不改写调用方 draft 的 messages 属性')
  assert.equal(regeneratedChat.messages[1].text, '重新生成的正文4')
  assert.equal(merged.chat.messages[assistantIndex].messageUid, originalChat.messages[assistantIndex].messageUid)
  const outputText = merged.chat.messages[0].text
  merged.chat.messages[0].text = '输出侧修改'
  assert.notEqual(originalChat.messages[0].text, '输出侧修改', '返回历史仍与原始快照隔离')
  merged.chat.messages[0].text = outputText
  h.chat = merged.chat
  replaceSessionSurface(h.session, 'assistant/message', { turn: 4, step: 1,
    message: { id: 'regenerated-4', role: 'assistant', content: [{ type: 'text', text: '重新生成的正文4' }], source: { ...model, tavernStoryTurn: 4 } } },
  { start: h.selectors.a4.seq, end: h.selectors.a4.seq, sourceEventSeqs: [h.selectors.a4.seq] })
  const repaired = repairNativeSurface(h.session, h.chat, { repairId: 'after-delete-regen' })
  if (repaired.applied) recordNativeSurfaceRepair(h.chat, h.chat, repaired.anchors)
  assert.ok(h.chat.messages.some(row => row.role === 'assistant' && row.text === '正文2'), 'Chat 必须保留前面 AI')
  assert.ok(nodeTexts(h.session).includes('正文2'), '原生 Surface 必须保留前面 AI')
  const plan = planTranscriptRows({ chat: h.chat, events: sessionEvents(h.session) })
  assert.equal(plan['2'].input, 0)
  assert.equal(plan['2'].reply, 1, '行计划必须继续显示前面 AI')
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

test('deleteMessages RPC 固定返回 view/deletedCount 并走取消与通知流程', async () => {
  const calls = [], view = { chatId: 'chat' }
  const handlers = createPlayHandlers({
    str: String,
    autoChoices: { cancel: id => calls.push('cancel:' + id) },
    reconcileStory: async id => calls.push('reconcile:' + id),
    messageDeletion: { remove: async args => { calls.push(args); return { view, deletedCount: 2, chat: { ignored: true } } } },
    notifyPluginTimeline: (...args) => calls.push(args)
  })
  const result = await handlers.deleteMessages({ sessionId: 'session', items: [{ role: 'user', turn: 2, seq: 1 }] })
  assert.deepEqual(result, { view, deletedCount: 2 })
  assert.equal(calls[0], 'cancel:session')
  assert.equal(calls[1], 'reconcile:session')
  assert.equal(calls[2].items.length, 1)
  assert.deepEqual(calls[3], ['session', 'edit', { settled: true }])
})

test('故事直选 assistant：按 messageIndex+revision 定位 Chat 行并写原生 tombstone', async () => {
  const h = fixture(), revision = h.chat._storageRevision
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
  assert.deepEqual(nodeTexts(h.session), ['输入2', '正文2', '输入3', '', '输入4', '正文4'])
  assert.equal(h.chat.messageDeletion.surface.operations.length, 1)
  assert.equal(h.chat.messageDeletion.items[0].messageIndex, 3)
  assert.equal(h.chat.messageDeletion.items[0].revision, revision)
  assert.equal(typeof h.chat.messageDeletion.items[0].messageUid, 'string')
})

test('故事直选 user：自身无 nativeAnchor 时借用下一条正文锚点同步 Surface', async () => {
  const h = fixture()
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'user', messageIndex: 2, revision: h.chat._storageRevision }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '正文3', '输入4', '正文4'])
  assert.deepEqual(nodeTexts(h.session), ['输入2', '正文2', '', '正文3', '输入4', '正文4'])
  assert.equal(h.chat.userInputEdits[3], undefined, '直选 user 仍清理对应 turn 的编辑缓存')
})

test('故事直选不依赖 turn：缺失、重复、非单调都可删除', async () => {
  const h = fixture()
  delete h.chat.messages[1].turn // 正文 2 缺 turn
  h.chat.messages[3].turn = 9 // 正文 3 非单调
  h.chat.messages[5].turn = 3 // 正文 4 与 3 重复
  const revision = h.chat._storageRevision
  const result = await h.create().remove({ sessionId: h.session.id, items: [
    { role: 'assistant', messageIndex: 1, revision },
    { role: 'assistant', messageIndex: 5, revision }
  ] })
  assert.equal(result.deletedCount, 2)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '输入3', '正文3', '输入4'])
  assert.equal(h.chat.messageDeletion.items.length, 2)
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

test('故事直选带 messageUid 时，无关后台 revision 写入不让选中行过期', async () => {
  const h = fixture(), revision = h.chat._storageRevision
  const messageUid = legacyMessageUid(h.chat.messages[3], 3)
  h.chat.candidates = { messageId: 'background-candidate', choices: [] }
  h.chat._storageRevision += 1
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision, messageUid }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
})

test('持久 messageUid 在前置行变化后仍定位原正文，不误删原索引上的新消息', async () => {
  const h = fixture(), revision = h.chat._storageRevision
  h.chat.messages[3].messageUid = 'stable-reply-3'
  h.chat.messages.unshift({ role: 'user', text: '后来插入的输入' })
  h.chat._storageRevision += 1
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision, messageUid: 'stable-reply-3' }] })
  assert.equal(result.deletedCount, 1)
  assert.equal(h.chat.messages.some(row => row.text === '正文3'), false)
  assert.equal(h.chat.messages.some(row => row.text === '输入4'), true)
})

test('故事直选 revision 陈旧时报剧情已变化且不提交', async () => {
  const h = fixture(), before = structuredClone(h.chat)
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: h.chat._storageRevision - 1 }] }), /剧情已变化，请刷新后重试/)
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [{ role: 'user', messageIndex: 3, revision: h.chat._storageRevision }] }), /剧情已变化，请刷新后重试/)
  assert.deepEqual(h.chat, before)
  assert.equal(h.calls.length, 0)
})

test('故事直选选择器保留渲染正文与 swipe，不带时结构逐字不变', () => {
  const [withText] = normalizeMessageDeletionSelectors([{ role: 'assistant', messageIndex: 3, revision: 1, text: '正文3', swipe: 0 }])
  assert.deepEqual(withText, { role: 'assistant', messageIndex: 3, revision: 1, text: '正文3', swipe: 0 })
  const [plain] = normalizeMessageDeletionSelectors([{ role: 'assistant', messageIndex: 3, revision: 1 }])
  assert.deepEqual(plain, { role: 'assistant', messageIndex: 3, revision: 1 })
  assert.equal('text' in plain, false, '旧客户端选择器不多出字段')
})

test('故事直选无 UID：无关后台写入不让选中行过期', async () => {
  const h = fixture()
  h.chat.candidates = { messageId: 'out-4', choices: [{ type: 'action', text: '新候选' }] }
  h.chat._storageRevision += 1
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: 1, text: '正文3' }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
})

test('故事直选无 UID 且同位置正文不同时整批拒绝', async () => {
  const h = fixture(), before = structuredClone(h.chat)
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: 1, text: '别人改过的正文' }] }), /剧情已变化，请刷新后重试/)
  assert.deepEqual(h.chat, before)
  assert.equal(h.calls.length, 0)
})

test('故事直选无 UID 且 swipe 不同时拒绝', async () => {
  const h = fixture()
  h.chat.messages[3].swipeId = 0
  const before = structuredClone(h.chat)
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: 1, text: '正文3', swipe: 1 }] }), /剧情已变化，请刷新后重试/)
  assert.deepEqual(h.chat, before)
})

test('预演后 revision 变化同样整批拒绝，不落任何 Chat 或 Surface 写入', async () => {
  const h = fixture(), update = h.options.chats.update
  const events = sessionEvents(h.session).length
  h.options.chats.update = async (id, mutate, metadata) => {
    if (metadata.source === 'foreground.message-delete') h.chat._storageRevision += 1
    return update(id, mutate, metadata)
  }
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: h.chat._storageRevision }] }), /剧情已变化/)
  assert.equal(h.chat.messageDeletion, undefined)
  assert.equal(h.chat.messages.length, 6)
  assert.equal(h.chat.tavernHelperLifecycleRevision, 7)
  assert.equal(sessionEvents(h.session).length, events)
})

test('故事直选没有原生 Session 也能删除 Chat，旧 selector 仍要求原生上下文', async () => {
  const h = fixture(), events = sessionEvents(h.session), before = events.length
  h.options.sessions.get = () => undefined
  const result = await h.create().remove({ sessionId: h.session.id, items: [{ role: 'assistant', messageIndex: 3, revision: h.chat._storageRevision }] })
  assert.equal(result.deletedCount, 1)
  assert.deepEqual(h.chat.messages.map(row => row.text), ['输入2', '正文2', '输入3', '输入4', '正文4'])
  assert.equal(h.chat.messageDeletion.contextRepair.required, true)
  assert.equal(h.chat.nativeSync.status, 'stale')
  assert.equal(sessionEvents(h.session).length, before)
  assert.deepEqual(sessionEvents(h.session), events)
  await assert.rejects(h.create().remove({ sessionId: h.session.id, items: [h.selectors.a2] }), /无法访问原生会话/)
})
