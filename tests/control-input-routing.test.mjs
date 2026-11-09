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

test('ambiguous control plugins fail instead of falling back to story', async () => {
  const providers = createBodyGenerationProviders({ allowed: async () => true })
  for (const owner of ['one', 'two']) providers.register(owner, { name: 'control', controlInput: true })
  await assert.rejects(providers.controlRoute('game'), /多个插件/)
})

test('control registration preserves a running turn route and never takes over workbench', async () => {
  const providers = createBodyGenerationProviders({ allowed: async () => true })
  providers.register('ra2', { name: 'control', controlInput: true })
  let chat = { mode: 'workbench' }
  const controller = createPluginBodyGeneration({ providers, chatForSession: async () => chat, settings: async () => ({}) })
  assert.equal((await controller.route('game')).mode, 'host')
  chat = { mode: 'story', timeline: { operations: { op: { status: 'running' } } },
    foregroundFrames: { op: { operationId: 'op', source: { bodyGeneration: { mode: 'host', provider: '' } } } } }
  assert.equal((await controller.route('game')).mode, 'host')
})
