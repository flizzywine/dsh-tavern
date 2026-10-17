import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
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
const view = (revision = 1) => ({ chatId: 'tavern-chat', tavernHelper: context(revision), tavernHelperScripts: [{ id: 'script', name: 'script', content: 'void 0' }] })
const mvuView = () => {
  const input = { ...view(), tavernMvuRuntime: { owner: 'official', assetUrl: '/bundle.js' } }
  input.tavernHelper.messages[0].variables = { stat_data: { hp: 10 }, schema: {} }
  return input
}

function execution(options = {}) {
  const h = host(), calls = [], runtimes = [], signalListeners = new Map(), connectionListeners = new Map()
  let handle = () => Promise.resolve({ active: true })
  const module = h.client.createTavernScriptExecutionModule({ window: h.window,
    signals: { subscribe(sessionId, kind, listener, _onError, onConnect) {
      signalListeners.set(sessionId + ':' + kind, listener)
      connectionListeners.set(sessionId + ':' + kind, onConnect)
      return () => { signalListeners.delete(sessionId + ':' + kind); connectionListeners.delete(sessionId + ':' + kind) }
    } },
    rpc(method, args, sessionId, requestOptions) {
      calls.push({ method, args: copy(args), sessionId, requestOptions })
      return Promise.resolve(handle(method, args, sessionId)).then(function (result) {
        if (method === 'completeTavernHelperEvent' && result?.completed === undefined) return { completed: true }
        return method === 'startTavernScriptWork' && (!result || result.started === undefined) ? { started: true } : result
      })
    },
    createRuntime(options) {
      const runtime = { options, syncs: [], emissions: [], disposed: 0,
        sync(sessionId, view) { this.syncs.push({ sessionId, view }) },
        inspect() { return { scripts: [{ subscriptionsReady: true }] } },
        emit(...args) { this.emissions.push(args); return Promise.resolve(args[1]) },
        triggerButton: () => Promise.resolve('clicked'),
        dispose() { this.disposed++ }
      }
      runtimes.push(runtime); return runtime
    },
    ...options
  })
  return Object.assign(h, { module, calls, runtimes,
    respond(fn) { handle = fn },
    wake(sessionId = 'A') { signalListeners.get(sessionId + ':runtime-work')?.({ sessionId, kind: 'runtime-work', version: String(Date.now()) }) },
    reconnect(sessionId = 'A') { connectionListeners.get(sessionId + ':runtime-work')?.() },
    async settle() { await tick(); await tick() }
  })
}

const announcementDelays = [1500, 4000, 9000]
const announcementTimers = h => [...h.timers.entries()].filter(([, timer]) => announcementDelays.includes(timer.delay))
function runAnnouncement(h, delay) {
  const entry = announcementTimers(h).find(([, timer]) => timer.delay === delay)
  assert.ok(entry, `no pending chat announcement timer for ${delay}ms`)
  h.timers.delete(entry[0])
  return entry[1].run()
}

test('coordination subscription performs an authoritative initial refresh when a restart signal was lost', async () => {
  const h = host()
  const states = []
  let refreshes = 0
  const coordination = h.client.createTavernCoordinationEventModule({
    connect(_sessionId, handlers) {
      return {
        close() {},
        refresh() {
          refreshes++
          handlers.message({ task: { kind: 'candidate', status: 'succeeded', busy: false, terminal: true } })
        }
      }
    }
  })

  const stop = coordination.subscribe('A', state => states.push(copy(state)))
  await tick()
  assert.equal(refreshes, 1)
  assert.equal(states.at(-1).view.task.status, 'succeeded')
  stop()
})

test('script owner acquires one lease, reuses sandbox on variable changes, initializes and releases on empty view', async () => {
  const h = execution()
  h.module.sync('A', view())
  h.module.sync('A', view(2))
  assert.equal(h.runtimes.length, 1)
  assert.equal(h.timers.size, 1)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelperScripts.length, 0, 'no script execution before lease acquisition')
  await h.settle()
  assert.equal(h.module.inspect().active, true)
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 2)
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions[0][0], 'CHAT_CHANGED')
  assert.deepEqual(copy(h.runtimes[0].emissions[0][1]), ['tavern-chat'], 'MVU transition requires the Tavern chat ID, not the DSH session ID or undefined')
  assert.equal(h.runtimes[0].emissions[0][2].stateRevision, 2)
  h.module.sync('A', view(3))
  assert.equal(await h.module.triggerButton('script', 'button'), 'clicked')
  h.module.sync('A', {})
  assert.equal(h.runtimes[0].disposed, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls.at(-1).method, 'releaseTavernHelperRuntime')
  assert.equal(h.calls.at(-1).requestOptions.keepalive, true, 'navigation must not abort the ownership release')
  h.module.dispose()
  assert.equal(h.calls.filter(x => x.method === 'releaseTavernHelperRuntime').length, 1)
})

test('8 秒的短暂请求积压恢复后仍领取同一执行器，不被旧 3 秒超时打断', async t => {
  const h = execution(), response = deferred()
  t.after(() => h.module.dispose())
  h.respond(method => method === 'claimTavernScriptWork' ? response.promise : {})
  h.module.sync('A', view())
  await tick()
  // Replay an 8-second response delay without waiting on wall-clock time.
  for (const [id, timer] of [...h.timers]) {
    if (timer.delay <= 8000) { h.timers.delete(id); timer.run() }
  }
  await h.settle()
  response.resolve({ active: true })
  await h.settle()
  assert.equal(h.module.inspect().active, true)
  assert.equal(h.calls.filter(call => call.method === 'claimTavernScriptWork').length, 1)
})

test('script readiness without a chat identity never cancels MVU initialization with an undefined transition', async () => {
  const h = execution(), input = view()
  delete input.chatId
  h.module.sync('A', input)
  await h.settle()
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 0)
  h.module.dispose()
})

test('初始变量尚未保存时重发 CHAT_CHANGED，让卡脚本重跑聊天级初始化且重发有界', async () => {
  const h = execution(), input = view()
  h.module.sync('A', input)
  await h.settle()
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 1, 'readiness announces the chat once')

  h.runtimes[0].options.onMvuLoadState({ phase: 'evaluating' })
  for (const [index, delay] of [1500, 4000, 9000].entries()) {
    runAnnouncement(h, delay)
    await h.settle()
    const emitted = h.runtimes[0].emissions.slice(-2)
    assert.equal(emitted.length, 2, `retry ${index + 1} announces twice`)
    assert.deepEqual(copy(emitted[0][1]), [''], 'the forced retry first announces an identity MVU cannot adopt')
    assert.deepEqual(copy(emitted[1][1]), ['tavern-chat'], 'the forced retry then announces the Tavern chat')
    assert.equal(h.runtimes[0].emissions.length, index * 2 + 3, `retry ${index + 1} re-initializes the chat once`)
  }
  assert.equal(announcementTimers(h).length, 0, 'retries stop after the bounded schedule')
  h.module.dispose()
})

test('初始变量保存后不再重发 CHAT_CHANGED', async () => {
  const h = execution(), input = view()
  h.module.sync('A', input)
  await h.settle()
  await h.runtimes[0].options.onReady('A')
  h.runtimes[0].options.onMvuLoadState({ phase: 'evaluating' })
  assert.equal(announcementTimers(h).length, 1, 'a missing initial variable schedules one retry')
  h.runtimes[0].options.onMvuLoadState({ phase: 'ready' })
  assert.equal(announcementTimers(h).length, 0, 'saved initial variables cancel the pending retry')
  h.runtimes[0].options.onMvuLoadState({ phase: 'evaluating' })
  h.module.dispose()
  assert.equal(announcementTimers(h).length, 0, 'disposal cancels the retry')
})

test('A -> B -> A rejects late claims/readiness and uses distinct leases', async () => {
  const h = execution(), late = deferred()
  let firstClaim = true
  h.respond(method => {
    if (method !== 'claimTavernScriptWork') return Promise.resolve({})
    if (firstClaim) { firstClaim = false; return late.promise }
    return Promise.resolve({ active: true })
  })
  h.module.sync('A', view())
  await tick()
  h.module.sync('B', view())
  h.module.sync('A', view(3))
  const last = h.runtimes.at(-1)
  await h.runtimes[0].options.onReady('A')
  late.resolve({ active: true, event: { id: 'old-event', name: 'OLD', args: [] } })
  await h.settle()
  assert.equal(last.emissions.length, 0)
  assert.equal(h.module.inspect().active, true)
  assert.ok(h.calls.some(call => call.method === 'releaseTavernHelperRuntime' && call.args.runtimeId === h.calls[0].args.runtimeId), 'late claim cannot retain the old server lease')
  h.module.sync('A', view(4))
  h.wake()
  await h.settle()
  assert.equal(last.syncs.at(-1).view.tavernHelper.stateRevision, 4)
  const claims = h.calls.filter(x => x.method === 'claimTavernScriptWork')
  assert.notEqual(claims[0].args.runtimeId, claims.at(-1).args.runtimeId)
  assert.equal(h.calls.some(x => x.method === 'completeTavernHelperEvent'), false)
  h.module.dispose()
})

test('event completion stays in its lease; disposal during execution does not acknowledge into another lifetime', async () => {
  const h = execution(), running = deferred()
  let delivered = false
  h.respond(method => {
    if (method !== 'claimTavernScriptWork') return Promise.resolve({})
    if (delivered) return Promise.resolve({ active: true })
    delivered = true
    return Promise.resolve({ active: true, event: { id: 'E', name: 'UPDATE', args: [1] } })
  })
  h.module.sync('A', view())
  h.runtimes[0].emit = () => running.promise
  await tick()
  h.module.dispose()
  h.module.sync('A', view())
  running.resolve([2])
  await h.settle()
  assert.equal(h.calls.some(x => x.method === 'completeTavernHelperEvent'), false)
  h.module.dispose()
  assert.equal(h.timers.size, 0)
})

test('服务重启遗留的悬挂 claim 超时后由重放 signal 向新服务登记', async () => {
  const h = execution({ pollRequestTimeoutMs: 100 })
  const stale = deferred()
  let restarted = false
  h.respond(method => {
    if (method !== 'claimTavernScriptWork') return Promise.resolve({})
    return restarted ? Promise.resolve({ active: true }) : stale.promise
  })
  h.module.sync('A', view())
  await tick()

  restarted = true
  assert.equal(h.timers.size, 1, '悬挂 claim 必须有独立超时保护')
  await h.runTimer()
  await h.settle()
  h.wake()
  await h.settle()

  assert.equal(h.calls.filter(call => call.method === 'claimTavernScriptWork').length, 2)
  assert.equal(h.module.inspect().active, true)
  stale.resolve({ active: true })
  h.module.dispose()
})

test('claim 响应丢失后自动重试同一 offer，脚本只执行一次', async () => {
  const h = execution({ pollRequestTimeoutMs: 100 })
  const lost = deferred()
  const offer = { active: true, ready: true, leaseToken: 'offer-1', event: { id: 'work-1', name: 'UPDATE', args: [1], context: context() } }
  let claims = 0
  h.respond((method, args) => {
    if (method === 'claimTavernScriptWork') return ++claims === 1 ? lost.promise : Promise.resolve(offer)
    if (method === 'startTavernScriptWork') return Promise.resolve({ started: args.eventId === 'work-1' && args.leaseToken === 'offer-1' })
    return Promise.resolve({})
  })
  h.module.sync('A', view())
  await tick()

  await h.runTimer()
  await h.settle()
  await h.runTimer()
  await h.settle()

  assert.equal(claims, 2)
  assert.equal(h.runtimes[0].emissions.length, 1)
  const completed = h.calls.find(call => call.method === 'completeTavernHelperEvent')
  assert.equal(completed.args.eventId, 'work-1')
  assert.equal(completed.args.leaseToken, 'offer-1')
  lost.resolve(offer)
  h.module.dispose()
})

test('claimed host event identity reaches the shared script runtime unchanged', async () => {
  const h = execution()
  const offer = { active: true, ready: true, leaseToken: 'offer-1', event: { id: 'operation-1:attempt-1', name: 'MESSAGE_RECEIVED', args: [0], context: context() } }
  h.respond(method => Promise.resolve(method === 'claimTavernScriptWork' ? offer : {}))

  h.module.sync('A', view())
  await h.settle()

  assert.equal(h.runtimes[0].emissions.length, 1)
  assert.equal(h.runtimes[0].emissions[0][4], offer.event.id)
  h.module.dispose()
})

test('script failure is acknowledged with diagnostics; the next signal can execute another event', async () => {
  const h = execution()
  let eventId = 0
  h.respond(method => Promise.resolve(method === 'claimTavernScriptWork' ? { active: true, event: { id: 'E' + ++eventId, name: 'UPDATE', args: [1], context: context() } } : {}))
  h.module.sync('A', view())
  h.runtimes[0].emit = async (_name, _args, _context, diagnostics) => { diagnostics.push({ stage: 'script' }); throw Error('fixture failure') }
  await h.settle()
  assert.match(h.calls.at(-1).args.error, /fixture failure/)
  assert.deepEqual(h.calls.at(-1).args.diagnostics, [{ stage: 'script' }])
  h.runtimes[0].emit = async () => [2]
  h.wake()
  await h.settle()
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

test('runtime reports coalesce and cancel on stop; restart attaches once and read-only capture never mutates variables', async () => {
  const h = frames(), frame = h.attach()
  frame.message('dsh-tavern-frame-height', { height: 90000 })
  assert.equal(h.lifecycle.snapshot().height, 32000)
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

function sandbox(options = {}) {
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
    onMutation(...args) { mutations.push(args) }, reportError(_source, error) { errors.push(error.message) }, resolveError() {}, ...options
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

test('shared script mutation keeps the claimed host event identity', async () => {
  const h = sandbox()
  h.runtime.sync('A', view())
  const frame = h.ready()
  const hostEventId = 'operation-1:attempt-1'
  const emission = h.runtime.emit('UPDATE', [1], context(), [], hostEventId)
  const dispatched = frame.contentWindow.messages.find(message => message.type === 'dsh-tavern-helper-event')

  assert.equal(dispatched.eventId, hostEventId)
  h.message(frame, 'dsh-tavern-helper-call', {
    requestId: 'mutation-1', eventId: dispatched.eventId,
    method: 'updateTavernHelperVariables', args: { option: { type: 'message', message_id: 0 }, variables: { hp: 2 } }
  })
  await tick()
  assert.equal(h.calls.at(-1).args.eventId, hostEventId)

  h.message(frame, 'dsh-tavern-helper-event-complete', { eventId: dispatched.eventId, args: [1] })
  await emission
  h.runtime.dispose()
})

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

test('MVU 导入失败不宣布就绪，也不把未订阅的事件静默当作成功；重建后可恢复', async () => {
  let announcements = 0
  const h = sandbox({ onReady() { announcements++ } })
  const input = mvuView()
  h.runtime.sync('A', input)
  const frame = h.frames[0]; frame.load()
  const message = 'Failed to fetch dynamically imported module: http://127.0.0.1:43120/bundle.js'
  h.message(frame, 'dsh-tavern-helper-script-runtime', { scriptId: '__dsh_official_mvu__', message })
  h.message(frame, 'dsh-tavern-helper-subscriptions', { ready: true, names: [], scripts: [
    { id: '__dsh_official_mvu__', ready: false, failed: true }, { id: 'script', ready: true, failed: false }
  ] })
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), false)
  assert.match(h.runtime.inspect().initializationError, /Failed to fetch/)
  assert.equal(announcements, 0)
  const diagnostics = []
  await assert.rejects(h.runtime.emit('MESSAGE_RECEIVED', [0], context(), diagnostics), /MVU.*加载失败/)
  assert.equal(diagnostics[0].initializationFailed, true)
  assert.equal(frame.contentWindow.messages.some(x => x.type === 'dsh-tavern-helper-event'), false)
  assert.equal(h.timers.size, 0)
  h.runtime.sync('B', input)
  const recovered = h.frames.at(-1); recovered.load()
  h.message(recovered, 'dsh-tavern-helper-subscriptions', { ready: true, names: ['MESSAGE_RECEIVED'], scripts: [
    { id: '__dsh_official_mvu__', ready: true, failed: false }, { id: 'script', ready: true, failed: false }
  ] })
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), true)
  assert.equal(h.runtime.inspect().initializationError, undefined)
  assert.equal(announcements, 1)
  h.runtime.dispose()
})

test('下载等待暂停初始化超时，同一沙箱可手动恢复且拒绝重复、伪造和旧窗口重试', () => {
  const states = [], h = sandbox({ onMvuLoadState: state => states.push(copy(state)) })
  const input = mvuView()
  h.runtime.sync('A', input)
  const frame = h.frames[0]; frame.load()
  const report = state => h.message(frame, 'dsh-tavern-mvu-load-state', { state })
  assert.equal(h.timers.size, 1)
  report({ phase: 'loading', attempt: 1 })
  assert.equal(h.timers.size, 0)
  frame.load()
  assert.equal(h.timers.size, 0, '迟到 load 事件不能恢复下载阶段的初始化超时')
  const token = frame.contentWindow.messages[0].token
  h.deliver(frame, { token, type: 'dsh-tavern-mvu-load-state', state: { phase: 'failed' } }, {})
  assert.equal(h.runtime.retryMvuLoad(), false)
  report({ phase: 'failed', error: 'HTTP 503', attempt: 3 })
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), false)
  assert.equal(h.runtime.inspect().initializationError, undefined, '可恢复下载失败保持 pending，不终止已保存结算')
  assert.equal(h.runtime.retryMvuLoad(), true)
  assert.equal(h.runtime.retryMvuLoad(), false)
  assert.equal(frame.contentWindow.messages.filter(m => m.type === 'dsh-tavern-mvu-reload').length, 1)
  assert.equal(h.frames.length, 1)
  report({ phase: 'evaluating' })
  assert.equal(h.timers.size, 1)
  report({ phase: 'failed' })
  assert.equal(h.runtime.retryMvuLoad(), false, '执行后不能退回可重试状态')
  h.message(frame, 'dsh-tavern-helper-subscriptions', { ready: true, names: [], scripts: [
    { id: '__dsh_official_mvu__', ready: true }, { id: 'script', ready: true }
  ] })
  assert.equal(h.timers.size, 0)
  assert.equal(states.at(-1).phase, 'ready')
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), true)
  h.runtime.sync('B', input)
  report({ phase: 'failed' })
  assert.equal(h.runtime.retryMvuLoad(), false)
  h.runtime.dispose()
  assert.equal(states.at(-1), null)
})

test('MVU subscriptions cannot advertise settlement readiness until initialized variables are saved; late persistence recovers without replay', async () => {
  let now = 0
  const states = [], h = sandbox({ now: () => now, onMvuLoadState: state => states.push(copy(state)) })
  const input = mvuView()
  input.tavernHelper.messages[0].variables = {}
  h.runtime.sync('A', input)
  const frame = h.frames[0]; frame.load()
  h.message(frame, 'dsh-tavern-helper-subscriptions', { ready: true, names: ['MESSAGE_RECEIVED'], scripts: [
    { id: '__dsh_official_mvu__', ready: true }, { id: 'script', ready: true }
  ] })
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), false)
  assert.equal(states.at(-1).phase, 'evaluating')
  assert.equal(h.runtime.inspect().initializationError, undefined)
  const saved = mvuView().tavernHelper
  saved.chatId = input.chatId
  h.respond(async () => ({ updated: false, stale: true, context: saved }))
  h.message(frame, 'dsh-tavern-helper-call', { requestId: 'stale', method: 'updateTavernHelperMessages' })
  await tick()
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), false, 'rejected writes cannot satisfy initialization')
  now += 15000
  h.runTimer()
  assert.match(h.runtime.inspect().initializationError, /初始变量.*保存/)
  assert.equal(states.at(-1).phase, 'error')
  assert.equal(h.runtime.retryMvuLoad(), false, 'never rerun partially executed initialization')
  h.respond(async () => ({ updated: true, context: saved }))
  h.message(frame, 'dsh-tavern-helper-call', { requestId: 'saved', method: 'updateTavernHelperMessages' })
  await tick()
  assert.equal(h.client.tavernScriptRuntimeReady(h.runtime.inspect()), true)
  assert.equal(h.runtime.inspect().initializationError, undefined)
  assert.equal(states.at(-1).phase, 'ready')
  assert.equal(h.frames.length, 1)
  h.runtime.dispose()
  assert.equal(h.timers.size, 0)
})

test('执行租约 claim 将 MVU 加载失败与未就绪分开报告', async () => {
  const h = execution()
  h.module.sync('A', view())
  h.runtimes[0].inspect = () => ({ initializationError: 'MVU 加载失败：bundle.js', scripts: [
    { id: '__dsh_official_mvu__', subscriptionsReady: false, initializationFailed: true }
  ] })
  h.wake()
  await h.settle()
  const claim = h.calls.filter(x => x.method === 'claimTavernScriptWork').at(-1)
  assert.equal(claim.args.ready, false)
  assert.equal(claim.args.initializationError, 'MVU 加载失败：bundle.js')
  h.module.dispose()
})

test('second browser keeps companion UI scripts while only the lease owner initializes and settles', async () => {
  const h = execution()
  let owns = false
  h.respond(() => Promise.resolve({ active: owns }))
  h.module.sync('A', mvuView())
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelperScripts.length, 0, 'wait for the first ownership response')
  await h.settle()
  assert.equal(h.module.inspect().active, false)
  const viewer = h.runtimes[0].syncs.at(-1).view
  assert.equal(viewer.tavernHelperScripts.length, 1, 'companion scripts mount local panels')
  assert.equal(viewer.tavernScriptRuntimeMode, 'viewer')
  assert.equal(viewer.tavernMvuRuntime, null, 'viewer cannot initialize a second MVU core')
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 0, 'viewer must not receive CHAT_CHANGED initialization')
  assert.equal(await h.module.triggerButton('script', 'button'), 'clicked', 'explicit UI actions remain usable')
  h.module.sync('A', view(2))
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernHelper.stateRevision, 2)
  await h.settle()
  assert.equal(h.calls.filter(call => call.method === 'claimTavernScriptWork').at(-1).args.ready, false, 'viewer readiness cannot claim settlement before executor promotion')
  owns = true
  h.wake(); await h.settle()
  assert.equal(h.module.inspect().active, true)
  assert.notEqual(h.runtimes[0].syncs.at(-1).view.tavernScriptRuntimeMode, 'viewer')
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 1)
  owns = false
  h.wake(); await h.settle()
  assert.equal(h.runtimes[0].syncs.at(-1).view.tavernScriptRuntimeMode, 'viewer')
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 1)
  h.module.dispose()
})

for (const fail of [false, true]) test(`事件收尾等待已接收的排队写入，保存${fail ? '失败不能报成功' : '成功不误判迟到'}`, async () => {
  const h = sandbox(), blocked = deferred()
  h.runtime.sync('A', view())
  const frame = h.ready()
  h.respond((method) => method === 'getTavernHelperWorldbook' ? blocked.promise : fail ? Promise.reject(new Error('保存失败')) : Promise.resolve({ updated: true }))
  h.message(frame, 'dsh-tavern-helper-call', { requestId: 'read', method: 'getTavernHelperWorldbook', args: {} })
  await tick()
  const event = h.runtime.emit('UPDATE', [1], context(), [], 'queued-event')
  let result
  const done = event.then(() => { result = 'success' }, error => { result = error.message })
  h.message(frame, 'dsh-tavern-helper-call', { eventId: 'queued-event', scriptId: 'script', requestId: 'write', method: 'updateTavernHelperPrompts', args: { operation: { kind: 'remove', ids: ['phone'] } } })
  h.message(frame, 'dsh-tavern-helper-event-complete', { eventId: 'queued-event', args: [1] })
  await tick()
  assert.equal(result, undefined, '宿主不能在已接收写入还排队时宣布事件完成')
  h.message(frame, 'dsh-tavern-helper-call', { eventId: 'queued-event', requestId: 'late', method: 'updateTavernHelperPrompts', args: {} })
  assert.match(frame.contentWindow.messages.find(x => x.requestId === 'late').error, /迟到写入/)
  blocked.resolve({})
  await done
  assert.equal(h.calls.filter(x => x.method === 'updateTavernHelperPrompts').length, 1)
  assert.equal(result, fail ? '保存失败' : 'success')
  h.runtime.dispose()
})

for (const accepted of [false, true]) test(`完成回执丢失后${accepted ? '查询已完成' : '重发原回执'}，不重跑或改报失败`, async t => {
  const h = execution()
  t.after(() => h.module.dispose())
  let claims = 0, receipts = 0
  h.respond(method => {
    if (method === 'claimTavernScriptWork') return { active: true, ...(claims++ === 0 ? { event: { id: 'work', name: 'MESSAGE_RECEIVED', args: [1] }, leaseToken: 'lease' } : {}) }
    if (method === 'completeTavernHelperEvent') return ++receipts === 1 ? new Promise(() => {}) : { completed: true }
    if (method === 'getTavernScriptWorkState') return { phase: accepted ? 'completed' : 'executing' }
    return { started: true }
  })
  h.module.sync('A', view()); await h.settle()
  assert.equal(h.runtimes[0].emissions.length, 1)
  for (let i = 0; i < 4 && h.timers.size; i++) { h.runTimer(); await h.settle() }
  h.wake(); await h.settle()
  assert.ok(claims >= 2)
  assert.equal(receipts, accepted ? 1 : 2)
  assert.equal(h.runtimes[0].emissions.length, 1)
  assert.ok(h.calls.filter(x => x.method === 'completeTavernHelperEvent').every(x => !x.args.error))
})

for (const completes of [false, true]) test(`写入拒绝的错误码到达脚本并保留至事件${completes ? '失败回执' : '超时'}`, async () => {
  let now = 0
  const h = sandbox({ now: () => now, eventTimeoutMs: 10 })
  h.runtime.sync('A', view())
  const frame = h.ready(), diagnostics = []
  h.respond(() => Promise.reject(Object.assign(new Error('脚本写入不属于当前 MVU 结算事件'), { code: 'MVU_SETTLEMENT_EVENT_MISMATCH' })))
  const event = h.runtime.emit('UPDATE', [1], context(), diagnostics, 'rejected-event')
  let failure
  const done = event.catch(error => { failure = error })
  h.message(frame, 'dsh-tavern-helper-call', { eventId: 'rejected-event', scriptId: 'script', requestId: 'write', method: 'updateTavernHelperVariables', args: {} })
  await tick()
  const reply = frame.contentWindow.messages.find(x => x.requestId === 'write')
  if (completes) h.message(frame, 'dsh-tavern-helper-event-complete', { eventId: 'rejected-event', scriptId: 'script', error: reply.error, errorCode: reply.errorCode })
  else {
    now = 20
    for (const timer of [...h.timers.values()]) if (timer.delay < 10) timer.run()
  }
  await done
  h.runtime.dispose()
  assert.equal(reply.errorCode, 'MVU_SETTLEMENT_EVENT_MISMATCH')
  assert.match(failure.message, /不属于当前 MVU 结算事件/)
  assert.equal(completes ? failure.code : failure.cause?.code, 'MVU_SETTLEMENT_EVENT_MISMATCH')
  if (!completes) assert.equal(diagnostics.at(-1).causeCode, 'MVU_SETTLEMENT_EVENT_MISMATCH')
})

test('start 已接收但响应丢失时重试同一 start，不先执行脚本或报告失败', async t => {
  const h = execution()
  t.after(() => h.module.dispose())
  let starts = 0, claims = 0
  h.respond(method => {
    if (method === 'claimTavernScriptWork') return { active: true, ...(claims++ === 0 ? { event: { id: 'start-lost', name: 'UPDATE', args: [1] }, leaseToken: 'token' } : {}) }
    if (method === 'startTavernScriptWork') return ++starts === 1 ? new Promise(() => {}) : { started: true, alreadyStarted: true }
    return { completed: true }
  })
  h.module.sync('A', view()); await h.settle()
  assert.equal(h.runtimes[0].emissions.length, 0)
  for (let i = 0; i < 4 && h.timers.size; i++) { h.runTimer(); await h.settle() }
  assert.equal(starts, 2)
  assert.equal(h.runtimes[0].emissions.length, 1)
  assert.equal(h.calls.filter(x => x.method === 'completeTavernHelperEvent').length, 1)
  assert.ok(h.calls.filter(x => x.method === 'completeTavernHelperEvent').every(x => !x.args.error))
})

test('脚本尚未完成时独立查询并续租，不重复 emit；宿主取消后销毁旧沙箱', async t => {
  const h = execution(), slow = deferred()
  t.after(() => h.module.dispose())
  let cancelled = false, claims = 0
  h.respond(method => {
    if (method === 'claimTavernScriptWork') return { active: true, ...(claims++ === 0 ? { event: { id: 'slow', name: 'UPDATE', args: [1] }, leaseToken: 'lease' } : {}) }
    if (method === 'getTavernScriptWorkState') return { phase: cancelled ? 'unknown' : 'executing' }
    return { started: true }
  })
  h.module.sync('A', view())
  const runtime = h.runtimes[0]
  runtime.eventResponsive = () => true
  runtime.emit = (...args) => { runtime.emissions.push(args); return slow.promise }
  await h.settle()
  for (let i = 0; i < 10; i++) { h.runTimer(); await h.settle() }
  const probes = h.calls.filter(x => x.method === 'getTavernScriptWorkState')
  assert.ok(probes.length >= 10)
  assert.ok(probes.every(x => x.args.keepAlive === true))
  assert.equal(runtime.emissions.length, 1)
  cancelled = true
  h.wake(); await h.settle()
  assert.equal(runtime.disposed, 1)
  slow.resolve([2]); await h.settle()
  assert.equal(h.calls.filter(x => x.method === 'completeTavernHelperEvent').length, 0)
})

test('真实父页和 Helper 沙箱互联：首个事件及完成回执都丢失时仍只执行一次', async () => {
  let now = 0, droppedEvent = false, droppedReceipt = false, executions = 0
  const h = sandbox({ now: () => now, eventTimeoutMs: 30 })
  h.runtime.sync('A', view())
  const frame = h.ready()
  const helper = helperHostHarness(context(), { onCall(message) {
    if (message.type === 'dsh-tavern-helper-event-complete' && !droppedReceipt) { droppedReceipt = true; return }
    queueMicrotask(() => h.message(frame, message.type, { ...message, token: frame.contentWindow.messages[0].token }))
  } })
  helper.window.eventOn('UPDATE', () => { executions++ })
  frame.contentWindow.postMessage = message => {
    frame.contentWindow.messages.push(copy(message))
    if (message.type === 'dsh-tavern-helper-event' && !droppedEvent) { droppedEvent = true; return }
    queueMicrotask(() => helper.receive({ ...message, token: 'host-test' }))
  }
  const pending = h.runtime.emit('UPDATE', [1], context(), [], 'wire-fault')
  await tick()
  for (let i = 0; i < 3 && h.timers.size; i++) { now += 10; h.runTimer(); await tick() }
  assert.deepEqual(copy(await pending), [1])
  assert.equal(droppedEvent, true)
  assert.equal(droppedReceipt, true)
  assert.equal(executions, 1)
  assert.equal(h.errors.length, 0)
  h.runtime.dispose()
})
