import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationStateAtMessage, conversationStateAtTurn, conversationForkBoundary } from '../tavern-plugin/lib/domain/conversation-fork-point.js'

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

// A story Chat whose snapshots are keyed by revision, exactly like storage: here
// revision == message count and each round contributes one checkpoint.
function chain(turns, turnsOf) {
  const messages = []
  const states = new Map()
  for (let turn = 1; turn <= turns; turn++) {
    messages.push({ role: 'user', text: 'input' + turn })
    messages.push({ role: 'assistant', turn: turnsOf ? turnsOf(turn) : turn, text: 'reply' + turn, variables: [{ hp: turn }] })
    states.set(messages.length, {
      id: 'chat', sessionId: 'source', mode: 'story', _storageRevision: messages.length, settleStatus: 'done',
      messages: structuredClone(messages), timeline: { checkpoints: [] }
    })
  }
  const source = structuredClone(states.get(messages.length))
  for (let turn = 1; turn < turns; turn++) source.timeline.checkpoints.push({ turn: turn + 1, beforeRevision: 2 * turn })
  const read = async (_id, revision) => structuredClone(states.get(revision))
  return { source, states, read }
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

test('按绝对消息序号选择状态：不读 turn，缺 turn 也能定位，分叉点必须是正文', async () => {
  const messages = []
  for (let i = 0; i < 3; i++) messages.push({ role: 'user', text: 'in' + i }, { role: 'assistant', text: 'out' + i })
  const make = rows => ({ id: 'chat', sessionId: 'session', mode: 'story', settleStatus: 'done', _storageRevision: rows, messages: structuredClone(messages.slice(0, rows)), timeline: { checkpoints: [] } })
  const states = new Map([[2, make(2)], [4, make(4)]])
  const source = { ...make(6), _storageRevision: 6, timeline: { checkpoints: [{ beforeRevision: 2 }, { beforeRevision: 4 }] } }
  const read = async (_id, revision) => structuredClone(states.get(revision))
  const first = await conversationStateAtMessage(source, 1, read)
  assert.equal(first.messageIndex, 1)
  assert.equal(first.state.messages.length, 2)
  assert.equal(first.state.messages[1].text, 'out0')
  const second = await conversationStateAtMessage(source, 3, read)
  assert.equal(second.messageIndex, 3)
  assert.equal(second.state.messages.length, 4)
  // The head resolves to the live Chat itself, without reading any revision.
  const head = await conversationStateAtMessage(source, 5, async () => { throw new Error('不该读取快照') })
  assert.equal(head.state, source)
  assert.equal(head.messageIndex, 5)
  await assert.rejects(conversationStateAtMessage(source, 0, read), /正文消息/)
  await assert.rejects(conversationStateAtMessage(source, 99, read), /找不到指定分叉消息/)
  await assert.rejects(conversationStateAtMessage(source, 1.5, read), /找不到指定分叉消息/)
})

test('重复、缺失、非单调 turn 不影响状态选择，只按消息序号对齐前缀', async () => {
  const { source, states, read } = chain(4, turn => [2, 2, 1, 3][turn - 1])
  // Checkpoint order is reversed and the snapshot's own turns differ from the source.
  source.timeline.checkpoints.reverse()
  states.get(2).messages[1].turn = 999
  const atMessage1 = await conversationStateAtMessage(source, 1, read)
  assert.equal(atMessage1.state.messages.length, 2)
  const atMessage3 = await conversationStateAtMessage(source, 3, read)
  assert.equal(atMessage3.state.messages.length, 4)
  assert.equal(atMessage3.state.messages[3].text, 'reply2')
  // No turn field anywhere: the index still picks the prefix.
  for (const row of source.messages) delete row.turn
  const turnless = await conversationStateAtMessage(source, 5, read)
  assert.equal(turnless.state.messages.length, 6)
})

test('陈旧或内容不符的快照不会被当作所选消息的状态', async () => {
  const { source, states, read } = chain(3)
  states.get(2).messages[1].text = '其他分支的正文'
  await assert.rejects(conversationStateAtMessage(source, 1, read), /不一致/)
  await assert.rejects(conversationStateAtMessage(source, 1, async () => undefined), /不可用/)
  await assert.rejects(conversationStateAtMessage(source, 1, async () => {
    const error = new Error('gone')
    error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
    throw error
  }), /已清理/)
  const settling = chain(3)
  settling.states.get(2).settleStatus = 'running'
  await assert.rejects(conversationStateAtMessage(settling.source, 1, settling.read), /结算/)
  const live = chain(3)
  live.source.regenInProgress = true
  await assert.rejects(conversationStateAtMessage(live.source, 5, live.read), /正文仍在生成/)
})

test('旧 turn API 回归：按 turn 找到消息后仍走按序号的状态选择，原生边界保持不变', async () => {
  const { source, read } = chain(3)
  const byTurn = await conversationStateAtTurn(source, 2, read)
  assert.equal(byTurn.turn, 2)
  assert.equal(byTurn.state.messages.length, 4)
  const auto = await conversationStateAtTurn(source, 0, read)
  assert.equal(auto.turn, 3)
  assert.equal(auto.state, source)
  await assert.rejects(conversationStateAtTurn(source, 9, read), /找不到/)
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
