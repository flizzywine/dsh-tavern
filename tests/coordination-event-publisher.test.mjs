import assert from 'node:assert/strict'
import test from 'node:test'

import { createCoordinationEventPublisher } from '../tavern-plugin/lib/domain/coordination-event-publisher.js'

function intervals() {
  const active = []
  return {
    start(run, delay) {
      const timer = { run, delay, stopped: false }
      active.push(timer)
      return timer
    },
    stop(timer) { timer.stopped = true },
    async tick() {
      const timer = active.find((item) => !item.stopped)
      assert.ok(timer, 'expected an active server poller')
      timer.run()
      await new Promise((resolve) => setImmediate(resolve))
      return timer.delay
    },
    count() { return active.filter((item) => !item.stopped).length },
    delays() { return active.filter((item) => !item.stopped).map((item) => item.delay) }
  }
}

function createPublisher(received, options) {
  return createCoordinationEventPublisher({
    ...options,
    publishSignal(sessionId, signal) { received.push({ sessionId, ...signal }) }
  })
}

test('写入通知立即发布 tavern-state signal，文件检查只作为低频兜底', async function () {
  const clock = intervals()
  let phase = 'running'
  let loads = 0
  const received = []
  const publisher = createPublisher(received, {
    readVersion: async function () { return phase },
    load: async function () {
      loads += 1
      return { mailboxVersion: loads, activity: { busy: phase === 'running', phase, updatedAt: loads }, task: null }
    },
    startInterval: clock.start,
    stopInterval: clock.stop,
    fallbackIntervalMs: 5000
  })
  const close = publisher.watch('session-active')
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(clock.delays(), [5000])
  phase = 'idle'
  await publisher.publish('session-active')

  assert.equal(loads, 2)
  assert.equal(received.at(-1).kind, 'tavern-state')
  close()
})

test('低频兜底发现 busy 变为 idle 时发布新版本 signal', async function () {
  const clock = intervals()
  const snapshots = [
    { mailboxVersion: 1, activity: { busy: true, phase: 'running', updatedAt: 10 }, task: { taskId: 'task-1', status: 'running', version: 1 } },
    { mailboxVersion: 2, activity: { busy: false, phase: 'idle', updatedAt: 20 }, task: { taskId: 'task-1', status: 'succeeded', version: 2, result: { candidates: { choices: ['完成'] } } } }
  ]
  const received = []
  const publisher = createPublisher(received, {
    load: async function () { return snapshots.shift() || snapshots.at(-1) },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const close = publisher.watch('session-1')

  await new Promise((resolve) => setImmediate(resolve))
  await clock.tick()

  assert.equal(received.length, 2)
  assert.equal(received[0].kind, 'tavern-state')
  assert.equal(received[1].kind, 'tavern-state')
  assert.equal(clock.count(), 1)
  close()
  assert.equal(clock.count(), 0)
})

test('文件内容未变化时不重复通知，单次读取失败不会终止后续同步', async function () {
  const clock = intervals()
  let call = 0
  const idle = { mailboxVersion: 3, activity: { busy: false, phase: 'idle', updatedAt: 30 }, task: null }
  const received = []
  const publisher = createPublisher(received, {
    async load() {
      call += 1
      if (call === 2) throw new Error('temporary read failure')
      return idle
    },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const close = publisher.watch('session-2')

  await new Promise((resolve) => setImmediate(resolve))
  await clock.tick()
  await clock.tick()

  assert.equal(received.length, 1)
  assert.equal(received[0].kind, 'tavern-state')
  close()
})

test('服务器只轮询小版本文件，版本不变时不重读完整对话', async function () {
  const clock = intervals()
  let version = 'v1'
  let fullLoads = 0
  const received = []
  const publisher = createPublisher(received, {
    readVersion: async function () { return version },
    load: async function () {
      fullLoads += 1
      return { mailboxVersion: fullLoads, activity: { busy: fullLoads === 1, phase: fullLoads === 1 ? 'running' : 'idle', updatedAt: fullLoads } }
    },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const close = publisher.watch('session-small-file')

  await new Promise((resolve) => setImmediate(resolve))
  await clock.tick()
  assert.equal(fullLoads, 1)
  assert.equal(received.length, 1)

  version = 'v2'
  await clock.tick()
  assert.equal(fullLoads, 2)
  assert.equal(received.at(-1).kind, 'tavern-state')
  close()
})

test('人物卡展示投影修订变化时，即使后台状态不变也发布新快照', async function () {
  const clock = intervals()
  let version = 'cards-v1'
  let projectionRevision = 1
  const received = []
  const publisher = createPublisher(received, {
    readVersion: async function () { return version },
    load: async function () {
      return { projectionRevision, mailboxVersion: 0, activity: { busy: false, phase: 'idle', updatedAt: 10 }, task: null }
    },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const close = publisher.watch('session-projection')

  await new Promise((resolve) => setImmediate(resolve))
  version = 'cards-v2'
  projectionRevision = 2
  await clock.tick()

  assert.equal(received.length, 2)
  close()
})
