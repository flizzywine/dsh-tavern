import assert from 'node:assert/strict'
import test from 'node:test'
import { projectHistoryAsToolCalls } from '../tavern-plugin/lib/domain/history-tool-call.js'

function body(id, text) {
  return { id, role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text }] }
}

function player(id, text) {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

const TOOL = 'submit_story'

// These tests are about the projection itself; the anchor turn has its own tests below.
function project(messages, options) {
  const projected = projectHistoryAsToolCalls(messages, options)
  return projected === messages ? projected : projected.filter(message => !String(message.id).endsWith(':anchor'))
}

test('all 布局把说明性文本也改成调用，系统提示仍是 system', () => {
  const frame = { id: 'frame-1', role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: [{ type: 'text', text: '共同创作虚构小说' }] }
  const system = { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: '规则' }] }
  const messages = [system, frame, body('message-1', '正文'), player('player-2', '继续')]
  const projected = project(messages, { toolName: TOOL, layout: 'all' })
  assert.deepEqual(projected.map(message => message.role), ['system', 'assistant', 'tool', 'assistant', 'tool', 'user'])
  assert.deepEqual(JSON.parse(projected[1].content[0].arguments), { content: '共同创作虚构小说' })
})
