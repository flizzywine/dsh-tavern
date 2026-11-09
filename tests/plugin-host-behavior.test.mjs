import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostBehaviorPolicies } from '../tavern-plugin/lib/domain/plugin-host-behavior.js'

test('host policy is card scoped, deny wins, and unload restores defaults', async () => {
  const policy = createHostBehaviorPolicies({ allowed: (_, id) => id === 'game' })
  const dispose = policy.register('ra2', { backgroundAgents: false })
  policy.register('other', { backgroundAgents: true })
  assert.equal((await policy.forGame('game')).backgroundAgents, false)
  assert.equal((await policy.forGame('other-game')).backgroundAgents, true)
  assert.throws(() => policy.register('bad', { unknown: false }))
  dispose()
  assert.equal((await policy.forGame('game')).backgroundAgents, true)
})
