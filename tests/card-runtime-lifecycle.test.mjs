import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function host() {
  const timers = new Map(), listeners = new Set(), saved = new Map()
  let id = 0, descriptor
  const window = {
    crypto: { randomUUID: () => 'token-' + ++id },
    sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    setTimeout(run, delay) { timers.set(++id, { run, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    addEventListener(type, run) { if (type === 'message') listeners.add(run) },
    removeEventListener(type, run) { if (type === 'message') listeners.delete(run) },
    __ModuleLoader__: { load(value) { descriptor = value } }
  }
  vm.runInNewContext(source, { window, console: { warn() {} } })
  const client = descriptor.factory(() => ({}))
  return { window, client, timers, listeners, saved,
    runTimer() { const [key, timer] = timers.entries().next().value; timers.delete(key); return timer.run() },
    deliver(node, data, sender = node.contentWindow) { for (const run of listeners) run({ source: sender, data }) }
  }
}
const context = (revision = 1) => ({ version: 1, stateRevision: revision, lifecycleRevision: 1, messages: [{ role: 'assistant', variables: { hp: revision } }], turnMessageIds: { 1: 0 }, chatVariables: {}, scriptVariables: {} })
const view = (revision = 1) => ({ tavernHelper: context(revision), tavernHelperScripts: [{ id: 'script', name: 'script', content: 'void 0' }] })
function execution() {
  const h = host(), calls = [], runtimes = []
  let handle = () => Promise.resolve({ active: true })
  const module = h.client.createTavernScriptExecutionModule({ window: h.window,
    rpc(method, args, sessionId) { calls.push({ method, args: copy(args), sessionId }); return handle(method, args, sessionId) },
    createRuntime(options) {
      const runtime = { options, syncs: [], emissions: [], disposed: 0,
        sync(sessionId, view) { this.syncs.push({ sessionId, view }) },
        inspect() { return { scripts: [{ subscriptionsReady: true }] } },
        emit(...args) { this.emissions.push(args); return Promise.resolve(args[1]) },
        triggerButton: () => Promise.resolve('clicked'),
        dispose() { this.disposed++ }
      }
      runtimes.push(runtime); return runtime
    }
  })
  return Object.assign(h, { module, calls, runtimes, respond(fn) { handle = fn } })
}

test('script owner acquires one lease, reuses sandbox on variable changes, initializes and releases on empty view', async () => {
  const h = execution()
  h.module.sync('A', view())
  h.module.sync('A', view(2))
  assert.equal(h.runtimes.length, 1)
  assert.equal(h.timers.size, 1)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelperScripts.length, 0, 'no script execution before lease acquisition')
  await h.runTimer()
  assert.equal(h.module.inspect().active, true)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 2)
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions[0][0], 'CHAT_CHANGED')
  assert.equal(h.runtimes[0].emissions[0][2].stateRevision, 2)
  h.module.sync('A', view(3))
  assert.equal(await h.module.triggerButton('script', 'button'), 'clicked')
  h.module.sync('A', {})
  assert.equal(h.runtimes[0].disposed, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls.at(-1).method, 'releaseTavernHelperRuntime')
  h.module.dispose()
  assert.equal(h.calls.filter(x => x.method === 'releaseTavernHelperRuntime').length, 1)
})

test('A -> B -> A rejects late polls/readiness and uses distinct leases, including same-session view updates during polling', async () => {
  const h = execution(), late = deferred()
  h.respond(method => method === 'pollTavernHelperEvent' ? late.promise : Promise.resolve({}))
  h.module.sync('A', view())
  const pending = h.runTimer()
  h.module.sync('B', view())
  h.module.sync('A', view(3))
  const last = h.runtimes.at(-1)
  await h.runtimes[0].options.onReady('A')
  late.resolve({ active: true, event: { id: 'old-event', name: 'OLD', args: [] } })
  await pending
  assert.equal(last.emissions.length, 0)
  assert.equal(h.module.inspect().active, false)
  assert.equal(h.calls.at(-1).method, 'releaseTavernHelperRuntime', 'late poll cannot retain the old server lease')
  assert.equal(h.calls.at(-1).args.runtimeId, h.calls[0].args.runtimeId)
  assert.equal(h.timers.size, 1)
  const newer = deferred()
  h.respond(method => method === 'pollTavernHelperEvent' ? newer.promise : Promise.resolve({}))
  const current = h.runTimer()
  h.module.sync('A', view(4))
  newer.resolve({ active: true })
  await current
  assert.equal(last.syncs.at(-1).view.tavernHelper.stateRevision, 4)
  const polls = h.calls.filter(x => x.method === 'pollTavernHelperEvent')
  assert.notEqual(polls[0].args.runtimeId, polls[1].args.runtimeId)
  assert.equal(h.calls.some(x => x.method === 'completeTavernHelperEvent'), false)
  h.module.dispose()
})

test('event completion stays in its lease; disposal during execution does not acknowledge into another lifetime', async () => {
  const h = execution(), running = deferred()
  h.respond(method => Promise.resolve(method === 'pollTavernHelperEvent' ? { active: true, event: { id: 'E', name: 'UPDATE', args: [1] } } : {}))
  h.module.sync('A', view())
  h.runtimes[0].emit = () => running.promise
  const pending = h.runTimer()
  await tick()
  h.module.dispose()
  h.module.sync('A', view())
  running.resolve([2])
  await pending
  assert.equal(h.calls.some(x => x.method === 'completeTavernHelperEvent'), false)
  assert.equal(h.timers.size, 1)
  h.module.dispose()
  assert.equal(h.timers.size, 0)
})

test('script failure is acknowledged with diagnostics; the poll loop can execute the next event', async () => {
  const h = execution()
  let eventId = 0
  h.respond(method => Promise.resolve(method === 'pollTavernHelperEvent' ? { active: true, event: { id: 'E' + ++eventId, name: 'UPDATE', args: [1], context: context() } } : {}))
  h.module.sync('A', view())
  h.runtimes[0].emit = async (_name, _args, _context, diagnostics) => { diagnostics.push({ stage: 'script' }); throw Error('fixture failure') }
  await h.runTimer()
  assert.match(h.calls.at(-1).args.error, /fixture failure/)
  assert.deepEqual(h.calls.at(-1).args.diagnostics, [{ stage: 'script' }])
  assert.equal([...h.timers.values()][0].delay, 0)
  h.runtimes[0].emit = async () => [2]
  await h.runTimer()
  assert.equal(h.calls.at(-1).args.eventId, 'E2')
  assert.deepEqual(h.calls.at(-1).args.args, [2])
  h.module.dispose()
})

function frames(extra = {}) {
  const h = host(), calls = [], invalidations = [], posts = []
  let props = { sessionId: 'A', content: '<p>status</p>', turn: 1, partIndex: 0, eager: true, persistent: true, helperContext: context(), ...extra }
  let handler = () => Promise.resolve({ updated: true })
  const lifecycle = h.client.createTavernMessageFrameLifecycle(props, { window: h.window,
    rpc(method, args, sessionId) { calls.push({ method, args: copy(args), sessionId }); return handler(method, args, sessionId) },
    invalidate(sessionId) { invalidations.push(sessionId) }
  })
  const stop = lifecycle.start(() => {})
  function attach(document = lifecycle.snapshot().visibleDocument) {
    const node = { contentWindow: { postMessage(data) { posts.push(copy(data)) } } }
    document.ref(node)
    return { document, node, message(type, data = {}, sender = node.contentWindow) { h.deliver(node, { type, token: document.token, ...data }, sender) } }
  }
  return Object.assign(h, { lifecycle, stop, attach, calls, posts, invalidations,
    update(patch) { props = { ...props, ...patch }; lifecycle.update(props) },
    respond(fn) { handler = fn }
  })
}

test('document transport coalesces loading updates, recovers snapshots, and rejects forged or detached sources', () => {
  const h = frames(), frame = h.attach()
  h.update({ helperContext: context(2) }); h.update({ helperContext: context(3) })
  frame.message('dsh-tavern-frame-ready', {}, {})
  assert.equal(h.posts.length, 0)
  frame.message('dsh-tavern-frame-ready')
  assert.equal(h.posts[0].update.baseRevision, 1)
  assert.equal(h.posts[0].update.stateRevision, 3)
  frame.message('dsh-tavern-frame-ready')
  assert.equal(h.posts.length, 1)
  frame.message('dsh-tavern-helper-context-request')
  assert.equal(h.posts[1].update.kind, 'snapshot')
  h.update({ helperContext: context(1) })
  assert.equal(h.posts[2].update.kind, 'snapshot', 'rollback replaces mirror without changing authoritative history')
  frame.document.ref(null)
  frame.message('dsh-tavern-helper-context-request')
  assert.equal(h.posts.length, 3)
  h.stop()
})

test('replacement retains visible page, ignores superseded pending readiness, and carries measured height into the swap', () => {
  const h = frames(), old = h.attach()
  old.message('dsh-tavern-frame-ready')
  h.update({ content: '<p>first</p>' })
  const abandoned = h.attach(h.lifecycle.snapshot().pendingDocument)
  h.update({ content: '<p>second</p>' })
  const replacement = h.attach(h.lifecycle.snapshot().pendingDocument)
  abandoned.message('dsh-tavern-frame-ready')
  assert.equal(h.lifecycle.snapshot().visibleDocument, old.document)
  replacement.message('dsh-tavern-frame-height', { height: 450.2 })
  h.update({ helperContext: context(2) })
  replacement.message('dsh-tavern-frame-ready')
  assert.equal(h.lifecycle.snapshot().visibleDocument, replacement.document)
  assert.equal(h.lifecycle.snapshot().pendingDocument, null)
  assert.equal(h.lifecycle.snapshot().height, 451)
  assert.equal(h.posts.at(-1).update.stateRevision, 2)
  old.message('dsh-tavern-helper-call', { method: 'updateTavernHelperVariables' })
  assert.equal(h.calls.length, 0, 'superseded visible document is rejected even before React detaches it')
  h.stop()
})

test('return to visible content cancels preparation; stale refresh coalesces; historical context remains frozen', () => {
  const h = frames(), old = h.attach()
  h.update({ content: 'temporary' })
  const pending = h.attach(h.lifecycle.snapshot().pendingDocument)
  h.update({ content: '<p>status</p>' })
  assert.equal(h.lifecycle.snapshot().pendingDocument, null)
  pending.message('dsh-tavern-frame-ready')
  assert.equal(h.lifecycle.snapshot().visibleDocument, old.document)
  old.message('dsh-tavern-status-stale')
  const replacement = h.lifecycle.snapshot().pendingDocument
  old.message('dsh-tavern-status-stale')
  assert.equal(h.lifecycle.snapshot().pendingDocument, replacement)
  h.stop()
  const history = frames({ eager: false, persistent: false }), historical = history.attach()
  historical.message('dsh-tavern-frame-ready')
  history.update({ helperContext: context(2) })
  historical.message('dsh-tavern-status-stale')
  assert.equal(history.posts.length, 0)
  assert.equal(history.lifecycle.snapshot().pendingDocument, null)
  history.stop()
})

test('same template in another session gets a new page and rejects old writes; pending RPC response cannot reach a retired page', async () => {
  const h = frames(), old = h.attach(), call = deferred()
  h.respond(() => call.promise)
  old.message('dsh-tavern-helper-call', { requestId: 'R', method: 'updateTavernHelperVariables', args: { sessionId: 'forged' } })
  assert.equal(h.calls[0].sessionId, 'A')
  assert.equal(h.calls[0].args.sessionId, 'A')
  assert.equal(h.calls[0].args.expectedLifecycleRevision, 1)
  h.update({ sessionId: 'B', helperContext: { ...context(2), lifecycleRevision: 9 } })
  const current = h.attach()
  assert.notEqual(current.document.token, old.document.token)
  old.message('dsh-tavern-helper-call', { method: 'updateTavernHelperVariables' })
  call.resolve({ updated: true }); await tick()
  assert.equal(h.posts.length, 0)
  assert.equal(h.calls.length, 1)
  current.message('dsh-tavern-helper-call', { method: 'replaceTavernHelperWorldbook' })
  assert.equal(h.calls.length, 1, 'message page retains its narrow write allowlist')
  h.stop()
})

test('runtime reports coalesce and cancel on stop; restart attaches once and read-only capture never mutates variables', async () => {
  const h = frames(), frame = h.attach()
  frame.message('dsh-tavern-frame-height', { height: 90000 })
  assert.equal(h.lifecycle.snapshot().height, 12000)
  frame.message('dsh-tavern-frame-runtime', { runtime: { stage: 1 } })
  frame.message('dsh-tavern-frame-runtime', { runtime: { stage: 2 } })
  assert.equal(h.timers.size, 1)
  await h.runTimer()
  assert.equal(h.calls[0].args.runtime.stage, 2)
  const captured = deferred()
  h.respond(() => captured.promise)
  frame.message('dsh-tavern-mvu-view-used')
  frame.message('dsh-tavern-frame-runtime', { runtime: {} })
  h.stop()
  captured.resolve({ captured: true }); await tick()
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.invalidations.length, 0)
  const stopAgain = h.lifecycle.start(() => {})
  assert.equal(h.listeners.size, 1)
  h.respond(() => Promise.resolve({ captured: true }))
  frame.message('dsh-tavern-mvu-view-used'); await tick()
  assert.deepEqual(h.invalidations, ['A'])
  assert.ok(h.calls.every(x => x.method === 'captureDisplayRuntime'))
  stopAgain()
})

function sandbox() {
  const h = host(), frames = [], calls = [], mutations = [], errors = []
  let respond = () => Promise.resolve({ updated: true })
  const document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'div') return { isConnected: true, appendChild() {}, remove() {}, style: {} }
    const frame = { contentWindow: { messages: [], postMessage(data) { this.messages.push(copy(data)) } }, style: {},
      addEventListener(type, run) { if (type === 'load') this.load = run }, remove() { this.removed = true }
    }
    frames.push(frame); return frame
  } }
  const runtime = h.client.createTavernHelperScriptRuntime({ window: h.window, document,
    rpc(method, args, sessionId) { calls.push({ method, args, sessionId }); return respond(method, args, sessionId) },
    onMutation(...args) { mutations.push(args) }, reportError(_source, error) { errors.push(error.message) }, resolveError() {}
  })
  function message(frame, type, data = {}) {
    const token = frame.contentWindow.messages[0].token
    h.deliver(frame, { token, type, ...data })
  }
  function ready(frame = frames.at(-1)) {
    frame.load()
    message(frame, 'dsh-tavern-helper-subscriptions', { ready: true, names: ['UPDATE'] })
    return frame
  }
  return Object.assign(h, { runtime, frames, calls, mutations, errors, ready, message, respond(fn) { respond = fn } })
}

test('replacing the shared sandbox cancels its pending events and ignores detached load and RPC completion', async () => {
  const h = sandbox(), result = deferred()
  h.runtime.sync('A', view())
  const first = h.ready()
  const emission = h.runtime.emit('UPDATE', [1], context())
  const rejection = assert.rejects(emission, /已重置/)
  h.respond(() => result.promise)
  h.message(first, 'dsh-tavern-helper-call', { method: 'updateTavernHelperVariables', args: {} })
  const changed = view(); changed.tavernHelperScripts[0].content = 'void 1'
  h.runtime.sync('A', changed)
  await rejection
  assert.equal(first.removed, true)
  assert.equal(h.timers.size, 0, 'old initialization/event timers must not survive replacement')
  first.load()
  assert.equal(h.timers.size, 0, 'detached load cannot start a new timeout')
  h.runtime.sync('B', view())
  result.resolve({ updated: true }); await tick()
  assert.equal(h.mutations.length, 0, 'old RPC completion cannot invalidate the new session')
  assert.equal(first.contentWindow.messages.some(x => x.type === 'dsh-tavern-helper-response'), false)
  const callCount = h.calls.length
  h.message(first, 'dsh-tavern-helper-call', { method: 'updateTavernHelperVariables' })
  assert.equal(h.calls.length, callCount)
  h.runtime.dispose(); h.runtime.dispose()
  assert.equal(h.listeners.size, 0)
  assert.equal(h.timers.size, 0)
})

test('sandbox initialization failure remains observable; a new script document can become ready', () => {
  const h = sandbox()
  h.runtime.sync('A', view())
  h.frames[0].load()
  h.runTimer()
  assert.equal(h.runtime.inspect().scripts[0].initializationFailed, true)
  assert.match(h.errors[0], /初始化超时/)
  const changed = view(); changed.tavernHelperScripts[0].content = 'void 2'
  h.runtime.sync('A', changed)
  h.ready()
  assert.equal(h.runtime.inspect().scripts[0].subscriptionsReady, true)
  assert.equal(h.runtime.inspect().scripts[0].initializationFailed, false)
  h.runtime.dispose()
  assert.equal(h.timers.size, 0)
})

test('another window owning the lease keeps local scripts inactive until ownership is available', async () => {
  const h = execution()
  let owns = false
  h.respond(() => Promise.resolve({ active: owns }))
  h.module.sync('A', view())
  await h.runTimer()
  assert.equal(h.module.inspect().active, false)
  assert.ok(h.runtimes[0].syncs.every(x => x.view.tavernHelperScripts.length === 0))
  await assert.rejects(h.module.triggerButton('script', 'button'), /其他窗口/)
  owns = true
  await h.runTimer()
  assert.equal(h.module.inspect().active, true)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelperScripts.length, 1)
  owns = false
  await h.runTimer()
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelperScripts.length, 0)
  h.module.dispose()
})


test('equivalent context revisions and height rerenders do not rescan the conversation', () => {
  const h = frames(), frame = h.attach()
  h.update({ helperContext: context(1) })
  frame.message('dsh-tavern-frame-ready')
  const sameRevision = context(1)
  Object.defineProperty(sameRevision, 'messages', { get() { throw Error('unchanged history must not be read'); } })
  h.update({ helperContext: sameRevision })
  frame.message('dsh-tavern-frame-height', { height: 300 })
  h.update({})
  assert.equal(h.posts.length, 0)
  h.update({ helperContext: context(2) })
  assert.equal(h.posts[0].update.baseRevision, 1)
  assert.equal(h.posts[0].update.stateRevision, 2)
  h.stop()
})
