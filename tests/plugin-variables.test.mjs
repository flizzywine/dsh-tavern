import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createPluginVariableWriter } from '../tavern-plugin/lib/domain/plugin-variables.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'

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
      const next = copy(); next.messages[1].variables = changes[0].value; writes++; return save(next)
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

test('结算后任务可以改变量，后续任务读到新值；任务外和其他插件不能借用权限', async () => {
  const h = harness(), entered = deferred(), release = deferred()
  const other = Object.create(h.service); other.ctx = { fiber: { name: 'other-plugin' } }
  let seen, crossOwner
  h.service.settlementTask({ name: 'a-update', run: async () => {
    entered.resolve(); await release.promise
    await assert.rejects(other.setVariables(h.input({ hp: 0 })), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
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
