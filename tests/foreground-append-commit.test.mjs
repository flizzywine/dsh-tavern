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
  let duringWorldbook = null
  let beforePlan = null
  let beforePatch = null
  let beforeHelperPatch = null
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
    planner: { plan: async () => {
      const hook = beforePlan
      beforePlan = null
      await hook?.()
      return { text: 'context', systemPromptText: '' }
    } },
    projectReply: text => ({ sourceText: text, projectionText: text, sessionText: text, displayText: text, warnings: [] }),
    ...(template ? {
      projectForegroundWorldbook: async () => { await duringWorldbook?.(); return { context: '' } },
      projectUserTemplate: async ({ text, turn }) => ({ message: { role: 'user', text, tavernPluginData: { rendered: turn },
        variables: [{ stat_data: { hp: -turn }, schema: {} }] }, scopes: { local: { turn }, initial: {} } })
    } : {})
  })
  const helper = createTavernScriptHostAdapter({
    resolveChat: store.chatForSession, resolveChatSlice: store.readChatSlice, readChatRevision: persistence.readRevision,
    async patchChat(...args) {
      const hook = beforeHelperPatch
      beforeHelperPatch = null
      await hook?.()
      return persistence.patch(...args)
    },
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
    duringWorldbook: fn => { duringWorldbook = fn }, beforePlan: fn => { beforePlan = fn },
    beforePatch: fn => { beforePatch = fn }, beforeHelperPatch: fn => { beforeHelperPatch = fn } }
}

function base(messages, extra = {}) {
  return { id: 'chat-1', sessionId: 's', mode: 'story', cardPath: 'cards/a.json', backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
    mvu: { enabled: true, owner: 'official' }, messages, ...extra }
}

function comparable(chat) {
  const { updatedAt: _updatedAt, ...rest } = chat
  return rest
}

async function writeHelperVariables(run, option, variables) {
  const { _storageRevision: stateRevision, id: chatId } = (await run.persistence.readSlice('chat-1')).chat
  const result = await run.helper.updateVariables('s', option, variables, 0, '', { chatId, stateRevision, lifecycleRevision: 0 })
  assert.equal(result.updated, true)
  assert.ok(result.contextDelta)
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
    scoped[timing](async () => {
      await writeHelperVariables(scoped, { type: 'message', message_id: 1 }, { stat_data: { hp: 100 }, schema: {} })
      await writeHelperVariables(scoped, { type: 'message', message_id: 24 }, { stat_data: { hp: 200 }, schema: {} })
      await writeHelperVariables(scoped, { type: 'chat' }, { turn: 13, playerName: '新名字' })
    })

    const preparation = await scoped.turns.prepare(input)
    assert.equal(preparation.ready, true)
    assert.equal(preparation.frame.source.regenerationMaterials.generationState.messageVariables.stat_data.hp, 200)
    assert.equal(preparation.frame.source.regenerationMaterials.persona.name, '新名字')
    const prepared = await scoped.stored()
    assert.equal(prepared.messages.length, 26)
    assert.equal(prepared.messages[1].variables[0].stat_data.hp, 100)
    assert.equal(prepared.messages[24].variables[0].stat_data.hp, 200)
    assert.equal(prepared.macroState.userName, '新名字')
    assert.deepEqual(prepared.variables, { turn: 13, playerName: '新名字' })
    assert.equal(prepared.messages[25].placeholder, true)
    assert.deepEqual(prepared.foregroundFrames[preparation.frame.operationId], preparation.frame)

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

for (const timing of ['duringWorldbook', 'afterPrepare']) {
  test(`本轮输入变量写入后，准备和提交保留最新值（${timing}）`, async t => {
    const scoped = await app(t, base(history(12, () => true)), true, true)
    const input = { sessionId: 's', turn: 13, requestId: 'input-13', userText: '继续' }
    await scoped.turns.appendUser(input)
    const write = () => writeHelperVariables(scoped, { type: 'message', message_id: 24 }, { stat_data: { hp: 200 }, schema: {} })
    if (timing === 'duringWorldbook') scoped.duringWorldbook(write)
    const prepared = await scoped.turns.prepare(input)
    if (timing === 'afterPrepare') await write()
    else assert.equal(prepared.frame.source.regenerationMaterials.generationState.messageVariables.stat_data.hp, 200)
    assert.equal((await scoped.stored()).messages[24].variables[0].stat_data.hp, 200)

    await scoped.turns.finalize({ ...input, assistantText: '回复' })
    const saved = await scoped.stored()
    assert.equal(saved.messages.length, 26)
    assert.equal(saved.messages[24].variables[0].stat_data.hp, 200)
    assert.equal(saved.messages[25].variables[0].stat_data.hp, 200)
  })
}

test('失败清理只撤销模板写入，保留 Helper 后续写入的聊天变量', async t => {
  const scoped = await app(t, base(history(12, () => true), { variables: { flag: false } }), true, true)
  const input = { sessionId: 's', turn: 13, requestId: 'input-13', userText: '继续' }
  await scoped.turns.prepare(input)
  await writeHelperVariables(scoped, { type: 'chat' }, { turn: 13, flag: true })
  await scoped.turns.discard(input)
  const saved = await scoped.stored()
  assert.deepEqual(saved.variables, { flag: true })
  assert.equal(saved.promptTemplateInput, undefined)
  assert.equal(saved.messages.length, 25)
})

test('上一楼层的显示捕获和回退记录版本戳不作废正文准备', async t => {
  const scoped = await app(t, base(history(12, () => true), { rollbackUndo: { ready: true, storageRevision: 1 } }), true)
  const receipt = { version: 2, frames: [] }
  scoped.beforePatch(async () => {
    const { _storageRevision } = (await scoped.persistence.readSlice('chat-1')).chat
    assert.ok(await scoped.persistence.patch('chat-1', _storageRevision, [
      { op: 'set', path: ['messages', 23, 'displayRuntime'], value: receipt },
      { op: 'set', path: ['rollbackUndo', 'storageRevision'], value: _storageRevision + 1 }
    ], { source: 'display.capture', touchUpdatedAt: false }))
  })
  assert.equal((await scoped.turns.prepare({ sessionId: 's', turn: 13, userText: '继续' })).ready, true)
  const saved = await scoped.stored()
  assert.deepEqual(saved.messages[23].displayRuntime, receipt)
  assert.equal(saved.messages.length, 26)
})

test('Helper 写入时保留其他楼层的并发变量变更', async t => {
  const scoped = await app(t, base(history(12, () => true)), true)
  scoped.beforeHelperPatch(async () => {
    const { _storageRevision } = (await scoped.persistence.readSlice('chat-1')).chat
    assert.ok(await scoped.persistence.patch('chat-1', _storageRevision, [
      { op: 'set', path: ['messages', 23, 'variables', 0, 'stat_data', 'hp'], value: 300 }
    ], { source: 'test.disjoint-variables' }))
  })
  const { _storageRevision: stateRevision, id: chatId } = (await scoped.persistence.readSlice('chat-1')).chat
  const result = await scoped.helper.updateVariables('s', { type: 'message', message_id: 1 },
    { stat_data: { hp: 200 }, schema: {} }, 0, '', { chatId, stateRevision, lifecycleRevision: 0 })
  assert.equal(result.updated, true)
  assert.equal(result.context.stateRevision, stateRevision + 2)
  const saved = await scoped.stored()
  assert.equal(saved.messages[1].variables[0].stat_data.hp, 200)
  assert.equal(saved.messages[23].variables[0].stat_data.hp, 300)
})

test('空白开场初始化遇到并发写入后，变量与完成状态一起提交', async t => {
  const scoped = await app(t, base([], {
    mvu: { enabled: true, owner: 'official', openingInitialization: { status: 'pending' } },
    variables: {}
  }), true)
  const { _storageRevision: stateRevision, id: chatId } = (await scoped.persistence.readSlice('chat-1')).chat
  scoped.beforeHelperPatch(async () => {
    assert.ok(await scoped.persistence.patch(chatId, stateRevision, [
      { op: 'set', path: ['variables', 'note'], value: '并发写入' }
    ], { source: 'test.concurrent-opening' }))
  })
  const variables = { stat_data: { hp: 10 }, schema: {} }
  const result = await scoped.helper.updateVariables('s', { type: 'chat' }, variables, 0, '',
    { chatId, stateRevision, lifecycleRevision: 0 })
  assert.equal(result.updated, true)
  const saved = await scoped.stored()
  assert.deepEqual(saved.variables, { ...variables, note: '并发写入' })
  assert.equal(saved.mvu.openingInitialization.status, 'complete')
  assert.equal(saved.messages.length, 0)
})

for (const [kind, path, value] of [
  ['不同字段', ['variables', 0, 'stat_data', 'mp'], 30],
  ['相同字段', ['variables', 0, 'stat_data', 'hp'], 30],
  ['切换 swipe', ['swipeId'], 1]
]) {
  test('Helper 基于目标楼层的实际变更判定冲突：' + kind, async t => {
    const rows = history(3, () => true)
    rows[1].swipes.push('另一个版本')
    rows[1].variables = [{ stat_data: { hp: 1, mp: 5 }, schema: {} }, { stat_data: { hp: 2 }, schema: {} }]
    const scoped = await app(t, base(rows), true)
    const { _storageRevision: stateRevision, id: chatId } = (await scoped.persistence.readSlice('chat-1')).chat
    scoped.beforeHelperPatch(async () => {
      assert.ok(await scoped.persistence.patch(chatId, stateRevision, [
        { op: 'set', path: ['messages', 1, ...path], value }
      ], { source: 'test.concurrent-edit' }))
    })
    const write = scoped.helper.updateVariables('s', { type: 'message', message_id: 1 },
      { stat_data: { hp: 20, mp: 5 }, schema: {} }, 0, '', { chatId, stateRevision, lifecycleRevision: 0 })
    if (kind === '不同字段') assert.equal((await write).updated, true)
    else await assert.rejects(write, { code: 'DSH_TAVERN_CHAT_CONFLICT' })
    const row = (await scoped.stored()).messages[1]
    if (kind === '不同字段') assert.deepEqual(row.variables[0].stat_data, { hp: 20, mp: 30 })
    if (kind === '相同字段') assert.deepEqual(row.variables[0].stat_data, { hp: 30, mp: 5 })
    if (kind === '切换 swipe') {
      assert.equal(row.swipeId, 1)
      assert.deepEqual(row.variables, rows[1].variables)
    }
  })
}
