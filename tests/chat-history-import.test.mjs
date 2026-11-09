import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChatHistory, CHAT_IMPORT_MAX_BYTES } from '../tavern-plugin/lib/domain/chat-history-import.js'
const encode = (...messages) => [JSON.stringify({ chat_metadata: {} }), ...messages.map(m => JSON.stringify(m))].join('\n')
const state = n => ({ stat_data: { world: { day: n } }, schema: '{}' })

test('format failures have line numbers and do not select a different variable slot', () => {
  assert.throws(() => parseChatHistory('{}\n'), /头部/)
  assert.throws(() => parseChatHistory('{"chat_metadata":{}}\nBAD'), /第 2 行/)
  assert.throws(() => parseChatHistory(encode({ is_user: false, mes: 'x', swipe_id: -1 })), /编号/)
  const parsed = parseChatHistory(encode({ is_user: false, mes: 'x', swipe_id: 1, variables: [state(8)] }))
  assert.equal(parsed.hasMvu, false)
  assert.throws(() => parseChatHistory('x'.repeat(CHAT_IMPORT_MAX_BYTES + 1)), /8 MB/)
})
