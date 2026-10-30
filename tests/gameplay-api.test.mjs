import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameplayApi } from '../tavern-plugin/lib/gameplay-api.js'

test('gameplay model overrides start defaults and is selected for each input', async () => {
  const model = { provider: 'test-provider', model: 'test-model', reasoningEffort: 'low' }
  let owner, selected
  const calls = []
  const agent = {}
  const host = {
    create: async () => {},
    agents: { selectForNextRequest(target, value) { assert.equal(target, agent); selected = value } },
    prompt: async () => { calls.push(selected); selected = null }
  }
  const api = createGameplayApi({
    controller: () => host, registry: { get: () => agent },
    llm: { resolveCallConfig: async value => value },
    store: { writeJson: async (_, value) => { owner = structuredClone(value) }, readJson: async () => structuredClone(owner) },
    dispatch: async method => { if (method === 'startChat') selected = { provider: 'player-default' }; return {} },
    chatForSession: async () => ({ mode: 'story' }), requiresBrowser: async () => false,
    listCards: async () => [{ path: 'cards/test.json' }], dataRoot: 'test-data'
  })
  const created = await api.call('create', { sourceCard: 'test.json', model })
  assert.deepEqual(selected, model)
  for (let i = 0; i < 2; i++) await api.call('send', { sessionId: created.sessionId, input: 'continue' })
  assert.deepEqual(calls, [model, model])
})
