import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

import {
  createBackgroundTaskCoordinator,
  createSettlementAfterTurnEndScheduler,
  isOpeningAwaitingSettlement,
  shouldStartSettlementAfterTurnEnd
} from '../tavern-plugin/lib/domain/background-task-coordinator.js'

function coordinatorHarness() {
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
    store: {
      async readChat() { return current },
      async writeChat(chat) { current = chat; writes.push(chat) }
    }
  })
  return { coordinator, timeline, current: function () { return current }, writes }
}

test('后台任务通过一个 interface 原子开始、重载并提交时间线结果', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(harness.current(), 'worldbook')
  assert.equal(task.participantRequest.role, 'background')
  assert.equal(harness.writes.length, 1)

  const result = await task.commit({
    stateChanged: true,
    participant: task.participant({ traceSessionId: 'background-1', traceBoundary: 42 }),
    apply(draft) { draft.preparedWorldBookContext = '钟楼只在午夜开放。' }
  })

  assert.equal(result.status, 'committed')
  assert.equal(result.chat.preparedWorldBookContext, '钟楼只在午夜开放。')
  assert.equal(harness.writes.length, 2)
  assert.equal(harness.current().timeline.participants.background.sessionId, 'background-1')
})

test('后台 activity 只由 Story Timeline operation 推导，不相信重复的 settleStatus', async () => {
  const harness = coordinatorHarness()
  const task = await harness.coordinator.begin(Object.assign(harness.current(), { settleStatus: 'done' }), 'worldbook')

  assert.deepEqual(harness.coordinator.activity(task.chat), {
    phase: 'running', busy: true, role: 'worldbook', operationId: task.operationId,
    basedOn: task.basedOn, updatedAt: 1003
  })

  const completed = await task.commit({ stateChanged: false })
  assert.deepEqual(harness.coordinator.activity(completed.chat), {
    phase: 'idle', busy: false, role: 'worldbook', operationId: task.operationId,
    basedOn: task.basedOn, updatedAt: 1003
  })
})

test('同一 Tavern Chat 的后台 operation 严格串行，不会用新任务取消旧任务', async () => {
  const harness = coordinatorHarness()
  const first = await harness.coordinator.begin(harness.current(), 'worldbook')

  await assert.rejects(
    harness.coordinator.begin(first.chat, 'settlement'),
    function (error) { return error && error.code === 'BACKGROUND_BUSY' }
  )

  const operations = Object.values(harness.timeline.inspect({ chat: first.chat }).operations)
  assert.equal(operations.length, 1)
  assert.equal(operations[0].status, 'running')
  assert.equal(operations[0].role, 'worldbook')
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

test('正文只在前台 turn/end 成功送达后启动后台结算', () => {
  const story = { mode: 'story', settleStatus: 'running' }
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'completed'), true)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'max-tokens'), true)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, ''), false)
  assert.equal(shouldStartSettlementAfterTurnEnd(story, 'failed'), false)
  assert.equal(shouldStartSettlementAfterTurnEnd({ mode: 'card', settleStatus: 'running' }, 'completed'), false)
  assert.equal(shouldStartSettlementAfterTurnEnd({ mode: 'story', settleStatus: 'done' }, 'completed'), false)
})

test('后台结算被推迟到 turn/end 事件处理完成后的下一任务', async () => {
  const queued = []
  const deferred = []
  const schedule = createSettlementAfterTurnEndScheduler({
    async readChatForSession() { return { id: 'chat-1', mode: 'story', settleStatus: 'running' } },
    async queueSettlement(chatId) { queued.push(chatId) },
    defer(task) { deferred.push(task) }
  })

  assert.equal(schedule({ sessionId: 'session-1', reason: 'completed' }), true)
  assert.deepEqual(queued, [])
  assert.equal(deferred.length, 1)
  deferred[0]()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.deepEqual(queued, ['chat-1'])
})
