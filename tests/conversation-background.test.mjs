import assert from 'node:assert/strict'
import test from 'node:test'
import { patchConversationBackground } from '../tavern-plugin/lib/domain/conversation-background.js'

test('the scene image Agent model is per game: null follows the foreground, a choice is validated', () => {
  const chat = { id: 'c', backgroundConfigVersion: 1 }
  const chosen = patchConversationBackground(chat, { imageModel: { provider: 'p', model: 'm', reasoningEffort: 'low' } })
  assert.deepEqual(chosen.imageModelSelection, { provider: 'p', model: 'm', reasoningEffort: 'low' })
  assert.equal(patchConversationBackground(chosen, { imageModel: null }).imageModelSelection, null)
  assert.equal(patchConversationBackground(chosen, { webSearchEnabled: true }).imageModelSelection.model, 'm', 'other changes keep it')
  assert.throws(() => patchConversationBackground(chat, { imageModel: { provider: '' } }), /生图 Agent 模型配置无效/)
})
