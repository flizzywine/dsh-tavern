import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

test('per-game generation settings override defaults, validate availability and restore inheritance', async () => {
  let chat = { id: 'chat', sessionId: 'session', mode: 'story' }
  const providers = [{ id: 'p:body', title: 'Example' }]
  const handlers = createSettingsHandlers({
    str: value => String(value || ''), groupOfMode: mode => mode === 'story' ? 'play' : 'other',
    chatForSession: async () => structuredClone(chat),
    readTavernSettings: async () => ({ storyGenerationMode: 'plugin-direct', storyGenerationProvider: 'p:body' }),
    updateChat: async (_id, mutate) => { chat = mutate(structuredClone(chat)); return chat },
    pluginApi: { bodyGenerators: { list: async () => providers, require: async id => {
      if (id !== 'p:body') throw new Error('unavailable')
    } } },
  })
  assert.deepEqual(await handlers.getBodyGenerationSettings({ sessionId: 'session' }), {
    inherited: true, mode: 'plugin-direct', provider: 'p:body', providers,
  })
  assert.equal((await handlers.setBodyGenerationSettings({ sessionId: 'session', mode: 'host', provider: '' })).inherited, false)
  await assert.rejects(handlers.setBodyGenerationSettings({ sessionId: 'session', mode: 'plugin-direct', provider: 'missing' }), /unavailable/)
  assert.equal(chat.storyGenerationMode, 'host')
  const restored = await handlers.setBodyGenerationSettings({ sessionId: 'session', inherit: true })
  assert.equal(restored.mode, 'plugin-direct')
  assert.equal(restored.inherited, true)
  assert.equal(Object.hasOwn(chat, 'storyGenerationProvider'), false)
  chat.mode = 'card'
  await assert.rejects(handlers.getBodyGenerationSettings({ sessionId: 'session' }), /游玩/)
})
