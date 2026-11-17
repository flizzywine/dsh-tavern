import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostureItem } from '../tavern-plugin/lib/domain/background-pipeline.js'
import { createPlainSettlementEngine } from '../tavern-plugin/lib/domain/plain-settlement-engine.js'
import { POSTURE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/posture-submission.js'

function engine({ replaced = null, submit = true } = {}) {
  const runs = []
  const settle = createPlainSettlementEngine({
    pluginApi: { replaceSettlement: async () => replaced },
    pluginSettlementProgress: { begin() {} },
    backgroundModelSelection: () => ({ provider: 'p', model: 'm' }),
    postureItem: createPostureItem({ prompt: () => '要求', tool: POSTURE_SUBMIT_TOOL }),
    backgroundAgentRunner: { async run(input) {
      runs.push(input)
      if (submit) await input.onToolCall({ name: 'posture_submit', arguments: { posture: '靠在门边' } })
      return { text: '', traceSessionId: 'background-1', traceBoundary: 3 }
    } },
    agentRegistry: new Map(), sessionStore: new Map()
  })
  return { settle, runs }
}
const turn = posture => ({
  snapshot: { id: 'game', sessionId: 'story', messages: [{ role: 'user', text: '开门' }, { role: 'assistant', turn: 2, text: '门开了' }] },
  taskRun: { bindSession() {}, participantRequest: { rewindTo: 0 } }, card: { name: '鱼' }, signal: undefined,
  trace: { sessionId: '', boundary: null }, backgroundTasksSettings: { posture }
})

test('posture off settles without a model call or a plugin', async () => {
  const { settle, runs } = engine()
  assert.deepEqual(await settle.run(turn(false)), { text: '', result: {} })
  assert.equal(runs.length, 0)
})

test('a plugin that replaces the settlement wins; Tavern runs its own agent when the plugin declines', async () => {
  const byPlugin = engine({ replaced: { owner: 'anchor', posture: '坐着' } })
  const result = await byPlugin.settle.run(turn(true))
  assert.equal(result.result.posture, '坐着')
  assert.equal(byPlugin.runs.length, 0)

  const own = engine()
  const current = turn(true)
  const settled = await own.settle.run(current)
  assert.equal(settled.result.posture, '靠在门边')
  assert.deepEqual(current.trace, { sessionId: 'background-1', boundary: 3 })
  assert.equal(own.runs[0].task, 'settlement')
})
