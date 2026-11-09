import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldbookStrategies } from '../tavern-plugin/lib/domain/worldbook-strategies.js'

test('strategy registry migrates legacy to retrieval, registers and unloads without mutating saved selection', async () => {
  const registry = createWorldbookStrategies({ nativeSkills: async () => 'native' })
  assert.equal(await registry.project({ chat: {} }), 'native')
  assert.equal(await registry.project({ chat: { worldbookStrategy: 'legacy' } }), 'native')
  assert.equal(registry.has('legacy'), false)
  assert.throws(() => registry.register({ id: 'legacy', label: 'Legacy', project() {} }), /已停用/)
  assert.equal(await registry.project({ chat: { worldbookStrategy: 'native-skills' } }), 'native')
  const chat = { worldbookStrategy: 'plugin-demo' }
  const dispose = registry.register({ id: 'plugin-demo', label: 'Demo', project: async () => 'plugin' })
  assert.equal(await registry.project({ chat }), 'plugin')
  assert.equal(registry.has('plugin-demo'), true)
  dispose(); dispose()
  assert.equal(await registry.project({ chat }), 'native')
  assert.equal(chat.worldbookStrategy, 'plugin-demo')
  assert.throws(() => registry.register({ id: 'native-skills', label: 'collision', project() {} }), /已注册/)
})
