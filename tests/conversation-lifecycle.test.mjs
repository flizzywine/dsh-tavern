import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

async function loadExports() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadExports()
const createConversationLifecycleModule = client.createConversationLifecycleModule

const createPlayWorkspaceResolver = client.createPlayWorkspaceResolver

function harness(overrides = {}) {
  const calls = []
  const adapters = {
    archiveCurrent: async function () { calls.push('archive') },
    resolveWorkspace: async function (request) { calls.push('resolve:' + request.kind); return 'workspace-1' },
    connectWorkspace: async function (workspaceId) { calls.push('connect:' + workspaceId); return 'session-1' },
    waitForSession: async function (sessionId) { calls.push('wait:' + sessionId) },
    ensurePreset: async function (sessionId) { calls.push('preset:' + sessionId) },
    createChat: async function (request, sessionId) { calls.push('chat:' + request.targetMode + ':' + sessionId) },
    rememberPending: function (pending) { calls.push('remember:' + pending.sessionId) },
    finishOpen: async function (pending) { calls.push('open:' + pending.sessionId) }
  }
  return { calls, module: createConversationLifecycleModule(Object.assign(adapters, overrides)) }
}

test('开场事件已写入后的刷新重试直接恢复 Chat，不重复选择已锁定 preset', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const events = []
  let presetCalls = 0
  let chatCalls = 0
  const request = { kind: 'play', targetMode: 'story', card: { path: 'card' }, openingId: 'primary', userName: '你' }
  const adapters = {
    ensurePreset: async function (sessionId) {
      presetCalls += 1
      events.push('preset:' + sessionId)
      if (presetCalls > 1) throw new Error('agent-preset/locked: This session has already started')
    },
    createChat: async function (_request, sessionId) {
      chatCalls += 1
      events.push('chat:' + sessionId)
      if (chatCalls === 1) throw new Error('开场事件已提交，Chat 标记写入失败')
    }
  }
  const first = harness({ ...adapters, attempts: client.createConversationAttemptStore(storage) })
  const reloaded = harness({ ...adapters, attempts: client.createConversationAttemptStore(storage) })

  await assert.rejects(first.module.start(request), /Chat 标记写入失败/)
  const recovered = await reloaded.module.start(request)

  assert.equal(recovered.sessionId, 'session-1')
  assert.equal(presetCalls, 1)
  assert.equal(chatCalls, 2)
  assert.deepEqual(events, ['preset:session-1', 'chat:session-1', 'chat:session-1'])
})

test('旧版失败记录没有 presetReady 时，模式锁定直接进入 Chat 恢复', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const request = { kind: 'play', targetMode: 'story', card: { path: 'card' }, openingId: 'primary', userName: '你' }
  const key = JSON.stringify([request.kind, request.targetMode, request.card.path, request.openingId, request.userName, request.requestMode, request.task, request.pending])
  const legacy = client.createConversationAttemptStore(storage)
  legacy.set(key, { sessionId: 'session-1', initialized: false })
  const calls = []
  const { module } = harness({
    attempts: client.createConversationAttemptStore(storage),
    ensurePreset: async function () { throw new Error('This session has already started') },
    createChat: async function (_request, sessionId) { calls.push('recover:' + sessionId) }
  })

  const recovered = await module.start(request)

  assert.equal(recovered.sessionId, 'session-1')
  assert.deepEqual(calls, ['recover:session-1'])
  assert.equal(values.size, 0)
})

test('刷新页面后可复用失败 Session，打开失败不重复初始化，成功后下次新建', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const request = { kind: 'play', targetMode: 'story', card: { path: 'card' }, preparationId: 'preview-1' }
  const first = harness({ attempts: client.createConversationAttemptStore(storage), finishOpen: async () => { throw new Error('打开失败') } })
  await assert.rejects(first.module.start(request), /打开失败/)
  assert.equal(values.size, 1)
  const second = harness({ attempts: client.createConversationAttemptStore(storage) })
  await second.module.start({ ...request, preparationId: 'preview-2' })
  assert.equal(second.calls.some(item => item.startsWith('connect:') || item.startsWith('chat:')), false)
  assert.equal(values.size, 0)
  await second.module.start(request)
  assert.equal(second.calls.filter(item => item.startsWith('connect:')).length, 1)
})
