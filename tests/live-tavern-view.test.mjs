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
    load: async function () { loads += 1; return { view: { busy: false, marker: loads } } },
    shouldPoll(view) { return view && view.busy === true },
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

test('后台 Activity busy 时由 module 统一快速轮询，完成后停止', async function () {
  const timers = fakeTimers()
  const statuses = [true, false]
  const module = createLiveTavernViewModule({
    load: async function () { return { view: { busy: statuses.shift() || false } } },
    shouldPoll(view) { return view && view.busy === true },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-2', function () {})

  await timers.runNext()
  assert.deepEqual(timers.activeDelays(), [200])
  await timers.runNext()
  assert.equal(module.getSnapshot('session-2').view.busy, false)
  assert.deepEqual(timers.activeDelays(), [])
  stop()
})

test('客户端先投影 busy 时立即开始权威轮询，服务端 idle 后解除门控', async function () {
  const timers = fakeTimers()
  const module = createLiveTavernViewModule({
    load: async function () { return { view: { busy: false, phase: 'idle' } } },
    shouldPoll(view) { return view && view.busy === true },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-optimistic', function () {})
  await timers.runNext()

  module.setView('session-optimistic', { busy: true, phase: 'running' })
  assert.deepEqual(timers.activeDelays(), [0])
  await timers.runNext()

  assert.equal(module.getSnapshot('session-optimistic').view.busy, false)
  assert.equal(module.getSnapshot('session-optimistic').view.phase, 'idle')
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
      return Promise.resolve({ view: { busy: false, marker: loads } })
    },
    shouldPoll(view) { return view && view.busy === true },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-3', function () {})
  const first = timers.runNext()
  module.invalidate('session-3')
  module.invalidate('session-3')
  resolveLoad({ view: { busy: false, marker: 1 } })
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
      if (loads === 1) return { view: { busy: true } }
      if (loads === 2) {
        return await new Promise(function (_resolve, reject) {
          request.signal.addEventListener('abort', function () {
            aborted = true
            reject(new Error('aborted'))
          })
        })
      }
      return { view: { busy: false } }
    },
    shouldPoll(view) { return view && view.busy === true },
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
  assert.equal(module.getSnapshot('session-stalled').error, '')
  assert.deepEqual(timers.activeDelays(), [300])
  await timers.runNext()

  assert.equal(loads, 3)
  assert.equal(module.getSnapshot('session-stalled').view.busy, false)
  assert.deepEqual(timers.activeDelays(), [])
  stop()
})

test('候选 Agent 长时间生成时状态查询只在内部重试，不产生超时错误', async function () {
  const timers = fakeTimers()
  let generating = false
  let loads = 0
  const module = createLiveTavernViewModule({
    loadTimeoutMs: 2000,
    load: async function (_sessionId, request) {
      loads += 1
      if (!generating) return { view: { busy: false } }
      return await new Promise(function (_resolve, reject) {
        request.signal.addEventListener('abort', function () { reject(new Error('aborted')) })
      })
    },
    shouldPoll(view) { return view && view.busy === true },
    schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('session-generating', function () {})

  await timers.runNext()
  generating = true
  module.invalidate('session-generating')
  await timers.runNext()

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await timers.runNext()
    assert.equal(module.getSnapshot('session-generating').phase, 'retrying')
    assert.equal(module.getSnapshot('session-generating').error, '')
    assert.deepEqual(timers.activeDelays(), [1500])
    if (cycle < 2) await timers.runNext()
  }

  generating = false
  await timers.runNext()
  assert.equal(loads, 5)
  assert.equal(module.getSnapshot('session-generating').phase, 'ready')
  assert.equal(module.getSnapshot('session-generating').view.busy, false)
  assert.equal(module.getSnapshot('session-generating').error, '')
  stop()
})
