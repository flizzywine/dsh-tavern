import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualLedger, ledgerBacklog } from "../tavern-plugin/lib/domain/manual-ledger.js"
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
    assert.deepEqual(input.tools.map(tool => tool.name), ['ledger_submit', 'ledger_lookup'])
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

test('查询补取漏选人物后可更新，查询本身不修改台账；玩家计划不能作为查询证据', async () => {
  const ledger = applyLedgerDelta(null, { npcs: { add: [{ name: '苏婉', condition: '受伤' }] }, scenes: { add: [{ path: ['客栈'], desc: '住处' }] } }, 1)
  ledger.consolidatedTurn = 1
  const run = fixture(async input => {
    assert.ok(!input.messages[0].content[0].text.includes('"condition":"受伤"'))
    const before = run.get().ledger
    assert.equal(JSON.parse(await input.onToolCall({ name: 'ledger_lookup', arguments: { kind: 'npcs', names: ['苏婉'], evidence: '我要找她' } })).retryable, true)
    const found = JSON.parse(await input.onToolCall({ name: 'ledger_lookup', arguments: { kind: 'npcs', names: ['苏婉'], evidence: '她在客栈包扎伤口。' } }))
    assert.equal(found.ok, true)
    assert.match(found.context, /受伤/)
    assert.deepEqual(run.get().ledger, before)
    await input.onToolCall({ name: 'ledger_submit', arguments: { npcs: { update: [{ name: '苏婉', condition: '已包扎' }] } } })
  }, [{ role: 'user', turn: 2, text: '我要找她' }, { role: 'assistant', turn: 2, text: '她在客栈包扎伤口。' }], ledger)
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'done')
  assert.equal(run.get().ledger.npcs[0].condition, '已包扎')
})

test('筛选异常会终结任务并允许重试，不会一直停在整理中', async () => {
  let called = false
  const run = fixture(async () => { called = true }, round(1), { version: 1, items: null, npcs: [], scenes: [] })
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'failed')
  assert.equal(called, false)
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'failed')
})

test('查询证据仅来自本批正文，不包含玩家计划或预算之外的轮次', () => {
  const chat = { messages: [
    { role: 'user', turn: 1, text: '去找她' }, { role: 'assistant', turn: 1, text: '她开门。' },
    { role: 'assistant', turn: 2, text: '她包扎。' }
  ] }
  assert.equal(ledgerBacklog(chat, 1).evidenceText, '她开门。')
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
