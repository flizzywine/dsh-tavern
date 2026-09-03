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

test('DSH 字号同步到已就绪 iframe，不替换文档；离开后停止监听', () => {
  const h = host(), sent = []
  let size = '14px', notify, disconnected = false
  h.window.document = { body: {}, documentElement: {} }
  h.window.getComputedStyle = () => ({ getPropertyValue: () => size })
  h.window.MutationObserver = class {
    constructor(callback) { notify = callback }
    observe() {} disconnect() { disconnected = true }
  }
  const life = h.client.createTavernMessageFrameLifecycle({ content: '<p>正文</p>', eager: true }, { window: h.window })
  const stop = life.start(() => {})
  const doc = life.snapshot().visibleDocument
  const node = { contentWindow: { postMessage: value => sent.push(copy(value)) } }
  doc.ref(node)
  h.deliver(node, { type: 'dsh-tavern-frame-ready', token: doc.token }, {})
  assert.equal(sent.length, 0, '外部来源不能触发同步')
  h.deliver(node, { type: 'dsh-tavern-frame-ready', token: doc.token })
  assert.equal(sent.at(-1)?.type, 'dsh-tavern-font-size')
  assert.equal(sent.at(-1)?.fontSize, 14)
  size = '17px'; notify()
  assert.equal(sent.at(-1).fontSize, 17)
  assert.equal(life.snapshot().visibleDocument, doc)
  assert.equal(life.snapshot().pendingDocument, null)
  const count = sent.length; notify()
  assert.equal(sent.length, count, '无关样式变动不重复通知')
  stop()
  assert.equal(disconnected, true)
})

test('正文文档带认证字号通道与原字号恢复逻辑', () => {
  const html = host().client.buildTavernFrameDocument({ content: '<p style="font-size:20px">正文</p>', token: 'font-test' })
  assert.match(html, /data-dsh-tavern-font-runtime/)
  assert.match(html, /dsh-tavern-font-size/)
  assert.match(html, /restoreTavernFrameFontStyles/)
})
function execution(options = {}) {
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
    },
    ...options
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
  assert.deepEqual(copy(h.runtimes[0].emissions[0][1]), ['tavern-chat'], 'MVU transition requires the Tavern chat ID, not the DSH session ID or undefined')
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

test('script readiness without a chat identity never cancels MVU initialization with an undefined transition', async () => {
  const h = execution(), input = view()
  delete input.chatId
  h.module.sync('A', input)
  await h.runTimer()
  await h.runtimes[0].options.onReady('A')
  assert.equal(h.runtimes[0].emissions.length, 0)
  h.module.dispose()
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

test('服务重启遗留的悬挂轮询超时后继续向新服务登记', async () => {
  const h = execution({ pollRequestTimeoutMs: 100 })
  const stale = deferred()
  let restarted = false
  h.respond(method => {
    if (method !== 'pollTavernHelperEvent') return Promise.resolve({})
    return restarted ? Promise.resolve({ active: true }) : stale.promise
  })
  h.module.sync('A', view())
  const stuck = h.runTimer()
  await tick()

  restarted = true
  assert.equal(h.timers.size, 1, '悬挂轮询必须有独立超时保护')
  await h.runTimer()
  await stuck
  assert.equal(h.timers.size, 1, '超时后必须安排下一次轮询')
  await h.runTimer()

  assert.equal(h.calls.filter(call => call.method === 'pollTavernHelperEvent').length, 2)
  assert.equal(h.module.inspect().active, true)
  stale.resolve({ active: true })
  h.module.dispose()
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

test('消息 iframe 生命周期忽略旧触摸转发消息，不再改动宿主滚动位置', () => {
  const h = frames(), visible = h.attach()
  const outer = { parentElement: null, scrollTop: 40, clientHeight: 300, scrollHeight: 900, style: { overflowY: 'auto' } }
  const wrapper = { parentElement: outer, scrollTop: 0, clientHeight: 300, scrollHeight: 300, style: { overflowY: 'visible' } }
  visible.node.parentElement = wrapper
  h.window.getComputedStyle = node => node.style || { overflowY: 'visible' }

  visible.message('dsh-tavern-frame-pan', { deltaY: 36 }, {})
  assert.equal(outer.scrollTop, 40)
  visible.message('dsh-tavern-frame-pan', { deltaY: 36 })
  assert.equal(outer.scrollTop, 40)

  h.update({ content: '<p>replacement</p>' })
  const pending = h.attach(h.lifecycle.snapshot().pendingDocument)
  pending.node.parentElement = wrapper
  pending.message('dsh-tavern-frame-pan', { deltaY: 36 })
  assert.equal(outer.scrollTop, 40)

  visible.message('dsh-tavern-frame-pan', { deltaY: 9999 })
  assert.equal(outer.scrollTop, 40)
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
  assert.equal(h.lifecycle.snapshot().height, 1200)
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
  const states = [], h = sandbox({ onMvuLoadState: state => states.push(copy(state)) })
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

test('MVU initialization timeout is removed with its old sandbox and cannot poison the next chat', () => {
  const h = sandbox(), input = mvuView()
  input.tavernHelper.messages[0].variables = {}
  h.runtime.sync('A', input)
  const frame = h.frames[0]; frame.load()
  h.message(frame, 'dsh-tavern-helper-subscriptions', { ready: true, scripts: [
    { id: '__dsh_official_mvu__', ready: true }, { id: 'script', ready: true }
  ] })
  assert.equal(h.timers.size, 1)
  h.runtime.sync('B', mvuView())
  assert.equal(h.timers.size, 0)
  h.runtime.dispose()
})

test('加载诊断经认证沙箱归属到当前会话，限量且不影响运行状态', async () => {
  const h = sandbox()
  h.window.navigator = { userAgent: 'Mozilla Windows Chrome/128.0.0.0 custom-private-text' }
  h.runtime.sync('A', { ...view(), tavernMvuRuntime: { owner: 'official', assetUrl: '/bundle.js' } })
  const frame = h.frames[0]; frame.load()
  const token = frame.contentWindow.messages[0].token
  const diagnostic = { loadId: 'mvu-load-1', phase: 'download-response', attempt: 1, httpStatus: 200, contentType: 'application/json' }
  h.deliver(frame, { token, type: 'dsh-tavern-mvu-load-diagnostic', diagnostic }, {})
  assert.equal(h.calls.length, 0)
  h.respond(() => Promise.reject(Error('disk unavailable')))
  h.message(frame, 'dsh-tavern-mvu-load-diagnostic', { diagnostic })
  await tick()
  assert.equal(h.calls[0].sessionId, 'A')
  assert.equal(h.calls[0].args.diagnostic.platform, 'Windows')
  assert.equal(h.calls[0].args.diagnostic.browser, 'Chrome/128.0.0.0')
  assert.doesNotMatch(JSON.stringify(h.calls), /custom-private-text/)
  assert.equal(h.runtime.inspect().initializationError, undefined)
  for (let i = 0; i < 100; i++) h.message(frame, 'dsh-tavern-mvu-load-diagnostic', { diagnostic })
  assert.equal(h.calls.length, 80)
  h.runtime.sync('B', view())
  h.message(frame, 'dsh-tavern-mvu-load-diagnostic', { diagnostic })
  assert.equal(h.calls.length, 80)
  h.runtime.dispose()
  await tick()
})

test('执行租约轮询将 MVU 加载失败与未就绪分开报告', async () => {
  const h = execution()
  h.module.sync('A', view())
  h.runtimes[0].inspect = () => ({ initializationError: 'MVU 加载失败：bundle.js', scripts: [
    { id: '__dsh_official_mvu__', subscriptionsReady: false, initializationFailed: true }
  ] })
  await h.runTimer()
  const poll = h.calls.find(x => x.method === 'pollTavernHelperEvent')
  assert.equal(poll.args.ready, false)
  assert.equal(poll.args.initializationError, 'MVU 加载失败：bundle.js')
  h.module.dispose()
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
