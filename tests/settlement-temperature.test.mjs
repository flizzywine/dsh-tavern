import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundRequestTemperature } from '../tavern-plugin/lib/domain/background-request-temperature.js'
import { createCharacterDesignStage } from '../tavern-plugin/lib/domain/character-design-stage.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createPlainSettlementEngine } from '../tavern-plugin/lib/domain/plain-settlement-engine.js'
import { createPostureItem } from '../tavern-plugin/lib/domain/background-pipeline.js'
import { POSTURE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/posture-submission.js'

for (const provider of ['moonshotai-cn', 'kimi-coding', 'deepseek-official', 'openai-codex']) test(`settlement omits inherited and explicit temperature for ${provider}`, async () => {
  const stage = createCharacterDesignStage({ temperature: 0.9 })
  const input = { task: 'settlement', temperature: 0.1, selection: { provider } }
  const request = Object.freeze({ temperature: 0.4, messages: [], tools: [], maxTokens: 123, signal: new AbortController().signal })
  for (const name of [null, 'character_design_read', 'character_design_save', 'character_design_finish']) {
    if (name) await stage.execute(name, async () => 'ok')
    const projected = backgroundRequestTemperature(request, input, stage)
    assert.equal(Object.hasOwn(projected, 'temperature'), false)
    for (const key of ['messages', 'tools', 'maxTokens', 'signal']) assert.equal(projected[key], request[key])
  }
  assert.equal(request.temperature, 0.4, 'does not mutate host request')
})

for (const task of ['candidate', 'character-design']) test(`${task} retains its existing temperature and creative stage`, async () => {
  const stage = createCharacterDesignStage()
  const input = { task, temperature: 0.2, selection: { provider: 'test' } }
  const temperatures = [backgroundRequestTemperature({}, input, stage).temperature]
  await stage.execute('character_design_read', async () => 'ok')
  temperatures.push(backgroundRequestTemperature({}, input, stage).temperature)
  await stage.execute('character_design_finish', async () => 'ok')
  temperatures.push(backgroundRequestTemperature({}, input, stage).temperature)
  assert.deepEqual(temperatures, [0.2, 0.7, 0.2])
})

for (const method of ['settleVariables', 'settleAuxiliary']) test(`${method} passes no task temperature and makes no automatic retry`, async () => {
  const calls = []
  const sentinel = new Error('scripted provider rejection')
  const module = createMvuSettlementModule({ runtime: { async settleMvuUpdate() { assert.fail('model failure must not apply variables') } }, model: { async run(input) { calls.push(input); throw sentinel } } })
  await assert.rejects(module[method]({ operationId: 'temperature', chatId: 'c', branchId: 'b', basedOnRevision: 1,
    sessionId: 's', messageId: 0, swipeId: 0, storyText: '她站在门边。', currentVariables: { stat_data: { hp: 3 } } }), /scripted provider rejection/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].task, 'settlement')
  assert.equal(Object.hasOwn(calls[0], 'temperature'), false)
})

test('plain settlement passes no task temperature and makes no automatic retry', async () => {
  const calls = []
  const engine = createPlainSettlementEngine({
    settlementItems: { wanted: async () => true }, pluginApi: { replaceSettlement: async () => null },
    pluginSettlementProgress: { begin() {} }, backgroundModelSelection: () => ({ provider: 'kimi-coding', model: 'fixed' }),
    postureItem: createPostureItem({ prompt: () => '要求', tool: POSTURE_SUBMIT_TOOL }),
    backgroundAgentRunner: { async run(input) { calls.push(input); throw new Error('scripted provider rejection') } },
    agentRegistry: new Map(), sessionStore: new Map()
  })
  await assert.rejects(engine.run({
    snapshot: { id: 'game', sessionId: 'story', messages: [] }, taskRun: { bindSession() {}, participantRequest: { rewindTo: 0 } },
    card: {}, trace: { sessionId: '', boundary: null }, backgroundTasksSettings: { posture: true }
  }), /scripted provider rejection/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].task, 'settlement')
  assert.equal(Object.hasOwn(calls[0], 'temperature'), false)
})
