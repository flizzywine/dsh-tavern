import { createMvuSettlementEngine } from '../tavern-plugin/lib/domain/mvu-settlement-engine.js'
import { createPlainSettlementEngine } from '../tavern-plugin/lib/domain/plain-settlement-engine.js'
import { createSettlementRun } from '../tavern-plugin/lib/domain/settlement-run.js'
import { createSettlementControls } from '../tavern-plugin/lib/domain/settlement-controls.js'
import { createMvuSettlementResume } from '../tavern-plugin/lib/domain/mvu-settlement-resume.js'
import {applyJsonChanges} from '../tavern-plugin/lib/domain/json-mutation.js'
import { createSettlementJobs } from '../tavern-plugin/lib/domain/settlement-jobs.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { createSessionStateView, projectChatSessionState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { POSTURE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/posture-submission.js'
import { createPostureItem, plainSettlementPlan, runPipelineStages } from '../tavern-plugin/lib/domain/background-pipeline.js'

async function harness({ beginRunning = true, mvu = true } = {}) {
  let current = { backgroundTasks: { posture: true, characterDesign: true, variables: true }, id: 'chat', sessionId: 'session', mode: 'story', messages: [], mvu: { enabled: mvu, owner: mvu ? 'official' : null } }
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
  const running = beginRunning ? await tasks.begin(current, 'settlement') : null
  // The settlement's dependencies. The factories read them on every call, so tests swap services here.
  const sandbox = {
    storyEvents: createStoryEvents(), chatPersistence: { readWindow: async () => null }, readOpeningWindow: async () => null, serverScripts: null,
    taskStateReader: { forSession: async () => projectChatSessionState(await store.readChat()) },
    backgroundTasks: tasks, storyTimeline: timeline,
    readChat: store.readChat, chatForSession: store.readChat, writeChat: store.writeChat,
    patchChat: async (_id,revision,changes)=>{
      if(current._storageRevision!==revision)return undefined
      current=applyJsonChanges(current,changes)
      current._storageRevision=(current._storageRevision||0)+1
      current.updatedAt=Date.now()
      return {...structuredClone(current),messages:[]}
    },
    sessionStateForSession: async () => projectChatSessionState(await store.readChat()),
    prepareNextWorldBookContext: async () => assert.fail('retired recall preparation'), worldBookScanDepth: async () => 2, readChatCard: async () => ({}),
    view: async chat => chat,
    mvuUpdateRules: async () => [],
    backgroundModelSelection: () => ({}), runtimePrompt: () => '',
    backgroundAgentRunner: { async run() { throw new Error('backgroundAgentRunner not configured') } },
    agentRegistry: { get: () => undefined }, sessionStore: { get: () => undefined },
    conversationRegistry: { list: async () => [] },
    mvuSettlement: { settleVariables: async () => ({ receipt: { version: 1, status: 'unchanged', changes: [] } }) },
    pluginApi: { replaceSettlement: async () => null, checkVersions: async () => {} }
  }
  sandbox.postureItem = createPostureItem({ prompt: () => sandbox.runtimePrompt('posture-settlement'), tool: POSTURE_SUBMIT_TOOL })
  sandbox.plainSettlementPlan = plainSettlementPlan
  sandbox.runPipelineStages = runPipelineStages
  sandbox.mvuReceiptsOf = createSessionStateView({activity:chat=>tasks.activity(chat),evidence:()=>({})}).receipts
  // Read through the sandbox on every call, so the tests below can swap MVU services.
  sandbox.mvuSettlementEngine = createMvuSettlementEngine(sandbox)
  sandbox.plainSettlementEngine = createPlainSettlementEngine(sandbox)
  const settlementRun = createSettlementRun(sandbox)
  Object.assign(sandbox, {
    settlementRun,
    runSettlement: (...args) => settlementRun.runSettlement(...args),
    runSettlementCycle: (...args) => settlementRun.runCycle(...args),
    onSettlementSettled: (...args) => settlementRun.onSettled(...args),
    startPluginTask: (...args) => settlementRun.startPluginTask(...args),
    queueSettlement: chatId => sandbox.settlementJobs.start(chatId),
    cancelSettlement: (chatId, options) => sandbox.settlementJobs.cancel(chatId, options)
  })
  sandbox.settlementJobs = createSettlementJobs({run:(...args)=>sandbox.runSettlement(...args),onSettled:(...args)=>sandbox.onSettlementSettled(...args)})
  Object.assign(sandbox, createSettlementControls(sandbox))
  let onReady
  sandbox.tavernScriptDispatch = { subscribeSettled(fn) { onReady = fn; return () => {} }, status() { return { ready: true } } }
  const reconciler = createMvuSettlementResume(sandbox)
  const history = createRoundHistory({ chats: { read: store.readChat, forSession: store.readChat, readCard: async () => ({}) },
    sessions: { get: () => undefined }, scripts: {}, timeline, queueSettlement: async () => {}, present() {} })
  return { tasks, timeline, store, running, body, sandbox, history, onReady, reconciler, get: () => structuredClone(current) }
}

test('旧版安全挂起任务离线时保留提交，不丢弃为失败', async () => {
  const run = await harness()
  await run.running.defer({ apply(chat) { chat.messages[1].mvu.pendingSubmission = { operations: [] } } })
  run.sandbox.tavernScriptDispatch.status = () => ({ ready: false })
  let resumed = 0
  run.sandbox.mvuSettlement.resumeVariables = async () => { resumed++; return { receipt: { status: 'pending', changes: [] } } }
  await run.reconciler.wake('session')
  assert.equal(resumed, 0)
  assert.equal(run.get().messages[1].mvu.pending, true)
  assert.deepEqual(run.get().messages[1].mvu.pendingSubmission, { operations: [] })
})

for (const prepared of [false, true]) test(`进程在${prepared ? '结果保存后' : '任务保存后'}退出，重启自动完成同一变量提交`, async () => {
  const run = await harness({ beginRunning: false })
  let release, saved
  const wait = new Promise(resolve => { release = resolve })
  const checkpoint = new Promise(resolve => { saved = resolve })
  let generated = 0, executions = 0
  const resultFor = input => {
    const before = run.get(), after = structuredClone(before)
    after.messages[1].variables[0].stat_data.hp = 9
    return { submission: { operations: [{ op: 'delta', path: '/hp', value: -1 }] },
      effect: createMvuSettlementEffect({ ...input, before, after }),
      receipt: { status: 'updated', changes: [] } }
  }
  run.sandbox.mvuSettlement.settleVariables = async input => {
    generated++
    const result = resultFor(input)
    await input.onSubmission(result.submission)
    if (prepared) { executions++; await input.onPrepared(result) }
    saved(); await wait
    return result
  }
  const abandoned = run.sandbox.queueSettlement('chat')
  await checkpoint
  const persisted = run.get()
  assert.equal(persisted.messages[1].variables[0].stat_data.hp, 10)
  assert.equal(persisted.messages[1].mvu.delivery.version, 1)
  await run.tasks.recover(persisted)
  assert.equal(run.tasks.activity(run.get()).phase, 'pending')
  run.sandbox.settlementJobs.dispose()
  run.sandbox.settlementJobs = createSettlementJobs({run:(...args)=>run.sandbox.runSettlement(...args),onSettled:(...args)=>run.sandbox.onSettlementSettled(...args)})
  run.sandbox.mvuSettlement.resumeVariables = async input => { executions++; return resultFor(input) }
  await run.sandbox.queueSettlement('chat')
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 9)
  assert.equal(run.get().messages[1].mvu.pending, false)
  assert.equal(generated, 1)
  assert.equal(executions, 1)
  release(); await abandoned
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 9, 'abandoned worker cannot commit twice')
})

for (const recovery of ['自动恢复', '手动重新投递']) test('正式模型工具、调度器、草稿与剧情提交链路：漏领后' + recovery + '完成 delta 一次', async () => {
  const run = await harness({ beginRunning: false })
  const gate = createTavernScriptDispatch({ claimTimeoutMs: 100 })
  const adapter = createTavernScriptHostAdapter({ resolveChat: run.store.readChat, writeChat: run.store.writeChat,
    readCard: async () => ({}), worldBooks: { bound: async () => null }, scriptDispatch: gate })
  let models = 0
  run.sandbox.tavernScriptDispatch.status = gate.status
  run.sandbox.mvuSettlement = createMvuSettlementModule({ runtime: adapter, model: { async run(input) {
    models++
    await input.onToolCall({ name: 'posture_submit', arguments: { posture: '门边' } })
    await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [{ op: 'delta', path: '/hp', value: -1 }] } })
    return {}
  } } })
  gate.claim('session', 'browser', true)
  // Deliberately deliver no notification and no claim for the first attempt.
  await run.sandbox.queueSettlement('chat')
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 10)
  assert.equal(run.get().messages[1].mvu.pendingSubmission.operations[0].value, -1)
  assert.equal(run.tasks.activity(run.get()).phase, 'pending')
  assert.equal(run.get().messages[1].mvu.receipt.deferredReason, 'claim-timeout')
  // onSettled starts its own reconciliation check after the model job resolves.
  await new Promise(resolve => setImmediate(resolve))
  gate.claim('session', 'browser', true)
  if (recovery === '手动重新投递') await run.sandbox.retrySettlement('session', 2)
  const resumed = recovery === '自动恢复'
    ? run.reconciler.wake('session')
    : run.sandbox.queueSettlement('chat') // Coalesce a concurrent delivery request.
  let offer
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve))
    offer = gate.claim('session', 'browser', true)
    if (offer.event) break
  }
  assert.ok(offer.event)
  assert.equal(gate.start('session', offer.event.id, offer.leaseToken, 'browser').started, true)
  await adapter.updateMessages('session', [{ message_id: 1, data: { stat_data: { hp: 9 } } }], 0, offer.event.id)
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 10, 'script writes remain isolated')
  // An await or timer drops the event identity; like SillyTavern, the write joins the running settlement.
  await adapter.updateMessages('session', [{ message_id: 1, data: { stat_data: { hp: 9 } } }], 0, '')
  assert.equal(gate.complete('session', offer.event.id, [1], 'browser', offer.leaseToken), true)
  await resumed
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 9)
  assert.equal(run.get().settleStatus, 'done')
  assert.equal(models, 1)
  assert.equal(gate.complete('session', offer.event.id, [1], 'browser', offer.leaseToken), true, 'duplicate receipt acknowledges the original execution without committing twice')
  await assert.rejects(adapter.updateMessages('session', [{ message_id: 1, data: { stat_data: { hp: 8 } } }], 0, offer.event.id), { code: 'MVU_SETTLEMENT_EVENT_MISMATCH' })
  assert.equal(run.get().messages[1].variables[0].stat_data.hp, 9)
  run.reconciler.dispose()
})

for (const stage of ['read']) test(`销毁期间结束的 ${stage} 不能再启动后台结算`, async () => {
  const run = await harness({ beginRunning: false })
  let release, entered
  const held = new Promise(resolve => { release = resolve })
  const reading = new Promise(resolve => { entered = resolve })
  run.sandbox[stage === 'read' ? 'readChat' : 'prepareNextWorldBookContext'] = async () => {
    const snapshot = await run.store.readChat()
    entered(); await held; return snapshot
  }
  let begins = 0
  const begin = run.tasks.begin
  run.sandbox.backgroundTasks = { ...run.tasks, begin: (...args) => { begins++; return begin(...args) } }
  const pending = run.sandbox.queueSettlement('chat')
  await reading
  run.sandbox.settlementJobs.dispose()
  release()
  await pending.catch(error => { assert.equal(error.name, 'AbortError') })
  assert.equal(begins, 0)
  run.reconciler.dispose()
})

for(const storyChanged of [false,true])test(`retry CAS revalidates concurrent ${storyChanged?'body change':'display backfill'}`,async()=>{
 const run=await harness({beginRunning:false})
 const chat=run.get()
 chat._storageRevision=1
 await run.store.writeChat(chat)
 let attempts=0,queued=0
 const patch=run.sandbox.patchChat
 run.sandbox.patchChat=async(...args)=>{
  if(++attempts===1){
   await run.store.updateChat('chat',current=>{
    current._storageRevision++
    current.messages[0].tavernPluginData={template_rendered:true}
    if(storyChanged)current.messages[1].turn=3
    return current
   })
  }
  return patch(...args)
 }
 run.sandbox.queueSettlement=async()=>{queued++}
 if(storyChanged){
  await assert.rejects(run.sandbox.retrySettlement('session',2),/只能重试当前最新正文/)
  assert.equal(queued,0)
 }else{
  await run.sandbox.retrySettlement('session',2)
  assert.equal(attempts,2);assert.equal(queued,1)
  assert.equal(run.get().messages[0].tavernPluginData.template_rendered,true)
  assert.equal(run.get().messages[1].mvu.variableRetry,true)
 }
})

test('插件结算任务：结算前的在结算待办时运行，结算后的在提交之后运行，期间本局显示后台忙', async () => {
  const h = await harness({ beginRunning: false, mvu: false })
  const seen = []
  h.sandbox.backgroundAgentRunner.run = async input => { seen.push('tavern'); await input.onToolCall({ name: 'posture_submit', arguments: { posture: '门边' } }); return { text: '' } }
  h.sandbox.taskStateReader.read = async () => h.store.readChat()
  h.sandbox.pluginSettlementProgress = { begin: () => () => {} }
  h.sandbox.pluginApi.runSettlementTasks = async ({ gameId, phase, around }) => {
    const activity = h.tasks.activity(h.get())
    seen.push(phase + ':' + gameId + ':' + activity.role + ':' + activity.phase)
    if (around) await around(async operationId => { const inside = h.tasks.activity(h.get()); assert.equal(operationId, inside.operationId); seen.push('inside:' + inside.role + ':' + inside.busy) })
  }
  const jobs = createSettlementJobs({ run: (...args) => h.sandbox.runSettlementCycle(...args), onSettled: () => {} })
  await jobs.start('chat')
  // Parallel tasks start together with Tavern's own settlement (they run alongside it).
  assert.deepEqual(seen, ['before:session:settlement:pending', 'parallel:session:settlement:pending', 'tavern', 'after:session:settlement:idle', 'inside:plugin-task:true'])
  assert.equal(h.get().settleStatus, 'done')
  assert.equal(h.tasks.activity(h.get()).busy, false, 'the plugin-task operation is closed afterwards')
  jobs.dispose()
})

test('手动插件任务：登记为独占的后台任务，跑完后关闭；结算待办时不能启动', async () => {
  const pending = await harness({ beginRunning: false, mvu: false })
  pending.sandbox.pluginApi.manualTaskFor = async () => ({})
  await assert.rejects(pending.sandbox.startPluginTask('session', 'alpha:summary'), /正在执行 settlement/)

  const h = await harness({ beginRunning: false, mvu: false })
  h.sandbox.backgroundAgentRunner.run = async input => { await input.onToolCall({ name: 'posture_submit', arguments: { posture: '门边' } }); return { text: '' } }
  await h.sandbox.queueSettlement('chat')
  let release
  const calls = []
  h.sandbox.pluginSettlementProgress = { begin: () => () => {} }
  h.sandbox.pluginApi.manualTaskFor = async (gameId, key, input) => { calls.push([gameId, key, input]) }
  h.sandbox.pluginApi.runManualTask = async ({ operationId }) => { assert.equal(operationId, h.tasks.activity(h.get()).operationId); await new Promise(resolve => { release = resolve }); return true }
  assert.deepEqual(JSON.parse(JSON.stringify(await h.sandbox.startPluginTask('session', 'alpha:summary', '人物'))), { started: true })
  assert.deepEqual(calls, [['session', 'alpha:summary', '人物']])
  const busy = h.tasks.activity(h.get())
  assert.equal(busy.role, 'plugin-task')
  assert.equal(busy.busy, true)
  await assert.rejects(h.sandbox.startPluginTask('session', 'alpha:summary'), /已有插件任务/)
  const job = h.sandbox.settlementRun.pluginTaskJob('chat')
  release()
  await job
  assert.equal(h.tasks.activity(h.get()).busy, false)
  assert.equal(h.sandbox.settlementRun.pluginTaskJob('chat'), undefined)
})

// Guards for the background task pipeline refactor (docs/design/background-task-pipeline.md):
// what Tavern's own settlement asks of the model must stay byte-identical.
function settlementRequest(input) {
  return JSON.parse(JSON.stringify({ task: input.task, persistent: input.persistent, system: input.system, tools: (input.tools || []).map(tool => tool.name),
    messages: (input.messages || []).map(message => message.content.map(block => block.text).join('')), maxToolCalls: input.maxToolCalls, temperature: input.temperature,
    turn: input.turn, backgroundTasks: input.backgroundTasks }))
}
