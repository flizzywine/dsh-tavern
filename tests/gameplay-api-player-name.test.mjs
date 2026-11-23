// The gameplay API's test chat starts like a chat opened in the window. Synthetic host only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameplayApi } from '../tavern-plugin/lib/gameplay-api.js'

test('a gameplay test chat takes the default player name and its model override', async () => {
  const model = { provider: 'test-provider', model: 'test-model', reasoningEffort: 'low' }
  let owner, selected, started
  const agent = {}
  const host = { create: async () => {}, agents: { selectForNextRequest(target, value) { assert.equal(target, agent); selected = value } } }
  const api = createGameplayApi({
    controller: () => host, registry: { get: () => agent },
    llm: { resolveCallConfig: async value => value },
    store: { writeJson: async (_, value) => { owner = value }, readJson: async () => owner },
    dispatch: async (method, args) => { if (method === 'startChat') { selected = { provider: 'player-default' }; started = args } return {} },
    chatForSession: async () => ({ mode: 'story' }), requiresBrowser: async () => false,
    listCards: async () => [{ path: 'cards/test.json' }], dataRoot: 'test-data'
  })
  await api.call('create', { sourceCard: 'test.json', model })
  assert.equal(started.userName, '', 'startChat takes the default player name, as a chat opened in the window')
  assert.deepEqual(selected, model)
})
