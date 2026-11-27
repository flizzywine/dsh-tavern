import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldbookStrategies } from '../tavern-plugin/lib/domain/worldbook-strategies.js'

test('strategy registry follows plugin code, ignores old settings and restores native recall after unloading', async () => {
  const registry = createWorldbookStrategies({ nativeSkills: async () => 'native' })
  const chat = { sessionId: 'game-1', worldbookStrategy: 'plugin-demo' }
  let enabled = false
  const dispose = registry.register({ id: 'plugin-demo', label: 'Demo',
    shouldUse: input => enabled && input.chat.sessionId === 'game-1', project: async () => 'plugin' })
  assert.equal(await registry.project({ chat }), 'native')
  enabled = true
  assert.equal(await registry.project({ chat }), 'plugin')
  assert.equal(await registry.project({ chat: { ...chat, sessionId: 'game-2' } }), 'native')
  assert.equal(await registry.project({ chat, purpose: 'history-import' }), 'native')
  const other = registry.register({ id: 'plugin-other', label: 'Other', shouldUse: () => true, project: async () => 'other' })
  assert.equal(await registry.project({ chat }), 'native', 'simultaneous claims use native recall')
  other()
  assert.equal(await registry.project({ chat }), 'plugin')
  dispose(); dispose()
  assert.equal(await registry.project({ chat }), 'native')
  assert.equal(chat.worldbookStrategy, 'plugin-demo')
  assert.throws(() => registry.register({ id: 'native-skills', label: 'collision', shouldUse: () => true, project() {} }), /宿主保留/)
})
