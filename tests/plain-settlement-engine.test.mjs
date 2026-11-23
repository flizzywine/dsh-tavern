import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostureItem } from '../tavern-plugin/lib/domain/background-pipeline.js'
import { createPlainSettlementEngine } from '../tavern-plugin/lib/domain/plain-settlement-engine.js'
import { POSTURE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/posture-submission.js'

function engine({ replaced = null, submit = true, guides = [] } = {}) {
  const runs = []
  const settle = createPlainSettlementEngine({
    pluginApi: { replaceSettlement: async () => replaced, guideSections: async () => guides },
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

test('后台姿势结算收到插件 Guide，只按正文已经发生的事实结算', async () => {
  const { settle, runs } = engine({ guides: [{ text: '把下一幕留给访客。' }] })
  await settle.run(turn(true))
  const text = runs[0].messages[0].content[0].text
  assert.match(text, /门开了[\s\S]*<user_guide>[\s\S]*only what actually happened[\s\S]*把下一幕留给访客/)
})
