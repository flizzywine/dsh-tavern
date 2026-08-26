import assert from 'node:assert/strict'
import test from 'node:test'

import { createEphemeralCompatibilityRequest, isCompatibilityConversationRequest } from '../tavern-plugin/lib/domain/compatibility-request.js'

test('酒馆兼容请求从只读 DSH 请求派生且不修改原对象', () => {
  const originalMessages = Object.freeze([Object.freeze({
    id: 'user-1',
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: '原始输入' })]),
    source: Object.freeze({ kind: 'user' })
  })])
  const options = Object.freeze({
    provider: 'test',
    model: 'test-model',
    sessionId: 'session-1',
    messages: originalMessages
  })
  const tavernMessages = [{
    id: 'preset-1',
    role: 'system',
    content: [{ type: 'text', text: '酒馆预设' }],
    source: { kind: 'plugin', plugin: 'dsh-tavern' }
  }]

  const request = createEphemeralCompatibilityRequest(options, tavernMessages)

  assert.equal(options.messages, originalMessages)
  assert.equal(options.messages[0].content[0].text, '原始输入')
  assert.notEqual(request, options)
  assert.equal(request.messages[0].content[0].text, '酒馆预设')
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.messages), true)
  assert.equal(Object.isFrozen(request.messages[0]), true)
  assert.equal(Object.isFrozen(request.messages[0].content), true)
  assert.equal(Object.isFrozen(request.messages[0].content[0]), true)
})

test('连续兼容请求各自使用本轮酒馆投影，不累积上轮临时消息', () => {
  const first = createEphemeralCompatibilityRequest(Object.freeze({
    provider: 'test', model: 'test-model', sessionId: 'session-1', messages: Object.freeze([])
  }), [{ id: 'preset-a', role: 'system', content: [{ type: 'text', text: '预设 A' }], source: { kind: 'plugin' } }])
  const durableConversation = Object.freeze([
    Object.freeze({ id: 'user-1', role: 'user', content: Object.freeze([Object.freeze({ type: 'text', text: '第一轮' })]), source: Object.freeze({ kind: 'user' }) }),
    Object.freeze({ id: 'assistant-1', role: 'assistant', content: Object.freeze([Object.freeze({ type: 'text', text: '第一轮回复' })]), source: Object.freeze({ kind: 'model' }) })
  ])
  const second = createEphemeralCompatibilityRequest(Object.freeze({
    provider: 'test', model: 'test-model', sessionId: 'session-1', messages: durableConversation
  }), [{ id: 'preset-b', role: 'system', content: [{ type: 'text', text: '预设 B' }], source: { kind: 'plugin' } }])

  assert.deepEqual(first.messages.map(message => message.content[0].text), ['预设 A'])
  assert.deepEqual(second.messages.map(message => message.content[0].text), ['预设 B'])
  assert.deepEqual(durableConversation.map(message => message.content[0].text), ['第一轮', '第一轮回复'])
})

test('兼容模式只替换正文请求，不接管会话标题等 DSH 辅助调用', () => {
  const staged = { turn: 2, step: 1 }
  const coordinates = { turn: 2, step: 1 }

  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1' }, staged, coordinates), true)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1', purpose: 'session-title' }, staged, coordinates), false)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1', purpose: 'compaction' }, staged, coordinates), false)
  assert.equal(isCompatibilityConversationRequest({ sessionId: 'session-1' }, staged, { turn: 3, step: 1 }), false)
})
