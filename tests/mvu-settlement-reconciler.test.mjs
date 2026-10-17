import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementReconciler } from '../tavern-plugin/lib/domain/mvu-settlement-reconciler.js'

test('任务已持久化但全部就绪通知丢失时仍自动接续', async () => {
  const scheduled = []
  let ready = false, pending = true, resumed = 0
  const reconciler = createMvuSettlementReconciler({ list: async () => [], resolve: async () => ({ id: 'c', pending }),
    shouldResume: chat => chat.pending, isReady: () => ready,
    resume: async () => { resumed++; pending = false },
    schedule: fn => { scheduled.push(fn); return scheduled.length }, cancel() {} })
  await reconciler.wake('s')
  assert.equal(scheduled.length, 1)
  ready = true
  await scheduled.shift()()
  assert.equal(resumed, 1)
  reconciler.dispose()
})
