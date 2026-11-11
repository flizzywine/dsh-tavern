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
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

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
  let beforePlan = null
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
      readChangedSlice: persistence.readChangedSlice,
      readWindow: persistence.readWindow,
      async patchChat(...args) { calls.patch++; await beforePatch?.(); beforePatch = null; return persistence.patch(...args) }
    } : {})
  }
  const turns = createTurnOrchestrator({
    store, now: () => clock,
    timeline: createStoryTimeline({ id: prefix => prefix + '-' + (++ids), now: () => clock }), frameBuilder: createForegroundFrameBuilder(),
    planner: { plan: async () => { await beforePlan?.(); return { text: 'context' } } },
    projectReply: text => ({ sourceText: text, projectionText: text, sessionText: text, displayText: text, warnings: [] }),
    ...(template ? {
      projectForegroundWorldbook: async () => ({ context: '' }),
      projectUserTemplate: async ({ text, turn }) => ({ message: { role: 'user', text, tavernPluginData: { rendered: turn },
        variables: [{ stat_data: { hp: -turn }, schema: {} }] }, scopes: { local: { turn }, initial: {} } })
    } : {})
  })
  const helper = createTavernScriptHostAdapter({
    resolveChat: store.chatForSession, resolveChatSlice: store.readChatSlice, patchChat: persistence.patch,
    writeChat: store.writeChat, readCard: store.readCard, worldBooks: {}, scriptDispatch: {}
  })
  async function play(turn, userText = '继续') {
    clock += 10
    await turns.prepare({ sessionId: chat.sessionId, turn, userText })
    calls.full = 0
    clock += 10
    return turns.finalize({ sessionId: chat.sessionId, turn, userText, assistantText: '回复 ' + turn })
  }
  return { persistence, turns, calls, play, helper, stored: () => persistence.read(chat.id),
    beforePlan: fn => { beforePlan = fn }, beforePatch: fn => { beforePatch = fn } }
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

for (const timing of ['beforePlan', 'beforePatch']) {
  test(`准备正文时保留 Helper 变量并继续同一回合（${timing}）`, async t => {
    const scoped = await app(t, base(history(12, () => true), {
      macroState: { userName: '玩家', local: {}, global: {} }
    }), true, true)
    const input = { sessionId: 's', turn: 13, requestId: 'input-13', userText: '继续' }
    await scoped.turns.appendUser(input)
    const writeVariables = async (option, variables) => {
      const { _storageRevision: stateRevision, id: chatId } = (await scoped.persistence.readSlice('chat-1')).chat
      const result = await scoped.helper.updateVariables('s', option, variables, 0, '', { chatId, stateRevision, lifecycleRevision: 0 })
      assert.ok(result.contextDelta)
    }
    scoped[timing](async () => {
      await writeVariables({ type: 'message', message_id: 1 }, { stat_data: { hp: 100 }, schema: {} })
      await writeVariables({ type: 'message', message_id: 24 }, { stat_data: { hp: 200 }, schema: {} })
      await writeVariables({ type: 'chat' }, { turn: 13, playerName: '新名字' })
    })

    assert.equal((await scoped.turns.prepare(input)).ready, true)
    const prepared = await scoped.stored()
    assert.equal(prepared.messages.length, 26)
    assert.equal(prepared.messages[1].variables[0].stat_data.hp, 100)
    assert.equal(prepared.messages[24].variables[0].stat_data.hp, 200)
    assert.equal(prepared.macroState.userName, '新名字')
    assert.deepEqual(prepared.variables, { turn: 13, playerName: '新名字' })
    assert.equal(prepared.messages[25].placeholder, true)

    await scoped.turns.finalize({ ...input, assistantText: '回复' })
    const saved = await scoped.stored()
    assert.equal(saved.messages.length, 26)
    assert.equal(saved.messages[24].variables[0].stat_data.hp, 200)
    assert.equal(saved.messages[25].variables[0].stat_data.hp, 200)
  })
}

test('准备正文时改写历史正文：拒绝旧帧，即使楼层数量不变', async t => {
  const scoped = await app(t, base(history(12, () => true)), true)
  scoped.beforePatch(async () => {
    const { _storageRevision } = (await scoped.persistence.readSlice('chat-1')).chat
    await scoped.persistence.patch('chat-1', _storageRevision, [
      { op: 'set', path: ['messages', 1, 'text'], value: '改写过的正文' }
    ], { source: 'tavern-helper.messages' })
  })
  await assert.rejects(scoped.turns.prepare({ sessionId: 's', turn: 13, userText: '继续' }), { code: 'TAVERN_PREPARE_CONFLICT' })
  const saved = await scoped.stored()
  assert.equal(saved.messages[1].text, '改写过的正文')
  assert.equal(saved.messages.length, 24)
})
