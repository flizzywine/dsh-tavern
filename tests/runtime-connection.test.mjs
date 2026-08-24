import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createRuntimeConnectionCoordinator
}

const createRuntimeConnectionCoordinator = await loadFactory()
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
    async probe() { return { runtimeGeneration: 'runtime-a', liveSession: false } },
    async warm(sessionId) { warmed.push(sessionId) },
    reload(input) { reloaded.push(input) }
  })

  const result = await coordinator.reconcile({ sessionId: 'session-1', submitting: false, accepted: false, draft: '' })
  assert.deepEqual(plain(result), { phase: 'checking', retryImmediately: true })
  assert.deepEqual(warmed, ['session-1'])
  assert.deepEqual(reloaded, [])
})

test('服务代次变化时由 coordinator 原子保存草稿并请求重载', async function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:runtime-generation:v1', 'runtime-a')
  const reloaded = []
  const coordinator = createRuntimeConnectionCoordinator({
    storage: sessionStorage,
    async probe() { return { runtimeGeneration: 'runtime-b', liveSession: true } },
    async warm() {},
    reload(input) { reloaded.push(input) }
  })

  const result = await coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: false, draft: '推开房门' })
  assert.deepEqual(plain(result), { phase: 'reloading', retryImmediately: false })
  assert.deepEqual(plain(reloaded), [{ generation: 'runtime-b' }])
  assert.match(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), /推开房门/)
})

test('首次探测就是冷 Session 且正在发送时，也先保护草稿再重载', async function () {
  const sessionStorage = storage()
  const reloaded = []
  const coordinator = createRuntimeConnectionCoordinator({
    storage: sessionStorage,
    async probe() { return { runtimeGeneration: 'runtime-a', liveSession: false } },
    async warm() {},
    reload(input) { reloaded.push(input) }
  })

  const result = await coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: false, draft: '第一次发送' })
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
    async probe() { return { runtimeGeneration: 'runtime-b', liveSession: true } },
    async warm() {},
    reload() {}
  })

  await coordinator.reconcile({ sessionId: 'session-1', submitting: true, accepted: true, draft: '已接收' })
  assert.equal(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), null)
})

test('恢复草稿只消费同一个 Session 的记录，并由 adapter 确认写入成功', function () {
  const sessionStorage = storage()
  sessionStorage.setItem('dsh-tavern:reconnect-draft:v1', JSON.stringify({ sessionId: 'session-1', draft: '保留我' }))
  const coordinator = createRuntimeConnectionCoordinator({ storage: sessionStorage, async probe() {}, async warm() {}, reload() {} })
  let restored = ''

  assert.equal(coordinator.restore('session-2', function () { return true }), false)
  assert.equal(coordinator.restore('session-1', function (draft) { restored = draft; return true }), true)
  assert.equal(restored, '保留我')
  assert.equal(sessionStorage.getItem('dsh-tavern:reconnect-draft:v1'), null)
})
