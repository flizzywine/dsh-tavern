import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadFactory() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createConversationLifecycleModule
}

const createConversationLifecycleModule = await loadFactory()

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
