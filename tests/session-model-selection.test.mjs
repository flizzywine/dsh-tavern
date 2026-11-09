import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAgentModelSelection } from '../tavern-plugin/lib/domain/session-model-selection.js'

const selected = { provider: 'test', model: 'model', reasoningEffort: 'high' }

test('resident Agent selection is a no-op on hosts without AgentModel', () => {
  assert.equal(applyAgentModelSelection({ id: 'legacy' }, selected), false)
  const calls = []
  assert.equal(applyAgentModelSelection({ model: { select: selection => calls.push(selection) } }, selected), true)
  assert.deepEqual(calls, [selected])
})
