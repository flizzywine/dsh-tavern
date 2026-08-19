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

test('新剧本会话根据开场白末尾对齐当前剧本块', () => {
  const continuity = createScriptContinuity()
  const source = {
    title: '开场对齐测试',
    importedAt: 100,
    chunks: [
      { id: 'chunk-00001', order: 0, text: '屋里十分杂乱，父亲开始帮女儿收拾房间。' },
      { id: 'chunk-00002', order: 1, text: '孩子忽然哭了，女儿抱起孩子开始喂奶。' },
      { id: 'chunk-00003', order: 2, text: '女儿说父亲一个人住不容易，不如搬过来互相照应。' },
      { id: 'chunk-00004', order: 3, text: '父亲犹豫之后，暂时没有答应搬家的请求。' }
    ]
  }
  const opening = '父亲已经帮女儿收拾好了杂乱的房间。孩子哭起来后，她抱着孩子喂奶，随后抬眼说道：“爸，你一个人住也不容易，不如搬过来吧，咱俩也好有个照应。”'

  const aligned = continuity.startAligned(source, opening)
  assert.equal(continuity.inspect({ script: source, state: aligned, request: { kind: 'progress' } }).cursor, 2)

  const explicit = continuity.startAligned(source, opening, 0)
  assert.equal(continuity.inspect({ script: source, state: explicit, request: { kind: 'progress' } }).cursor, 0)
})

test('剧本回合准备不移动游标，正文提交后自动前进一块', () => {
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
  assert.equal(progress.cursor, 2)
  assert.equal(progress.recalledCount, 1)
  assert.equal(preview.previous.text, '第二块：雨夜追踪。')

  const next = continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 5, userText: '走上钟楼' }
  })
  assert.equal(next.reference.chunkId, 'chunk-00003')
})

test('候选 point 可保持或向前跳跃，不能让剧本游标后退', () => {
  const continuity = createScriptContinuity()
  let state = continuity.start(script(), 1)

  state = continuity.transition({
    script: script(),
    state,
    event: { kind: 'focus', cursor: 1 }
  }).state
  assert.equal(continuity.inspect({ script: script(), state, request: { kind: 'progress' } }).cursor, 1)

  state = continuity.transition({
    script: script(),
    state,
    event: { kind: 'focus', cursor: 1 }
  }).state
  assert.equal(continuity.inspect({ script: script(), state, request: { kind: 'progress' } }).cursor, 1)

  const focused = continuity.transition({
    script: script(),
    state,
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
  assert.equal(continuity.inspect({ script: script(), state: committed.state, request: { kind: 'progress' } }).cursor, 2)
  const restored = continuity.transition({ script: script(), state: committed.state, event: { kind: 'restore', revision: committed.revision } })
  assert.equal(continuity.inspect({ script: script(), state: restored.state, request: { kind: 'progress' } }).cursor, 1)
  assert.equal(continuity.inspect({ script: script(), state: restored.state, request: { kind: 'progress' } }).recalledCount, 0)

  const replaced = script(200)
  const reset = continuity.transition({ script: replaced, state: committed.state, event: { kind: 'prepare', nativeTurn: 3, userText: '重新开始' } })
  assert.equal(reset.reference.chunkId, 'chunk-00002')
  assert.equal(continuity.inspect({ script: replaced, state: reset.state, request: { kind: 'progress' } }).recalledCount, 0)
})

test('末块正文提交后自动进入结束位置，不再重复注入末块', () => {
  const continuity = createScriptContinuity()
  let state = continuity.start(script(), 2)
  state = continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 8, userText: '结束对峙' }
  }).state
  state = continuity.transition({
    script: script(),
    state,
    event: { kind: 'commit', nativeTurn: 8, userText: '结束对峙' }
  }).state
  assert.equal(continuity.inspect({ script: script(), state, request: { kind: 'progress' } }).cursor, 3)
  state = continuity.transition({ script: script(), state, event: { kind: 'end' } }).state

  assert.equal(continuity.inspect({ script: script(), state, request: { kind: 'progress' } }).cursor, 3)
  const ended = continuity.transition({
    script: script(),
    state,
    event: { kind: 'prepare', nativeTurn: 9, userText: '继续' }
  })
  assert.equal(ended.reference.ended, true)
  assert.equal(ended.reference.chunkId, '')
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
