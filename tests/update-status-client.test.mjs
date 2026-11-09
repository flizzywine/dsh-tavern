import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
const { rpcFetchPriority } = createRequire(import.meta.url)('../tavern-plugin/src/client/rpc-transport.cjs')
import { createUpdateStatusController } from '../tavern-plugin/lib/domain/update-status-controller.js'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function rpcFor(fetch) {
  const start = source.includes('\t\tasync function readTavernJsonResponse(') ? source.indexOf('\t\tasync function readTavernJsonResponse(') : source.indexOf('\t\tfunction rpc(method,')
  const end = source.indexOf('\n\t\tfunction rpcWithTimeout', start)
  return new Function('fetch', 'tavernRuntimeGenerationMonitor', 'rpcFetchPriority', 'window', source.slice(start, end) + ';return rpc')(fetch, { observe() {} }, rpcFetchPriority, {})
}
const ok = () => Response.json({ ok: true, status: { phase: 'update-available' } })
const tick = () => new Promise(resolve => setImmediate(resolve))

function updaterHarness({ call, initial = { phase: 'loading', host: 'cli' }, askConfirm = async () => true, polling = false } = {}) {
  const reports = [], cleared = [], states = [], calls = [], signals = [], timers = new Map(), intervals = new Map(), timeoutDurations = []
  let timerId = 0
  const controller = createUpdateStatusController({ initial, confirm: askConfirm,
    call: (method, args, options) => {
      if (!polling && method === 'getUpdateStatus') return Promise.resolve({})
      calls.push(method); signals.push(options?.signal); return call(method, args, undefined, options)
    },
    errors: { report: (label, error) => reports.push({ label, error }), resolve: label => cleared.push(label) },
    browser: {
      setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id },
      clearInterval(id) { intervals.delete(id) },
      setTimeout(fn, ms) { const id = ++timerId; timeoutDurations.push(ms); timers.set(id, { fn, ms }); return id }, clearTimeout(id) { timers.delete(id) },
      fetch: async () => ({ ok: true }), location: { origin: 'http://localhost', reload() {} }
    }
  })
  controller.subscribe(() => states.push(controller.getSnapshot()))
  controller.start()
  return { checkUpdate: controller.check, performUpdate: controller.perform, cancelUpdate: controller.cancel,
    isUpdateBusy: controller.isBusy, reports, cleared, states, calls, signals, timeoutDurations,
    expire: () => { for (const timer of [...timers.values()]) timer.fn() },
    status: controller.getSnapshot, poll: () => [...intervals.values()].find(item => item.ms === 2500)?.fn(),
    stop: controller.stop, intervals, timers }

}
function pollHarness(fetch) { return updaterHarness({ call: rpcFor(fetch), polling: true }) }
function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('检查和启动允许完整元数据回退，状态与取消仍使用短超时', async () => {
  const available = { phase: 'update-available', host: 'cli' }
  const h = updaterHarness({ initial: available, call: async method => ({ status:
    method === 'startUpdate' ? { phase: 'running', host: 'cli', cancellable: true }
      : method === 'cancelUpdate' ? { phase: 'up-to-date', host: 'cli' } : available }) })
  await tick()
  await h.checkUpdate()
  await h.performUpdate()
  await h.cancelUpdate()
  assert.deepEqual(h.timeoutDurations, [30000, 60000, 60000, 30000])
  h.stop()
})

test('首次状态查询挂起时可直接检查，迟到的状态不覆盖检查结果', async () => {
  const initialRead = deferred()
  const available = { phase: 'update-available', host: 'cli', latestCommit: 'b'.repeat(40) }
  const h = updaterHarness({ polling: true, call: async method => {
    if (method === 'getUpdateStatus') return initialRead.promise
    assert.equal(method, 'checkUpdate')
    return { status: available }
  } })
  assert.equal(h.isUpdateBusy(h.status()), false)
  await h.checkUpdate()
  assert.equal(h.status().phase, 'update-available')
  assert.deepEqual(h.calls, ['getUpdateStatus', 'checkUpdate'])
  initialRead.resolve({ status: { phase: 'idle', host: 'cli' } })
  await tick()
  assert.equal(h.status().phase, 'update-available')
  h.stop()
})

test('网络中断可恢复，认证和业务错误立即提示', async () => {
  let calls = 0
  const network = pollHarness(async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return ok() })
  await tick()
  assert.equal(network.reports.length, 0)
  await network.poll()
  assert.equal(network.states.at(-1).phase, 'update-available')
  network.stop()
  // A 401 right after a restart is waited out first (rpc fetchThroughRestart, session-rpc-freshness); a 403 still surfaces at once.
  for (const response of [() => new Response('', { status: 403 }), () => Response.json({ ok: false, error: '状态文件损坏' })]) {
    const h = pollHarness(async () => response())
    await tick()
    assert.equal(h.reports.length, 1)
    h.stop()
  }
})

for (const phase of ['running', 'cancelling', 'blocked']) {
  test(`${phase} 禁止检查和启动，取消必须由后台声明可用`, async () => {
    const h = updaterHarness({ initial: { phase, cancellable: false }, call: async () => assert.fail('must not call API') })
    await Promise.all([h.checkUpdate(), h.performUpdate(), h.cancelUpdate()])
    assert.deepEqual(h.calls, [])
    assert.equal(h.isUpdateBusy(h.status()), true)
  })
}

for (const [action, initial, busyPhase] of [
  ['performUpdate', { phase: 'update-available' }, 'running'],
  ['cancelUpdate', { phase: 'running', cancellable: true }, 'cancelling'],
]) {
  test(`${action} 响应丢失时保持忙碌，由只读状态轮询恢复`, async () => {
    const h = updaterHarness({ initial, polling: true, call: async method => {
      if (method === 'getUpdateStatus') return { status: { phase: 'repair-required' } }
      throw new TypeError('Failed to fetch')
    } })
    await h[action]()
    assert.equal(h.status().phase, busyPhase)
    assert.match(h.status().error, /尚未确认/)
    await Promise.all([h.checkUpdate(), h.performUpdate(), h.cancelUpdate()])
    assert.equal(h.calls.filter(method => method !== 'getUpdateStatus').length, 1)
    await h.poll()
    assert.equal(h.status().phase, 'repair-required')
    h.stop()
  })
}

for (const [action, initial, busyPhase] of [
  ['performUpdate', { phase: 'update-available' }, 'running'],
  ['cancelUpdate', { phase: 'running', cancellable: true }, 'cancelling'],
]) {
  test(`${action} 请求挂起会解除等待，迟到响应不覆盖新状态`, async () => {
    const mutation = deferred()
    const h = updaterHarness({ initial, polling: true, call: async method => {
      if (method === 'getUpdateStatus') return { status: { phase: 'repair-required' } }
      return mutation.promise
    } })
    const pending = h[action]()
    await tick()
    h.expire()
    await pending
    assert.equal(h.status().phase, busyPhase)
    assert.equal(h.signals.at(-1).aborted, true)
    await h.poll()
    assert.equal(h.status().phase, 'repair-required')
    mutation.resolve({ status: { phase: 'running', cancellable: true } })
    await tick()
    assert.equal(h.status().phase, 'repair-required')
    assert.equal(h.calls.filter(method => method !== 'getUpdateStatus').length, 1)
    h.stop()
  })
}

for (const initial of [{ phase: 'running', host: 'cli' }, { phase: 'running', host: 'desktop' },
  { phase: 'completed', host: 'desktop', requiresRestart: true }]) test(`${initial.host} ${initial.phase} 恢复探测不重叠，断线恢复只重载一次并在停止时清理`, async () => {
  const intervals = new Map(), probes = [], waiting = deferred()
  let reloads = 0, online = false
  const controller = createUpdateStatusController({ initial,
    call: async () => ({}), confirm: async () => true, errors: { report() {}, resolve() {} },
    browser: { setTimeout, clearTimeout,
      setInterval(fn, ms) { intervals.set(ms, fn); return ms }, clearInterval(id) { intervals.delete(id) },
      location: { origin: 'http://localhost', reload() { reloads++ } },
      async fetch() { probes.push(1); if (!online) throw new TypeError('offline'); return waiting.promise }
    }
  })
  controller.start(); await tick()
  online = true
  const probe = intervals.get(400)()
  await intervals.get(400)()
  assert.equal(probes.length, 2, 'pending recovery probe is not duplicated')
  waiting.resolve({ ok: true }); await probe
  assert.equal(reloads, 1)
  await intervals.get(400)()
  assert.equal(reloads, 1)
  controller.stop()
  assert.equal(intervals.size, 0)
})

test('刷新桌面更新页面后仍提示已安装待重启，不能重复启动更新', async () => {
  const completed = { phase: 'completed', host: 'desktop', requiresRestart: true, completedAt: 100 }
  const h = updaterHarness({ polling: true, call: async method => {
    assert.equal(method, 'getUpdateStatus')
    return { status: completed }
  } })
  await tick()
  assert.deepEqual(h.status(), completed)
  await h.checkUpdate()
  h.stop()
})

test('桌面更新断线后提供手动恢复提示，不能将断线当作安装完成', async () => {
  let offline = true
  const h = updaterHarness({ initial: { phase: 'running', host: 'desktop' }, polling: true,
    call: async () => { if (offline) throw new TypeError('Failed to fetch'); return { status: { phase: 'failed', host: 'desktop', error: '依赖安装失败' } } } })
  await tick()
  await h.poll(); await h.poll()
  assert.equal(h.status().phase, 'running')
  assert.equal(h.status().connectionLost, true)
  assert.match(h.status().error, /尚未确认.*安装完成后.*手动重启/)
  offline = false
  await h.poll()
  assert.equal(h.status().phase, 'failed')
  assert.equal(h.status().connectionLost, undefined)
  assert.equal(h.status().error, '依赖安装失败')
  h.stop()
})

test('Android standalone 重启后的完成记录不再占用侧栏，可直接检查更新', async () => {
  // 服务重启后读侧把 requiresRestart 视为已过期；这一页不是发起更新的那一页，
  // 于是完成态折算为 idle，侧栏不再挂着「请重启 DSHA」。
  const h = updaterHarness({ polling: true, call: async () => ({ status: { phase: 'completed', host: 'android', requiresRestart: false, completedAt: 100 } }) })
  await tick()
  assert.equal(h.status().phase, 'idle')
  assert.equal(h.status().host, 'android')
  h.stop()
})
