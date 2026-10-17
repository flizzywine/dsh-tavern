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
  test('正文提交只追加本轮楼层，结果与完整写入一致：' + name, async t => {
    const chat = base(history(120, variablesAt))
    const scoped = await app(t, chat, true), full = await app(t, chat, false)
    for (const turn of [121, 122]) {
      const [left, right] = [await scoped.play(turn), await full.play(turn)]
      assert.deepEqual(left, right)
    }
    assert.deepEqual(scoped.calls, { full: 0, update: 0, patch: 2 })
    assert.equal(full.calls.update, 2)
    const [left, right] = [await scoped.stored(), await full.stored()]
    assert.equal(left.messages.length, 244)
    assert.deepEqual(comparable(left), comparable(right))
    const expected = variablesAt(120) ? 120 : variablesAt(3) ? 3 : undefined
    assert.equal(left.messages.at(-1).variables[0].stat_data?.hp, expected)
  })
}

test('玩家模板输入随追加提交消费，结果与完整写入一致', async t => {
  const chat = base(history(20, () => true))
  const scoped = await app(t, chat, true, true), full = await app(t, chat, false, true)
  assert.deepEqual(await scoped.play(21), await full.play(21))
  const [left, right] = [await scoped.stored(), await full.stored()]
  assert.deepEqual(comparable(left), comparable(right))
  assert.deepEqual(left.messages.at(-2).tavernPluginData, { rendered: 21 })
  assert.equal(left.messages.at(-1).variables[0].stat_data.hp, -21)
  assert.equal(left.promptTemplateInput, undefined)
  assert.deepEqual(scoped.calls, { full: 0, update: 0, patch: 1 })
})

test('提交前其他写入推进了版本：重读后追加，不覆盖并发字段', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  scoped.beforePatch(() => scoped.persistence.update('chat-1', chat => { chat.guide = '并发写入'; return chat }, { source: 'guide.add' }))
  const result = await scoped.play(6)
  assert.equal(result.saved, true)
  const stored = await scoped.stored()
  assert.equal(stored.guide, '并发写入')
  assert.equal(stored.messages.length, 12)
  assert.equal(stored.timeline.checkpoints.length, 1)
  assert.equal(scoped.calls.patch, 2)
})

test('剧情版本在生成期间变化：拒绝提交，楼层不变', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  await scoped.turns.prepare({ sessionId: 's', turn: 6, userText: '继续' })
  scoped.beforePatch(() => scoped.persistence.update('chat-1', chat => { chat.timeline.revision++; return chat }, { source: 'rollback' }))
  await assert.rejects(scoped.turns.finalize({ sessionId: 's', turn: 6, userText: '继续', assistantText: '回复' }), /剧情状态已变化/)
  assert.equal((await scoped.stored()).messages.length, 10)
})

test('同一回合重复提交只追加一次', async t => {
  const scoped = await app(t, base(history(5, () => true)), true)
  await scoped.turns.prepare({ sessionId: 's', turn: 6, userText: '继续' })
  const input = { sessionId: 's', turn: 6, userText: '继续', assistantText: '回复' }
  await scoped.turns.finalize(input)
  const again = await scoped.turns.finalize(input)
  assert.equal(again.duplicate, true)
  assert.equal((await scoped.stored()).messages.length, 12)
})
