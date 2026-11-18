import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createMvuSettlementEngine } from '../tavern-plugin/lib/domain/mvu-settlement-engine.js'
import { createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createSettlementRun } from '../tavern-plugin/lib/domain/settlement-run.js'
import { createSettlementControls } from '../tavern-plugin/lib/domain/settlement-controls.js'
import { sessionViewMessageFields } from '../tavern-plugin/lib/domain/session-view-projection.js'

async function fixture(t, initialDelta = -1, openingLimit = 2) {
  const root = await mkdtemp(join(tmpdir(), 'settlement-retry-window-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = () => createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  let persistence = open()
  const timeline = createStoryTimeline()
  const variables = { stat_data: { hp: 10 }, schema: {} }
  const body = timeline.apply({ chat: {
    id: 'c', sessionId: 's', mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
    backgroundTasks: { variables: true, posture: false, characterDesign: false },
    mvu: { enabled: true, owner: 'official' },
    messages: [{ role: 'assistant', turn: 1, text: '前一轮', variables: [variables] }]
  }, intent: { kind: 'body.begin', turn: 2, userText: '开门' } })
  const round = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' }, apply(chat) {
      chat.messages.push({ role: 'user', turn: 2, text: '开门' }, {
        role: 'assistant', turn: 2, text: '门开了', swipeId: 1, swipes: ['旧正文', '门开了'],
        variables: [{ stat_data: { hp: 80 }, schema: {} }, structuredClone(variables)], mvu: { pending: true }
      })
    }
  }).chat
  await persistence.write(round)
  const store = {
    readChat: () => assert.fail('retry must stay within bounded reads'),
    writeChat: (...args) => persistence.write(...args),
    readState: (...args) => persistence.readSessionState(...args),
    readSlice: (...args) => persistence.readSlice(...args),
    readSettlementCheckpoint: (...args) => persistence.readSettlementCheckpoint(...args),
    updateChat: (...args) => persistence.update(...args),
    patchChat: (...args) => persistence.patch(...args)
  }
  const tasks = createBackgroundTaskCoordinator({ timeline, store })
  const inputs = []
  let delta = initialDelta
  const deps = {
    backgroundTasks: tasks, storyTimeline: timeline,
    chatPersistence: { readWindow: (...args) => persistence.readWindow(...args) },
    readChat: store.readChat, chatForSession: store.readChat, readSlice: store.readSlice, patchChat: store.patchChat,
    readChatCard: async () => ({}), worldBookScanDepth: async () => 2,
    backgroundModelSelection: () => ({}), mvuUpdateRules: async () => [],
    readOpeningWindow: () => persistence.readWindow('c', { limit: openingLimit, messageFields: sessionViewMessageFields }),
    projectOpeningWindow: async window => window,
    queueSettlement: async () => {},
    mvuSettlement: { async settleVariables(input) {
      inputs.push(input)
      const selected = await persistence.readSlice('c', [input.messageId])
      const before = { ...selected.chat, messages: new Array(selected.messageCount) }
      before.messages[input.messageId] = selected.chat.messages[0]
      const after = structuredClone(before)
      after.messages[input.messageId].variables[input.swipeId] = structuredClone(input.currentVariables)
      after.messages[input.messageId].variables[input.swipeId].stat_data.hp += delta
      return { receipt: { version: 1, status: delta === 0 ? 'unchanged' : 'updated', changes: [] },
        effect: createMvuSettlementEffect({ ...input, before, after, messageIndices: [input.messageId] }) }
    } }
  }
  deps.mvuSettlementEngine = createMvuSettlementEngine(deps)
  const run = createSettlementRun(deps)
  const controls = createSettlementControls(deps)
  await run.runSettlement('c')
  const settled = await persistence.read('c')
  assert.equal(settled.settleStatus, 'done')
  assert.deepEqual(settled.messages[2].mvuBaseline, { swipeId: 1, variables })
  assert.equal(settled.messages[2].variables[1].stat_data.hp, 10 + initialDelta)
  // Reopen with cold storage, then use the exact field projection used by readOpeningWindow.
  persistence = open()
  const window = await deps.readOpeningWindow()
  assert.equal(window.from, Math.max(0, 3 - openingLimit))
  assert.equal(window.chat.messages.at(-1).mvuBaseline, undefined)
  delta = -2
  return { deps, controls, inputs, run, settled, read: () => persistence.read('c') }
}

for (const [status, delta, guidance, openingLimit] of [['updated', -1, '', 2], ['updated', -1, '修正伤害', 3], ['unchanged', 0, '', 2]]) {
  test(`冷存档精简窗口重算 ${status}，指导意见=${guidance || '空'}，窗口=${openingLimit}`, async t => {
    const f = await fixture(t, delta, openingLimit)
    let queued = 0
    f.deps.queueSettlement = async () => { queued++ }
    await f.controls.retrySettlement('s', 2, guidance)
    assert.equal(queued, 1)
    assert.equal((await f.read()).messages[2].mvu.pending, true)
    await f.run.runSettlement('c')
    const saved = await f.read()
    assert.equal(saved.settleStatus, 'done')
    assert.equal(f.inputs.length, 2)
    assert.equal(f.inputs[1].guidance, guidance)
    assert.equal(f.inputs[1].currentVariables.stat_data.hp, 10)
    assert.equal(saved.messages[2].variables[1].stat_data.hp, 8)
    assert.deepEqual(saved.messages[2].mvuBaseline, f.settled.messages[2].mvuBaseline)
    assert.deepEqual(saved.messages.map(message => message.text), f.settled.messages.map(message => message.text))
    assert.equal(saved.messages[2].variables[0].stat_data.hp, 80)
    await f.controls.retrySettlement('s', 2, guidance)
    await f.run.runSettlement('c')
    assert.equal((await f.read()).messages[2].variables[1].stat_data.hp, 8, '连续重算始终从原始基线开始')
  })
}

test('补读轮次时存档前进，重新读取窗口并校验最新正文', async t => {
  const f = await fixture(t)
  const readSlice = f.deps.readSlice
  let reads = 0
  f.deps.readSlice = async (...args) => {
    if (++reads === 1) {
      const current = await f.read()
      await f.deps.patchChat('c', current._storageRevision, [{ op: 'set', path: ['messages', 2, 'turn'], value: 3 }])
    }
    return readSlice(...args)
  }
  await assert.rejects(f.controls.retrySettlement('s', 2), /只能重试当前最新正文/)
  assert.equal((await f.read()).messages[2].mvu.pending, false)
})

test('补读轮次后写入冲突，重新校验快照对应的 swipe', async t => {
  const f = await fixture(t)
  const patch = f.deps.patchChat
  let writes = 0
  f.deps.patchChat = async (...args) => {
    if (++writes === 1) {
      const current = await f.read()
      await patch('c', current._storageRevision, [{ op: 'set', path: ['messages', 2, 'swipeId'], value: 0 }])
    }
    return patch(...args)
  }
  await assert.rejects(f.controls.retrySettlement('s', 2), /没有结算前快照/)
  assert.equal((await f.read()).messages[2].mvu.pending, false)
})

for (const baseline of ['missing', 'wrong-swipe']) test(`完整轮次的快照 ${baseline} 时保留校验`, async t => {
  const f = await fixture(t)
  const current = await f.read()
  const change = baseline === 'missing' ? { op: 'delete', path: ['messages', 2, 'mvuBaseline'] }
    : { op: 'set', path: ['messages', 2, 'mvuBaseline', 'swipeId'], value: 0 }
  await f.deps.patchChat('c', current._storageRevision, [change])
  await assert.rejects(f.controls.retrySettlement('s', 2), /没有结算前快照/)
  assert.equal((await f.read()).messages[2].mvu.pending, false)
})
