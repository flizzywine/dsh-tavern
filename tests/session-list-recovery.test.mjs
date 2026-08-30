import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = loadClient()

test('Session 列表首次刷新被中止后重试并打开原 Session', async function () {
  const sessionId = 'session-retry'
  const summaries = {}
  const bindings = new Set()
  let now = 0
  let refreshCalls = 0
  let openCalls = 0
  const recovery = client.createSessionListRecoveryModule({
    summary: function (id) { return summaries[id] },
    binding: function (id) { return bindings.has(id) },
    refresh: async function () {
      refreshCalls += 1
      if (refreshCalls === 1) {
        const error = new Error('request aborted')
        error.name = 'AbortError'
        throw error
      }
      summaries[sessionId] = { id: sessionId }
      bindings.add(sessionId)
    },
    open: function (id) {
      openCalls += 1
      if (!summaries[id] || !bindings.has(id)) throw new Error('sessions.select: unknown session')
    },
    now: function () { return now },
    sleep: async function (ms) { now += ms },
    timeoutMs: 1000,
    retryDelays: [0, 10, 20]
  })

  await recovery.open(sessionId)

  assert.equal(refreshCalls, 2)
  assert.equal(openCalls, 2)
  assert.equal(recovery.ready(sessionId), true)
})

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
