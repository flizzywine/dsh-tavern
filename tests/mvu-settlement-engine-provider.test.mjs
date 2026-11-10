import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementEngine } from '../tavern-plugin/lib/domain/mvu-settlement-engine.js'

function fixture(providerResult) {
  const baseline = { stat_data: { hp: 10 }, schema: {} }
  const snapshot = {
    id: 'chat', sessionId: 'game', mvu: { enabled: true, owner: 'official' },
    backgroundTasks: { variables: true, posture: false, characterDesign: false },
    messages: [
      { role: 'user', text: '前进', turn: 2 },
      { role: 'assistant', text: '你走进森林。', turn: 2, mvu: { pending: true },
        mvuBaseline: { swipeId: 0, variables: baseline }, variables: [baseline] }
    ],
    timeline: { branchId: 'main' }
  }
  const taskRun = {
    operationId: 'settlement-op', basedOn: { branchId: 'main', revision: 4 },
    participantRequest: { sessionId: 'background' },
    async checkpointMessage() {}, bindSession() {}, participant() { return null }
  }
  let loadedUpdateRules = 0, fallbackInput, providerRuns = 0, auxiliaryRuns = 0
  const mvuSettlement = {
    async resumeProviderVariables() { providerRuns++; return { submission: { operations: [] }, receipt: { status: 'updated', changes: [] } } },
    async settleAuxiliary() { auxiliaryRuns++; return { posture: '站在林间', text: '', traceSessionId: 'auxiliary' } },
    async settleVariables(input) { fallbackInput = input; return { receipt: { status: 'unchanged', changes: [] } } }
  }
  const engine = createMvuSettlementEngine({
    mvuSettlement,
    mvuUpdateRules: async () => { loadedUpdateRules++; return ['card rule'] },
    backgroundModelSelection: () => ({ provider: 'fixture', model: 'fixed' }),
    postureItem: { requirement: () => '' }, tavernScriptDispatch: { status: () => ({ ready: true }) },
    pluginApi: {
      mvuProvider: async () => providerResult,
      mvuProviderActive: async () => true,
      mvuProviderRegistered: owner => owner === 'card-provider'
    }
  })
  return { engine, snapshot, taskRun, providerRuns: () => providerRuns, auxiliaryRuns: () => auxiliaryRuns, counts: () => ({ loadedUpdateRules, fallbackInput }) }
}

test('明确无变化但启用姿势时仍派发 MVU 并完成辅助姿势', async () => {
  const { engine, snapshot, taskRun, providerRuns, auxiliaryRuns } = fixture({ owner: 'card-provider', operations: [], unchanged: true })
  snapshot.backgroundTasks.posture = true
  const result = await engine.run({ snapshot, taskRun, card: {}, trace: {}, backgroundTasksSettings: engine.settings(snapshot), mvuTarget: engine.target(snapshot) })
  assert.equal(providerRuns(), 1)
  assert.equal(auxiliaryRuns(), 1)
  assert.equal(result.posture, '站在林间')
  assert.equal(result.mvuResult.runtimeSkipped, undefined)
})

test('明确无变化的 provider 回执无需运行浏览器 MVU，普通空补丁仍投递', async () => {
  for (const unchanged of [false, true]) {
    const { engine, snapshot, taskRun, providerRuns } = fixture({ owner: 'card-provider', operations: [], unchanged })
    const mvuTarget = engine.target(snapshot)
    const result = await engine.run({ snapshot, taskRun, card: {}, trace: {}, backgroundTasksSettings: snapshot.backgroundTasks, mvuTarget })
    assert.equal(providerRuns(), unchanged ? 0 : 1)
    if (unchanged) {
      engine.completion({ mvuTarget, mvuResult: result.mvuResult }).apply(snapshot)
      assert.equal(snapshot.messages[1].mvu.pending, false)
      assert.equal(snapshot.messages[1].mvu.receipt.status, 'unchanged')
      assert.deepEqual(snapshot.messages[1].mvu.events, [])
      assert.equal(snapshot.messages[1].variables[0].stat_data.hp, 10)
    }
  }
})

test('MVU provider 已提交补丁时跳过模型专用 World Book 规则读取，fallback 仍读取', async () => {
  const provider = fixture({ owner: 'card-provider', operations: [{ op: 'replace', path: '/stat_data/hp', value: 9 }] })
  await provider.engine.run({ snapshot: provider.snapshot, taskRun: provider.taskRun, card: {}, signal: undefined, trace: {},
    backgroundTasksSettings: provider.snapshot.backgroundTasks, mvuTarget: provider.engine.target(provider.snapshot) })
  assert.deepEqual(provider.counts(), { loadedUpdateRules: 0, fallbackInput: undefined })

  const fallback = fixture(null)
  await fallback.engine.run({ snapshot: fallback.snapshot, taskRun: fallback.taskRun, card: {}, signal: undefined, trace: {},
    backgroundTasksSettings: fallback.snapshot.backgroundTasks, mvuTarget: fallback.engine.target(fallback.snapshot) })
  assert.equal(fallback.counts().loadedUpdateRules, 1)
  assert.deepEqual(fallback.counts().fallbackInput.updateRules, ['card rule'])
})
