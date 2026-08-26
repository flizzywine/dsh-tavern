import assert from 'node:assert/strict'
import test from 'node:test'

import { hasRollbackMessages, locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'

function modelSource() {
  return { kind: 'model', provider: 'test', model: 'test-model' }
}

test('回退识别正则替换后的可见助手节点，并同时覆盖本轮用户输入与输出', () => {
  const events = []
  events[2] = {
    seq: 2,
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }
  events[5] = {
    seq: 5,
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text: '本轮输入' }] },
    surfaceOp: 'append'
  }
  events[8] = {
    seq: 8,
    type: 'assistant/message',
    data: { turn: 2, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }
  events[9] = {
    seq: 9,
    type: 'assistant/message',
    data: { turn: 2, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: { op: 'replace', start: 8, end: 8 },
    sourceEventSeqs: [8]
  }

  const located = locateRollbackSurface({ events, nodes: [2, 5, 9] })

  assert.equal(located.userSeq, 5)
  assert.equal(located.assistantSeq, 9)
  assert.equal(located.turn, 2)
  assert.deepEqual(located.shadowedSeqs, [5, 9])
  assert.equal(located.source.kind, 'model')
})

test('只有开场白而没有用户输入时不存在可回退轮次', () => {
  const events = []
  events[2] = {
    seq: 2,
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }

  assert.equal(locateRollbackSurface({ events, nodes: [2] }), null)
})

test('回退按钮只在权威消息尾部存在用户输入与正文组合时显示', () => {
  const opening = { role: 'assistant', greeting: true, text: '开场白' }
  const user = { role: 'user', text: '本轮输入' }
  const assistant = { role: 'assistant', text: '本轮输出' }

  assert.equal(hasRollbackMessages([opening]), false)
  assert.equal(hasRollbackMessages([opening, user]), false)
  assert.equal(hasRollbackMessages([opening, user, assistant]), true)
})
