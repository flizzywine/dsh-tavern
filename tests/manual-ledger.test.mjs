import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualLedger } from "../tavern-plugin/lib/domain/manual-ledger.js"
import { applyLedgerDelta } from '../tavern-plugin/lib/domain/story-ledger.js'

const round = turn => [
  { role: 'user', turn, text: '第' + turn + '轮行动' },
  { role: 'assistant', turn, text: '第' + turn + '轮正文：拿到一把钥匙。' }
]
function fixture(runAgent, messages = [...round(1), ...round(2)], ledger) {
  let chat = { id: 'chat', sessionId: 'session', messages, ledger }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: {
    readChat: async () => structuredClone(chat), writeChat: async value => { chat = value },
    updateChat: async (_id, fn) => { chat = await fn(structuredClone(chat)); return chat }
  } })
  const api = createManualLedger({
    beginTask: value => tasks.begin(value, 'ledger'),
    store: { chatForSession: async () => structuredClone(chat), updateChat: async (_id, update) => { chat = update(structuredClone(chat)); return chat } },
    runAgent, selection: () => ({ provider: 'fixture', model: 'fixture' })
  })
  return { api, get: () => structuredClone(chat) }
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

test('手动整理使用精简上下文，越界提交可重试且不覆盖旧状态', async () => {
  const ledger = applyLedgerDelta(null, { npcs: { add: [
    { name: '苏婉', ties: '陈岚是同伴' },
    { name: '陈岚', condition: '健康', location: '城外' },
    { name: '宋英', personality: '无关人物的私密性格描述' }
  ] }, items: { add: [{ name: '旧信', qty: 3 }] } }, 1)
  ledger.consolidatedTurn = 1
  const run = fixture(async input => {
    const prompt = input.messages[0].content[0].text
    assert.match(prompt, /relationOnly/)
    assert.doesNotMatch(prompt, /无关人物的私密性格描述/)
    const rejected = JSON.parse(await input.onToolCall({ name: 'ledger_submit', arguments: {
      items: { add: [{ name: '新药', qty: 1 }] },
      npcs: { update: [{ name: '陈岚', location: '客栈' }] }
    } }))
    assert.equal(rejected.retryable, true)
    assert.equal(JSON.parse(await input.onToolCall({ name: 'ledger_submit', arguments: {
      npcs: { update: [{ name: '苏婉', relation: '信任玩家', personality: '本批行为支持的性格' }, { name: '陈岚', ties: '与苏婉互相信任' }] }
    } })).ok, true)
  }, [{ role: 'assistant', turn: 2, text: '苏婉推开门。' }], ledger)
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'done')
  assert.equal(run.get().ledger.npcs[1].location, '城外')
  assert.equal(run.get().ledger.npcs[1].condition, '健康')
  assert.equal(run.get().ledger.items[0].qty, 3)
  assert.equal(run.get().ledger.items.length, 1, 'rejected submissions must not partially add items')
})
