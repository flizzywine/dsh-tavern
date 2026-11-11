import assert from 'node:assert/strict'
import test from 'node:test'

import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'

function script(version = 100) {
  return {
    title: '测试剧本',
    importedAt: version,
    chunks: [
      { id: 'chunk-00001', order: 0, text: '第一块：旅店相遇。' },
      { id: 'chunk-00002', order: 1, text: '第二块：雨夜追踪。' },
      { id: 'chunk-00003', order: 2, text: '第三块：钟楼对峙。' }
    ]
  }
}

test('替换剧本自动复位，rollback 使用不透明 revision 恢复提交前状态', () => {
  const continuity = createScriptContinuity()
  let state = continuity.start(script(), 1)
  state = continuity.transition({ script: script(), state, event: { kind: 'prepare', nativeTurn: 2, userText: '进入钟楼' } }).state
  const committed = continuity.transition({ script: script(), state, event: { kind: 'commit', nativeTurn: 2, userText: '进入钟楼' } })
  assert.equal(continuity.inspect({ script: script(), state: committed.state, request: { kind: 'progress' } }).cursor, 2)
  const restored = continuity.transition({ script: script(), state: committed.state, event: { kind: 'restore', revision: committed.revision } })
  assert.equal(continuity.inspect({ script: script(), state: restored.state, request: { kind: 'progress' } }).cursor, 1)
  assert.equal(continuity.inspect({ script: script(), state: restored.state, request: { kind: 'progress' } }).recalledCount, 0)

  const replaced = script(200)
  const reset = continuity.transition({ script: replaced, state: committed.state, event: { kind: 'prepare', nativeTurn: 3, userText: '重新开始' } })
  assert.equal(reset.reference.chunkId, 'chunk-00002')
  assert.equal(continuity.inspect({ script: replaced, state: reset.state, request: { kind: 'progress' } }).recalledCount, 0)
})
