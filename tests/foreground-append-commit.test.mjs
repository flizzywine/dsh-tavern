import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createSessionSliceReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { replyProseProblems } from '../tavern-plugin/lib/domain/reply-prose.js'

function history(count, variablesAt) {
  const messages = []
  for (let turn = 1; turn <= count; turn++) {
    messages.push({ role: 'user', text: '行动 ' + turn, turn })
    messages.push({ role: 'assistant', text: '正文 ' + turn, turn, swipeId: 0, swipes: ['正文 ' + turn],
      ...(variablesAt(turn) ? { variables: [{ stat_data: { hp: turn }, schema: {} }] } : {}) })
  }
  return messages
}

// Two identical chats: one commits through the append patch, the other through
// the complete-chat update. Every stored field except timestamps must agree.
async function app(t, chat, scoped, template = false) {
  const root = await mkdtemp(join(tmpdir(), 'foreground-append-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let clock = 1000, ids = 0
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }), now: () => clock })
  await persistence.write(structuredClone(chat), { source: 'chat.create' })
  const calls = { full: 0, update: 0, patch: 0 }
  let beforePatch = null
  const store = {
    async chatForSession() { calls.full++; return persistence.read(chat.id) },
    readCard: async () => ({ name: 'Card' }),
    writeChat: persistence.write,
    writeChatHeader: persistence.writeHeader,
    async updateChat(...args) { calls.update++; return persistence.update(...args) },
    ...(scoped ? {
      async storyContextForSession(sessionId) {
        const bounded = createBoundedHistory({ links: async () => ({ [chat.sessionId]: chat.id }), readWindow: persistence.readWindow, pageSize: 8 })
        return (await bounded.forSession(sessionId, { storyRows: 3, lastAssistant: true, lastVariables: true })).chat
      },
      readChatSlice: createSessionSliceReader({ links: async () => ({ [chat.sessionId]: chat.id }), readSlice: persistence.readSlice }),
      async patchChat(...args) { calls.patch++; await beforePatch?.(); beforePatch = null; return persistence.patch(...args) }
    } : {})
  }
  const turns = createTurnOrchestrator({
    store, now: () => clock,
    timeline: createStoryTimeline({ id: prefix => prefix + '-' + (++ids), now: () => clock }), frameBuilder: createForegroundFrameBuilder(),
    planner: { plan: async () => ({ text: 'context' }) },
    projectReply: text => ({ sourceText: text, projectionText: text, sessionText: text, displayText: text, warnings: [] }),
    ...(template ? { projectUserTemplate: async ({ text, turn }) => ({ message: { role: 'user', text, tavernPluginData: { rendered: turn },
      variables: [{ stat_data: { hp: -turn }, schema: {} }] }, scopes: { local: { turn }, initial: {} } }) } : {})
  })
  async function play(turn, userText = '继续') {
    clock += 10
    await turns.prepare({ sessionId: chat.sessionId, turn, userText })
    calls.full = 0
    clock += 10
    return turns.finalize({ sessionId: chat.sessionId, turn, userText, assistantText: '回复 ' + turn })
  }
  return { persistence, turns, calls, play, stored: () => persistence.read(chat.id), beforePatch: fn => { beforePatch = fn } }
}

function base(messages, extra = {}) {
  return { id: 'chat-1', sessionId: 's', mode: 'story', cardPath: 'cards/a.json', backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
    mvu: { enabled: true, owner: 'official' }, messages, ...extra }
}

function comparable(chat) {
  const { updatedAt: _updatedAt, ...rest } = chat
  return rest
}

for (const [name, variablesAt] of [['最近楼层有变量', () => true], ['变量只在很早的楼层', turn => turn === 3], ['全无变量', () => false]]) {
  test('准备追加占位、提交原地替换，结果与完整写入一致：' + name, async t => {
    const chat = base(history(120, variablesAt))
    const scoped = await app(t, chat, true), full = await app(t, chat, false)
    for (const turn of [121, 122]) {
      const [left, right] = [await scoped.play(turn), await full.play(turn)]
      assert.deepEqual(left, right)
    }
    assert.deepEqual(scoped.calls, { full: 0, update: 0, patch: 4 }, '两轮各有一次准备 patch 和一次提交 patch')
    assert.equal(full.calls.update, 2)
    const [left, right] = [await scoped.stored(), await full.stored()]
    assert.equal(left.messages.length, 244)
    assert.deepEqual(comparable(left), comparable(right))
    const expected = variablesAt(120) ? 120 : variablesAt(3) ? 3 : undefined
    assert.equal(left.messages.at(-1).variables[0].stat_data?.hp, expected)
    assert.deepEqual(replyProseProblems(left.messages.at(-1), { regexScripts: [] }), [])
  })
}

test('纯附件输入从准备到提交复用同一对分页消息', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  const userContent = [{ type: 'image', source: { type: 'base64', data: 'IMAGE_DATA' } }]
  await scoped.turns.prepare({ sessionId: 's', turn: 6, userText: '', userContent })
  const pending = await scoped.stored()
  assert.equal(pending.messages.length, 12)
  assert.equal(pending.messages[10].placeholder, true)
  assert.deepEqual(pending.messages[10].inputAttachments, userContent)
  assert.equal(pending.messages[11].placeholder, true)
  await scoped.turns.finalize({ sessionId: 's', turn: 6, userText: '', userContent, assistantText: '已查看图片。' })
  const committed = await scoped.stored()
  assert.equal(committed.messages.length, 12, '提交只替换占位，不追加第三行')
  assert.deepEqual(committed.messages[10].inputAttachments, userContent)
  assert.equal(committed.messages[11].text, '已查看图片。')
  assert.ok(committed.messages.slice(10).every(message => message.placeholder === undefined))
  assert.equal(scoped.calls.patch, 2, '准备和提交各使用一次分页 patch')
})

test('已保存玩家输入在分页准备和提交中保持同一索引', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  const input = { sessionId: 's', requestId: 'rpc-paged', userText: '继续' }
  const saved = await scoped.turns.appendUser(input)
  const duplicate = await scoped.turns.appendUser(input)
  assert.equal(saved.messageIndex, 10)
  assert.deepEqual([duplicate.messageIndex, duplicate.duplicate], [10, true])
  assert.equal((await scoped.stored()).messages.length, 11)

  await scoped.turns.prepare({ ...input, turn: 6 })
  const pending = await scoped.stored()
  assert.equal(pending.messages.length, 12, '分页准备只追加 assistant')
  assert.equal(pending.messages[10].source.rpcId, 'rpc-paged')
  assert.equal(pending.messages[11].role, 'assistant')

  await scoped.turns.finalize({ ...input, turn: 6, assistantText: '回复 6' })
  const committed = await scoped.stored()
  assert.equal(committed.messages.length, 12)
  assert.equal(committed.messages[10].source.rpcId, 'rpc-paged')
  assert.equal(committed.messages[10].text, '继续')
  assert.equal(committed.messages[11].text, '回复 6')
})

test('剧情版本在生成期间被后台写入推进：仍然提交，不丢本轮正文', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  await scoped.turns.prepare({ sessionId: 's', turn: 6, userText: '继续' })
  // 结算/候选/世界书会在同一分支上推进 revision，那不代表玩家看到的剧情换了。
  scoped.beforePatch(() => scoped.persistence.update('chat-1', chat => {
    chat.timeline.revision++
    chat.posture = '后台结算后的状态'
    return chat
  }, { source: 'settlement' }))
  await scoped.turns.finalize({ sessionId: 's', turn: 6, userText: '继续', assistantText: '回复' })
  const stored = await scoped.stored()
  assert.equal(stored.messages.length, 12)
  assert.equal(stored.messages[11].text, '回复')
  assert.equal(stored.posture, '后台结算后的状态', '后台写入的状态不被本轮提交覆盖')
})

test('生成期间换了分支：拒绝提交，楼层不变', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  await scoped.turns.prepare({ sessionId: 's', turn: 6, userText: '继续' })
  scoped.beforePatch(() => scoped.persistence.update('chat-1', chat => {
    chat.timeline.revision++
    chat.timeline.branchId = 'other-branch'
    return chat
  }, { source: 'rollback' }))
  await assert.rejects(scoped.turns.finalize({ sessionId: 's', turn: 6, userText: '继续', assistantText: '回复' }), /剧情状态已变化/)
  assert.equal((await scoped.stored()).messages.length, 12, '拒绝提交后仍只有本轮两条占位，没有重复正式楼层')
})
