import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernCompactionCoordinator } from '../tavern-plugin/lib/domain/tavern-compaction.js'

function harness(options = {}) {
  let chat = structuredClone(options.chat || {
    id: 'chat-1',
    mode: 'story',
    sessionId: 'foreground-1',
    timeline: {
      branchId: 'branch-1', revision: 7,
      participants: {
        background: {
          role: 'background', lifetime: 'chat', sessionId: 'background-1',
          branchId: 'branch-1', syncedRevision: 7, boundary: 42, status: 'current'
        }
      }
    }
  })
  const coordinator = createTavernCompactionCoordinator({
    id: () => 'compaction-1',
    now: () => 1000,
    activity: () => options.activity || { phase: 'idle', busy: false, role: '' },
    store: {
      async chatForSession(sessionId) { return sessionId === chat.sessionId ? structuredClone(chat) : undefined },
      async updateChat(chatId, mutation) {
        assert.equal(chatId, chat.id)
        const draft = structuredClone(chat)
        chat = await mutation(draft)
        return structuredClone(chat)
      }
    }
  })
  return { coordinator, read: () => structuredClone(chat) }
}

test('联合压缩计划包含前台与当前后台 Session，并在执行期间阻止后台任务', async function () {
  const app = harness()
  const plan = await app.coordinator.prepare('foreground-1')

  assert.deepEqual(plan, {
    operationId: 'compaction-1',
    foregroundSessionId: 'foreground-1',
    backgroundSessionId: 'background-1'
  })
  assert.equal(app.coordinator.blocked(app.read()), true)
  assert.equal(app.read().timeline.participants.background.requiresNewSessionOnRewind, true)
  assert.equal(await app.coordinator.backgroundTarget('foreground-1', plan.operationId), 'background-1')
})

test('后台压缩目标只能由当前前台压缩计划解析', async function () {
  const app = harness()
  const plan = await app.coordinator.prepare('foreground-1')

  await assert.rejects(
    () => app.coordinator.backgroundTarget('foreground-1', 'wrong-operation'),
    function (error) { return error && error.code === 'COMPACTION_PLAN_STALE' }
  )
  assert.equal(await app.coordinator.backgroundTarget('foreground-1', plan.operationId), 'background-1')
})

test('后台任务运行时拒绝开始联合压缩', async function () {
  const app = harness({ activity: { phase: 'running', busy: true, role: 'settlement' } })
  await assert.rejects(
    () => app.coordinator.prepare('foreground-1'),
    function (error) { return error && error.code === 'BACKGROUND_BUSY' }
  )
})

test('后台结算仅待启动且 Agent 空闲时允许开始联合压缩', async function () {
  const app = harness({ activity: { phase: 'pending', busy: false, role: 'settlement' } })

  const plan = await app.coordinator.prepare('foreground-1')

  assert.equal(plan.foregroundSessionId, 'foreground-1')
  assert.equal(plan.backgroundSessionId, 'background-1')
  assert.equal(app.coordinator.blocked(app.read()), true)
})

test('前后台结果分别持久化，后台成功后标记回退必须重建 Session', async function () {
  const app = harness()
  const plan = await app.coordinator.prepare('foreground-1')
  const result = await app.coordinator.complete('foreground-1', {
    operationId: plan.operationId,
    foreground: { status: 'succeeded', message: 'Compacted 10 history items.' },
    background: { status: 'succeeded', message: 'Compacted 20 history items.' }
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.foreground.status, 'succeeded')
  assert.equal(result.background.status, 'succeeded')
  assert.equal(app.coordinator.blocked(app.read()), false)
  assert.equal(app.read().timeline.participants.background.requiresNewSessionOnRewind, true)
  assert.deepEqual(app.read().lastCompaction, {
    operationId: 'compaction-1', status: 'completed', completedAt: 1000,
    foreground: { status: 'succeeded', message: 'Compacted 10 history items.' },
    background: { status: 'succeeded', message: 'Compacted 20 history items.' }
  })
})

test('单边失败返回部分成功，没有后台 Session 时只要求前台成功', async function () {
  const partial = harness()
  const partialPlan = await partial.coordinator.prepare('foreground-1')
  const partialResult = await partial.coordinator.complete('foreground-1', {
    operationId: partialPlan.operationId,
    foreground: { status: 'succeeded', message: 'ok' },
    background: { status: 'failed', message: 'busy' }
  })
  assert.equal(partialResult.status, 'partial')
  assert.equal(partial.read().timeline.participants.background.requiresNewSessionOnRewind, true)

  const foregroundOnly = harness({
    chat: {
      id: 'chat-1', mode: 'story', sessionId: 'foreground-1',
      timeline: { branchId: 'branch-1', revision: 1, participants: {} }
    }
  })
  const plan = await foregroundOnly.coordinator.prepare('foreground-1')
  assert.equal(plan.backgroundSessionId, '')
  const result = await foregroundOnly.coordinator.complete('foreground-1', {
    operationId: plan.operationId,
    foreground: { status: 'succeeded', message: 'ok' },
    background: { status: 'skipped', message: '没有后台 Session' }
  })
  assert.equal(result.status, 'completed')
})
