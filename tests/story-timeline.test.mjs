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

test('「已精修」标记：手动精修（正文编辑）带上，之后普通编辑去掉', async () => {
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '你好', '原来的正文。')
  current.messages.at(-1).turn = 1
  current = timeline.apply({ chat: current, intent: { kind: 'body.edit', turn: 1, patch: { text: '精修后的正文。', sourceText: '精修后的正文。', polished: true } } }).chat
  assert.equal(current.messages.at(-1).polished, true)
  current = timeline.apply({ chat: current, intent: { kind: 'body.edit', turn: 1, patch: { text: '玩家又改了。', sourceText: '玩家又改了。' } } }).chat
  assert.equal(current.messages.at(-1).polished, undefined)
})

test('自动精修只改措辞：版本号、候选项、姿势和结算都不动，场景键沿用原文；之后手动编辑才算新场景', async () => {
  const { computeSceneTarget, sceneSourceDigest } = await import('../tavern-plugin/lib/domain/scene-illustration.js')
  const { timeline, chat } = harness()
  let current = beginAndCommitBody(timeline, chat, 1, '你好', '原来的正文。')
  current.messages.at(-1).turn = 1
  current.candidates = { choices: ['a'] }
  const revision = current.timeline.revision, key = computeSceneTarget(current, 1).key
  current = timeline.apply({ chat: current, intent: { kind: 'body.polish', turn: 1,
    patch: { text: '润色后的正文。', sourceText: '润色后的正文。', polishedFrom: sceneSourceDigest('原来的正文。') } } }).chat
  assert.equal(current.messages.at(-1).text, '润色后的正文。')
  assert.equal(current.timeline.revision, revision)
  assert.deepEqual(current.candidates, { choices: ['a'] })
  assert.equal(current.posture, '门边站立')
  assert.equal(current.settleStatus, 'done')
  assert.equal(computeSceneTarget(current, 1).key, key)
  current = timeline.apply({ chat: current, intent: { kind: 'body.edit', turn: 1, patch: { text: '玩家改过。', sourceText: '玩家改过。' } } }).chat
  assert.equal(current.messages.at(-1).polishedFrom, undefined)
  assert.notEqual(computeSceneTarget(current, 1).key, key)
  assert.equal(current.timeline.revision, revision + 1)
})
