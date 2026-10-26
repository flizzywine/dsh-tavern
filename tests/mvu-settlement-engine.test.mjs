import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementEngine } from '../tavern-plugin/lib/domain/mvu-settlement-engine.js'

const engine = createMvuSettlementEngine({})
const official = { enabled: true, owner: 'official' }
const game = mvu => ({ mvu: official, messages: [{ role: 'user' }, { role: 'assistant', turn: 2, swipeId: 0, variables: [{ stat_data: { hp: 1 } }], mvu }] })

test('only an official MVU game with a waiting reply has a target; a switched-off task still delivers a saved submission', () => {
  assert.equal(engine.target({ ...game({ pending: true }), mvu: { enabled: true, owner: 'card' } }), null)
  const target = engine.target(game({ pending: true }))
  assert.equal(target.messageId, 1)
  assert.equal(engine.runs(target, { variables: false }), false)
  assert.equal(engine.runs(engine.target(game({ pending: true, pendingSubmission: {} })), { variables: false }), true)
  assert.deepEqual(engine.settings(game({ pending: true, variableRetry: true })).posture, false, 'a variable retry settles the variables alone')
})

test('the commit marks a switched-off reply skipped; a failure closes it with an error receipt', () => {
  const chat = game({ pending: true })
  const target = engine.target(chat)
  const commit = engine.completion({ mvuTarget: target, mvuResult: null, backgroundTasksSettings: { variables: false } })
  assert.equal(commit.stateChanged, false)
  assert.deepEqual(commit.messageIndices, [1])
  commit.apply(chat, {})
  assert.equal(chat.messages[1].mvu.receipt.status, 'skipped')
  assert.equal(chat.messages[1].mvu.pending, false)

  const failed = game({ pending: true })
  assert.equal(engine.recordFailure(failed, new Error('x'), '模型超时'), true)
  assert.deepEqual(failed.messages[1].mvu.receipt.failures, [{ command: '', message: '模型超时' }])
  assert.equal(engine.recordFailure({ messages: [] }, new Error('x'), 'x'), false)
})

test('a retry redelivers a waiting submission as saved, or restarts the variables; never both', () => {
  const plain = { chat: { mvu: null }, target: {}, activity: {} }
  assert.equal(engine.prepareRetry(plain), 'none')
  const waiting = () => ({ chat: { mvu: official }, target: { message: { swipeId: 0, mvu: { receipt: { status: 'pending' }, pendingSubmission: {} } } }, activity: { phase: 'pending' } })
  assert.equal(engine.prepareRetry(waiting()), 'redeliver')
  assert.throws(() => engine.prepareRetry({ ...waiting(), guidance: '多加点血' }), /只能重新投递/)
  const done = { chat: { mvu: official }, target: { message: { swipeId: 0, mvuBaseline: { swipeId: 0 }, mvu: { receipt: { status: 'updated' }, guidance: '旧意见' } } }, activity: {} }
  assert.equal(engine.prepareRetry({ ...done, guidance: ' 新意见 ' }), 'reset')
  assert.deepEqual(done.target.message.mvu, { pending: true, variableRetry: true, guidance: '新意见', modified: false, diagnostics: [], events: [] })
  const noBaseline = { chat: { mvu: official }, target: { message: { swipeId: 0, mvu: { receipt: { status: 'updated' } } } }, activity: {} }
  assert.throws(() => engine.prepareRetry(noBaseline), /没有结算前快照/)
})

function providerRun({ saved = false, active = true, tasks = { posture: false, characterDesign: false }, modelSelection = { model: 'm' }, unloadDuringResume = false, unloadDuringAuxiliary = false } = {}) {
  const variables = { stat_data: { hp: 2 }, schema: {} }
  const message = { role: 'assistant', turn: 2, swipeId: 0, text: '小火龙出现。', variables: [variables],
    mvuBaseline: { swipeId: 0, variables }, mvu: { pending: true,
      ...(saved ? { pendingSubmission: { operations: [{ op: 'replace', path: '/stat_data/hp', value: 3 }] },
        delivery: { branchId: 'branch', revision: 7, lifecycleRevision: 2, swipeId: 0, provider: { owner: 'card-plugin' }, auxiliaryPending: true } } : {}) } }
  const snapshot = { id: 'chat', sessionId: 'game', mvu: { enabled: true, owner: 'official' },
    tavernHelperLifecycleRevision: 2, messages: [{ role: 'user', text: '选小火龙' }, message], guides: [] }
  const calls = []
  let failAuxiliaryOnce = false
  let activeNow = active
  let registered = true
  const taskRun = { operationId: 'operation', basedOn: { branchId: 'branch', revision: 7 },
    async checkpointMessage(_id, update) { update(snapshot, message) },
    async bindSession() {} }
  const pluginApi = {
    async mvuProvider(input) { calls.push(['provider', input]); return { owner: 'card-plugin', operations: [{ op: 'replace', path: '/stat_data/hp', value: 3 }] } },
    async mvuProviderActive(input) { calls.push(['active', input]); return activeNow },
    mvuProviderRegistered(owner) { return registered && owner === 'card-plugin' }
  }
  const mvuSettlement = {
    async resumeProviderVariables(input) {
      calls.push(['provider-resume', input])
      await input.onSubmission(input.submission)
      if (unloadDuringResume) activeNow = false
      return { submission: input.submission, variables, receipt: { status: 'updated' }, effect: { changes: [] } }
    },
    async resumeVariables(input) {
      calls.push(['resume', input])
      await input.onSubmission(input.submission)
      return { submission: input.submission, variables, receipt: { status: 'updated' }, effect: { changes: [] } }
    },
    async settleVariables(input) { calls.push(['model', input]); return { receipt: { status: 'unchanged' } } },
    async settleAuxiliary(input) {
      calls.push(['auxiliary', input])
      if (failAuxiliaryOnce) { failAuxiliaryOnce = false; throw new Error('aux interrupted') }
      if (unloadDuringAuxiliary) activeNow = false
      return { posture: '站在路旁', text: '' }
    }
  }
  const engine = createMvuSettlementEngine({ pluginApi, mvuSettlement,
    mvuUpdateRules: async () => [], backgroundModelSelection: () => modelSelection, postureItem: { requirement: () => 'pose' },
    tavernScriptDispatch: { status: () => ({}) } })
  const target = engine.target(snapshot)
  return { engine, snapshot, message, taskRun, target, calls, mvuSettlement, tasks,
    failAuxiliaryOnce() { failAuxiliaryOnce = true }, setRegistered(value) { registered = value } }
}

function ownerGuardEffect() {
  return { version: 1, operationId: 'operation', chatId: 'chat', sessionId: 'game', branchId: 'branch', basedOnRevision: 7,
    expectedLifecycleRevision: 2, messageId: 1, swipeId: 0,
    changes: [{ op: 'replace', path: ['messages', 1, 'variables', 0, 'stat_data', 'hp'], value: 99 }] }
}

test('MVU engine：本地 provider 走官方恢复事务、保存 owner，并独立执行姿势辅助任务', async () => {
  const run = providerRun({ tasks: { posture: true, characterDesign: false } })
  const result = await run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target })
  assert.equal(run.calls.filter(([kind]) => kind === 'provider').length, 1)
  assert.equal(run.calls.filter(([kind]) => kind === 'provider-resume').length, 1)
  assert.equal(run.calls.filter(([kind]) => kind === 'auxiliary').length, 1)
  assert.deepEqual(result.posture, '站在路旁')
  assert.equal(run.message.mvu.pendingSubmission.operations[0].path, '/stat_data/hp')
  assert.equal(run.message.mvu.delivery.provider.owner, 'card-plugin')
  assert.equal(run.message.mvu.delivery.auxiliaryPending, false)
  assert.ok(run.message.mvu.delivery.prepared)
  assert.equal(run.message.mvu.delivery.prepared.providerOwner, 'card-plugin')
})

test('MVU engine：provider pending 恢复不再调用 provider，只恢复官方提交并完成辅助任务', async () => {
  const run = providerRun({ saved: true, tasks: { posture: true, characterDesign: true } })
  await run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target })
  assert.equal(run.calls.filter(([kind]) => kind === 'provider').length, 0)
  assert.equal(run.calls.filter(([kind]) => kind === 'active').length, 3)
  assert.equal(run.calls.filter(([kind]) => kind === 'resume').length, 1)
  assert.equal(run.calls.filter(([kind]) => kind === 'auxiliary').length, 1)
  assert.equal(run.message.mvu.delivery.provider.owner, 'card-plugin')
  assert.equal(run.message.mvu.delivery.auxiliaryPending, false)
})

test('MVU engine：provider 卸载或换卡后拒绝恢复已保存的提交', async () => {
  const run = providerRun({ saved: true, active: false })
  await assert.rejects(run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target }), /不再绑定当前卡/)
  assert.equal(run.calls.filter(([kind]) => kind === 'resume').length, 0)
  assert.equal(run.calls.filter(([kind]) => kind === 'provider').length, 0)
})

test('MVU engine：恢复事务与aux之间断开后保留 auxiliaryPending，重试不调用provider且补齐prepared', async () => {
  const run = providerRun({ saved: true, tasks: { posture: true, characterDesign: true } })
  run.failAuxiliaryOnce()
  const args = { snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target }
  await assert.rejects(run.engine.run(args), /aux interrupted/)
  assert.equal(run.message.mvu.delivery.auxiliaryPending, true)
  assert.equal(run.message.mvu.delivery.prepared, undefined, 'resume cannot prematurely mark provider delivery prepared')
  await run.engine.run(args)
  assert.equal(run.calls.filter(([kind]) => kind === 'provider').length, 0)
  assert.equal(run.calls.filter(([kind]) => kind === 'resume').length, 2)
  assert.equal(run.calls.filter(([kind]) => kind === 'auxiliary').length, 2)
  assert.equal(run.message.mvu.delivery.auxiliaryPending, false)
  assert.ok(run.message.mvu.delivery.prepared)
})

test('MVU engine：owner卸载后，即使delivery已prepared也不提交', async () => {
  const run = providerRun({ saved: true, active: false })
  run.message.mvu.delivery.prepared = { submission: run.message.mvu.pendingSubmission, receipt: { status: 'updated' }, effect: { changes: [] } }
  await assert.rejects(run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target }), /已准备的操作提交已取消/)
  assert.equal(run.calls.filter(([kind]) => kind === 'provider').length, 0)
})

test('MVU engine：owner在官方事务派发期间卸载时不保存prepared、不返回可提交effect', async () => {
  const run = providerRun({ unloadDuringResume: true })
  await assert.rejects(run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target }), /结算提交已取消/)
  assert.ok(run.message.mvu.pendingSubmission, '提交已经durable，恢复时会验证 owner')
  assert.equal(run.message.mvu.delivery.prepared, undefined)
})

test('MVU engine：owner在auxiliary期间卸载时不保存prepared、不返回可提交effect', async () => {
  const run = providerRun({ tasks: { posture: true, characterDesign: false }, unloadDuringAuxiliary: true })
  await assert.rejects(run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target }), /prepared 保存已取消/)
  assert.equal(run.calls.filter(([kind]) => kind === 'auxiliary').length, 1)
  assert.equal(run.message.mvu.delivery.prepared, undefined)
})

test('MVU engine：无姿势或人物设计任务时，本地 provider 不需要模型配置', async () => {
  const run = providerRun({ modelSelection: null })
  const result = await run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target })
  assert.equal(result.mvuResult.receipt.status, 'updated')
  assert.equal(run.calls.filter(([kind]) => kind === 'model').length, 0)
  assert.equal(run.calls.filter(([kind]) => kind === 'auxiliary').length, 0)
})

test('MVU engine：run成功后owner在同步completion.apply前卸载，effect不改变量', async () => {
  const run = providerRun()
  const result = await run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target })
  assert.equal(result.mvuResult.providerOwner, 'card-plugin')
  result.mvuResult.effect = ownerGuardEffect()
  run.setRegistered(false)
  const draft = structuredClone(run.snapshot)
  const completion = run.engine.completion({ mvuTarget: run.target, mvuResult: result.mvuResult, backgroundTasksSettings: run.tasks })
  assert.throws(() => completion.apply(draft, { messageIndices: [1] }), /provider 已卸载/)
  assert.equal(draft.messages[1].variables[0].stat_data.hp, 2)
})

test('MVU engine：恢复的prepared保留providerOwner并经过同步completion guard', async () => {
  const run = providerRun({ saved: true })
  run.message.mvu.delivery.prepared = { submission: run.message.mvu.pendingSubmission, receipt: { status: 'updated' },
    effect: ownerGuardEffect() }
  const result = await run.engine.run({ snapshot: run.snapshot, taskRun: run.taskRun, card: { name: '小智' }, signal: new AbortController().signal,
    trace: { sessionId: 'session', boundary: null }, backgroundTasksSettings: run.tasks, mvuTarget: run.target })
  assert.equal(result.mvuResult.providerOwner, 'card-plugin')
  run.setRegistered(false)
  const draft = structuredClone(run.snapshot)
  const completion = run.engine.completion({ mvuTarget: run.target, mvuResult: result.mvuResult, backgroundTasksSettings: run.tasks })
  assert.throws(() => completion.apply(draft, { messageIndices: [1] }), /provider 已卸载/)
  assert.equal(draft.messages[1].variables[0].stat_data.hp, 2)
})
