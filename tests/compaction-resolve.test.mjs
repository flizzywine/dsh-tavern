import test from 'node:test'
import assert from 'node:assert/strict'
import { inject, resolveAgentCompaction } from '../tavern-plugin/lib/agent-compaction.js'

test('relay does not hard-inject the isolated compaction service', () => {
  assert.deepEqual(inject, ['tokenMeter', 'llm', 'sessions'])
})

test('resolveAgentCompaction reads the preset-scoped serviceFor engine', async () => {
  const engine = { compactNow() {}, compactIfNeeded() {} }
  const agent = { ctx: {} }
  let seen
  const service = {
    serviceFor(agentArg, name) {
      seen = [agentArg, name]
      return engine
    }
  }
  const ctx = {
    get(name) {
      assert.equal(name, 'agentPresets')
      // The host may expose the service through Cordis's proxy wrapper.
      return { [Symbol.for('cordis.original')]: service }
    }
  }
  assert.equal(await resolveAgentCompaction(ctx, agent), engine)
  assert.deepEqual(seen, [agent, 'compaction'])
})
