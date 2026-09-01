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

test('正文提交建立 checkpoint，revision 单调增加并清除旧候选', () => {
  const { timeline, chat } = harness()
  chat.candidates = { messageId: 'old', choices: [{ type: 'action', text: '旧候选' }] }
  const next = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')

  const view = timeline.inspect({ chat: next })
  const checkpoint = next.timeline.checkpoints[0]
  const bodyOperation = Object.values(next.timeline.operations).find(function (operation) { return operation.kind === 'body' })
  assert.equal(view.revision, 1)
  assert.equal(view.checkpointCount, 1)
  assert.equal(checkpoint.beforeRevision, 1)
  assert.equal(Object.hasOwn(checkpoint, 'before'), false)
  assert.equal(bodyOperation.beforeRevision, 1)
  assert.equal(Object.hasOwn(bodyOperation, 'before'), false)
  assert.equal(next.candidates, null)
  assert.equal(next.messages.length, 2)
  assert.equal(next.scriptState.cursor, 1)
})

test('前台正文与后台结算构成同一个原子 Round，结算前拒绝下一轮', () => {
  const { timeline, chat } = harness()
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 1, userText: '推门' } })
  const foreground = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.messages.push({ role: 'user', text: '推门' }, { role: 'assistant', text: '门开了。' }) }
  })

  assert.equal(timeline.inspect({ chat: foreground.chat }).revision, 0)
  assert.equal(timeline.inspect({ chat: foreground.chat }).checkpointCount, 0)
  assert.equal(foreground.chat.timeline.operations[begun.value.operationId].status, 'foreground-completed')
  assert.throws(
    () => timeline.apply({ chat: foreground.chat, intent: { kind: 'body.begin', turn: 2, userText: '进去' } }),
    function (error) { return error && error.code === 'ROUND_INCOMPLETE' && error.operationId === begun.value.operationId }
  )

  const settlement = timeline.apply({ chat: foreground.chat, intent: { kind: 'agent.begin', role: 'settlement' } })
  const completed = timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'success' },
    apply(draft) { draft.posture = '站在门内' }
  })
  assert.equal(timeline.inspect({ chat: completed.chat }).revision, 1)
  assert.equal(timeline.inspect({ chat: completed.chat }).checkpointCount, 1)
  assert.equal(completed.chat.timeline.operations[begun.value.operationId].status, 'completed')
  assert.equal(completed.chat.posture, '站在门内')
  assert.doesNotThrow(() => timeline.apply({ chat: completed.chat, intent: { kind: 'body.begin', turn: 2, userText: '进去' } }))
})

test('结算延后或失败都不提交 Round，重试成功后只提交一次', () => {
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
  assert.equal(timeline.inspect({ chat: current }).revision, 0)
  assert.equal(current.timeline.operations[begun.value.operationId].background.phase, 'pending')

  settlement = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  current = timeline.complete({
    chat: settlement.chat,
    operationId: settlement.value.operationId,
    basedOn: settlement.value.basedOn,
    outcome: { status: 'failed' }
  }).chat
  assert.equal(timeline.inspect({ chat: current }).revision, 0)
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

test('世界书不创建 Agent operation，候选与状态结算共用后台 participant', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  assert.equal(begun.value.participant.role, 'background')
  let completed = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success', stateChanged: true, participant: { sessionId: 'background-1', boundary: 20, lifetime: 'chat' } },
    apply(draft) { draft.posture = '门内站立' }
  })
  current = completed.chat

  begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(begun.value.role, 'candidate')
  assert.equal(begun.value.participant.role, 'background')
  assert.equal(begun.value.participant.sessionId, 'background-1')
  assert.equal(begun.value.participant.syncedRevision, begun.value.basedOn.revision)
  assert.equal(timeline.inspect({ chat: begun.chat }).participants.candidate, undefined)
  assert.equal(timeline.inspect({ chat: begun.chat }).participants.settlement, undefined)
  assert.equal(Object.values(timeline.inspect({ chat: begun.chat }).operations).some(function (operation) { return operation.role === 'worldbook' }), false)
})

test('后台 participant 在正常推进时复用，回退后仍使用同一 Session 并请求 Surface 回退', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  let completed = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success', participant: { sessionId: 'candidate-1', boundary: 42, lifetime: 'chat' } },
    apply() {}
  })
  current = completed.chat

  current = beginAndCommitBody(timeline, current, 2, '上楼', '钟声响了。')

  begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(begun.value.participant.sessionId, 'candidate-1')
  assert.equal(begun.value.participant.rewindTo, null)

  const rolled = rollback(timeline, begun.chat)
  const next = timeline.apply({ chat: rolled.chat, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(next.value.participant.sessionId, 'candidate-1')
  assert.equal(next.value.participant.rewindTo, 42)
})

test('后台 Session 压缩后发生正文回退时重建 Session，不复用可能含废弃剧情的摘要', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  current = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success', participant: { sessionId: 'background-1', boundary: 42, lifetime: 'chat' } }
  }).chat
  current = beginAndCommitBody(timeline, current, 2, '上楼', '钟声响了。')
  current.timeline.participants.background.requiresNewSessionOnRewind = true
  current.timeline.participants.background.compactedAt = 1000

  const rolled = rollback(timeline, current)
  begun = timeline.apply({ chat: rolled.chat, intent: { kind: 'agent.begin', role: 'candidate' } })

  assert.equal(begun.value.participant.sessionId, '')
  assert.equal(begun.value.participant.rewindTo, null)
})

test('连续正文替代始终回退同一个后台 Session 的有效 checkpoint', () => {
  const { timeline, chat } = harness()
  let current = timeline.apply({ chat, intent: { kind: 'ensure' } }).chat
  current.timeline.participants.background = {
    role: 'background', lifetime: 'chat', sessionId: 'background-before-body',
    branchId: current.timeline.branchId, syncedRevision: current.timeline.revision,
    boundary: 42, status: 'current', rewindTo: null, updatedAt: 1
  }

  current = beginAndCommitBody(timeline, current, 1, '推门', '第一版正文')
  current = rollback(timeline, current).chat
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(begun.value.participant.sessionId, 'background-before-body')
  assert.equal(begun.value.participant.rewindTo, 42)

  current = beginAndCommitBody(timeline, begun.chat, 2, '推门', '第二版正文')
  current = rollback(timeline, current).chat
  begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })

  assert.equal(begun.value.participant.sessionId, 'background-before-body')
  assert.equal(begun.value.participant.rewindTo, 42)
})

test('旧对话可惰性迁移，现有候选 Session 成为后台 participant', () => {
  const { timeline, chat } = harness()
  chat.messages.push({ role: 'assistant', text: '已有正文' })
  chat.candidateAgent = { sessionId: 'legacy-candidate', mode: 'continuable', updatedAt: 9 }
  const ensured = timeline.apply({ chat, intent: { kind: 'ensure' } })
  const view = timeline.inspect({ chat: ensured.chat })

  assert.equal(view.revision, 0)
  assert.equal(view.participants.background.sessionId, 'legacy-candidate')
  assert.equal(view.participants.background.status, 'current')
})

test('上一版 timeline 的 candidate participant 自动迁移为 background', () => {
  const { timeline, chat } = harness()
  chat.timeline = {
    schemaVersion: 1,
    branchId: 'old-branch',
    revision: 7,
    checkpoints: [],
    operations: {},
    participants: {
      candidate: { role: 'candidate', lifetime: 'branch', sessionId: 'old-candidate', branchId: 'old-branch', syncedRevision: 7, status: 'current' }
    }
  }

  const ensured = timeline.apply({ chat, intent: { kind: 'ensure' } })
  const participants = timeline.inspect({ chat: ensured.chat }).participants
  assert.equal(participants.background.sessionId, 'old-candidate')
  assert.equal(participants.background.role, 'background')
  assert.equal(participants.candidate, undefined)
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

test('正文替代失败不会清空待回退的后台 checkpoint', () => {
  const { timeline, chat } = harness()
  const original = timeline.apply({ chat, intent: { kind: 'ensure' } }).chat
  original.timeline.participants.background = {
    role: 'background', lifetime: 'branch', sessionId: '', branchId: original.timeline.branchId,
    syncedRevision: null, boundary: null, status: 'needs-branch',
    forkFrom: { sessionId: 'background-before-body', boundary: 42 }, updatedAt: 1
  }
  const transient = timeline.apply({ chat: original, intent: { kind: 'agent.begin', role: 'candidate' } }).chat

  const restored = timeline.apply({
    chat: transient,
    intent: { kind: 'replacement.abort', restoreChat: original }
  })

  assert.equal(restored.chat.timeline.participants.background.sessionId, 'background-before-body')
  assert.equal(restored.chat.timeline.participants.background.rewindTo, 42)
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
