import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationStateAtTurn, conversationForkBoundary } from '../tavern-plugin/lib/domain/conversation-fork-point.js'

function history(count = 85) {
  const states = new Map()
  let messages = []
  for (let turn = 1; turn <= count; turn++) {
    messages.push({ role: 'user', text: 'input' + turn }, { role: 'assistant', turn, text: 'reply' + turn, variables: [{ hp: turn }] })
    states.set(turn, { id: 'chat', sessionId: 'source', mode: 'story', _storageRevision: turn, settleStatus: 'done', messages: structuredClone(messages),
      posture: 'place' + turn, scriptState: { cursor: turn }, ledger: { turn }, mvu: { enabled: true }, variables: { hp: turn },
      timeline: { checkpoints: Array.from({ length: turn - 1 }, (_, i) => ({ turn: i + 2, beforeRevision: i + 1 })).slice(-40) } })
  }
  return { source: states.get(count), states, read: async (_id, revision) => structuredClone(states.get(revision)) }
}

test('缺少、变化或未完成的历史状态不使用当前变量冒充', async () => {
  const h = history(3)
  await assert.rejects(conversationStateAtTurn(h.source, 999, h.read), /找不到/)
  await assert.rejects(conversationStateAtTurn(h.source, 1, async () => undefined), /不可用/)
  h.states.get(1).messages[1].text = '其他分支'
  await assert.rejects(conversationStateAtTurn(h.source, 1, h.read), /不一致/)
  h.states.get(2).settleStatus = 'running'
  await assert.rejects(conversationStateAtTurn(h.source, 2, h.read), /结算/)
})

function native() {
  const events = []
  for (const turn of [1, 2, 3]) {
    events.push({ seq: events.length, type: 'turn/start', data: { turn } })
    events.push({ seq: events.length, type: 'assistant/message', data: { turn, message: { id: 'm' + turn, source: { kind: 'model' }, content: [{ type: 'text', text: 'reply' + turn }] } } })
    events.push({ seq: events.length, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return { events }
}

test('原生分叉边界按所选回合确定，不把后续模型历史带入', () => {
  const session = native()
  assert.equal(conversationForkBoundary(session, {}, 1), 2)
  assert.equal(conversationForkBoundary(session, {}, 2), 5)
  assert.equal(conversationForkBoundary(session, {}, 3), 8)
  assert.throws(() => conversationForkBoundary(session, {}, 4), /边界/)
})
