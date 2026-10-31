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

function host2020() {
  const rows = {
    'session-main': { id: 'session-main', blank: false, retainedBy: Object.freeze(Object.assign(Object.create(null), { mainView: 1 })) },
    'session-blank': { id: 'session-blank', blank: true, retainedBy: Object.freeze(Object.create(null)) },
  }
  const bindings = new Map()
  const retained = []
  const opened = []
  let cleared = 0
  return {
    opened,
    rows,
    retained,
    get cleared() { return cleared },
    sessions: {
      list: {
        getSnapshot() {
          return { phase: 'ready', ids: Object.keys(rows), byId: rows, projectionsBySession: {} }
        },
      },
      binding(id) { return bindings.get(id) },
      scope(id) { return { id } },
      create() { return Promise.resolve({ ok: true, value: { sessionId: 'session-created' } }) },
      fork() { return Promise.resolve({ ok: true, value: { sessionId: 'session-forked' } }) },
      retain(target, options) {
        retained.push([target, options && options.source])
        if (rows[target] === undefined) throw new Error('sessions.retain: unknown session ' + target)
        bindings.set(target, { sessionId: target, session: {} })
        return { sessionId: target, release() { bindings.delete(target) } }
      },
      subagentAddress() { return undefined },
    },
    uiWorkspace: {
      openSession(id) { opened.push(id) },
      clearMain() { cleared += 1 },
    },
  }
}

test('uiWorkspace 缺失时 open() 退化为 retain，未知会话错误冒泡给 recovery 判定', async function () {
  const host = host2020()
  const compat = client.createSessionCompat(host.sessions, null)
  await compat.open('session-blank')
  assert.deepEqual(host.retained, [['session-blank', 'tavern']])
  assert.equal(compat.binding('session-blank').sessionId, 'session-blank')
  // 0.2.0 的 sessions.retain 对未列清单 id 抛错；recovery 的 isUnknownSession 据此走 wait 重试。
  // open() 现在会先尝试刷新基线再打开，所以错误以 rejection 形式出现。
  await assert.rejects(function () { return compat.open('session-ghost') }, /sessions\.retain: unknown session session-ghost/)
  assert.equal(host.retained.length, 2)
})

// 真实故障：点「开始新游戏」→ create() 只写入 placeholder 行，scope 尚未 retain。
// 旧适配器只读 scope，wait() 必然 8 秒超时（session-110820bb-... 即此路径）。
test('sessionListAdapters：新建但未 retain 的会话立即就绪（修复列表同步超时）', async function () {
  const host = host2020()
  // 模拟 create 之后：会话已进列表，但没有 scope。
  host.rows['session-fresh'] = {
    id: 'session-fresh', blank: true, updatedAt: 1,
    retainedBy: Object.freeze(Object.create(null)),
  }
  const compat = client.createSessionCompat(host.sessions, host.uiWorkspace)
  const adapters = client.sessionListAdapters(compat)
  const recovery = client.createSessionListRecoveryModule(adapters)

  assert.ok(adapters.summary('session-fresh'), 'placeholder 行应可读')
  assert.equal(adapters.binding('session-fresh').id, 'session-fresh', '未 retain 时 binding 以列表行兜底')
  assert.equal(recovery.ready('session-fresh'), true)
  await recovery.wait('session-fresh')

  // 真正打开时才 materialize scope，并保留真实 binding 语义。
  await recovery.open('session-fresh')
  assert.deepEqual(host.opened, ['session-fresh'])
  assert.equal(typeof compat.binding('session-fresh'), 'undefined', '未 retain 时真 binding 仍为空')
})

// 真实故障：点旧存档时宿主列表基线尚未返回，replaceMain 的 retain 同步抛
// 「sessions.retain: unknown session」。recovery 的 refresh 是 single-flight，
// 轮询拉不回新基线，8 秒后必然超时。open() 因此先补拉一次基线再打开。
