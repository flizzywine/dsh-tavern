import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadExports() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadExports()
const createConversationLifecycleModule = client.createConversationLifecycleModule
const createConversationPrewarmModule = client.createConversationPrewarmModule

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

test('游玩对话通过一个 interface 严格完成创建生命周期', async function () {
  const { calls, module } = harness()
  const result = await module.start({ kind: 'play', targetMode: 'free', card: { path: 'cards/a.json' } })

  assert.deepEqual(calls, [
    'archive', 'resolve:play', 'connect:workspace-1', 'wait:session-1',
    'preset:session-1', 'chat:free:session-1', 'remember:session-1', 'open:session-1'
  ])
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.pending.targetMode, 'free')
})

test('卡片工作台保留任务元数据直到打开完成', async function () {
  let opened
  const { module } = harness({ finishOpen: async function (pending) { opened = pending } })
  const pending = { task: 'extract', label: '从剧本新建人物卡', selectedResources: [{ path: 'a.md' }] }

  await module.start({ kind: 'card', targetMode: 'card', pending })

  assert.equal(opened.sessionId, 'session-1')
  assert.equal(opened.targetMode, 'card')
  assert.equal(opened.task, 'extract')
  assert.equal(opened.label, '从剧本新建人物卡')
  assert.equal(opened.selectedResources.length, 1)
})

test('已预热的游玩 Session 跳过点击后的 Workspace 解析和 Agent 创建', async function () {
  const { calls, module } = harness()

  const result = await module.start({
    kind: 'play', targetMode: 'story', card: { path: 'cards/a.json' }, preparedSessionId: 'session-warm'
  })

  assert.deepEqual(calls, [
    'archive', 'wait:session-warm', 'preset:session-warm',
    'chat:story:session-warm', 'remember:session-warm', 'open:session-warm'
  ])
  assert.equal(result.sessionId, 'session-warm')
})

test('创建失败会标记准确阶段并停止后续副作用', async function () {
  const { calls, module } = harness({
    ensurePreset: async function () { calls.push('preset:failed'); throw new Error('preset unavailable') }
  })

  await assert.rejects(module.start({ kind: 'play', targetMode: 'free' }), function (error) {
    assert.equal(error.phase, '切换到酒馆模式')
    assert.match(error.message, /preset unavailable/)
    return true
  })
  assert.deepEqual(calls, [
    'archive', 'resolve:play', 'connect:workspace-1', 'wait:session-1', 'preset:failed'
  ])
})

function prewarmHarness(overrides = {}) {
  const calls = []
  const reports = []
  const adapters = {
    sessionIds: function () { return [] },
    resolveWorkspace: async function () { calls.push('resolve'); return 'workspace-1' },
    connectWorkspace: async function () { calls.push('connect'); return 'session-warm' },
    archiveSession: async function (sessionId) { calls.push('archive:' + sessionId) },
    report: function (event) { reports.push(event) },
    now: function () { return 100 }
  }
  return { calls, reports, module: createConversationPrewarmModule(Object.assign(adapters, overrides)) }
}

test('游戏准备阶段只预热一次，开始游戏直接认领同一个 Session', async function () {
  const { calls, module } = prewarmHarness()

  await module.begin({ key: 'cards/a.json' })
  const sessionId = await module.claim('cards/a.json')

  assert.equal(sessionId, 'session-warm')
  assert.deepEqual(calls, ['resolve', 'connect'])
})

test('关闭游戏准备会清理本次新建但尚未使用的 Session', async function () {
  let release
  const connected = new Promise(function (resolve) { release = resolve })
  const { calls, module } = prewarmHarness({
    connectWorkspace: async function () { calls.push('connect'); return await connected }
  })

  module.begin({ key: 'cards/a.json' })
  module.cancel()
  release('session-created')
  await new Promise(function (resolve) { setImmediate(resolve) })

  assert.deepEqual(calls, ['resolve', 'connect', 'archive:session-created'])
})

test('关闭游戏准备不会归档原本就存在的空白 Session', async function () {
  const { calls, module } = prewarmHarness({
    sessionIds: function () { return ['session-existing'] },
    connectWorkspace: async function () { calls.push('connect'); return 'session-existing' }
  })

  await module.begin({ key: 'cards/a.json' })
  module.cancel()
  await new Promise(function (resolve) { setImmediate(resolve) })

  assert.deepEqual(calls, ['resolve', 'connect'])
})
