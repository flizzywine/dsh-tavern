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

test('打开的游戏随每次轮询做一次自身检查（如人物卡文件被改）；检查失败只报告，停止监听后不再检查', async function () {
  const clock = intervals()
  const ticks = [], errors = []
  const publisher = createPublisher([], {
    async load() { return { mailboxVersion: 1, activity: { busy: false, phase: 'idle', updatedAt: 1 }, task: null } },
    async onTick(sessionId) { ticks.push(sessionId); if (ticks.length === 2) throw new Error('card stat failed') },
    onError(error) { errors.push(error.message) },
    startInterval: clock.start,
    stopInterval: clock.stop
  })
  const stop = publisher.watch('session-a')
  await clock.tick()
  await clock.tick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(ticks, ['session-a', 'session-a'])
  assert.deepEqual(errors, ['card stat failed'])
  stop()
  assert.equal(clock.count(), 0)
})
