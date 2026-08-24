import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createLiveTavernViewModule
}

function fakeTimers() {
  const pending = []
  return {
    schedule(run, delay) {
      const timer = { run, delay, cancelled: false }
      pending.push(timer)
      return timer
    },
    cancel(timer) { timer.cancelled = true },
    async runNext() {
      const timer = pending.find(function (item) { return !item.cancelled })
      assert.ok(timer, 'expected a scheduled refresh')
      timer.cancelled = true
      timer.run()
      await new Promise(function (resolve) { setImmediate(resolve) })
      return timer.delay
    },
    activeDelays() { return pending.filter(function (item) { return !item.cancelled }).map(function (item) { return item.delay }) }
  }
}

const createLiveTavernViewModule = await loadFactory()

test('多个调用者通过同一 interface 订阅时只发出一次加载', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { settleStatus: 'idle', marker: loads } } },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const left = []
  const right = []
  const stopLeft = module.subscribe('session-1', function (state) { left.push(state) })
  const stopRight = module.subscribe('session-1', function (state) { right.push(state) })

  await timers.runNext()

  assert.equal(loads, 1)
  assert.equal(module.getSnapshot('session-1').phase, 'ready')
  assert.equal(module.getSnapshot('session-1').view.marker, 1)
  assert.equal(left.at(-1).view.marker, 1)
  assert.equal(right.at(-1).view.marker, 1)
  stopLeft(); stopRight()
})

test('后台结算运行时由 module 统一快速轮询，完成后停止', async function () {
  const timers = fakeTimers()
  const statuses = ['running', 'idle']
  const module = createLiveTavernViewModule({
    load: async function () { return { view: { settleStatus: statuses.shift() || 'idle' } } },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-2', function () {})

  await timers.runNext()
  assert.deepEqual(timers.activeDelays(), [200])
  await timers.runNext()
  assert.equal(module.getSnapshot('session-2').view.settleStatus, 'idle')
  assert.deepEqual(timers.activeDelays(), [])
  stop()
})

test('失效通知在加载中到达时只排队一次后续刷新', async function () {
  const timers = fakeTimers()
  let resolveLoad
  let loads = 0
  const module = createLiveTavernViewModule({
    load: function () {
      loads += 1
      if (loads === 1) return new Promise(function (resolve) { resolveLoad = resolve })
      return Promise.resolve({ view: { settleStatus: 'idle', marker: loads } })
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-3', function () {})
  const first = timers.runNext()
  module.invalidate('session-3')
  module.invalidate('session-3')
  resolveLoad({ view: { settleStatus: 'idle', marker: 1 } })
  await first

  assert.deepEqual(timers.activeDelays(), [0])
  await timers.runNext()
  assert.equal(loads, 2)
  assert.equal(module.getSnapshot('session-3').view.marker, 2)
  stop()
})

test('结算轮询请求悬挂时按时取消，并继续轮询直到完成', async function () {
  const timers = fakeTimers()
  let loads = 0
  let aborted = false
  const module = createLiveTavernViewModule({
    loadTimeoutMs: 2000,
    load: async function (_sessionId, request) {
      loads += 1
      if (loads === 1) return { view: { settleStatus: 'running' } }
      if (loads === 2) {
        return await new Promise(function (_resolve, reject) {
          request.signal.addEventListener('abort', function () {
            aborted = true
            reject(new Error('aborted'))
          })
        })
      }
      return { view: { settleStatus: 'done' } }
    },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-stalled', function () {})

  await timers.runNext()
  assert.deepEqual(timers.activeDelays(), [200])
  await timers.runNext()
  assert.deepEqual(timers.activeDelays(), [2000])
  await timers.runNext()
  assert.equal(aborted, true)
  assert.deepEqual(timers.activeDelays(), [300])
  await timers.runNext()

  assert.equal(loads, 3)
  assert.equal(module.getSnapshot('session-stalled').view.settleStatus, 'done')
  assert.deepEqual(timers.activeDelays(), [])
  stop()
})
