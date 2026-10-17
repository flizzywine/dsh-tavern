import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function store(value) {
  const listeners = new Set()
  return { getSnapshot: () => value, listeners,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of listeners) fn() } }
}
const view = revision => ({ tavernHelperScripts: [{ id: 'companion', content: 'void 0' }], tavernHelper: { stateRevision: revision } })
function harness({ holdReleases = false, dropSignals = false, claimTimeoutMs, receiptBarrier, retentionMs = 0, snapshotShape } = {}) {
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
  const list = store(snapshotShape === 'flat'
    ? { phase: 'ready', ids: ['A'], byId: { A: { id: 'A', retainedBy: { mainView: 1 } } }, projectionsBySession: {} }
    : { current: 'A' }), transition = store(false), views = new Map(), subscriptions = []
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
        const runtime = { disposed: 0, syncs: [], emissions: [], foreground:settings.foreground,
          setForeground(value) { this.foreground=value },
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

test('0.2.0 扁平快照没有顶层 current 时，仍按 mainView retain 选中会话并建立卡片运行时', async t => {
  const h = harness({ snapshotShape: 'flat' })
  const owner = h.client.createTavernScriptSessionOwner(h.options)
  t.after(() => owner.dispose())
  owner.start(); await h.poll()
  assert.equal(owner.getSnapshot().sessionId, 'A', '主视图 retained 的会话必须被选中')
  assert.equal(h.runtimes.length, 1, '0.2.0 宿主下页面必须自建脚本运行时，否则卡片 UI 永不挂载')
  assert.equal(h.runtimes[0].foreground, true, 'retained 会话的宿主卡片产物必须保持可见')
  owner.dispose()
})
