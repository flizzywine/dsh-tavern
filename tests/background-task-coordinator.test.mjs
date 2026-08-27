import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from '../tavern-plugin/lib/domain/background-task-coordinator.js'

function coordinatorHarness(options = {}) {
  let current = {
    id: 'chat-1', mode: 'story', messages: [], posture: '', candidates: null,
    settleStatus: 'idle', settleError: null
  }
  const writes = []
  let sequence = 0
  const timeline = createStoryTimeline({
    id(prefix) { sequence++; return prefix + '-' + sequence },
    now() { return 1000 + sequence }
  })
  const coordinator = createBackgroundTaskCoordinator({
    timeline,
    blocked: options.blocked,
    store: {
      async readChat() { return current },
      async writeChat(chat) { current = chat; writes.push(chat) }
    }
  })
  return { coordinator, timeline, current: function () { return current }, writes }
}

test('后台任务通过一个 interface 原子开始、重载并提交时间线结果', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(harness.current(), 'settlement')
  assert.equal(task.participantRequest.role, 'background')
  assert.equal(harness.writes.length, 1)

  const result = await task.commit({
    stateChanged: true,
    participant: task.participant({ traceSessionId: 'background-1', traceBoundary: 42 }),
    apply(draft) { draft.posture = '门边站立。' }
  })

  assert.equal(result.status, 'committed')
  assert.equal(result.chat.posture, '门边站立。')
  assert.equal(harness.writes.length, 2)
  assert.equal(harness.current().timeline.participants.background.sessionId, 'background-1')
})

test('Tavern 联合压缩期间不允许启动新的后台任务', async () => {
  const harness = coordinatorHarness({ blocked: () => true })
  await assert.rejects(
    () => harness.coordinator.begin(harness.current(), 'settlement'),
    function (error) { return error && error.code === 'COMPACTION_RUNNING' }
  )
  assert.equal(harness.writes.length, 0)
})

test('后台 activity 只由 Story Timeline operation 推导，不相信重复的 settleStatus', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(Object.assign(harness.current(), { settleStatus: 'done' }), 'settlement')

  assert.deepEqual(harness.coordinator.activity(task.chat), {
    phase: 'running', busy: true, role: 'settlement', operationId: task.operationId,
    basedOn: task.basedOn, updatedAt: 1003
  })

  const completed = await task.commit({ stateChanged: false })
  assert.deepEqual(harness.coordinator.activity(completed.chat), {
    phase: 'idle', busy: false, role: 'settlement', operationId: task.operationId,
    basedOn: task.basedOn, updatedAt: 1003
  })
})

test('同一 Tavern Chat 的后台 operation 严格串行，不会用新任务取消旧任务', async () => {
  const harness = coordinatorHarness()
  const first = await harness.coordinator.begin(harness.current(), 'settlement')

  await assert.rejects(
    harness.coordinator.begin(first.chat, 'candidate'),
    function (error) { return error && error.code === 'BACKGROUND_BUSY' }
  )

  const operations = Object.values(harness.timeline.inspect({ chat: first.chat }).operations)
  assert.equal(operations.length, 1)
  assert.equal(operations[0].status, 'running')
  assert.equal(operations[0].role, 'settlement')
})

test('同一候选请求标识重试时返回原 Operation，不会启动第二个后台任务', async () => {
  const harness = coordinatorHarness()
  const first = await harness.coordinator.begin(harness.current(), 'candidate', { requestId: 'candidate-request-1' })
  const retried = await harness.coordinator.begin(first.chat, 'candidate', { requestId: 'candidate-request-1' })

  assert.equal(retried.operationId, first.operationId)
  assert.equal(first.created, true)
  assert.equal(retried.created, false)
  assert.equal(harness.writes.length, 1)
  assert.equal(Object.values(harness.timeline.inspect({ chat: retried.chat }).operations).length, 1)
})

test('按 Operation ID 查询终态，不会被同一 Chat 的后续任务覆盖', async () => {
  const harness = coordinatorHarness()
  const first = await harness.coordinator.begin(harness.current(), 'candidate')
  await first.commit({ stateChanged: false })
  const second = await harness.coordinator.begin(harness.current(), 'candidate')

  assert.equal(harness.coordinator.activity(second.chat).operationId, second.operationId)
  assert.deepEqual(harness.coordinator.operation(second.chat, first.operationId), {
    operationId: first.operationId,
    role: 'candidate',
    requestId: '',
    status: 'completed',
    busy: false,
    terminal: true,
    successful: true,
    basedOn: first.basedOn,
    updatedAt: 1003
  })
})

test('Foreground Turn 提交后直接开放状态结算，不创建世界书 Agent 阶段', async () => {
  const harness = coordinatorHarness()
  const begunBody = harness.timeline.apply({ chat: harness.current(), intent: { kind: 'body.begin', turn: 1, userText: '向前走' } })
  const completedBody = harness.timeline.complete({
    chat: begunBody.chat,
    operationId: begunBody.value.operationId,
    basedOn: begunBody.value.basedOn,
    outcome: { status: 'success' }
  })
  Object.assign(harness.current(), completedBody.chat)

  assert.equal(harness.coordinator.activity(harness.current()).phase, 'pending')
  assert.equal(harness.coordinator.activity(harness.current()).role, 'settlement')
  assert.equal(harness.coordinator.activity(harness.current()).busy, false)
  assert.equal(Object.values(harness.timeline.inspect({ chat: harness.current() }).operations).some(function (operation) { return operation.role === 'worldbook' }), false)

  await assert.rejects(harness.coordinator.begin(harness.current(), 'candidate'), function (error) {
    return error && error.code === 'BACKGROUND_BUSY'
  })

  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')
  const afterSettlement = await settlement.commit({ stateChanged: true })
  assert.equal(harness.coordinator.activity(afterSettlement.chat).phase, 'idle')
  assert.equal(harness.coordinator.activity(afterSettlement.chat).busy, false)
})

test('进程重启把遗留 running operation 恢复为同一 Cycle 的 pending 任务', async () => {
  const harness = coordinatorHarness()
  const begunBody = harness.timeline.apply({ chat: harness.current(), intent: { kind: 'body.begin', turn: 1, userText: '向前走' } })
  const completedBody = harness.timeline.complete({ chat: begunBody.chat, operationId: begunBody.value.operationId, basedOn: begunBody.value.basedOn, outcome: { status: 'success' } })
  Object.assign(harness.current(), completedBody.chat)
  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')

  const recovered = await harness.coordinator.recover(settlement.chat)

  assert.equal(recovered.activity.phase, 'pending')
  assert.equal(recovered.activity.role, 'settlement')
  const interrupted = Object.values(harness.timeline.inspect({ chat: recovered.chat }).operations).find(function (operation) {
    return operation.kind === 'agent' && operation.role === 'settlement'
  })
  assert.equal(interrupted.status, 'interrupted')
  await harness.coordinator.begin(recovered.chat, 'settlement')
})

test('世界书确定性投影不需要 skip operation，后台周期始终只有结算', async () => {
  const harness = coordinatorHarness()
  const begunBody = harness.timeline.apply({ chat: harness.current(), intent: { kind: 'body.begin', turn: 1, userText: '向前走' } })
  const completedBody = harness.timeline.complete({ chat: begunBody.chat, operationId: begunBody.value.operationId, basedOn: begunBody.value.basedOn, outcome: { status: 'success' } })
  Object.assign(harness.current(), completedBody.chat)

  assert.equal(harness.coordinator.activity(harness.current()).role, 'settlement')
  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')
  const recovered = await harness.coordinator.recover(settlement.chat)
  assert.equal(recovered.activity.phase, 'pending')
  assert.equal(recovered.activity.role, 'settlement')
  await harness.coordinator.begin(recovered.chat, 'settlement')
})

test('重启会持久关闭遗留候选 operation，但不会误排结算', async () => {
  const harness = coordinatorHarness()
  const candidate = await harness.coordinator.begin(harness.current(), 'candidate')
  const recovered = await harness.coordinator.recover(candidate.chat)

  assert.equal(recovered.status, 'recovered')
  assert.equal(recovered.activity.busy, false)
  assert.equal(Object.values(harness.current().timeline.operations)[0].status, 'interrupted')
})

test('后台模型失败由 coordinator 关闭 operation，任务 module 只负责上报失败', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(harness.current(), 'candidate')
  const result = await task.fail({ traceSessionId: 'background-2', traceBoundary: 7 })

  assert.equal(result.status, 'failed')
  assert.equal(harness.writes.length, 2)
  assert.equal(Object.values(harness.current().timeline.operations)[0].status, 'failed')
})

test('只有尚未结算的纯开场白会在首次生成候选前补跑后台结算', () => {
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'idle',
    messages: [{ role: 'assistant', text: '开场白', greeting: true }]
  }), true)
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'done',
    messages: [{ role: 'assistant', text: '开场白', greeting: true }]
  }), false)
  assert.equal(isOpeningAwaitingSettlement({
    settleStatus: 'idle',
    messages: [
      { role: 'assistant', text: '开场白', greeting: true },
      { role: 'user', text: '向前走' },
      { role: 'assistant', text: '第一轮正文' }
    ]
  }), false)
})
