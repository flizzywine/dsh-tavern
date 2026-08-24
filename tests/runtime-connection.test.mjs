import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadFactory()
const createRuntimeConnectionCoordinator = client.createRuntimeConnectionCoordinator
const createRuntimeVersionGuard = client.createRuntimeVersionGuard
function plain(value) { return JSON.parse(JSON.stringify(value)) }

function storage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) || null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

test('首次发现冷 Session 时记录服务代次并预热，不重载页面', async function () {
  const warmed = []
  const reloaded = []
  const coordinator = createRuntimeConnectionCoordinator({
    storage: storage(),
    async warm(sessionId) { warmed.push(sessionId) },
    reload(input) { reloaded.push(input) }
  })

  const result = coordinator.reconcile({ sessionId: 'session-1', submitting: false, accepted: false, draft: '', snapshot: { runtimeGeneration: 'runtime-a', liveSession: false } })
  assert.deepEqual(plain(result), { phase: 'recovering' })
  assert.deepEqual(warmed, ['session-1'])
  assert.deepEqual(reloaded, [])
})

test('Session 预热永久挂起时不阻塞后续权威连接探测', async function () {
  let warmCalls = 0
  const coordinator = createRuntimeConnectionCoordinator({
    storage: storage(),
    async warm() {
      warmCalls += 1
      return await new Promise(function () {})
    },
    reload() {}
  })

  const first = coordinator.reconcile({ sessionId: 'session-1', submitting: false, accepted: false, draft: '', snapshot: { runtimeGeneration: 'runtime-a', liveSession: false } })
  const second = coordinator.reconcile({ sessionId: 'session-1', submitting: false, accepted: false, draft: '', snapshot: { runtimeGeneration: 'runtime-a', liveSession: true } })

  assert.deepEqual(plain(first), { phase: 'recovering' })
  assert.deepEqual(plain(second), { phase: 'ready' })
  assert.equal(warmCalls, 1)
})

test('服务代次变化时由 coordinator 原子保存草稿并请求重载', async function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:runtime-generation:v1', 'runtime-a')
  const reloaded = []
  const coordinator = createRuntimeConnectionCoordinator({
    storage: sessionStorage,
    async warm() {},
    reload(input) { reloaded.push(input) }
  })

  const result = coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: false, draft: '推开房门', snapshot: { runtimeGeneration: 'runtime-b', liveSession: true } })
  assert.deepEqual(plain(result), { phase: 'reloading' })
  assert.deepEqual(plain(reloaded), [{ generation: 'runtime-b' }])
  assert.match(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), /推开房门/)
})

test('Activity 链发现服务代次变化时独立保存草稿并请求带版本重载', function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:runtime-generation:v1', 'runtime-a')
  const reloaded = []
  const guard = createRuntimeVersionGuard({
    storage: sessionStorage,
    reload(input) { reloaded.push(input) }
  })

  assert.equal(guard.observe({ sessionId: 'session-1', generation: 'runtime-b', draft: '继续调查' }), true)
  assert.deepEqual(plain(reloaded), [{ generation: 'runtime-b' }])
  assert.match(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), /继续调查/)
  assert.equal(guard.observe({ sessionId: 'session-1', generation: 'runtime-b', draft: '不会重复重载' }), false)
})

test('首次探测就是冷 Session 且正在发送时，也先保护草稿再重载', async function () {
  const sessionStorage = storage()
  const reloaded = []
  const coordinator = createRuntimeConnectionCoordinator({
    storage: sessionStorage,
    async warm() {},
    reload(input) { reloaded.push(input) }
  })

  const result = coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: false, draft: '第一次发送', snapshot: { runtimeGeneration: 'runtime-a', liveSession: false } })
  assert.equal(result.phase, 'reloading')
  assert.deepEqual(plain(reloaded), [{ generation: 'runtime-a' }])
  assert.match(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), /第一次发送/)
})

test('服务已权威接收本轮时不恢复草稿，避免诱导用户重复发送', async function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:runtime-generation:v1', 'runtime-a')
  sessionStorage.setItem('dsh-tavern:reconnect-draft:v1', 'stale')
  const coordinator = createRuntimeConnectionCoordinator({
    storage: sessionStorage,
    async warm() {},
    reload() {}
  })

  coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: true, draft: '已接收', snapshot: { runtimeGeneration: 'runtime-b', liveSession: true } })
  assert.equal(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), null)
})

test('恢复草稿只消费同一个 Session 的记录，并由 adapter 确认写入成功', function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:reconnect-draft:v1', JSON.stringify({ sessionId: 'session-1', draft: '保留我' }))
  const coordinator = createRuntimeConnectionCoordinator({ storage: sessionStorage, async warm() {}, reload() {} })
  let restored = ''

  assert.equal(coordinator.restore('session-2', function () { return true }), false)
  assert.equal(coordinator.restore('session-1', function (draft) { restored = draft; return true }), true)
  assert.equal(restored, '保留我')
  assert.equal(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), null)
})

test('协调快照尚未返回时保持 checking，但不声称 Session 已失联', function () {
  const coordinator = createRuntimeConnectionCoordinator({ storage: storage(), async warm() {}, reload() {} })

  const result = coordinator.reconcile({ sessionId: 'session-1', submitting: false, accepted: false, draft: '', snapshot: null })

  assert.deepEqual(plain(result), { phase: 'checking' })
})
