import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createTavernHelperEventGate } from '../tavern-plugin/lib/domain/tavern-helper-event-gate.js'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function store(value) {
  const listeners = new Set()
  return { getSnapshot: () => value, listeners,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of listeners) fn() } }
}
const view = revision => ({ tavernHelperScripts: [{ id: 'companion', content: 'void 0' }], tavernHelper: { stateRevision: revision } })
function harness() {
  const timers = new Map(), events = new Map(), runtimes = [], calls = []
  let sequence = 0, descriptor
  const window = { crypto: { randomUUID: () => 'lease-' + ++sequence },
    setTimeout(fn) { timers.set(++sequence, fn); return sequence }, clearTimeout(id) { timers.delete(id) },
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
    invalidate() {},
    update(id, value) { views.set(id, value); for (const sub of subscriptions) if (sub.active && sub.id === id) sub.fn({ phase: 'ready', view: value }) }
  }
  const gate = createTavernHelperEventGate()
  const options = { window, sessions, liveView, transition,
    createExecution: settings => client.createTavernScriptExecutionModule({ ...settings, window,
      rpc: async (method, args, id) => {
        calls.push({ method, args, id })
        if (method === 'pollTavernHelperEvent') return gate.poll(id, args.runtimeId, args.ready)
        if (method === 'releaseTavernHelperRuntime') return gate.dispose(id, args.runtimeId)
        if (method === 'completeTavernHelperEvent') return gate.complete(id, args.eventId, args.args, args.runtimeId)
        return {}
      }, createRuntime(settings) {
        const runtime = { disposed: 0, syncs: [], emissions: [],
          sync(id, next) { this.syncs.push({ id, view: next }) },
          inspect: () => ({ scripts: [{ subscriptionsReady: true }] }),
          async emit(name, args) { this.emissions.push(name); return args },
          retryMvuLoad() { return true }, dispose() { this.disposed++ }, settings }
        runtimes.push(runtime); return runtime
      } }) }
  return { client, options, list, transition, liveView, subscriptions, gate, runtimes, calls, events, uiStops,
    async poll() { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn() } }
}

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

test('other games release the old owner immediately; stale view callbacks cannot cross an A-B-A switch', async () => {
  const h = harness(), owner = h.client.createTavernScriptSessionOwner(h.options)
  owner.start(); await h.poll()
  const stale = h.subscriptions[0]
  h.list.set({ current: 'otherChild' })
  assert.equal(h.gate.status('A').present, false)
  await h.poll()
  assert.equal(h.gate.status('B').ready, true)
  h.list.set({ current: 'A' })
  const current = h.runtimes.at(-1)
  stale.fn({ phase: 'ready', view: view(999) })
  assert.notEqual(current.syncs.at(-1).view.tavernHelper?.stateRevision, 999)
  await h.poll()
  h.list.set({ current: undefined })
  assert.equal(h.gate.status('A').present, false)
  assert.equal(owner.getSnapshot().sessionId, '')
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
