import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuSettlementReconciler } from '../tavern-plugin/lib/domain/mvu-settlement-reconciler.js'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('启动扫描会接续已持久化且运行时就绪的 MVU 结算', async () => {
  const resumed = []
  const reconciler = createMvuSettlementReconciler({
    list: async () => [{ sessionId: 'session-1' }],
    resolve: async sessionId => ({ id: 'chat-1', sessionId, pending: true }),
    shouldResume: chat => chat.pending,
    isReady: () => true,
    resume: async chatId => { resumed.push(chatId) }
  })

  await reconciler.scan()

  assert.deepEqual(resumed, ['chat-1'])
  reconciler.dispose()
})

test('瞬时读取失败会自行退避重试，不依赖新的浏览器就绪事件', async () => {
  const scheduled = []
  let reads = 0
  const reconciler = createMvuSettlementReconciler({
    list: async () => [],
    resolve: async sessionId => {
      reads++
      if (reads === 1) throw new Error('temporary read failure')
      return { id: 'chat-1', sessionId, pending: true }
    },
    shouldResume: chat => chat.pending,
    isReady: () => true,
    resume: async () => {},
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancel: () => {},
    retryDelayMs: 25,
    onError: () => {}
  })

  assert.equal(await reconciler.wake('session-1'), false)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 25)
  await scheduled[0].callback()
  assert.equal(reads, 2)
  reconciler.dispose()
})

test('重复唤醒合并为一次结算接续', async () => {
  const gate = deferred()
  let resumes = 0
  const reconciler = createMvuSettlementReconciler({
    list: async () => [],
    resolve: async sessionId => ({ id: 'chat-1', sessionId, pending: true }),
    shouldResume: chat => chat.pending,
    isReady: () => true,
    resume: async () => { resumes++; await gate.promise }
  })

  const first = reconciler.wake('session-1')
  const second = reconciler.wake('session-1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resumes, 1)
  gate.resolve()
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  reconciler.dispose()
})

test('未就绪时只保留持久事实，后续就绪唤醒再接续', async () => {
  let ready = false
  let resumes = 0
  const reconciler = createMvuSettlementReconciler({
    list: async () => [{ sessionId: 'session-1' }],
    resolve: async sessionId => ({ id: 'chat-1', sessionId, pending: true }),
    shouldResume: chat => chat.pending,
    isReady: () => ready,
    resume: async () => { resumes++ }
  })

  await reconciler.scan()
  assert.equal(resumes, 0)
  ready = true
  await reconciler.wake('session-1')
  assert.equal(resumes, 1)
  reconciler.dispose()
})
