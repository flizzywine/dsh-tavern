import assert from 'node:assert/strict'
import test from 'node:test'

import { createStoryCompactionRequest, usesStoryCompaction } from '../tavern-plugin/lib/domain/story-compaction.js'

function compactionRequest() {
  return Object.freeze({
    purpose: 'compaction',
    sessionId: 'session-1',
    messages: Object.freeze([
      Object.freeze({ role: 'user', content: Object.freeze([Object.freeze({ type: 'text', text: '旧对话' })]) }),
      Object.freeze({
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text: 'DSH 默认工程摘要指令' })]),
        source: Object.freeze({ kind: 'plugin', plugin: 'dsh-compaction-basic' })
      })
    ])
  })
}

test('只有剧情和剧本游玩会话使用剧情压缩', () => {
  assert.equal(usesStoryCompaction({ mode: 'story' }), true)
  assert.equal(usesStoryCompaction({ mode: 'script' }), true)
  assert.equal(usesStoryCompaction({ mode: 'card' }), false)
  assert.equal(usesStoryCompaction(undefined), false)
})

test('剧情压缩只替换 DSH 压缩请求最后一条指令且不修改原请求', () => {
  const original = compactionRequest()
  const request = createStoryCompactionRequest(original, '剧情专用摘要指令')

  assert.notEqual(request, original)
  assert.equal(original.messages[1].content[0].text, 'DSH 默认工程摘要指令')
  assert.equal(request.messages[0], original.messages[0])
  assert.equal(request.messages[1].content[0].text, '剧情专用摘要指令')
  assert.deepEqual(request.messages[1].source, original.messages[1].source)
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.messages), true)
  assert.equal(Object.isFrozen(request.messages[1].content), true)
})

test('普通请求和来源不明的压缩请求保持原样', () => {
  const ordinary = Object.freeze({ purpose: undefined, messages: Object.freeze([]) })
  const unknown = Object.freeze({
    purpose: 'compaction',
    messages: Object.freeze([Object.freeze({ role: 'user', content: Object.freeze([]), source: Object.freeze({ plugin: 'other' }) })])
  })

  assert.equal(createStoryCompactionRequest(ordinary, '剧情摘要'), ordinary)
  assert.equal(createStoryCompactionRequest(unknown, '剧情摘要'), unknown)
})
