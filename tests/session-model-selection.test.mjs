import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAgentModelSelection, selectSessionModel } from '../tavern-plugin/lib/domain/session-model-selection.js'

const selected = { provider: 'test', model: 'model', reasoningEffort: 'high' }

test('DSH 0.2.2 selects through agent.model without touching the removed controller API', () => {
  const calls = []
  const agent = { model: { select: selection => calls.push(['agent', selection]) } }
  const controller = { agents: { selectForNextRequest: () => calls.push(['controller']) } }
  selectSessionModel({ agent, controller, selection: selected })
  assert.deepEqual(calls, [['agent', selected]])
})

test('DSH 0.2.1 hosts keep the session controller route', () => {
  const calls = []
  const agent = { id: 'agent-1' }
  const controller = { agents: { selectForNextRequest: (target, selection) => calls.push([target, selection]) } }
  selectSessionModel({ agent, controller, selection: selected })
  assert.deepEqual(calls, [[agent, selected]])
})

test('unsupported hosts fail closed with the caller-facing message', () => {
  assert.throws(() => selectSessionModel({ agent: {}, controller: {}, selection: selected }), /DSH 不支持独立会话模型选择/)
  assert.throws(() => selectSessionModel({ agent: {}, controller: {}, selection: selected, unsupported: '无法设置新游戏默认前台模型' }),
    /无法设置新游戏默认前台模型/)
})

test('resident Agent selection is a no-op on hosts without AgentModel', () => {
  assert.equal(applyAgentModelSelection({ id: 'legacy' }, selected), false)
  const calls = []
  assert.equal(applyAgentModelSelection({ model: { select: selection => calls.push(selection) } }, selected), true)
  assert.deepEqual(calls, [selected])
})
