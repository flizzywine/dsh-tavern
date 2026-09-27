import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function store(value) {
  const listeners = new Set()
  return { getSnapshot: () => value, listeners,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of listeners) fn() } }
}
const view = revision => ({ tavernHelperScripts: [{ id: 'companion', content: 'void 0' }], tavernHelper: { stateRevision: revision } })
function harness({ holdReleases = false, dropSignals = false, claimTimeoutMs, receiptBarrier, retentionMs = 0 } = {}) {
  const timers = new Map(), events = new Map(), runtimes = [], calls = []
  const heartbeats = new Map()
  let sequence = 0, descriptor, clock = 0
  let allowRelease
  const releaseBarrier = holdReleases ? new Promise(resolve => { allowRelease = resolve }) : Promise.resolve()
  const window = { crypto: { randomUUID: () => 'lease-' + ++sequence },
    setTimeout(fn, delay = 0) {
      const id = ++sequence; timers.set(id, { fn, at: clock + delay });
      if (delay === 0) queueMicrotask(() => { if (timers.delete(id)) fn() });
      return id
    }, clearTimeout(id) { timers.delete(id) },
    setInterval(fn, delay) { heartbeats.set(++sequence, { fn, delay }); return sequence }, clearInterval(id) { heartbeats.delete(id) },
    addEventListener(type, fn) { events.set(type, fn) }, removeEventListener(type) { events.delete(type) },
    __ModuleLoader__: { load(d) { descriptor = d } } }
  vm.runInNewContext(source, { window, console })
  const react = { createElement: (type, props) => ({ type, props }),
    useSyncExternalStore: (subscribe, snapshot) => { uiStops.push(subscribe(() => {})); return snapshot() } }
  const uiStops = []
  const client = descriptor.factory(name => name === 'react' ? react : {})
  const list = store({ current: 'A' }), transition = store(false), views = new Map(), subscriptions = []
  const parents = { child: 'A', nested: 'child', otherChild: 'B' }
  const sessions = { list, subagentAddress: id => parents[id] ? { parentSessionId: parents[id], childSessionId: id } : undefined }
  const liveView = {
    subscribe(id, fn) { const sub = { id, fn, active: true }; subscriptions.push(sub); fn({ phase: 'ready', view: views.get(id) || view(1) }); return () => { sub.active = false } },
    invalidate(id) { queueMicrotask(() => liveView.update(id, views.get(id) || view(1))) },
    update(id, value) { views.set(id, value); for (const sub of subscriptions) if (sub.active && sub.id === id) sub.fn({ phase: 'ready', view: value }) }
  }
  const runtimeWorkListeners = new Map()
  const gate = createTavernScriptDispatch({ claimTimeoutMs, publishSignal(sessionId, signal) { if (!dropSignals && signal.kind === 'runtime-work') runtimeWorkListeners.get(sessionId)?.(signal) } })
  const options = { window, sessions, liveView, transition, retentionMs, now: () => clock,
    signals: { subscribe(sessionId, kind, listener) { if (kind === 'runtime-work') runtimeWorkListeners.set(sessionId, listener); return () => { if (runtimeWorkListeners.get(sessionId) === listener) runtimeWorkListeners.delete(sessionId) } } },
    createExecution: settings => client.createTavernScriptExecutionModule({ ...settings, window,
      rpc: async (method, args, id) => {
        calls.push({ method, args, id })
        if (method === 'claimTavernScriptWork') return gate.claimWithContext(id, args.runtimeId, args.ready, args.initializationError, args.contextBaseline)
        if (method === 'startTavernScriptWork') return gate.start(id, args.eventId, args.leaseToken, args.runtimeId)
        if (method === 'heartbeatTavernScriptRuntime') return { active: gate.touch(id, args.runtimeId, args.ready) }
        if (method === 'releaseTavernHelperRuntime') {
          if (holdReleases) await releaseBarrier
          return gate.dispose(id, args.runtimeId)
        }
        if (method === 'completeTavernHelperEvent') {
          const completed = gate.complete(id, args.eventId, args.args, args.runtimeId, args.leaseToken, args.error)
          if (receiptBarrier) await receiptBarrier
          return { completed }
        }
        return {}
      }, createRuntime(settings) {
        const runtime = { disposed: 0, syncs: [], emissions: [],
          sync(id, next) { this.syncs.push({ id, view: next }) },
          inspect: () => ({ scripts: [{ subscriptionsReady: true }] }),
          async emit(name, args) { this.emissions.push(name); return args },
          retryMvuLoad() { return true }, dispose() { this.disposed++ }, settings }
        runtimes.push(runtime); return runtime
      } }) }
  return { client, options, list, transition, liveView, subscriptions, gate, runtimes, calls, events, uiStops, heartbeats, views,
    heartbeat() { for (const { fn } of heartbeats.values()) fn() },
    allowReleases() { allowRelease?.() },
    async advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn() }; await new Promise(resolve => setImmediate(resolve)) },
    async poll() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) } }
}

test('丢失全部工作通知时，存活页面通过心跳领取同一任务，执行一次且不需要刷新', async t => {
  const h = harness({ dropSignals: true, claimTimeoutMs: 100 })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  const pending = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [1])
  await h.poll()
  assert.equal(h.runtimes[0].emissions.length, 0, 'notification was deliberately lost')
  h.heartbeat()
  await h.poll()
  assert.equal((await pending).handled, true, 'a live heartbeat must recover queued work before it expires')
  h.heartbeat(); h.heartbeat(); await h.poll()
  assert.deepEqual(h.runtimes[0].emissions, ['MESSAGE_RECEIVED'])
  assert.equal(h.runtimes.length, 1)
  owner.dispose()
  assert.equal(h.heartbeats.size, 0)
})

test('执行期间的心跳合并领取请求，不重复执行变量事件', async t => {
  const h = harness({ dropSignals: true })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  let finish
  h.runtimes[0].emit = async function (name, args) {
    this.emissions.push(name)
    await new Promise(resolve => { finish = resolve })
    return args
  }
  const pending = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [1])
  h.heartbeat(); await h.poll()
  const claims = h.calls.filter(call => call.method === 'claimTavernScriptWork').length
  h.heartbeat(); h.heartbeat(); await h.poll()
  assert.equal(h.calls.filter(call => call.method === 'claimTavernScriptWork').length, claims)
  assert.deepEqual(h.runtimes[0].emissions, ['MESSAGE_RECEIVED'])
  finish(); await h.poll()
  assert.equal((await pending).handled, true)
  assert.deepEqual(h.runtimes[0].emissions, ['MESSAGE_RECEIVED'])
  assert.equal(h.calls.filter(call => call.method === 'completeTavernHelperEvent').length, 1)
})

test('默认领取窗口覆盖首次兜底心跳与短暂积压，离线仍有明确终点', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness({ dropSignals: true })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  let ended = false
  const pending = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [1]).then(result => { ended = true; return result })
  const interval = [...h.heartbeats.values()][0].delay
  t.mock.timers.tick(interval + 8000)
  await h.poll()
  assert.equal(ended, false, 'first fallback plus a slow response must fit inside the claim budget')
  h.heartbeat(); await h.poll()
  assert.equal((await pending).handled, true)
  const offline = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [2])
  t.mock.timers.tick(60000)
  assert.equal((await offline).claimTimedOut, true)
  assert.deepEqual(h.runtimes[0].emissions, ['MESSAGE_RECEIVED'])
})

test('viewing a child and returning keeps one game executor; events complete while its header is unmounted', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start()
  await h.poll()
  assert.equal(h.gate.status('A').ready, true)
  const stopHeader = owner.subscribe(() => {})
  h.list.set({ current: 'child' }); stopHeader()
  assert.equal(h.gate.status('A').ready, true, 'header unmount must not release the game executor')
  h.list.set({ current: 'nested' })
  h.liveView.update('A', view(2))
  const completed = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [1])
  await h.poll()
  assert.equal((await completed).handled, true)
  assert.deepEqual(h.runtimes[0].emissions, ['MESSAGE_RECEIVED'])
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 2)
  h.list.set({ current: 'A' })
  await h.poll()
  assert.equal(h.runtimes.length, 1)
  assert.equal(h.calls.filter(c => c.method === 'releaseTavernHelperRuntime').length, 0)
  assert.equal(h.calls.some(c => ['child', 'nested'].includes(c.id)), false)
  owner.dispose()
  assert.equal(h.gate.status('A').present, false)
})

test('idle games release after refreshing state; stale callbacks cannot cross an A-B-A switch', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  const stale = h.subscriptions[0]
  h.list.set({ current: 'otherChild' })
  await h.poll()
  assert.equal(h.gate.status('A').present, false)
  await h.poll()
  assert.equal(h.gate.status('B').ready, true)
  h.list.set({ current: 'A' })
  const current = h.runtimes.at(-1)
  stale.fn({ phase: 'ready', view: view(999) })
  assert.notEqual(current.syncs.at(-1).view.tavernHelper?.stateRevision, 999)
  await h.poll()
  h.list.set({ current: undefined })
  await h.poll()
  assert.equal(h.gate.status('A').present, false)
  assert.equal(owner.getSnapshot().sessionId, '')
  owner.dispose()
})

test('fast A-B-A switch reuses the retained runtime without releasing its lease', async () => {
  const h = harness({ holdReleases: true }), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  assert.equal(h.gate.status('A').ready, true)

  h.list.set({ current: 'otherChild' })
  h.list.set({ current: 'A' })
  await h.poll()
  assert.equal(h.gate.status('A').ready, true, 'A keeps its lease during rapid navigation')

  h.allowReleases()
  await h.poll()
  assert.equal(h.gate.status('A').ready, true, 'returning must not wait for a heartbeat')
  assert.equal(h.runtimes[0].disposed, 0)
  assert.equal(h.runtimes.filter(r => r.syncs.some(s => s.id === 'A')).length, 1)
  owner.dispose()
})

test('pagehide releases ownership; pageshow resumes once; plugin disposal removes all subscriptions', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); owner.start(); await h.poll()
  assert.equal(h.list.listeners.size, 1)
  h.events.get('pagehide')()
  assert.equal(h.gate.status('A').present, false)
  assert.equal(h.list.listeners.size, 0)
  h.events.get('pageshow')(); await h.poll()
  assert.equal(h.runtimes.length, 2)
  owner.dispose(); owner.dispose()
  assert.equal(h.list.listeners.size, 0)
  assert.equal(h.transition.listeners.size, 0)
  assert.equal(h.events.size, 0)
  assert.equal(h.subscriptions.some(s => s.active), false)
})

test('transition blocks view replacement, missing runtime clears it, malformed parent cycles fail closed', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  h.transition.set(true)
  h.liveView.update('A', view(2))
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 1)
  h.transition.set(false)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 2)
  h.liveView.update('A', {})
  assert.equal(h.gate.status('A').present, false)
  h.options.sessions.subagentAddress = id => ({ parentSessionId: id, childSessionId: id })
  h.list.set({ current: 'broken' })
  assert.equal(owner.getSnapshot().sessionId, '')
  owner.dispose()
})

test('production feature owns lifetime independently of header mount/unmount', () => {
  const h = harness(), disposers = [], slots = new Map()
  h.list.set({ current: undefined })
  h.client.createTavernAssistantRendererFeatureModule().register({
    ctx: { sessions: h.options.sessions, effect(fn) { disposers.push(fn()) } },
    slots: { inject(_name, fn) { return fn() }, register(meta, component) { slots.set(meta.id || meta.key, component); return () => {} } }
  })
  assert.equal(h.list.listeners.size, 1, 'game owner starts at feature registration, not at header mount')
  const element = slots.get('dsh-tavern-script-runtime')({ sessionId: 'child' })
  const rendered = element.type(element.props)
  assert.equal(rendered, null)
  h.uiStops.splice(0).forEach(stop => stop())
  assert.equal(h.list.listeners.size, 1, 'header cleanup must only unsubscribe its display')
  disposers.reverse().forEach(stop => stop?.())
  assert.equal(h.list.listeners.size, 0)
})


test('MVU settlement survives navigation, writes only its owner and releases after completion', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  h.liveView.update('A', { ...view(2), activity: { role: 'settlement', phase: 'running', busy: true } })
  const original = h.runtimes[0]
  h.list.set({ current: 'B' }); await h.poll()
  assert.equal(original.disposed, 0, 'switching must not disconnect an unfinished settlement')
  const result = await h.gate.dispatch('A', 'MESSAGE_RECEIVED', [7])
  assert.equal(result.handled, true)
  assert.deepEqual(original.emissions, ['MESSAGE_RECEIVED'])
  assert.deepEqual(h.runtimes[1].emissions, [])
  assert.equal(h.calls.filter(c => c.method === 'completeTavernHelperEvent').at(-1).id, 'A')
  h.liveView.update('A', { ...view(3), activity: { role: 'settlement', phase: 'idle', busy: false } })
  await h.poll()
  assert.equal(original.disposed, 1)
  assert.equal(h.gate.status('A').present, false)
  assert.equal(h.gate.status('B').ready, true)
})


test('navigation refresh catches settlement start before its notification arrives', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  h.views.set('A', { ...view(2), activity: { role: 'settlement', phase: 'pending' } })
  h.list.set({ current: 'B' }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  assert.equal((await h.gate.dispatch('A', 'MESSAGE_RECEIVED', [3])).handled, true)
  h.list.set({ current: 'A' }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  assert.equal(h.runtimes.filter(r => r.syncs.some(s => s.id === 'A')).length, 1)
})

test('in-flight event survives navigation and idle view until its receipt is confirmed', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  let finish
  h.runtimes[0].emit = async (name, args) => { await new Promise(resolve => { finish = resolve }); return args }
  const pending = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [9])
  await h.poll()
  h.list.set({ current: 'B' }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  finish()
  assert.equal((await pending).handled, true)
  await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
  assert.equal(h.gate.status('B').ready, true)
})

test('pagehide releases all retained owners and their subscriptions', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  h.liveView.update('A', { ...view(2), settleStatus: 'running' })
  h.list.set({ current: 'B' }); await h.poll()
  h.events.get('pagehide')()
  assert.equal(h.gate.status('A').present, false)
  assert.equal(h.gate.status('B').present, false)
  assert.equal(h.subscriptions.some(s => s.active), false)
  assert.equal(h.heartbeats.size, 0)
  owner.dispose()
})


test('real MVU transaction commits A variables after switching to B during execution', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  const makeChat = sessionId => ({ id: sessionId, sessionId, mode: 'story', cardPath: 'test.json',
    mvu: { enabled: true, owner: 'official' }, tavernHelperLifecycleRevision: 2, variables: {},
    messages: [{ role: 'assistant', turn: 1, text: '正文', sourceText: '正文', swipes: ['正文'], swipeId: 0,
      variables: [{ stat_data: { hp: 10 }, schema: { type: 'object' } }] }] })
  const chats = { A: makeChat('A'), B: makeChat('B') }
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async id => chats[id], readCard: async () => ({ name: '测试' }),
    worldBooks: { bound: async () => null }, scriptDispatch: h.gate,
    writeChat: async () => { throw new Error('transaction must not write before commit') }
  })
  owner.start(); await h.poll()
  h.liveView.update('A', { ...view(2), settleStatus: 'running' })
  let finish
  h.runtimes[0].emit = async (_name, args, context, _diagnostics, eventId) => {
    await new Promise(resolve => { finish = resolve })
    await adapter.updateMessages('A', [{ message_id: 0, message: context.messages[0].message,
      data: { stat_data: { hp: 7 }, schema: { type: 'object' } } }], 2, eventId)
    return args
  }
  const pending = adapter.settleMvuUpdate({ operationId: 'settlement-A', chatId: 'A', sessionId: 'A',
    messageId: 0, swipeId: 0, expectedLifecycleRevision: 2, storyText: '正文',
    command: '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":7}]</JSONPatch></UpdateVariable>' })
  await h.poll()
  assert.equal(typeof finish, 'function')
  h.list.set({ current: 'B' }); await h.poll()
  finish()
  const result = await pending
  assert.equal(result.updated, true)
  applyMvuSettlementEffect(chats.A, result.effect)
  assert.equal(chats.A.messages[0].variables[0].stat_data.hp, 7)
  assert.equal(chats.B.messages[0].variables[0].stat_data.hp, 10)
  assert.equal(chats.A.messages[0].text, '正文')
  h.liveView.update('A', { ...view(3), settleStatus: 'done' }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
})


test('completed server work keeps its runtime until the receipt response arrives', async t => {
  let acknowledge
  const h = harness({ receiptBarrier: new Promise(resolve => { acknowledge = resolve }) })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  const pending = h.gate.dispatch('A', 'MESSAGE_RECEIVED', [4])
  await h.poll()
  assert.equal((await pending).handled, true)
  h.list.set({ current: 'B' }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  acknowledge(); await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
})

test('failed background settlement releases its retained executor', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  h.liveView.update('A', { ...view(2), activity: { role: 'settlement', phase: 'running', busy: true } })
  h.list.set({ current: 'B' }); await h.poll()
  h.liveView.update('A', { ...view(3), activity: { role: 'settlement', phase: 'failed', busy: false }, settleStatus: 'error' })
  await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
  assert.equal(h.subscriptions.some(s => s.id === 'A' && s.active), false)
})

test('foreground generation retains Helper execution until fresh idle confirmation', async t => {
  const h = harness()
  h.views.set('A', { ...view(1), chatId: 'chat-A', mode: 'story' })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  h.list.set({ current: 'A', byId: { A: { running: true } } })
  owner.start(); await h.poll()
  h.list.set({ current: 'B', byId: { A: { running: true } } }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  h.views.set('A', { ...view(2), chatId: 'chat-A', activity: { phase: 'pending', busy: true } })
  h.list.set({ current: 'B', byId: { A: { running: false } } }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0, 'fresh settlement state must win over stale idle state')
  h.liveView.update('A', { ...view(3), chatId: 'chat-A', activity: { phase: 'idle', busy: false } }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
})

test('retained foreground executor releases after failed generation with no settlement', async t => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  h.list.set({ current: 'A', byId: { A: { running: true } } })
  owner.start(); await h.poll()
  h.list.set({ current: 'B', byId: { A: { running: true } } }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 0)
  h.list.set({ current: 'B', byId: { A: { running: false } } }); await h.poll()
  assert.equal(h.runtimes[0].disposed, 1)
  assert.equal(h.gate.status('A').present, false)
})


test('正式会话默认保留10分钟，返回复用原脚本，第二次离开重新计时', async t => {
  const h = harness()
  delete h.options.retentionMs // Exercise the production default, not the short deadline used above.
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  const original = h.runtimes[0]
  h.list.set({ current: 'B' }); await h.poll()
  assert.equal(original.disposed, 0)
  await h.advance(599999); assert.equal(original.disposed, 0)
  h.list.set({ current: 'A' }); await h.poll()
  await h.advance(600000); assert.equal(original.disposed, 0)
  assert.equal(h.runtimes.filter(r => r.syncs.some(s => s.id === 'A')).length, 1)
  h.list.set({ current: 'B' }); await h.poll()
  await h.advance(600000); assert.equal(original.disposed, 1)
  assert.equal(h.gate.status('A').present, false)
})

test('会话到期先解除视图订阅再淘汰快照，活动会话不淘汰', async () => {
  const h = harness({ retentionMs: 600000 }), evicted = []
  h.liveView.evict = id => {
    assert.equal(h.subscriptions.some(s => s.id === id && s.active), false)
    evicted.push(id)
  }
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  h.list.set({ current: 'B' }); await h.poll()
  await h.advance(599999); assert.deepEqual(evicted, [])
  await h.advance(1); assert.deepEqual(evicted, ['A'])
  owner.dispose()
})
