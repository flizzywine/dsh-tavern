import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
function section(start, end) {
  const from = server.indexOf(start)
  const to = server.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return server.slice(from, to)
}

async function harness() {
  let current = { id: 'chat', sessionId: 'session', mode: 'story', messages: [], mvu: { enabled: true, owner: 'official' } }
  let sequence = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + ++sequence, now: () => 1000 + sequence })
  const store = {
    readChat: async () => structuredClone(current),
    writeChat: async chat => { current = structuredClone(chat) },
    updateChat: async (_id, fn) => { current = await fn(structuredClone(current)); return structuredClone(current) }
  }
  const tasks = createBackgroundTaskCoordinator({ timeline, store })
  const body = timeline.apply({ chat: current, intent: { kind: 'body.begin', turn: 2, userText: '开门' } })
  current = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn,
    outcome: { status: 'success' }, apply(chat) {
      chat.messages.push({ role: 'user', text: '开门', turn: 2 },
        { role: 'assistant', text: '门开了', turn: 2, variables: [{ stat_data: { hp: 10 } }], mvu: { pending: true } })
    }
  }).chat
  const running = await tasks.begin(current, 'settlement')
  const sandbox = vm.createContext({
    structuredClone, Date, console: { log() {}, error() {} },
    str: value => value == null ? '' : String(value),
    backgroundTasks: tasks, storyTimeline: timeline, settlementJobs: new Map(),
    readChat: store.readChat, chatForSession: store.readChat, writeChat: store.writeChat,
    prepareNextWorldBookContext: async chat => chat, readChatCard: async () => ({}),
    view: async chat => chat, settlementTurn: () => 2,
    projectAgentMessageText: message => message.text, mvuUpdateRules: async () => [],
    backgroundModelSelection: () => ({}), runtimePrompt: () => '',
    applySettlement: () => ({ postureUpdated: false }),
    mvuSettlement: { settleVariables: async () => ({ receipt: { version: 1, status: 'unchanged', changes: [] } }) }
  })
  vm.runInContext(section('  function mvuReceiptsOf(', '  function withLegacyPresentationProjection('), sandbox)
  vm.runInContext(section('  function pendingMvuTarget(', '  async function mvuUpdateRules('), sandbox)
  vm.runInContext(section('  async function runSettlement(', '  const unsubscribeMvuRuntimeReady'), sandbox)
  vm.runInContext(section('  async function retrySettlement(', '  async function pullBackgroundCycle('), sandbox)
  let onReady
  sandbox.tavernHelperEventGate = { subscribeSettled(fn) { onReady = fn }, status() { return { ready: false } } }
  vm.runInContext(section('  const unsubscribeMvuRuntimeReady', '  ctx.effect(() => unsubscribeMvuRuntimeReady'), sandbox)
  const history = createRoundHistory({ chats: { read: store.readChat, forSession: store.readChat, readCard: async () => ({}) },
    sessions: { get: () => undefined }, scripts: {}, timeline, queueSettlement: async () => {}, present() {} })
  return { tasks, timeline, store, running, body, sandbox, history, onReady, get: () => structuredClone(current) }
}

test('重启丢失 MVU 回执：显示中断、保留正文变量、可从真实重试入口完成同一 Round', async () => {
  const run = await harness()
  const before = run.get()
  await run.tasks.recover(run.get())
  const recovered = run.get()
  assert.equal(run.tasks.activity(recovered).phase, 'failed')
  assert.deepEqual(recovered.messages, before.messages)
  assert.equal(recovered.timeline.revision, before.timeline.revision)
  assert.equal(run.sandbox.mvuReceiptsOf(recovered)[0].receipt.status, 'interrupted')
  await assert.rejects(run.history.regenerate('chat', '', 'session'), /尚未完成状态结算/)
  let calls = 0
  run.sandbox.mvuSettlement.settleVariables = async () => {
    calls++
    return { receipt: { version: 1, status: 'unchanged', changes: [] } }
  }
  await run.sandbox.retrySettlement('session', 2)
  await run.sandbox.queueSettlement('chat')
  assert.equal(calls, 1)
  assert.equal(run.get().timeline.operations[run.body.value.operationId].status, 'completed')
  assert.equal(run.get().timeline.checkpoints.length, 1)
  assert.equal(run.sandbox.mvuReceiptsOf(run.get())[0].receipt.status, 'unchanged')
  assert.equal(run.get().messages[1].text, before.messages[1].text)
  assert.deepEqual(run.get().messages[1].variables, before.messages[1].variables)
  await assert.rejects(run.history.regenerate('chat', '', 'session'), /无法访问 DSH 会话/, '结算完成后已通过保护，继续访问原生会话')
})

test('旧版已恢复成 pending 但没有待执行提交的存档也能恢复，重复恢复幂等', async () => {
  const run = await harness()
  const legacy = run.get()
  legacy.timeline.operations[run.running.operationId].status = 'interrupted'
  legacy.timeline.operations[run.body.value.operationId].background.phase = 'pending'
  await run.store.writeChat(legacy)
  await run.tasks.recover(legacy)
  assert.equal(run.sandbox.mvuReceiptsOf(run.get())[0].receipt.status, 'interrupted')
  const again = await run.tasks.recover(run.get())
  assert.equal(again.status, 'unchanged')
})

test('已安全挂起且保存了提交的任务仍等待执行器，不误报中断', async () => {
  const run = await harness()
  await run.running.defer({ apply(chat) { chat.messages[1].mvu.pendingSubmission = { operations: [] } } })
  await run.tasks.recover(run.get())
  assert.equal(run.tasks.activity(run.get()).phase, 'pending')
  assert.equal(run.sandbox.mvuReceiptsOf(run.get())[0].receipt.status, 'pending')
  let resumed = 0
  run.sandbox.mvuSettlement.resumeVariables = async () => {
    resumed++
    return { receipt: { version: 1, status: 'unchanged', changes: [] } }
  }
  run.onReady('session')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resumed, 1)
  assert.equal(run.tasks.activity(run.get()).phase, 'idle')
})

test('执行中断即使留有旧提交也不会在浏览器就绪时自动重放', async () => {
  const run = await harness()
  const chat = run.get()
  chat.messages[1].mvu.pendingSubmission = { operations: [{ op: 'delta', path: '/hp', value: -1 }] }
  await run.store.writeChat(chat)
  await run.tasks.recover(chat)
  let queued = 0
  run.sandbox.queueSettlement = async () => { queued++ }
  run.onReady('session')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queued, 0)
  assert.equal(run.tasks.activity(run.get()).reason, 'interrupted')
})

test('保存 pending 期间 MVU 已加载失败，不丢失通知或永久等待，也不重开模型', async () => {
  const run = await harness()
  await run.tasks.recover(run.get())
  let generated = 0, resumed = 0
  run.sandbox.tavernHelperEventGate.status = () => ({ ready: false, initializationError: 'MVU 模块加载失败：bundle.js' })
  run.sandbox.mvuSettlement.settleVariables = async () => {
    generated++
    return { submission: { operations: [] }, receipt: { status: 'pending', changes: [] } }
  }
  run.sandbox.mvuSettlement.resumeVariables = async () => {
    resumed++
    return { receipt: { status: 'error', failures: [{ message: 'MVU 模块加载失败：bundle.js' }] } }
  }
  await run.sandbox.retrySettlement('session', 2)
  await run.sandbox.queueSettlement('chat')
  assert.equal(generated, 1)
  assert.equal(resumed, 1)
  assert.equal(run.tasks.activity(run.get()).phase, 'failed')
  assert.match(run.get().settleError, /MVU 模块加载失败/)
  assert.equal(run.get().timeline.checkpoints.length, 0)
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 10)
})

test('MVU 执行超时返回错误回执时不提交 Round，仍能重试', async () => {
  const run = await harness()
  await run.tasks.recover(run.get())
  run.sandbox.mvuSettlement.settleVariables = async () => ({
    receipt: { status: 'error', summary: 'MVU 脚本执行回执超时', failures: [{ message: '回执超时' }] }
  })
  await run.sandbox.retrySettlement('session', 2)
  await run.sandbox.queueSettlement('chat')
  assert.equal(run.tasks.activity(run.get()).phase, 'failed')
  assert.equal(run.get().timeline.checkpoints.length, 0)
  assert.equal(run.get().timeline.operations[run.body.value.operationId].status, 'foreground-completed')
  assert.equal(run.sandbox.mvuReceiptsOf(run.get())[0].receipt.status, 'error')
})
