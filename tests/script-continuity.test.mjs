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

test('剧本回合准备幂等，查看前后文不推进游标，commit 只确认引用', () => {
  const continuity = createScriptContinuity()
  let state = continuity.start(script(), 1)

  const first = continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 4, userText: '追上去' }
  })
  state = first.state
  assert.equal(first.reference.chunkId, 'chunk-00002')

  const repeated = continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 4, userText: '追上去' }
  })
  assert.deepEqual(repeated.reference, first.reference)

  const peek = continuity.inspect({
    script: script(),
    state,
    request: { kind: 'play', offset: 3, limit: 1 }
  })
  assert.equal(peek.chunks[0].id, 'chunk-00003')
  assert.equal(continuity.inspect({ script: script(), state, request: { kind: 'progress' } }).cursor, 1)

  const committed = continuity.transition({
    script: script(),
    state,
    event: { kind: 'commit', nativeTurn: 4, userText: '追上去' }
  })
  state = committed.state
  const progress = continuity.inspect({ script: script(), state, request: { kind: 'progress' } })
  const preview = continuity.inspect({ script: script(), state, request: { kind: 'preview' } })
  assert.equal(progress.cursor, 1)
  assert.equal(progress.recalledCount, 1)
  assert.equal(preview.previous.text, '第二块：雨夜追踪。')
})

test('候选项独占下一轮游标调整，越界值被钳制', () => {
  const continuity = createScriptContinuity()
  const initial = continuity.start(script(), 0)
  const focused = continuity.transition({
    script: script(),
    state: initial,
    event: { kind: 'focus', cursor: 99 }
  })

  const progress = continuity.inspect({ script: script(), state: focused.state, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
  assert.equal(progress.totalChunks, 3)
})

test('替换剧本自动复位，rollback 使用不透明 revision 恢复提交前状态', () => {
  const continuity = createScriptContinuity()
  let state = continuity.start(script(), 1)
  state = continuity.transition({ script: script(), state, event: { kind: 'prepare', nativeTurn: 2, userText: '进入钟楼' } }).state
  const committed = continuity.transition({ script: script(), state, event: { kind: 'commit', nativeTurn: 2, userText: '进入钟楼' } })
  const restored = continuity.transition({ script: script(), state: committed.state, event: { kind: 'restore', revision: committed.revision } })
  assert.equal(continuity.inspect({ script: script(), state: restored.state, request: { kind: 'progress' } }).recalledCount, 0)

  const replaced = script(200)
  const reset = continuity.transition({ script: replaced, state: committed.state, event: { kind: 'prepare', nativeTurn: 3, userText: '重新开始' } })
  assert.equal(reset.reference.chunkId, 'chunk-00002')
  assert.equal(continuity.inspect({ script: replaced, state: reset.state, request: { kind: 'progress' } }).recalledCount, 0)
})

test('同一 turn 改变 userText 会拒绝，避免提交错配', () => {
  const continuity = createScriptContinuity()
  const state = continuity.transition({
    script: script(),
    state: continuity.start(script(), 0),
    event: { kind: 'prepare', nativeTurn: 7, userText: '原始输入' }
  }).state

  assert.throws(() => continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 7, userText: '不同输入' }
  }), /本轮剧本准备不一致/)
})
