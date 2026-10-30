import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualLedger } from "../tavern-plugin/lib/domain/manual-ledger.js"

const round = turn => [
  { role: 'user', turn, text: '第' + turn + '轮行动' },
  { role: 'assistant', turn, text: '第' + turn + '轮正文：拿到一把钥匙。' }
]
function fixture(runAgent, messages = [...round(1), ...round(2)], options = {}) {
  let chat = { id: 'chat', sessionId: 'session', messages }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: {
    readChat: async () => structuredClone(chat), writeChat: async value => { chat = value },
    updateChat: async (_id, fn) => { chat = await fn(structuredClone(chat)); return chat }
  } })
  const api = createManualLedger({
    beginTask: options.queue ? (value, _sessionId, onQueued) => tasks.begin(value, 'ledger', { queue: true, onQueued }) : value => tasks.begin(value, 'ledger'),
    store: { chatForSession: async () => structuredClone(chat), updateChat: async (_id, update) => { chat = update(structuredClone(chat)); return chat } },
    runAgent, selection: () => ({ provider: 'fixture', model: 'fixture' }), ...options
  })
  return { api, tasks, get: () => structuredClone(chat) }
}
const addKey = { items: { add: [{ name: '钥匙', qty: 1 }] } }

test('手动整理只处理上次之后的新剧情，并记录整理到的轮次', async () => {
  const seen = []
  const run = fixture(async input => {
    seen.push(input.messages[0].content[0].text)
    assert.deepEqual(input.tools.map(tool => tool.name), ['ledger_submit'])
    assert.equal(input.task, 'ledger')
    await input.onToolCall({ name: 'ledger_submit', arguments: addKey })
  })
  assert.equal(run.api.project(run.get()).pendingRounds, 2)
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  const after = run.get()
  assert.equal(after.ledgerTask.status, 'done')
  assert.equal(after.ledger.consolidatedTurn, 2)
  assert.equal(after.ledger.items[0].qty, 1)
  assert.equal(run.api.project(after).pendingRounds, 0)
  assert.deepEqual(after.ledgerInjection, { through: 2 }, 'the next story turn reads the ledger once')
  assert.match(seen[0], /第 1 轮[\s\S]*第 2 轮/)
  await assert.rejects(run.api.start({ sessionId: 'session' }), /还没有新的剧情/)
})

test('插件接管台账整理：它交回的增量照常校验并保存；交回 null 时由 Tavern 自己整理', async () => {
  const asked = []
  let agentRuns = 0
  const taken = fixture(async () => { agentRuns++ }, undefined, { replaceLedger: async input => {
    asked.push(input)
    input.apply(addKey)
    return { owner: 'p', delta: addKey }
  } })
  await taken.api.start({ sessionId: 'session' }); await taken.api.wait('chat')
  assert.equal(agentRuns, 0)
  assert.equal(taken.get().ledgerTask.status, 'done')
  assert.equal(taken.get().ledger.items[0].qty, 1)
  assert.deepEqual([asked[0].gameId, asked[0].from, asked[0].through, asked[0].tool.name], ['session', 1, 2, 'ledger_submit'])
  assert.match(asked[0].text, /第1轮正文/)
  assert.throws(() => asked[0].apply({ items: { update: [{ name: '不存在' }] } }), /尚未登记/)

  const declined = fixture(async input => { agentRuns++; await input.onToolCall({ name: 'ledger_submit', arguments: addKey }) }, undefined, { replaceLedger: async () => null })
  await declined.api.start({ sessionId: 'session' }); await declined.api.wait('chat')
  assert.equal(agentRuns, 1)
  assert.equal(declined.get().ledger.items[0].qty, 1)
})

test('书记忙时点整理：马上返回「排队中」，书记做完再整理', async () => {
  let ran = 0
  const run = fixture(async input => { ran++; await input.onToolCall({ name: 'ledger_submit', arguments: addKey }) }, undefined, { queue: true })
  const holder = await run.tasks.begin(run.get(), 'settlement')
  assert.equal((await run.api.start({ sessionId: 'session' })).status, 'queued')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(run.get().ledgerTask.status, 'queued')
  assert.equal(run.api.project(run.get()).status, 'queued')
  assert.equal(ran, 0)
  await assert.rejects(run.api.start({ sessionId: 'session' }), /正在整理/)
  await holder.commit({ stateChanged: false })
  await run.api.wait('chat')
  assert.equal(ran, 1)
  assert.equal(run.get().ledgerTask.status, 'done')
  assert.equal(run.get().ledger.items[0].qty, 1)
})

test('排队中的整理遇到剧情回退：标为失败并说明原因', async () => {
  const run = fixture(async () => assert.fail('must not run'), undefined, { queue: true })
  const holder = await run.tasks.begin(run.get(), 'settlement')
  await run.api.start({ sessionId: 'session' })
  await new Promise(resolve => setTimeout(resolve, 20))
  await holder.commit({ stateChanged: false, apply: chat => { chat.timeline.branchId = 'rolled-back' } })
  await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'failed')
  assert.match(run.get().ledgerTask.error, /回退/)
})
