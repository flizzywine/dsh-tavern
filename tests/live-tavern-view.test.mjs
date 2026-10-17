import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } }, setInterval, clearInterval }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createLiveTavernViewModule
}

function fakeTimers() {
  const pending = []
  let now = 0
  return {
    now: () => now,
    schedule(run, delay) {
      const timer = { run, delay, at: now + delay, cancelled: false }
      pending.push(timer)
      return timer
    },
    cancel(timer) { timer.cancelled = true },
    async runNext() {
      const timer = pending.find(function (item) { return !item.cancelled })
      assert.ok(timer, 'expected a scheduled refresh')
      timer.cancelled = true
      now = timer.at
      timer.run()
      await new Promise(function (resolve) { setImmediate(resolve) })
      return timer.delay
    },
    dropAll() { pending.forEach(function (item) { item.cancelled = true }) },
    activeDelays() { return pending.filter(function (item) { return !item.cancelled }).map(function (item) { return item.delay }) }
  }
}

function fakeIntervals() {
  const active = []
  return {
    start(run, delay) {
      const interval = { run, delay, cancelled: false }
      active.push(interval)
      return interval
    },
    stop(interval) { interval.cancelled = true },
    async tick() {
      const interval = active.find(function (item) { return !item.cancelled })
      assert.ok(interval, 'expected an active watchdog')
      interval.run()
      await new Promise(function (resolve) { setImmediate(resolve) })
      return interval.delay
    }
  }
}

const createLiveTavernViewModule = await loadFactory()

test('后台已空闲但主轮询定时器丢失时，watchdog 会恢复权威查询并解除 busy', async function () {
  const timers = fakeTimers()
  const watchdog = fakeIntervals()
  const statuses = [true, false]
  const module = createLiveTavernViewModule({
    load: async function () { return { view: { busy: statuses.shift() || false } } },
    shouldPoll(view) { return view && view.busy === true },
    now: timers.now, schedule: timers.schedule,
    cancel: timers.cancel,
    startWatchdog: watchdog.start,
    stopWatchdog: watchdog.stop,
    watchdogIntervalMs: 1000
  })
  const stop = module.subscribe('session-watchdog', function () {})

  await timers.runNext()
  assert.equal(module.getSnapshot('session-watchdog').view.busy, true)
  timers.dropAll()

  assert.equal(await watchdog.tick(), 1000)
  assert.equal(module.getSnapshot('session-watchdog').view.busy, false)
  stop()
})

test('人物卡删除后的状态错误进入不可用终态，不再自动重试并重复弹错', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; throw new Error('人物卡不存在: cards/Erin.json') },
    shouldPoll() { return false },
    isTerminalError(error) { return /人物卡不存在:/.test(String(error && error.message || error || '')) },
    now: timers.now, schedule: timers.schedule,
    cancel: timers.cancel
  })
  const stop = module.subscribe('deleted-card-session', function () {})

  await timers.runNext()
  const snapshot = module.getSnapshot('deleted-card-session')
  const delays = timers.activeDelays()
  stop()

  assert.equal(loads, 1)
  assert.equal(snapshot.phase, 'unavailable')
  assert.match(snapshot.error, /人物卡不存在: cards\/Erin\.json/)
  assert.deepEqual(delays, [])
})

test('快照回收保护订阅者；过期请求不能复活旧快照；返回重新加载', async () => {
  const timers = fakeTimers(); let resolve
  const module = createLiveTavernViewModule({ load: () => new Promise(r => { resolve = r }),
    now: timers.now, schedule: timers.schedule, cancel: timers.cancel, pollWhileBusy: false })
  const stop = module.subscribe('A', () => {})
  await timers.runNext()
  assert.equal(module.evict('A'), false)
  stop()
  assert.equal(module.evict('A'), true)
  const fresh = module.getSnapshot('A')
  resolve({ view: { old: true } }); await new Promise(r => setImmediate(r))
  assert.equal(module.getSnapshot('A'), fresh)
  assert.equal(fresh.view, null)
  const stopAgain = module.subscribe('A', () => {})
  await timers.runNext(); resolve({ view: { fresh: true } })
  await new Promise(r => setImmediate(r))
  assert.equal(module.getSnapshot('A').view.fresh, true)
  stopAgain(); module.evict('A')
})
