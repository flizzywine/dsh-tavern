import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

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

test('新建对话复用 startChat 首份视图，后续失效刷新才请求服务端', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { source: 'getSession' } } },
    shouldPoll() { return false },
    now: timers.now, schedule: timers.schedule,
    cancel: timers.cancel
  })
  module.seed('new-session', { source: 'startChat' })
  assert.equal(module.getSnapshot('new-session').phase, 'ready', '种子应立即可供首屏订阅读取')
  assert.equal(module.getSnapshot('new-session').view.source, 'startChat')
  const stop = module.subscribe('new-session', function () {})
  await timers.runNext()
  assert.equal(loads, 0)
  assert.equal(module.getSnapshot('new-session').phase, 'ready')
  assert.equal(module.getSnapshot('new-session').view.source, 'startChat')

  module.invalidate('new-session')
  await timers.runNext()
  assert.equal(loads, 1)
  assert.equal(module.getSnapshot('new-session').view.source, 'getSession')
  stop()
})

test('故事读取期间主动订阅等待种子而不抢发 getSession', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { source: 'getSession' } } },
    shouldPoll() { return false }, now: timers.now, schedule: timers.schedule, cancel: timers.cancel
  })
  module.expectSeed('story-session')
  const stop = module.subscribe('story-session', function () {})
  await timers.runNext()
  assert.equal(loads, 0, '首次主动订阅也必须等待即将到达的故事视图')
  module.seed('story-session', { source: 'story', historyWindow: { revision: 3 } })
  await timers.runNext()
  assert.equal(loads, 0)
  assert.equal(module.getSnapshot('story-session').view.source, 'story')
  module.invalidate('story-session')
  await timers.runNext()
  assert.equal(loads, 1, '种子消费后，失效刷新仍走权威读取')
  stop()
})

test('故事读取失败释放种子等待并恢复权威加载', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { source: 'getSession' } } },
    shouldPoll() { return false }, now: timers.now, schedule: timers.schedule, cancel: timers.cancel
  })
  module.expectSeed('story-failed')
  const stop = module.subscribe('story-failed', function () {})
  await timers.runNext()
  assert.equal(loads, 0)
  module.cancelSeed('story-failed')
  await timers.runNext()
  assert.equal(loads, 1)
  assert.equal(module.getSnapshot('story-failed').view.source, 'getSession')
  stop()
})

test('较旧的故事种子不能覆盖已发布的新 revision', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { historyWindow: { revision: 10 } } } },
    shouldPoll() { return false }, now: timers.now, schedule: timers.schedule, cancel: timers.cancel
  })
  module.seed('session-revision', { historyWindow: { revision: 9 }, marker: 'new' })
  module.seed('session-revision', { historyWindow: { revision: 8 }, marker: 'stale' })
  assert.equal(module.getSnapshot('session-revision').view.marker, 'new')
  const stop = module.subscribe('session-revision', function () {})
  await timers.runNext()
  assert.equal(loads, 0)
  assert.equal(module.getSnapshot('session-revision').view.historyWindow.revision, 9)
  module.invalidate('session-revision')
  await timers.runNext()
  assert.equal(loads, 1)
  assert.equal(module.getSnapshot('session-revision').view.historyWindow.revision, 10)
  stop()
})

test('插件被动订阅不读取不可见会话，首个真实读者接管加载', async function () {
  const timers = fakeTimers()
  let loads = 0
  const module = createLiveTavernViewModule({
    load: async function () { loads += 1; return { view: { activity: { busy: false } } } },
    shouldPoll() { return false }, pollWhileBusy: false,
    now: timers.now, schedule: timers.schedule, cancel: timers.cancel
  })
  const states = []
  const stopPassive = module.subscribe('background-session', function (state) { states.push(state); }, [['activity']], { deferLoad: true })
  module.invalidate('background-session')
  assert.equal(loads, 0)
  assert.deepEqual(timers.activeDelays(), [])

  const stopVisible = module.subscribe('background-session', function () {}, [['activity']])
  await timers.runNext()
  assert.equal(loads, 1)
  assert.equal(states.at(-1).view.activity.busy, false)

  stopVisible()
  module.invalidate('background-session')
  assert.equal(loads, 1)
  assert.deepEqual(timers.activeDelays(), [])
  stopPassive()
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
