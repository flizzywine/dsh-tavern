import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureSessionVariableDirectory, sessionVariableDirectorySection, variableDirectoryOpen } from '../tavern-plugin/lib/domain/session-variable-directory.js'

function nativeSession(id = 's') {
  const events = []
  return { id, events, append(type, data) { const event = { seq: events.length, type, data }; events.push(event); return event } }
}
const mvuChat = statData => ({ mode: 'story', messages: [
  { role: 'assistant', greeting: true, swipeId: 0, variables: [{}] },
  { role: 'user', swipeId: 0, variables: [statData ? { stat_data: statData } : {}] }
] })

test('the variable directory freezes only before the first request: later stat_data never changes the system prompt', () => {
  const late = nativeSession()
  assert.equal(ensureSessionVariableDirectory(late, mvuChat(null)), null)
  late.append('request/header', { header: {} })
  // The opening variables arrive after the first reply was generated under a prompt without them.
  assert.equal(variableDirectoryOpen(late), false)
  assert.equal(ensureSessionVariableDirectory(late, mvuChat({ 特工: { 姓名: '' } })), null)
  assert.equal(sessionVariableDirectorySection(late), null)

  const early = nativeSession()
  assert.ok(ensureSessionVariableDirectory(early, mvuChat({ 特工: { 姓名: '' } })))
  assert.match(sessionVariableDirectorySection(early).text, /"\/特工\/姓名"/)
  assert.equal(variableDirectoryOpen(early), false)
})
