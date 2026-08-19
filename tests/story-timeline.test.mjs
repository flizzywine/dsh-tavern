import assert from 'node:assert/strict'
import test from 'node:test'

import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

function harness() {
  let sequence = 0
  const timeline = createStoryTimeline({
    id(prefix) { sequence++; return prefix + '-' + sequence },
    now() { return 1000 + sequence }
  })
  const chat = {
    id: 'chat-1', mode: 'script', messages: [], posture: '门边站立', candidates: null,
    scriptState: { cursor: 0, prepared: null }, settleStatus: 'done', settleError: null, lastSettle: { ts: 1 },
    candidateAgent: null
  }
  return { timeline, chat }
}

function beginAndCommitBody(timeline, chat, turn, userText, body) {
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
  return completed.chat
}

test('正文提交建立 checkpoint，revision 单调增加并清除旧候选', () => {
  const { timeline, chat } = harness()
  chat.candidates = { messageId: 'old', choices: [{ type: 'action', text: '旧候选' }] }
  const next = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')

  const view = timeline.inspect({ chat: next })
  assert.equal(view.revision, 1)
  assert.equal(view.checkpointCount, 1)
  assert.equal(next.candidates, null)
  assert.equal(next.messages.length, 2)
  assert.equal(next.scriptState.cursor, 1)
})

test('回退恢复完整 checkpoint，但创建新 branch 且 revision 不倒退', () => {
  const { timeline, chat } = harness()
  const first = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  first.posture = '站在屋内'
  const second = beginAndCommitBody(timeline, first, 2, '上楼', '钟声响了。')
  const beforeRollback = timeline.inspect({ chat: second })

  const rolled = timeline.apply({ chat: second, intent: { kind: 'turn.rollback' } })
  const after = timeline.inspect({ chat: rolled.chat })

  assert.notEqual(after.branchId, beforeRollback.branchId)
  assert.equal(after.revision, beforeRollback.revision + 1)
  assert.deepEqual(rolled.chat.messages.map((message) => message.text), ['推门', '门开了。'])
  assert.equal(rolled.chat.scriptState.cursor, 1)
  assert.equal(rolled.chat.posture, '站在屋内')
  assert.equal(after.checkpointCount, 1)
})

test('候选工作绑定 branch/revision；回退后迟到结果自动 stale', () => {
  const { timeline, chat } = harness()
  const committed = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  const begun = timeline.apply({ chat: committed, intent: { kind: 'agent.begin', role: 'candidate' } })
  const rolled = timeline.apply({ chat: begun.chat, intent: { kind: 'turn.rollback' } })
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
  const rolled = timeline.apply({ chat: begun.chat, intent: { kind: 'turn.rollback' } })
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

test('候选与状态结算是同一后台 Agent 的不同任务，共用 participant', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'settlement' } })
  assert.equal(begun.value.participant.role, 'background')
  let completed = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success', stateChanged: true, participant: { sessionId: 'background-1', boundary: 20, lifetime: 'branch' } },
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
})

test('分支级 participant 在正常推进时复用，回退后变为惰性派生', () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '推门', '门开了。')
  let begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  let completed = timeline.complete({
    chat: begun.chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success', participant: { sessionId: 'candidate-1', boundary: 42, lifetime: 'branch' } },
    apply() {}
  })
  current = completed.chat

  current = beginAndCommitBody(timeline, current, 2, '上楼', '钟声响了。')

  begun = timeline.apply({ chat: current, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(begun.value.participant.sessionId, 'candidate-1')
  assert.equal(begun.value.participant.forkFrom, null)

  const rolled = timeline.apply({ chat: begun.chat, intent: { kind: 'turn.rollback' } })
  const next = timeline.apply({ chat: rolled.chat, intent: { kind: 'agent.begin', role: 'candidate' } })
  assert.equal(next.value.participant.sessionId, '')
  assert.deepEqual(next.value.participant.forkFrom, { sessionId: 'candidate-1', boundary: 42 })
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
