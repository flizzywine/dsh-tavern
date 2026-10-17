import { createSettlementProgressGuard } from '../tavern-plugin/lib/domain/settlement-progress-guard.js'
import { readSettlementInput } from '../tavern-plugin/lib/domain/settlement-input.js'
import {applyJsonChanges} from '../tavern-plugin/lib/domain/json-mutation.js'
import { createSettlementJobs } from '../tavern-plugin/lib/domain/settlement-jobs.js'
import { createSessionStateView, projectChatSessionState, pendingMvuSettlementState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { collectMvuHelperContext, createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { normalizeBackgroundTasks } from '../tavern-plugin/lib/domain/tavern-settings.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { applyMvuSettlementEffect, createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createMvuSettlementReconciler } from '../tavern-plugin/lib/domain/mvu-settlement-reconciler.js'
import { LEDGER_SUBMIT_TOOL, LEDGER_RULES, ledgerContext, createLedgerSubmission } from '../tavern-plugin/lib/domain/story-ledger.js'
import { POSTURE_SUBMIT_TOOL, POSTURE_SUBMIT_TOOL_NAME, lastSubmittedPosture, normalizePostureSubmission } from '../tavern-plugin/lib/domain/posture-submission.js'
import { CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL } from '../tavern-plugin/lib/domain/character-design-document.js'
import { createPostureItem, plainSettlementPlan, runPipelineStages } from '../tavern-plugin/lib/domain/background-pipeline.js'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
function section(start, end) {
  const from = server.indexOf(start)
  const to = server.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return server.slice(from, to)
}

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
  const sandbox = vm.createContext({
    createSettlementProgressGuard, readSettlementInput, chatPersistence: { readWindow: async () => null }, readOpeningWindow: async () => null, serverScripts: null,
    taskStateReader: { forSession: async () => projectChatSessionState(await store.readChat()) },
    collectMvuHelperContext, normalizeBackgroundTasks, pendingMvuSettlementState, structuredClone, Date, AbortController, console: { log() {}, error() {} },
    str: value => value == null ? '' : String(value),
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
    prepareNextWorldBookContext: async chat => chat, worldBookScanDepth: async () => 2, readChatCard: async () => ({}),
    view: async chat => chat, settlementTurn: () => 2,
    projectAgentMessageText: message => message.text, mvuUpdateRules: async () => [],
    readTavernSettings: async () => ({ backgroundTasks: { posture: true, characterDesign: true } }),
    backgroundModelSelection: () => ({}), runtimePrompt: () => '',
    settleUserText: () => '【本轮正文】\n门开了',
    applySettlement: () => ({ postureUpdated: false }), applyMvuSettlementEffect, createMvuSettlementReconciler,
    backgroundAgentRunner: { async run() { throw new Error('backgroundAgentRunner not configured') } },
    characterDesignDocuments: { async execute() { return JSON.stringify({ ok: true }) } },
    CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL,
    POSTURE_SUBMIT_TOOL, POSTURE_SUBMIT_TOOL_NAME, normalizePostureSubmission, lastSubmittedPosture,
    agentRegistry: { get: () => undefined }, sessionStore: { get: () => undefined },
    LEDGER_SUBMIT_TOOL, LEDGER_RULES, ledgerContext, createLedgerSubmission,
    conversationRegistry: { list: async () => [] }, ctx: { effect() {} },
    mvuSettlement: { settleVariables: async () => ({ receipt: { version: 1, status: 'unchanged', changes: [] } }) },
    pluginApi: { replaceSettlement: async () => null }
  })
  sandbox.postureItem = createPostureItem({ prompt: () => sandbox.runtimePrompt('posture-settlement'), tool: POSTURE_SUBMIT_TOOL })
  sandbox.plainSettlementPlan = plainSettlementPlan
  sandbox.runPipelineStages = runPipelineStages
  sandbox.mvuReceiptsOf = createSessionStateView({activity:chat=>tasks.activity(chat),evidence:()=>({})}).receipts
  vm.runInContext(section('  function pendingMvuTarget(', '  async function mvuUpdateRules('), sandbox)
  vm.runInContext(section('  async function runSettlement(', '  const mvuSettlementReconciler'), sandbox)
  sandbox.settlementJobs = createSettlementJobs({run:(...args)=>sandbox.runSettlement(...args),onSettled:(...args)=>sandbox.onSettlementSettled(...args)})
  vm.runInContext(section('  async function retrySettlement(', '  async function pullBackgroundCycle('), sandbox)
  let onReady
  sandbox.tavernScriptDispatch = { subscribeSettled(fn) { onReady = fn }, status() { return { ready: true } } }
  vm.runInContext(section('  const mvuSettlementReconciler', '  async function retrySettlement'), sandbox)
  const history = createRoundHistory({ chats: { read: store.readChat, forSession: store.readChat, readCard: async () => ({}) },
    sessions: { get: () => undefined }, scripts: {}, timeline, queueSettlement: async () => {}, present() {} })
  return { tasks, timeline, store, running, body, sandbox, history, onReady, reconciler: vm.runInContext('mvuSettlementReconciler', sandbox), get: () => structuredClone(current) }
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
  await assert.rejects(run.history.regenerate('chat', '', 'session'), /无法访问 DSH 会话/,
    '中断的旧结算不再阻止重生成，继续访问原生会话')
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

test('变量 effect 与 receipt 提交时不重复推进正文 checkpoint 和 revision', async () => {
  const run = await harness({ beginRunning: false })
  const commits = []
  const originalUpdate = run.store.updateChat
  run.store.updateChat = async function (...args) {
    const saved = await originalUpdate(...args)
    commits.push({ source: args[2]?.source, chat: structuredClone(saved) })
    return saved
  }
  run.sandbox.mvuSettlement.settleVariables = async input => {
    const before = run.get()
    const after = structuredClone(before)
    after.messages[1].variables[0].stat_data.hp = 9
    return {
      effect: createMvuSettlementEffect({
        operationId: input.operationId,
        chatId: before.id, sessionId: before.sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision: 0, messageId: 1, swipeId: 0,
        before, after
      }),
      receipt: { version: 1, status: 'updated', changes: [{ path: '/hp', before: 10, after: 9 }] }
    }
  }

  await run.sandbox.queueSettlement('chat')

  const saved = run.get()
  assert.equal(commits.filter(row => row.source === 'background.settlement.commit').length, 1)
  for (const { chat } of commits) {
    assert.equal(chat.timeline.revision, 1)
    assert.equal(chat.timeline.checkpoints.length, 1)
  }
  assert.equal(saved.messages[1].variables[0].stat_data.hp, 9)
  assert.equal(saved.messages[1].mvu.receipt.status, 'updated')
  assert.equal(saved.timeline.operations[run.body.value.operationId].status, 'completed')
  assert.equal(saved.timeline.revision, 1)
  assert.equal(saved.timeline.checkpoints.length, 1)
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

test('non-MVU settlement binds session before first response so interruption can reuse it', async () => {
  const h = await harness({ beginRunning: false, mvu: false });
  let bound = false;
  h.sandbox.backgroundAgentRunner.run = async input => {
    await input.onPersistentSessionReady('background-first-interrupted');
    bound = true;
    throw new Error('first request interrupted before response');
  };
  await h.sandbox.queueSettlement('chat');
  assert.equal(bound, true);
  const restarted = createBackgroundTaskCoordinator({ timeline: h.timeline, store: h.store });
  const next = await restarted.begin(h.get(), 'candidate');
  assert.equal(next.participantRequest.sessionId, 'background-first-interrupted');
});

test('插件替换结算：采用插件交回的姿势，不再运行 Tavern 自己的后台结算；插件退回时照常运行', async () => {
  const h = await harness({ beginRunning: false, mvu: false })
  const applied = [], requests = []
  let runs = 0
  h.sandbox.applySettlement = (_draft, result) => { applied.push(result); return { postureUpdated: Boolean(result.posture) } }
  h.sandbox.backgroundAgentRunner.run = async input => { runs++; await input.onToolCall({ name: 'posture_submit', arguments: { posture: 'Tavern 的姿势' } }); return { text: '' } }
  h.sandbox.pluginApi.replaceSettlement = async input => { requests.push(input); return { owner: 'anchor', posture: '插件的姿势' } }
  await h.sandbox.queueSettlement('chat')
  assert.equal(runs, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(applied)), [{ posture: '插件的姿势' }])
  assert.deepEqual(JSON.parse(JSON.stringify([requests[0].gameId, requests[0].turn, requests[0].text, requests[0].tasks])), ['session', 2, '门开了', { posture: true }])
  assert.equal(h.get().settleStatus, 'done')

  const fallback = await harness({ beginRunning: false, mvu: false })
  const fellBack = []
  fallback.sandbox.applySettlement = (_draft, result) => { fellBack.push(result); return { postureUpdated: true } }
  fallback.sandbox.backgroundAgentRunner.run = async input => { await input.onToolCall({ name: 'posture_submit', arguments: { posture: 'Tavern 的姿势' } }); return { text: '' } }
  await fallback.sandbox.queueSettlement('chat')
  assert.deepEqual(JSON.parse(JSON.stringify(fellBack)), [{ posture: 'Tavern 的姿势' }], 'no replacement: Tavern settles as before')
})

test('MVU 执行器失联保留持久任务，恢复后自动续办且不重开模型', async () => {
  const run = await harness({ beginRunning: false })
  const before = run.get().messages[1]
  let generated = 0, resumed = 0
  run.sandbox.tavernScriptDispatch.status = () => ({ ready: false })
  run.sandbox.mvuSettlement.settleVariables = async input => {
    generated++
    const submission = { operations: [] }
    await input.onSubmission(submission)
    return { submission, receipt: { status: 'pending', changes: [] } }
  }
  await run.sandbox.queueSettlement('chat')
  const pending = run.get()
  assert.equal(pending.settleStatus, 'pending')
  assert.equal(pending.messages[1].mvu.pending, true)
  assert.equal(pending.messages[1].text, before.text)
  assert.deepEqual(pending.messages[1].variables, before.variables)
  assert.equal(run.tasks.activity(pending).phase, 'pending')
  assert.equal(pending.messages[1].mvu.delivery.version, 1)
  run.sandbox.mvuSettlement.resumeVariables = async () => { resumed++; return { receipt: { status: 'unchanged', changes: [] } } }
  // Complete the independent onSettled offline check before reconnecting.
  await new Promise(resolve => setImmediate(resolve))
  run.sandbox.tavernScriptDispatch.status = () => ({ ready: true })
  await run.reconciler.wake('session')
  assert.equal(run.get().settleStatus, 'done')
  assert.equal(generated, 1)
  assert.equal(resumed, 1)
  assert.equal(run.get().messages[1].mvu.delivery, undefined)
})

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

test('接续刚创建新 operation 再次崩溃，仍能从原持久任务恢复', async () => {
  const run = await harness()
  await run.running.checkpoint(chat => {
    chat.messages[1].mvu.pendingSubmission = { operations: [] }
    chat.messages[1].mvu.delivery = { version: 1, operationId: run.running.operationId,
      branchId: run.running.basedOn.branchId, revision: run.running.basedOn.revision, lifecycleRevision: 0, swipeId: 0 }
  })
  await run.tasks.recover(run.get())
  const resumed = await run.tasks.begin(run.get(), 'settlement')
  assert.notEqual(resumed.operationId, run.running.operationId)
  await run.tasks.recover(run.get())
  assert.equal(run.tasks.activity(run.get()).phase, 'pending')
  const target = run.get()
  target.tavernHelperLifecycleRevision = 1
  await run.store.writeChat(target)
  await run.tasks.begin(run.get(), 'settlement')
  await run.tasks.recover(run.get())
  assert.equal(run.tasks.activity(run.get()).phase, 'failed', 'changed target cannot reuse the old task')
})

for (const stage of ['read', 'prepare']) test(`销毁期间结束的 ${stage} 不能再启动后台结算`, async () => {
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
  assert.deepEqual(seen, ['before:session:settlement:pending', 'tavern', 'after:session:settlement:idle', 'inside:plugin-task:true'])
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
  const jobs = vm.runInContext('pluginTaskJobs', h.sandbox)
  const job = jobs.get('chat')
  release()
  await job
  assert.equal(h.tasks.activity(h.get()).busy, false)
  assert.equal(jobs.size, 0)
})

// Guards for the background task pipeline refactor (docs/design/background-task-pipeline.md):
// what Tavern's own settlement asks of the model must stay byte-identical.
function settlementRequest(input) {
  return JSON.parse(JSON.stringify({ task: input.task, persistent: input.persistent, system: input.system, tools: (input.tools || []).map(tool => tool.name),
    messages: (input.messages || []).map(message => message.content.map(block => block.text).join('')), maxToolCalls: input.maxToolCalls, temperature: input.temperature,
    turn: input.turn, backgroundTasks: input.backgroundTasks }))
}

test('管线护栏：普通卡开姿势时，结算请求的提示词、工具与结束条件逐字不变', async () => {
  const h = await harness({ beginRunning: false, mvu: false })
  h.sandbox.runtimePrompt = name => '〈' + name + '〉'
  const requests = []
  h.sandbox.backgroundAgentRunner.run = async input => {
    requests.push(settlementRequest(input))
    assert.equal(input.stopToolsWhen(), false)
    await input.onToolCall({ name: 'posture_submit', arguments: { posture: '门边' } })
    assert.equal(input.stopToolsWhen(), true)
    assert.equal(input.acceptWithoutText(), true)
    return { text: '' }
  }
  await h.sandbox.queueSettlement('chat')
  assert.deepEqual(requests, [{ task: 'settlement', persistent: true, system: '〈posture-settlement〉\n\nposture_submit 是本任务最后一步。', tools: ['posture_submit'],
    messages: ['【本轮正文】\n门开了'], maxToolCalls: 12, temperature: 0.2, turn: 2, backgroundTasks: { posture: true, characterDesign: false, variables: true, ledger: false } }])
  assert.equal(h.get().settleStatus, 'done')
})

test('管线护栏：只开台词标注时照样跑结算（不提交姿势）；全部关闭时不调用模型也提交', async () => {
  const cast = await harness({ beginRunning: false, mvu: false })
  await cast.store.writeChat({ ...cast.get(), backgroundTasks: { posture: false, variables: true } })
  cast.sandbox.settlementItems = { wanted: async () => true }
  const requests = []
  cast.sandbox.backgroundAgentRunner.run = async input => { requests.push(settlementRequest(input)); assert.equal(input.acceptWithoutText(), false); return { text: '完成' } }
  await cast.sandbox.queueSettlement('chat')
  assert.deepEqual(requests, [{ task: 'settlement', persistent: true, system: '本轮不生成或提交姿势。完成启用的后台任务后简短回复完成。\n\n', tools: [],
    messages: ['【本轮正文】\n门开了'], maxToolCalls: 12, temperature: 0.2, turn: 2, backgroundTasks: { posture: false, characterDesign: false, variables: true, ledger: false } }])
  assert.equal(cast.get().settleStatus, 'done')

  const off = await harness({ beginRunning: false, mvu: false })
  await off.store.writeChat({ ...off.get(), backgroundTasks: { posture: false, variables: true } })
  off.sandbox.settlementItems = { wanted: async () => false }
  let runs = 0
  off.sandbox.backgroundAgentRunner.run = async () => { runs++; return { text: '' } }
  await off.sandbox.queueSettlement('chat')
  assert.equal(runs, 0)
  assert.equal(off.get().settleStatus, 'done')
})

test('管线护栏：官方 MVU 卡的变量结算收到的提示词与开关逐字不变', async () => {
  const h = await harness({ beginRunning: false, mvu: true })
  h.sandbox.runtimePrompt = name => '〈' + name + '〉'
  const inputs = []
  h.sandbox.mvuSettlement.settleVariables = async input => {
    inputs.push(JSON.parse(JSON.stringify({ system: input.system, backgroundTasks: input.backgroundTasks, guidance: input.guidance, preserveForeground: input.preserveForeground,
      storyText: input.storyText, turn: input.turn, messageId: input.messageId, swipeId: input.swipeId, webSearchEnabled: input.webSearchEnabled })))
    return { receipt: { version: 1, status: 'unchanged', changes: [] } }
  }
  await h.sandbox.queueSettlement('chat')
  assert.deepEqual(inputs, [{ system: '〈posture-settlement〉', backgroundTasks: { posture: true, characterDesign: false, variables: true, ledger: false }, guidance: '',
    preserveForeground: false, storyText: '门开了', turn: 2, messageId: 1, swipeId: 0, webSearchEnabled: false }])
})

test('管线护栏：一轮的阶段顺序是前置任务、主结算、后置任务、收尾', async () => {
  const h = await harness({ beginRunning: false, mvu: false })
  const seen = []
  h.sandbox.backgroundAgentRunner.run = async input => { seen.push('settle'); await input.onToolCall({ name: 'posture_submit', arguments: { posture: '门边' } }); return { text: '' } }
  h.sandbox.taskStateReader.read = async () => h.store.readChat()
  h.sandbox.pluginApi.runSettlementTasks = async ({ phase, around }) => { seen.push(phase); if (around) await around(async () => {}) }
  const jobs = createSettlementJobs({ run: (...args) => h.sandbox.runSettlementCycle(...args), onSettled: () => seen.push('settled') })
  await jobs.start('chat')
  assert.deepEqual(seen, ['before', 'settle', 'after', 'settled'])
  jobs.dispose()
})
