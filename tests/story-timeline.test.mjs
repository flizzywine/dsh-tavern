import assert from 'node:assert/strict'
import test from 'node:test'

import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

const histories = new WeakMap()

function harness() {
  let sequence = 0
  const timeline = createStoryTimeline({
    id(prefix) { sequence++; return prefix + '-' + sequence },
    now() { return 1000 + sequence }
  })
  const chat = {
    id: 'chat-1', mode: 'script', messages: [], posture: '门边站立', candidates: null,
    scriptState: { cursor: 0, prepared: null }, settleStatus: 'done', settleError: null, lastSettle: { ts: 1 },
    candidateAgent: null, _storageRevision: 1
  }
  histories.set(timeline, new Map())
  return { timeline, chat }
}

function beginAndCommitBody(timeline, chat, turn, userText, body) {
  const beforeRevision = Math.max(0, Number(chat._storageRevision) || 0)
  histories.get(timeline).set(beforeRevision, structuredClone(chat))
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn, userText } })
  const completed = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) {
      draft.messages.push({ role: 'user', text: userText }, { role: 'assistant', text: body })
      draft.scriptState = { cursor: draft.scriptState.cursor + 1, prepared: null }
    }
  })
  const begunSettlement = timeline.apply({ chat: completed.chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  const settled = timeline.complete({
    chat: begunSettlement.chat,
    operationId: begunSettlement.value.operationId,
    basedOn: begunSettlement.value.basedOn,
    outcome: { status: 'success' }
  })
  settled.chat._storageRevision = beforeRevision + 2
  return settled.chat
}

function rollback(timeline, chat) {
  const target = timeline.rollbackTarget({ chat })
  const beforeChat = target === null ? undefined : histories.get(timeline).get(target.beforeRevision)
  const result = timeline.apply({ chat, intent: { kind: 'turn.rollback', beforeChat } })
  result.chat._storageRevision = Math.max(0, Number(chat._storageRevision) || 0) + 1
  return result
}

test('结算延后、失败和重试都不重复提交正文 checkpoint', () => {
  const { timeline, chat } = harness()
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1, userText: '推门' } })
  let current = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.messages.push({ role: 'user', text: '推门' }, { role: 'assistant', text: '门开了。' }) }
  }).chat

  let settlement = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  current = timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'deferred' },
    apply(draft) { draft.settleStatus = 'waiting-runtime' }
  }).chat
  assert.equal(timeline.inspect({ chat: current }).revision, 1)
  assert.equal(current.timeline.operations[begun.value.operationId].background.phase, 'pending')

  settlement = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  current = timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'failed' }
  }).chat
  assert.equal(timeline.inspect({ chat: current }).revision, 1)
  assert.equal(current.timeline.operations[begun.value.operationId].background.phase, 'failed')

  settlement = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  current = timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'success' }
  }).chat
  assert.equal(timeline.inspect({ chat: current }).revision, 1)
  assert.equal(timeline.inspect({ chat: current }).checkpointCount, 1)
})

test('旧正文结算迟到时不能覆盖更新正文之后的派生状态', () => {
  const { timeline, chat } = harness()
  const first = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1, userText: '推门' } })
  let current = timeline.complete({
    chat: first.chat,
    operationId: first.value.operationId,
    basedOn: first.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.messages.push({ role: 'user', text: '推门' }, { role: 'assistant', text: '门开了。' }) }
  }).chat
  const oldSettlement = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  const second = timeline.apply({ chat: oldSettlement.chat, intent: { kind: 'body.begin', turn: 2, userText: '进去' } })
  current = timeline.complete({
    chat: second.chat,
    operationId: second.value.operationId,
    basedOn: second.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.messages.push({ role: 'user', text: '进去' }, { role: 'assistant', text: '走进屋内。' }) }
  }).chat

  const late = timeline.complete({
    chat: current,
    operationId: oldSettlement.value.operationId,
    basedOn: oldSettlement.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.posture = '错误的迟到姿势' }
  })

  assert.equal(late.value.status, 'stale')
  assert.equal(late.chat.posture, '门边站立')
  assert.equal(timeline.inspect({ chat: late.chat }).checkpointCount, 2)
})
test('回退恢复完整 checkpoint，但创建新 branch 且 revision 不倒退', () => {
  const { timeline, chat } = harness()
  const first = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  first.posture = '站在屋内'
  first.preparedWorldBookContext = '钟楼只在午夜开放。'
  first.preparedWorldBook = { turn: 1, mode: 'agent' }
  first.worldBookReads = { 'entry:1': { turn: 1, fingerprint: 'old' } }
  const second = beginAndCommitBody(timeline, first, 2, '上楼', '钟声响了。')
  second.preparedWorldBookContext = '这条属于第二轮之后，不应保留。'
  second.worldBookReads['entry:2'] = { turn: 2, fingerprint: 'new' }
  const beforeRollback = timeline.inspect({ chat: second })

  const rolled = rollback(timeline, second)
  const after = timeline.inspect({ chat: rolled.chat })

  assert.notEqual(after.branchId, beforeRollback.branchId)
  assert.equal(after.revision, beforeRollback.revision + 1)
  assert.deepEqual(rolled.chat.messages.map((message) => message.text), ['推门', '门开了。'])
  assert.equal(rolled.chat.scriptState.cursor, 1)
  assert.equal(rolled.chat.posture, '站在屋内')
  assert.equal(rolled.chat.preparedWorldBookContext, '钟楼只在午夜开放。')
  assert.deepEqual(rolled.chat.preparedWorldBook, { turn: 1, mode: 'agent' })
  assert.deepEqual(rolled.chat.worldBookReads, { 'entry:1': { turn: 1, fingerprint: 'old' } })
  assert.equal(after.checkpointCount, 1)
})

test('候选工作绑定 branch/revision；回退后迟到结果自动 stale', () => {
  const { timeline, chat } = harness()
  const committed = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  const begun = timeline.apply({ chat: committed, intent: { kind: 'agent.begin', role: 'candidate' } })
  const rolled = rollback(timeline, begun.chat)
  const late = timeline.complete({
    chat: rolled.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.candidates = { choices: [{ type: 'action', text: '迟到候选' }] } }
  })

  assert.equal(late.value.status, 'stale')
  assert.equal(late.chat.candidates, null)
})

test('同一 operation 协议可扩展到状态结算，迟到结算不能覆盖回退状态', () => {
  const { timeline, chat } = harness()
  const committed = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  const begun = timeline.apply({ chat: committed, intent: { kind: 'agent.begin', role: 'settlement' } })
  const rolled = rollback(timeline, begun.chat)
  const late = timeline.complete({
    chat: rolled.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.posture = '错误的新姿势' }
  })

  assert.equal(late.value.status, 'stale')
  assert.equal(late.chat.posture, '门边站立')
})

test('正文替代失败恢复原内容，但仍换 branch/revision 防止瞬时 operation 复活', () => {
  const { timeline, chat } = harness()
  const original = timeline.apply({ chat, intent: { kind: 'ensure' } }).chat
  const transient = timeline.apply({ chat: original, intent: { kind: 'agent.begin', role: 'candidate' } }).chat
  transient.messages.push({ role: 'assistant', text: '不应保留的临时状态' })

  const restored = timeline.apply({
    chat: transient,
    intent: { kind: 'replacement.abort', restoreChat: original }
  })

  assert.deepEqual(restored.chat.messages, original.messages)
  assert.notEqual(restored.chat.timeline.branchId, original.timeline.branchId)
  assert.ok(restored.chat.timeline.revision > transient.timeline.revision)
  assert.equal(restored.chat.timeline.operations[Object.keys(restored.chat.timeline.operations)[0]], undefined)
})

test('旧 checkpoint 丢失直接来源时向前恢复最近的有效后台边界', () => {
  const { timeline, chat } = harness()
  let current = timeline.apply({ chat, intent: { kind: 'ensure' } }).chat
  current.timeline.participants.background = {
    role: 'background', lifetime: 'branch', sessionId: 'background-old', branchId: current.timeline.branchId,
    syncedRevision: 0, boundary: 42, status: 'current', rewindTo: null, updatedAt: 1
  }
  current = beginAndCommitBody(timeline, current, 1, '推门', '第一段正文')
  current.timeline.participants.background = {
    role: 'background', lifetime: 'branch', sessionId: '', branchId: current.timeline.branchId,
    syncedRevision: null, boundary: null, status: 'needs-branch', forkFrom: null, updatedAt: 2
  }
  current = beginAndCommitBody(timeline, current, 2, '上楼', '第二段正文')

  const rolled = rollback(timeline, current)
  const begun = timeline.apply({ chat: rolled.chat, intent: { kind: 'agent.begin', role: 'candidate' } })

  assert.equal(begun.value.participant.sessionId, 'background-old')
  assert.equal(begun.value.participant.rewindTo, 42)
})

test('台账随正文 checkpoint 回退，旧后台迟到不能恢复撤回的物品，重新推进可重新记账', () => {
  const { timeline, chat } = harness()
  chat.ledger = { version: 1, items: [{ name: '药', qty: 3 }] }
  let current = beginAndCommitBody(timeline, chat, 1, '用药', '用掉一瓶。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  current = timeline.complete({ chat: begun.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success', stateChanged: true }, apply(draft) { draft.ledger = { version: 1, items: [{ name: '药', qty: 2 }] } } }).chat
  current = beginAndCommitBody(timeline, current, 2, '再用药', '又用一瓶。')
  begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  const rolled = rollback(timeline, begun.chat)
  assert.equal(rolled.chat.ledger.items[0].qty, 2)
  const late = timeline.complete({ chat: rolled.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) { draft.ledger.items[0].qty = 1 } })
  assert.notEqual(late.value.status, 'completed')
  assert.equal(late.chat.ledger.items[0].qty, 2)
  const fresh = beginAndCommitBody(timeline, late.chat, 3, '重新用药', '用一瓶。')
  const latest = timeline.apply({ chat: fresh, intent: { kind: 'agent.begin', role: 'settlement' } })
  const settled = timeline.complete({ chat: latest.chat, operationId: latest.value.operationId, basedOn: latest.value.basedOn, outcome: { status: 'success' }, apply(draft) { draft.ledger.items[0].qty = 1 } })
  assert.equal(settled.chat.ledger.items[0].qty, 1)
})

test('body edit invalidates stale posture and rewinds background before the edited round', () => {
  const { timeline } = harness()
  let chat = timeline.apply({ intent: { kind: 'ensure' }, chat: { id: 'edited', mode: 'story', messages: [
    { role: 'user', text: '开门' }, { role: 'assistant', turn: 2, text: '陆伯拿蓝灯笼' }
  ], posture: '陆伯拿蓝灯笼', variables: { hp: 9 }, scriptState: { cursor: 2 }, settleStatus: 'done', lastSettle: { ts: 1 } } }).chat
  const background = { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'current', boundary: 40, branchId: chat.timeline.branchId }
  chat.timeline.participants.background = background
  chat.timeline.checkpoints = [{ turn: 2, participants: { background: { ...background, boundary: 19 } } }]
  chat = timeline.apply({ chat, intent: { kind: 'body.edit', turn: 2, patch: { text: '沈青拿红纸伞' } } }).chat
  assert.equal(chat.posture, '')
  assert.equal(chat.lastSettle, null)
  assert.deepEqual(chat.variables, { hp: 9 })
  assert.deepEqual(chat.scriptState, { cursor: 2 })
  const task = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(task.value.participant.sessionId, 'bg')
  assert.equal(task.value.participant.rewindTo, 19)
})

test('后台会话压缩过：编辑与撤销都沿用同一个后台会话，原地清空任务历史，清空后不再沿用压缩标记', () => {
  const { timeline } = harness()
  let chat = timeline.apply({ intent: { kind: 'ensure' }, chat: { id: 'compacted', mode: 'story', messages: [
    { role: 'user', text: '开门' }, { role: 'assistant', turn: 2, text: '陆伯拿蓝灯笼' }
  ], posture: '', scriptState: { cursor: 2 }, settleStatus: 'done' } }).chat
  const background = { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'current', boundary: 40, branchId: chat.timeline.branchId, requiresNewSessionOnRewind: true }
  chat.timeline.participants.background = background
  chat.timeline.checkpoints = [{ turn: 2, participants: { background: { ...background, boundary: 19 } } }]
  const original = structuredClone(chat)
  const edited = timeline.apply({ chat: structuredClone(chat), intent: { kind: 'body.edit', turn: 2, patch: { text: '沈青拿红纸伞' } } }).chat
  const editTask = timeline.apply({ chat: edited, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(editTask.value.participant.sessionId, 'bg')
  assert.equal(editTask.value.participant.rewindTo, -1)
  const aborted = timeline.apply({ chat: structuredClone(chat), intent: { kind: 'replacement.abort', restoreChat: original } }).chat
  assert.equal(aborted.timeline.participants.background.sessionId, 'bg')
  assert.equal(aborted.timeline.participants.background.status, 'needs-rewind')
  assert.equal(aborted.timeline.participants.background.rewindTo, -1)
  // After the reset ran, the worker has no compacted history left.
  const done = timeline.complete({ chat: editTask.chat, operationId: editTask.value.operationId, basedOn: editTask.value.basedOn,
    outcome: { status: 'success', participant: { sessionId: 'bg', boundary: 7 } } }).chat
  assert.equal(done.timeline.participants.background.boundary, 7)
  assert.equal(done.timeline.participants.background.requiresNewSessionOnRewind, undefined)
})

test('变量重试推进版本后，延后的重新结算接续时仍能提交', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  const settle = (outcome) => {
    const begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
    const result = timeline.complete({ chat: begun.chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome })
    current = result.chat
    return { begun, result }
  }
  // A completed variable retry changes state and advances the revision.
  settle({ status: 'success', stateChanged: true })
  assert.equal(timeline.inspect({ chat: current }).revision, 2)
  // The next retry waits for the runtime, then resumes.
  settle({ status: 'deferred' })
  const { begun, result } = settle({ status: 'success', stateChanged: true })
  assert.equal(begun.chat.timeline.operations[begun.value.operationId].roundOperationId, undefined)
  assert.equal(result.value.status, 'committed')
  assert.equal(timeline.inspect({ chat: current }).revision, 3)
})

test('裁剪旧 operation 时保留仍在运行或延后的任务', () => {
  const { timeline, chat } = harness()
  const settlement = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  const current = settlement.chat
  for (let index = 0; index < 85; index++) {
    current.timeline.operations['old-' + index] = { id: 'old-' + index, kind: 'body', role: 'body', status: 'completed', createdAt: 5000 + index }
  }
  const begun = timeline.apply({ chat: current, intent: { kind: 'body.begin', turn: 1, userText: '继续' } })
  const operations = begun.chat.timeline.operations
  assert.equal(operations[settlement.value.operationId]?.status, 'running')
  assert.equal(operations[begun.value.operationId]?.status, 'running')
  assert.equal(operations['old-0'], undefined, '已完成的旧记录照常裁剪')
  assert.equal(Object.keys(operations).filter(id => id.startsWith('old-')).length, 80)
})
