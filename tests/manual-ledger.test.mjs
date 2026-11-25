// tagged English defaults; retain protocol, payload, cache and budget assertions.
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualLedger } from "../tavern-plugin/lib/domain/manual-ledger.js"
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

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
  return { api, tasks, get: () => structuredClone(chat), rollback: original => { chat = createStoryTimeline().apply({chat,intent:{kind:'replacement.abort',restoreChat:original}}).chat } }
}
const addKey = { items: { add: [{ name: '钥匙', qty: 1 }] } }

test('停用台账后，更新和编辑入口都拒绝执行，后台任务页隐藏台账', async () => {
  const api = createPlayHandlers({
    manualLedger: { start: () => assert.fail('不应发起整理') },
    ledgerEditor: () => assert.fail('不应写入台账'),
    backgroundAgentRunner: { runs: () => [{ task: 'ledger' }], locks: () => [] }
  })
  await assert.rejects(api.consolidateLedger({ sessionId: 'session' }), /游玩台账已停用/)
  await assert.rejects(api.editLedger({ sessionId: 'session' }), /游玩台账已停用/)
  const { runs, catalog } = await api.getBackgroundRuns({ sessionId: 'session' })
  assert.deepEqual(runs, [])
  assert.ok(!catalog.some(entry => entry.task === 'ledger'))
})








test('late failed manual ledger cannot resurrect markers on a replacement branch',async()=>{
  let release,started;const ready=new Promise(resolve=>{started=resolve}),pending=new Promise(resolve=>{release=resolve})
  const run=fixture(async()=>{started();await pending;throw new Error('old branch failure')})
  const original=run.get()
  await run.api.start({sessionId:'session'});await ready
  run.rollback(original);release();await run.api.wait('chat')
  assert.equal(run.get().ledgerTask,undefined)
  assert.equal(run.get().ledgerInjection,undefined)
  assert.equal(run.get().ledger,null)
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
