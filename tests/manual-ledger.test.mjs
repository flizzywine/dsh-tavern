import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualLedger, ledgerBacklog } from '../tavern-plugin/lib/domain/manual-ledger.js'
import { ledgerFrameInputs } from '../tavern-plugin/lib/domain/story-ledger.js'

const round = turn => [
  { role: 'user', turn, text: '第' + turn + '轮行动' },
  { role: 'assistant', turn, text: '第' + turn + '轮正文：拿到一把钥匙。' }
]
function fixture(runAgent, messages = [...round(1), ...round(2)]) {
  let chat = { id: 'chat', sessionId: 'session', messages }
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

test('模型没有提交台账时不保存并提示失败', async () => {
  const run = fixture(async () => ({ text: '完成' }))
  await run.api.start({ sessionId: 'session' }); await run.api.wait('chat')
  assert.equal(run.get().ledgerTask.status, 'failed')
  assert.match(run.get().ledgerTask.error, /未调用 ledger_submit/)
  assert.equal(run.get().ledger, undefined)
})

test('长历史分批整理：一次只读预算内的轮次，剩余留到下一次', () => {
  const messages = Array.from({ length: 30 }, (_, index) => round(index + 1)).flat()
  const backlog = ledgerBacklog({ messages }, 400)
  assert.equal(backlog.from, 0)
  assert.ok(backlog.through >= 1 && backlog.through < 30)
  assert.equal(backlog.remaining, 30 - backlog.through)
  const next = ledgerBacklog({ messages, ledger: { version: 1, items: [], npcs: [], scenes: [], itemLog: [], locationPath: [], consolidatedTurn: backlog.through } }, 400)
  assert.equal(next.from, backlog.through)
  assert.doesNotMatch(next.text, new RegExp('【第 ' + backlog.through + ' 轮】'))
})

test('整理后的台账只给下一轮正文一次；台账为空或没有整理时不提供', () => {
  const ledger = { version: 1, location: '旅店', locationPath: [], items: [{ name: '钥匙', qty: 1 }], npcs: [], scenes: [], itemLog: [], updatedTurn: 2, consolidatedTurn: 2 }
  const [input] = ledgerFrameInputs({ ledger, ledgerInjection: { through: 2 } })
  assert.equal(input.kind, 'foreground.current-state')
  assert.match(input.text, /^【游玩台账 · 整理至第 2 轮[^】]*】\n\{"location":"旅店"/)
  assert.doesNotMatch(input.text, /consolidatedTurn|updatedTurn/)
  assert.deepEqual(ledgerFrameInputs({ ledger }), [])
  assert.deepEqual(ledgerFrameInputs({ ledger: { version: 1, location: '', locationPath: [], items: [], npcs: [], scenes: [], itemLog: [] }, ledgerInjection: { through: 2 } }), [])
})
