import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createPluginVariableWriter } from '../tavern-plugin/lib/domain/plugin-variables.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness() {
  let chat = { id: 'chat', sessionId: 'game', mode: 'story', _storageRevision: 1, settleStatus: 'done',
    messages: [{ role: 'user', text: '输入' }, { role: 'assistant', turn: 3, text: 'version-1', variables: [{ hp: 10 }] }] }
  const copy = () => structuredClone(chat)
  const save = value => { chat = { ...structuredClone(value), _storageRevision: chat._storageRevision + 1 }; return copy() }
  const coordinator = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: {
    readChat: async () => copy(), writeChat: async value => save(value), updateChat: async (_id, fn) => save(await fn(copy()))
  } })
  const state = { generating: false, beforeSlice: null, beforePatch: null }
  const material = () => ({ chatId: 'chat', sessionId: 'game', turn: 3, index: 1, key: chat.messages[1].text,
    text: chat.messages[1].text, source: chat.messages[1].text, card: { path: 'cards/a.json', name: 'A' } })
  let writes = 0
  const writer = createPluginVariableWriter({
    readState: async () => copy(),
    readSlice: async () => {
      const hook = state.beforeSlice; state.beforeSlice = null; await hook?.()
      return { chat: { id: chat.id, _storageRevision: chat._storageRevision, messages: [structuredClone(chat.messages[1])] } }
    },
    activity: coordinator.activity, generating: () => state.generating,
    currentKey: async () => material().key,
    patch: async (_id, revision, changes) => {
      const hook = state.beforePatch; state.beforePatch = null; await hook?.()
      if (revision !== chat._storageRevision) return null
      const next = copy(); for (const change of changes) next.messages[change.path[1]][change.path[2]] = structuredClone(change.value)
      writes++; return save(next)
    }
  })
  const api = createTavernPluginApi({
    ctx: { fiber: { name: 'state-plugin' } }, logger: { warn() {} },
    resolveGame: async gameId => gameId === 'game' ? { chatId: 'chat', sessionId: 'game' } : null,
    readTurn: async () => material(), readLatestSettledTurn: async () => material(), readPendingTurn: async () => material(),
    readVariables: async () => structuredClone(chat.messages[1].variables[0]), writeVariables: writer, publish() {}
  })
  const input = variables => ({ gameId: 'game', turn: 3, textVersion: 'version-1', variables })
  const around = async work => {
    const task = await coordinator.begin(copy(), 'plugin-task')
    try { return await work(task.operationId) } finally { await task.commit({ stateChanged: false }) }
  }
  return { api, service: api.service, coordinator, state, material, writer, input, around, copy,
    writes: () => writes, changeText() { const next = copy(); next.messages[1].text = 'version-2'; save(next) } }
}

test('变量快照条件提交：重试返回持久收据，并拒绝冲突及旧正文', async () => {
  const h = harness()
  const target = { gameId: 'game', turn: 3, textVersion: 'version-1' }
  const snapshot = await h.service.getVariableSnapshot(target)
  assert.deepEqual(snapshot.variables, { hp: 10 })
  const request = { ...target, variablesRevision: snapshot.variablesRevision, operationId: 'reward-1', variables: { hp: 8 } }
  const first = await h.service.commitVariables(request)
  assert.equal(first.replayed, false)
  assert.equal((await h.service.commitVariables(request)).replayed, true)
  assert.equal(h.writes(), 1)
  await assert.rejects(h.service.commitVariables({ ...request, variables: { hp: 0 } }), { code: 'TAVERN_PLUGIN_OPERATION_CONFLICT' })
  await assert.rejects(h.service.commitVariables({ ...request, operationId: 'reward-2' }), { code: 'TAVERN_PLUGIN_VARIABLE_CONFLICT' })
  h.changeText()
  await assert.rejects(h.service.commitVariables(request), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
})

test('同一快照的并发变量提交只有一个成功', async () => {
  const h = harness(), target = { gameId: 'game', turn: 3, textVersion: 'version-1' }
  const snapshot = await h.service.getVariableSnapshot(target)
  const attempts = await Promise.allSettled(['a', 'b'].map(operationId => h.service.commitVariables({
    ...target, variablesRevision: snapshot.variablesRevision, operationId, variables: { hp: operationId === 'a' ? 7 : 6 }
  })))
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'TAVERN_PLUGIN_VARIABLE_CONFLICT')
  assert.equal(h.writes(), 1)
})

test('条件提交收据与变量在日志中一起保存并可在重新加载后重试', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-variable-commit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let store = createChatJournalStore({ dataRoot: root })
  await store.update('chat', () => ({ id: 'chat', sessionId: 'game', _storageRevision: 1,
    messages: [{ role: 'assistant', turn: 3, text: 'version-1', variables: [{ hp: 10 }] }] }))
  const material = { sessionId: 'game', turn: 3, index: 0, key: 'version-1' }
  const makeWriter = () => createPluginVariableWriter({
    readState: () => store.read('chat'), readSlice: (_session, indices, fields) => store.readSlice('chat', indices, ['id', ...fields]),
    activity: () => null, generating: () => false, currentKey: () => 'version-1',
    patch: (id, revision, changes, metadata) => store.patch(id, revision,
      [...changes, { op: 'set', path: ['_storageRevision'], value: revision + 1 }], metadata)
  })
  const writer = makeWriter(), snapshot = await writer.snapshot(material)
  const options = { owner: 'fixture', operationId: 'one', variablesRevision: snapshot.variablesRevision }
  assert.equal((await writer.commit(material, { hp: 8 }, options)).replayed, false)
  store = createChatJournalStore({ dataRoot: root })
  assert.equal((await makeWriter().commit(material, { hp: 8 }, options)).replayed, true)
  assert.equal((await store.read('chat')).messages[0].variables[0].hp, 8)
})

test('结算后任务可以改变量，后续任务读到新值；任务外和其他插件不能借用权限', async () => {
  const h = harness(), entered = deferred(), release = deferred()
  const other = Object.create(h.service); other.ctx = { fiber: { name: 'other-plugin' } }
  let seen, crossOwner
  h.service.settlementTask({ name: 'a-update', run: async () => {
    entered.resolve(); await release.promise
    await assert.rejects(other.setVariables(h.input({ hp: 0 })), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
    await assert.rejects(other.getVariableSnapshot({ gameId: 'game', turn: 3, textVersion: 'version-1' }), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
    crossOwner = true
    await h.service.setVariables(h.input({ hp: 8 }))
  } })
  h.service.settlementTask({ name: 'b-read', run: async ({ variables }) => { seen = variables } })
  const job = h.api.runSettlementTasks({ gameId: 'game', phase: 'after', around: h.around })
  await entered.promise
  await assert.rejects(h.service.setVariables(h.input({ hp: 0 })), { code: 'TAVERN_PLUGIN_BUSY' })
  release.resolve(); await job
  assert.equal(crossOwner, true)
  assert.deepEqual(seen, { hp: 8 })
  assert.equal(h.writes(), 1)
})

for (const stopped of [false, true]) {
  test('插件任务' + (stopped ? '停止' : '结束') + '后迟到的异步回调不能写变量', async () => {
    const h = harness(), entered = deferred(), release = deferred()
    let late
    h.service.settlementTask({ name: 'late', run: () => {
      late = release.promise.then(() => h.service.setVariables(h.input({ hp: 0 })))
      entered.resolve()
      if (stopped) return new Promise(() => {})
    } })
    const job = h.api.runSettlementTasks({ gameId: 'game', phase: 'after', around: h.around })
    await entered.promise
    if (stopped) assert.equal(h.api.stopTasks('game'), true)
    await job
    assert.equal(h.coordinator.activity(h.copy()).busy, false)
    const rejected = assert.rejects(late, { code: 'TAVERN_PLUGIN_STALE_VERSION' })
    release.resolve(); await rejected
    assert.equal(h.writes(), 0)
  })
}

for (const boundary of ['beforeSlice', 'beforePatch']) {
  test('读取与提交之间正文变化时拒绝旧变量：' + boundary, async () => {
    const h = harness()
    h.state[boundary] = () => h.changeText()
    await assert.rejects(h.service.setVariables(h.input({ hp: 0 })), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
    assert.deepEqual(h.copy().messages[1].variables[0], { hp: 10 })
    assert.equal(h.writes(), 0)
  })
}
