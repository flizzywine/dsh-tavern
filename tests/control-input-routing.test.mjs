import test from 'node:test'
import assert from 'node:assert/strict'
import { createBodyGenerationProviders } from '../tavern-plugin/lib/domain/body-generation-providers.js'
import { createPluginBodyGeneration } from '../tavern-plugin/lib/domain/plugin-body-generation.js'

test('card control provider takes native input even when story defaults select host', async () => {
  const providers = createBodyGenerationProviders({ allowed: async (_, gameId) => gameId === 'ra2' })
  providers.register('ra2-plugin', { name: 'commander', controlInput: true, generate: async () => ({ text: '战场未连接' }) })
  const controller = createPluginBodyGeneration({ providers,
    chatForSession: async id => ({ id, mode: 'story', storyGenerationMode: 'host' }), settings: async () => ({ storyGenerationMode: 'host' }) })
  assert.deepEqual(await controller.route('ra2'), { mode: 'plugin-direct', provider: 'ra2-plugin:commander', hostRegex: false })
  assert.deepEqual(await controller.route('other'), { mode: 'host', provider: '', hostRegex: false })
})
