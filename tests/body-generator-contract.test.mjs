import test from 'node:test'
import assert from 'node:assert/strict'
import { createBodyGenerationProviders } from '../tavern-plugin/lib/domain/body-generation-providers.js'
import { publicBodyMaterials } from '../tavern-plugin/lib/domain/body-generation-materials.js'

const materials = { gameId: 'game', target: { kind: 'generate', operationId: 'op', revision: 123 },
  input: { raw: 'input', projected: 'processed input' }, card: { name: '角色' }, persona: { name: '玩家' },
  cardContext: '<character_card>\n人物设定\n</character_card>', worldbook: { context: '世界书' },
  beforeState: { variables: { hp: 1 } }, generationState: { variables: { hp: 2 }, messageVariables: { n: 3 }, posture: '状态' }, history: [] }

test('public materials expose prepared state and separate context, not transaction internals', () => {
  const dto = publicBodyMaterials(materials)
  assert.deepEqual(dto.state, { variables: { hp: 2 }, messageVariables: { n: 3 }, status: '状态' })
  assert.equal(dto.reason, 'normal')
  assert.deepEqual(dto.input, { raw: 'input', text: 'processed input' })
  assert.deepEqual(dto.context.map(item => item.kind), ['character', 'worldbook'])
  assert.equal(dto.target, undefined)
  assert.equal(dto.beforeState, undefined)
  dto.state.variables.hp = 0
  assert.equal(materials.generationState.variables.hp, 2)
  assert.equal(publicBodyMaterials({ ...materials, target: { kind: 'failed' } }).reason, 'retry')
})

test('prepare freezes config for a single operation; generate gets independent copies', async () => {
  const providers = createBodyGenerationProviders({ allowed: async () => true })
  const config = { preset: 'first', model: 'model-a' }
  let preparations = 0
  providers.register('plugin', { name: 'body', prepare() { preparations++; return config },
    generate({ config, materials, signal }) {
      assert.equal(config.preset, 'first'); assert.equal(materials.operationId, 'op'); assert.equal(signal.aborted, false)
      config.preset = 'mutated'; return { text: '正文' }
    } })
  const snapshot = await providers.prepare('plugin:body', { gameId: 'game', reason: 'normal' })
  config.preset = 'second'
  await providers.generate('plugin:body', { materials, snapshot })
  assert.equal(snapshot.config.preset, 'first')
  assert.equal(preparations, 1)
})

test('replacement registration cannot use an old prepared operation', async () => {
  const providers = createBodyGenerationProviders({ allowed: async () => true })
  const dispose = providers.register('plugin', { name: 'body', generate: () => ({ text: 'old' }) })
  const snapshot = await providers.prepare('plugin:body', { gameId: 'game', reason: 'normal' })
  dispose()
  providers.register('plugin', { name: 'body', generate: () => assert.fail('must not execute') })
  await assert.rejects(providers.generate('plugin:body', { materials, snapshot }), /已更换/)
})

test('stop cancels a hanging prepare and rejects late config', async () => {
  let started, release
  const ready = new Promise(resolve => { started = resolve })
  const providers = createBodyGenerationProviders({ allowed: async () => true })
  providers.register('plugin', { name: 'body', prepare: ({ signal }) => {
    started(signal); return new Promise(resolve => { release = resolve })
  }, generate() {} })
  const pending = providers.prepare('plugin:body', { gameId: 'game', reason: 'normal' })
  const signal = await ready
  providers.stop('game')
  await assert.rejects(pending, /取消/)
  assert.equal(signal.aborted, true)
  release({ preset: 'late' })
})
