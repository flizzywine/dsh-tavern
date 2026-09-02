import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
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
      async writeChat(chat) { current = chat; writes.push(chat) },
      async updateChat(_chatId, mutation) {
        const next = await mutation(current)
        if (next !== undefined) current = next
        writes.push(current)
        return current
      }
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

test('展示刷新插入结算提交时，后台基于最新 Chat 原子保留双方消息差量', async () => {
  let value = {
    id: 'chat-1', mode: 'story',
    messages: [{ role: 'assistant', text: '正文', displayRuntime: null, mvu: { pending: true } }],
    posture: '', candidates: null, settleStatus: 'idle', settleError: null,
    _storageRevision: 1
  }
  let tail = Promise.resolve()
  const persistence = createChatPersistence({
    now: () => 1000,
    data: {
      async readJson() { return structuredClone(value) },
      async updateJson(_path, updater) {
        const current = tail.then(async function () {
          const next = await updater(structuredClone(value))
          if (next !== undefined) value = structuredClone(next)
          return structuredClone(value)
        })
        tail = current.catch(function () {})
        return await current
      },
      async remove() {}
    }
  })
  let injectDisplayRefresh = false
  async function refreshDisplay() {
    await persistence.update('chat-1', function (chat) {
      chat.messages[0].displayRuntime = { dom: '<p>正文</p>' }
      return chat
    }, { source: 'display.capture' })
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-1', now: () => 1000 })
  const coordinator = createBackgroundTaskCoordinator({
    timeline,
    store: {
      readChat: chatId => persistence.read(chatId),
      async writeChat(chat, metadata) {
        if (injectDisplayRefresh) {
          injectDisplayRefresh = false
          await refreshDisplay()
        }
        return await persistence.write(chat, metadata)
      },
      async updateChat(chatId, mutation, metadata) {
        if (injectDisplayRefresh) {
          injectDisplayRefresh = false
          await refreshDisplay()
        }
        return await persistence.update(chatId, mutation, metadata)
      }
    }
  })

  const task = await coordinator.begin(await persistence.read('chat-1'), 'settlement')
  injectDisplayRefresh = true
  const result = await task.commit({
    stateChanged: true,
    apply(chat) { chat.messages[0].mvu = { pending: false, modified: true } }
  })

  assert.deepEqual(result.chat.messages[0].displayRuntime, { dom: '<p>正文</p>' })
  assert.deepEqual(result.chat.messages[0].mvu, { pending: false, modified: true })
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
    basedOn: task.basedOn, updatedAt: task.chat.timeline.operations[task.operationId].createdAt
  })

  const completed = await task.commit({ stateChanged: false })
  assert.deepEqual(harness.coordinator.activity(completed.chat), {
    phase: 'idle', busy: false, role: 'settlement', operationId: task.operationId,
    basedOn: task.basedOn, updatedAt: completed.chat.timeline.operations[task.operationId].completedAt
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
  const firstCompleted = await first.commit({ stateChanged: false })
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
    updatedAt: firstCompleted.chat.timeline.operations[first.operationId].completedAt
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
    return error && error.code === 'ROUND_INCOMPLETE'
  })

  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')
  const afterSettlement = await settlement.commit({ stateChanged: true })
  assert.equal(harness.coordinator.activity(afterSettlement.chat).phase, 'idle')
  assert.equal(harness.coordinator.activity(afterSettlement.chat).busy, false)
})

test('Round 结算失败后只能重试结算，不能穿插候选任务', async () => {
  const harness = coordinatorHarness()
  const body = harness.timeline.apply({ chat: harness.current(), intent: { kind: 'body.begin', turn: 1, userText: '向前走' } })
  const foreground = harness.timeline.complete({
    chat: body.chat,
    operationId: body.value.operationId,
    basedOn: body.value.basedOn,
    outcome: { status: 'success' }
  })
  Object.assign(harness.current(), foreground.chat)
  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')
  await settlement.fail()

  await assert.rejects(
    harness.coordinator.begin(harness.current(), 'candidate'),
    function (error) { return error && error.code === 'ROUND_INCOMPLETE' && error.operationId === body.value.operationId }
  )
  await assert.doesNotReject(harness.coordinator.begin(harness.current(), 'settlement'))
})

test('进程重启把遗留 running 结算恢复为可重试失败，不假装仍在执行', async () => {
  const harness = coordinatorHarness()
  const begunBody = harness.timeline.apply({ chat: harness.current(), intent: { kind: 'body.begin', turn: 1, userText: '向前走' } })
  const completedBody = harness.timeline.complete({ chat: begunBody.chat, operationId: begunBody.value.operationId, basedOn: begunBody.value.basedOn, outcome: { status: 'success' } })
  Object.assign(harness.current(), completedBody.chat)
  const settlement = await harness.coordinator.begin(harness.current(), 'settlement')

  const recovered = await harness.coordinator.recover(settlement.chat)

  assert.equal(recovered.activity.phase, 'failed')
  assert.equal(recovered.activity.reason, 'interrupted')
  assert.equal(recovered.activity.busy, false)
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
  assert.equal(recovered.activity.phase, 'failed')
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
