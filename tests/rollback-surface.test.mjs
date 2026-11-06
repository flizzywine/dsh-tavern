import assert from 'node:assert/strict'
import test from 'node:test'

import { rollbackAvailability, pendingFailedSurfaceTurns, abortedRegenerationTurns, locateRollbackSurface, regenerationAttemptTurns, replayableFailedTurn, failedTurnReplayAvailability } from '../tavern-plugin/lib/domain/rollback-surface.js'

function modelSource() {
  return { kind: 'model', provider: 'test', model: 'test-model' }
}

test('重生成失败清理墓碑不冒充最后用户输入，仍可回退原轮次', () => {
  const events = []
  events[15] = {
    seq: 15,
    type: 'user/message',
    data: { role: 'user', content: [{ type: 'text', text: '本轮输入' }], source: { kind: 'user' } },
    surfaceOp: 'append'
  }
  events[555] = {
    seq: 555,
    type: 'assistant/message',
    data: { turn: 2, step: 1, message: { role: 'assistant', source: modelSource() } },
    surfaceOp: 'append'
  }
  events[753] = {
    seq: 753,
    type: 'user/message',
    data: { role: 'user', content: [], source: { kind: 'plugin', plugin: 'dsh-tavern-regeneration-abort' } },
    surfaceOp: { op: 'replace', start: 562, end: 750 },
    sourceEventSeqs: [562, 563, 750]
  }

  const located = locateRollbackSurface({ events, nodes: [15, 555, 753] })

  assert.equal(located.userSeq, 15)
  assert.equal(located.assistantSeq, 555)
  assert.equal(located.turn, 2)
  assert.deepEqual(located.shadowedSeqs, [15, 555, 753])
})

test('失败重生成的模型轮次可从尝试区间和持久清理墓碑重建', () => {
  const events = []
  events[20] = { seq: 20, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } } }
  events[21] = {
    seq: 21,
    type: 'assistant/message',
    data: { turn: 3, message: { source: modelSource(), content: [{ type: 'text', text: '临时正文' }] } }
  }
  events[22] = {
    seq: 22,
    type: 'user/message',
    data: { source: { kind: 'plugin', plugin: 'dsh-tavern-regeneration-abort' }, content: [] },
    surfaceOp: { op: 'replace', start: 20, end: 21 },
    sourceEventSeqs: [20, 21]
  }

  assert.deepEqual(regenerationAttemptTurns({ events, eventStart: 20 }), [3])
  assert.deepEqual(abortedRegenerationTurns({ events }), [3])
})

function failedThenRolledBack() {
  return [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '保留输入' }] } },
    { seq: 1, type: 'assistant/message', data: { turn: 171, message: { source: modelSource(), content: [{ type: 'text', text: '保留正文' }] } } },
    { seq: 2, type: 'turn/start', data: { turn: 207 } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '失败输入' }] } },
    { seq: 4, type: 'turn/end', data: { turn: 207, reason: { kind: 'error' } } },
    { seq: 5, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }, content: [] }, surfaceOp: { op: 'replace', start: 3, end: 3 }, sourceEventSeqs: [3] },
    { seq: 6, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '新输入' }] } },
    { seq: 7, type: 'assistant/message', data: { turn: 208, message: { source: modelSource(), content: [{ type: 'text', text: '新正文' }] } } },
    { seq: 8, type: 'assistant/message', data: { turn: 208, message: { source: modelSource(), content: [] } }, surfaceOp: { op: 'replace', start: 6, end: 7 }, sourceEventSeqs: [6, 7] },
    { seq: 9, type: 'user/message', data: { source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot' }, content: [] } }
  ]
}

test('失败轮次之后的新正文被回退，仍能发现并清理被空标记挡住的失败轮次', () => {
  const events = failedThenRolledBack()
  assert.deepEqual(pendingFailedSurfaceTurns({ events, nodes: [0, 1, 5, 8, 9] }), [207])
  assert.deepEqual(pendingFailedSurfaceTurns({ events, nodes: [0, 1, 5, 8, 9], suppressed: [207] }), [])
  assert.deepEqual(pendingFailedSurfaceTurns({ events, nodes: [0, 1, 5, 6, 7] }), [], '有未回退的新正文时不清理更早失败轮次')
})

test('回退可用性要求聊天与原生轮次配对，允许重生成映射，不接受孤立输入', () => {
  const chat = { messages: [{ role: 'user' }, { role: 'assistant', turn: 2 }] }
  const events = [
    { seq: 0, type: 'user/message', data: { role: 'user' } },
    { seq: 1, type: 'assistant/message', data: { turn: 2, message: { source: modelSource() } } }
  ]
  assert.equal(rollbackAvailability(chat, { events, nodes: [0, 1] }).canRollback, true)
  assert.equal(rollbackAvailability(chat, { events, nodes: [0] }).canRollback, false)
  assert.equal(rollbackAvailability(chat, { events, nodes: [] }).canRollback, false)
  events[1].data.turn = 3
  assert.equal(rollbackAvailability(chat, { events, nodes: [0, 1] }).canRollback, false)
  chat.regeneratedDshTurns = { 2: 3 }
  assert.equal(rollbackAvailability(chat, { events, nodes: [0, 1] }).canRollback, true)
})

test('失败尾部重放认领用户输入与历史重放输入，且只认领真正拥有尾部的回合', () => {
  const replayInput = { kind: 'plugin', plugin: 'dsh-tavern-replay' }
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 2 } },
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '第一次' }], source: { kind: 'user' } } },
    { seq: 2, type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } },
    { seq: 3, type: 'turn/start', data: { turn: 3 } },
    { seq: 4, type: 'user/message', data: { content: [{ type: 'text', text: '第二次' }], source: replayInput } },
    { seq: 5, type: 'turn/end', data: { turn: 3, reason: { kind: 'aborted' } } }
  ]
  assert.equal(replayableFailedTurn({ events }).userText, '第二次')
  // 只把失败回合之后的用户消息算作输入，之前的输入不参与重放。
  assert.equal(replayableFailedTurn({ events: events.map(event => event.seq === 4 ? { ...event, data: { ...event.data, source: { kind: 'user' } } } : event) }).userText, '第二次')
  // 尾部已完成、或失败之后又有新回合开始，都不再有可重放的失败尾部。
  assert.equal(replayableFailedTurn({ events: events.map(event => event.seq === 5 ? { ...event, data: { turn: 3, reason: { kind: 'completed' } } } : event) }), null)
  assert.equal(replayableFailedTurn({ events: [...events, { seq: 6, type: 'turn/start', data: { turn: 4 } }, { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: '第三次' }], source: { kind: 'user' } } }] }), null)
})

test('末尾持久玩家输入优先于更早的原生失败回合，重放保留同一请求号', () => {
  const chat = {
    mode: 'story',
    foregroundError: { turn: 4, requestId: 'rpc-latest' },
    messages: [
      { role: 'user', text: '倒数第二个输入' },
      { role: 'assistant', turn: 2, text: '上一轮正文' },
      { role: 'user', text: '最新输入', sourceText: '最新输入', native: true, source: { kind: 'user', rpcId: 'rpc-latest' } }
    ]
  }
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 3 } },
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '倒数第二个输入' }], source: { kind: 'user', rpcId: 'rpc-previous' } } },
    { seq: 2, type: 'turn/end', data: { turn: 3, reason: { kind: 'error' } } }
  ]
  const result = failedTurnReplayAvailability({ chat, events, nodes: [] })
  assert.equal(result.target.userText, '最新输入')
  assert.equal(result.target.source.rpcId, 'rpc-latest')
  assert.equal(result.target.persisted, true)
  assert.equal(result.target.messageIndex, 2)
})
