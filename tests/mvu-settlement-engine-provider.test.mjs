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
  let loadedUpdateRules = 0, fallbackInput
  const mvuSettlement = {
    async resumeProviderVariables() { return { submission: { operations: [] }, receipt: { status: 'updated', changes: [] } } },
    async settleVariables(input) { fallbackInput = input; return { receipt: { status: 'unchanged', changes: [] } } }
  }
  const engine = createMvuSettlementEngine({
    mvuSettlement,
    mvuUpdateRules: async () => { loadedUpdateRules++; return ['card rule'] },
    backgroundModelSelection: () => ({ provider: 'fixture', model: 'fixed' }),
    postureItem: { requirement: () => '' }, tavernScriptDispatch: { status: () => ({ ready: true }) },
    pluginApi: {
      mvuProvider: async () => providerResult,
      mvuProviderActive: async () => true
    }
  })
  return { engine, snapshot, taskRun, counts: () => ({ loadedUpdateRules, fallbackInput }) }
}

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
