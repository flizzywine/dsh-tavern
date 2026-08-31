import assert from 'node:assert/strict'
import test from 'node:test'

import { clearFailedTurnSurface, hasRollbackMessages, locateRollbackSurface, planFailedTurnSurface, planRegenerationSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'

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

test('重新生成正文完整遮蔽旧正文、失败回合残留和合成输入', () => {
  const events = []
  events[48] = {
    seq: 48,
    type: 'assistant/message',
    data: { turn: 2, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }
  events[55] = { seq: 55, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[56] = { seq: 56, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[69] = { seq: 69, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[70] = { seq: 70, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[99] = {
    seq: 99,
    type: 'assistant/message',
    data: { turn: 4, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }

  const planned = planRegenerationSurface({
    events,
    nodes: [6, 13, 14, 48, 55, 56, 69, 70, 99],
    oldAssistantSeq: 48,
    eventStart: 65
  })

  assert.deepEqual(planned, {
    start: 48,
    end: 99,
    finalAssistantSeq: 99,
    shadowedSeqs: [48, 55, 56, 69, 70, 99]
  })
})

test('失败的正文回合从模型消息面移除本轮全部残留节点', () => {
  const events = []
  events[52] = { seq: 52, type: 'turn/start', data: { turn: 3 } }
  events[55] = { seq: 55, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[56] = { seq: 56, type: 'user/message', data: { role: 'user' }, surfaceOp: 'append' }
  events[64] = { seq: 64, type: 'turn/end', data: { turn: 3, reason: { kind: 'error' } } }

  const planned = planFailedTurnSurface({
    events,
    nodes: [6, 13, 14, 48, 55, 56],
    turn: 3
  })

  assert.deepEqual(planned, {
    start: 55,
    end: 56,
    shadowedSeqs: [55, 56]
  })

  const calls = []
  const session = {
    events,
    surface: { nodes: [6, 13, 14, 48, 55, 56] },
    append(type, data, options) { calls.push({ type, data, options }) }
  }
  assert.equal(clearFailedTurnSurface({ session, turn: 3, id: function () { return 'cleanup-id' } }), 2)
  assert.deepEqual(calls, [{
    type: 'user/message',
    data: {
      id: 'cleanup-id',
      role: 'user',
      content: [],
      source: { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }
    },
    options: {
      surfaceOp: { op: 'replace', start: 55, end: 56 },
      sourceEventSeqs: [55, 56]
    }
  }])
})
