import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createCardLibraryRefreshModule
}

function deferred() {
  let resolve
  const promise = new Promise(function (done) { resolve = done })
  return { promise, resolve }
}

test('focus 与 visibilitychange 合并为一次激活刷新', async function () {
  const createRefresh = await loadFactory()
  const timers = []
  const refresh = createRefresh({
    schedule(run, delay) { const timer = { run, delay, cancelled: false }; timers.push(timer); return timer },
    cancel(timer) { timer.cancelled = true },
    activationDelayMs: 100
  })
  let loads = 0

  refresh.activate(function () { loads += 1 })
  refresh.activate(function () { loads += 1 })

  const active = timers.filter(function (timer) { return !timer.cancelled })
  assert.equal(active.length, 1)
  assert.equal(active[0].delay, 100)
  active[0].run()
  assert.equal(loads, 1)
})

test('同一人物卡的并发读取共用一个请求', async function () {
  const createRefresh = await loadFactory()
  const refresh = createRefresh()
  const pending = deferred()
  let loads = 0
  const load = function () { loads += 1; return pending.promise }

  const first = refresh.load('cards/a.json', load)
  const second = refresh.load('cards/a.json', load)

  assert.equal(loads, 1)
  assert.equal(first, second)
  pending.resolve('done')
  assert.equal(await first, 'done')
})
