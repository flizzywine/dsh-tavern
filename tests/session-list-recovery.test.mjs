import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = loadClient()

test('同一 Session 的并发恢复共用一条刷新链', async function () {
  const sessionId = 'session-shared'
  const summaries = {}
  const bindings = new Set()
  let refreshCalls = 0
  let releaseRefresh
  const refreshGate = new Promise(function (resolve) { releaseRefresh = resolve })
  const recovery = client.createSessionListRecoveryModule({
    summary: function (id) { return summaries[id] },
    binding: function (id) { return bindings.has(id) },
    refresh: async function () {
      refreshCalls += 1
      await refreshGate
      summaries[sessionId] = { id: sessionId }
      bindings.add(sessionId)
    },
    open: function () {},
    sleep: async function () {},
    timeoutMs: 1000
  })

  const first = recovery.wait(sessionId)
  const second = recovery.wait(sessionId)
  await Promise.resolve()
  assert.equal(refreshCalls, 1)

  releaseRefresh()
  await Promise.all([first, second])
  assert.equal(refreshCalls, 1)
})

// 宿主列表始终没有这一行时，超时信息要指出「去删历史记录」而不是「刷新页面」。
test('会话真的不在宿主时，超时信息说明该删除历史记录', async function () {
  const recovery = client.createSessionListRecoveryModule({
    summary: function () { return undefined },
    binding: function () { return undefined },
    refresh: function () { return Promise.resolve() },
    open: function () { throw new Error('sessions.retain: unknown session session-gone') },
    isUnknownSession: function (error) {
      return /sessions\.(select|retain): unknown session/i.test(String(error && error.message || error || ''))
    },
    sleep: function () { return Promise.resolve() },
    timeoutMs: 300
  })
  await assert.rejects(function () { return recovery.wait('session-gone') }, /已不在宿主列表中/)
})
