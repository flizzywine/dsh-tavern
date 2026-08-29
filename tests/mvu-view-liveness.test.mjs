import assert from 'node:assert/strict'
import test from 'node:test'

import { retainLatestMvuView } from '../tavern-plugin/lib/domain/mvu-view-liveness.js'

function projection(turn, parts) {
  return { version: 2, turn, mode: 'html', text: '', parts, warnings: [] }
}

test('把最近一次实际读取 MVU 的独立 View 保活到最新楼层', () => {
  const statusView = { kind: 'html', content: '<body><script>loadStatus()</script></body>' }
  const messages = [
    { role: 'assistant', turn: 1, variables: [{ hp: 10 }], swipeId: 0, displayRuntime: { frames: [{ partIndex: 1, mvuViewUsed: true }] } },
    { role: 'user', turn: 2, text: '继续' },
    { role: 'assistant', turn: 2, variables: [{ hp: 9 }], swipeId: 0 }
  ]
  const projections = [
    projection(1, [{ kind: 'html', content: '<p>第一轮正文</p>' }, statusView]),
    projection(2, [{ kind: 'html', content: '<p>第二轮正文</p>' }])
  ]

  const result = retainLatestMvuView(messages, projections)

  assert.equal(result[0].parts.length, 2)
  assert.deepEqual(result[1].parts, [
    { kind: 'html', content: '<p>第二轮正文</p>' },
    { kind: 'html', content: statusView.content, retainedMvuView: true }
  ])
})

test('当前楼层已经包含同一 MVU View 时不重复挂载', () => {
  const content = '<script>loadStatus()</script>'
  const messages = [
    { role: 'assistant', turn: 1, variables: [{}], swipeId: 0, displayRuntime: { frames: [{ partIndex: 1, mvuViewUsed: true }] } },
    { role: 'assistant', turn: 2, variables: [{}], swipeId: 0, displayRuntime: { frames: [{ partIndex: 1, mvuViewUsed: true }] } }
  ]
  const projections = [
    projection(1, [{ kind: 'html', content: '<p>一</p>' }, { kind: 'html', content }]),
    projection(2, [{ kind: 'html', content: '<p>二</p>' }, { kind: 'html', content }])
  ]

  const result = retainLatestMvuView(messages, projections)

  assert.equal(result[1].parts.filter(part => part.content === content).length, 1)
})

test('不把普通正文 iframe 或没有 MVU 状态的对话误判为保活 View', () => {
  const messages = [
    { role: 'assistant', turn: 1, displayRuntime: { frames: [{ partIndex: 0, mvuViewUsed: true }] } },
    { role: 'assistant', turn: 2 }
  ]
  const projections = [
    projection(1, [{ kind: 'html', content: '<p>只是正文</p>' }]),
    projection(2, [{ kind: 'html', content: '<p>下一轮</p>' }])
  ]

  assert.deepEqual(retainLatestMvuView(messages, projections), projections)
})
