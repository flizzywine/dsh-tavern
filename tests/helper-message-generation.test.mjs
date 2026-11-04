import assert from 'node:assert/strict'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { helperClient as client } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(t) {
  let nextTimer = 0
  const timers = new Map(), listeners = new Set(), submissions = [], mounted = []
  const host = {
    document: null, sessionStorage: { getItem() { return null }, setItem() {} },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    addEventListener(name, listener) { if (name === 'message') listeners.add(listener) },
    removeEventListener(name, listener) { if (name === 'message') listeners.delete(listener) },
  }
  const ctx = {
    sessions: { scope: () => ({}), binding: () => ({ session: { prompt: async content => {
      submissions.push(content); return { ok: true }
    } } }) },
    get: () => ({ input: { for: () => ({ setDraft() {}, submit() { submissions.push('draft') } }) } }),
  }
  const execute = client.createTavernFrameSlashExecutor(ctx, host)
  function mount(turn = 2) {
    const props = { sessionId: 'game', content: '<div>floor</div>', turn, helperContext: { messages: [] } }
    const lifecycle = client.createTavernMessageFrameLifecycle(props, { window: host, async rpc() { return {} } })
    const document = lifecycle.snapshot().visibleDocument, received = []
    const source = { postMessage(data) { received.push(data) } }
    document.ref({ contentWindow: source })
    const stop = lifecycle.start(() => {})
    const dispatch = (data, sender = source) => {
      for (const listener of listeners) listener({ source: sender, data: { token: document.token, ...data } })
    }
    const entry = { props, lifecycle, document, source, received, stop, dispatch,
      hook: active => dispatch({ type: 'dsh-tavern-frame-before-generate-hook', active }),
      request: () => received.find(message => message.type === 'dsh-tavern-frame-before-generate'),
    }
    mounted.push(entry)
    return entry
  }
  t.after(() => {
    for (const floor of mounted) floor.stop()
    assert.equal(timers.size, 0, 'all controlled timers are released')
  })
  return { mount, host, execute, submissions, timers,
    expireFlush() {
      const entries = [...timers].filter(([, timer]) => timer.delay === 15000)
      assert.equal(entries.length, 1, 'one host flush deadline')
      for (const [id, timer] of entries) { timers.delete(id); timer.fn() }
    },
  }
}

test('host flush timeout rejects and never submits a generation', async t => {
  const h = harness(t), floor = h.mount()
  floor.hook(true)
  const sending = h.execute('/trigger await=false', 'game')
  const rejected = assert.rejects(sending, /提示词超时/)
  await tick()
  assert.ok(floor.request())
  assert.equal(h.submissions.length, 0)
  h.expireFlush()
  await rejected
  assert.equal(h.submissions.length, 0)
})

for (const action of ['retirement', 'session switch']) test(action + ' rejects an outstanding host flush without sending', async t => {
  const h = harness(t), floor = h.mount()
  floor.hook(true)
  const sending = h.execute('/trigger await=false', 'game')
  const rejected = assert.rejects(sending, /页面已更换|会话已变化/)
  await tick()
  assert.ok(floor.request())
  if (action === 'retirement') floor.document.ref(null)
  else floor.lifecycle.update({ ...floor.props, sessionId: 'other-game' })
  await rejected
  assert.equal(h.submissions.length, 0)
})

test('only the originating frame and request can acknowledge a host flush', async t => {
  const h = harness(t), old = h.mount(1), current = h.mount(2)
  old.hook(true); current.hook(true)
  let finished = false
  const sending = h.execute('/trigger await=false', 'game').then(() => { finished = true })
  await tick()
  const request = current.request()
  assert.ok(request)
  assert.equal(old.request(), undefined)
  const ack = { type: 'dsh-tavern-frame-before-generate-done', requestId: request.requestId, ok: true }
  old.dispatch(ack) // Valid old token/window, but not the document being flushed.
  current.dispatch(ack, old.source) // Correct token, wrong window.
  current.dispatch({ ...ack, requestId: 'unrelated-request' })
  await tick()
  assert.equal(finished, false)
  assert.equal(h.submissions.length, 0)
  current.dispatch(ack)
  await sending
  assert.equal(h.submissions.length, 1)
})

test('removing a registered hook excludes that frame from the generation barrier', async t => {
  const h = harness(t), floor = h.mount()
  floor.hook(true)
  floor.hook(false)
  await h.execute('/trigger await=false', 'game')
  assert.equal(floor.request(), undefined)
  assert.equal(h.submissions.length, 1)
})

function serializedBridge(host, token) {
  const html = client.buildTavernFrameDocument({ content: '<div>floor</div>', token, helperContext: { messages: [] }, turn: 2 })
  const helper = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const interactive = html.match(/<script data-dsh-tavern-interactive-helper>([\s\S]*?)<\/script>/)[1]
  const sent = [], listeners = []
  const parent = { postMessage(message) { sent.push(structuredClone(message)) } }
  const scope = { structuredClone, parent, console, setTimeout: host.setTimeout, clearTimeout: host.clearTimeout,
    addEventListener(name, listener) { if (name === 'message') listeners.push(listener) } }
  scope.window = scope
  vm.createContext(scope)
  vm.runInContext(helper.replace(/var ready=Promise\.all\([\s\S]*?\);/, 'var ready=Promise.resolve(true);'), scope)
  vm.runInContext(interactive, scope)
  return { window: scope, sent, receive(data) {
    for (const listener of listeners) listener({ source: parent, data: { token, ...data } })
  } }
}

test('serialized bridge reports hook removal and a failed injection as a failed flush acknowledgement', async t => {
  const h = harness(t), bridge = serializedBridge(h.host, 'bridge-failure')
  const name = bridge.window.tavern_events.GENERATION_AFTER_COMMANDS
  const listener = () => bridge.window.injectPrompts([{ id: 'scene', content: 'rain' }], { once: true })
  bridge.window.eventOn(name, listener)
  assert.equal(bridge.sent.at(-1).active, true)
  bridge.window.eventRemoveListener(name, listener)
  assert.equal(bridge.sent.at(-1).active, false)
  bridge.window.eventOn(name, listener)
  bridge.receive({ type: 'dsh-tavern-frame-before-generate', requestId: 'flush-1' })
  await tick()
  const write = bridge.sent.find(message => message.method === 'updateTavernHelperPrompts')
  assert.ok(write)
  assert.equal(bridge.sent.some(message => message.type === 'dsh-tavern-frame-before-generate-done'), false)
  bridge.receive({ type: 'dsh-tavern-helper-response', requestId: write.requestId, ok: false, error: 'write failed' })
  await tick()
  const ack = bridge.sent.find(message => message.type === 'dsh-tavern-frame-before-generate-done')
  assert.equal(ack.requestId, 'flush-1')
  assert.equal(ack.ok, false)
  assert.match(ack.error, /write failed/)
})

test('a negative frame acknowledgement reaches the host caller without submitting', async t => {
  const h = harness(t), floor = h.mount()
  floor.hook(true)
  const sending = h.execute('/trigger await=false', 'game')
  const rejected = assert.rejects(sending, /write failed/)
  await tick()
  floor.dispatch({ type: 'dsh-tavern-frame-before-generate-done', requestId: floor.request().requestId, ok: false, error: 'write failed' })
  await rejected
  assert.equal(h.submissions.length, 0)
})

test('direct injection without an event hook is persisted before the iframe sends trigger', async t => {
  const h = harness(t), bridge = serializedBridge(h.host, 'direct-injection')
  bridge.window.injectPrompts([{ id: 'scene', content: 'rain' }], { once: true })
  const sending = bridge.window.triggerSlash('/trigger await=false')
  await tick()
  const write = bridge.sent.find(message => message.method === 'updateTavernHelperPrompts')
  assert.ok(write)
  assert.equal(bridge.sent.some(message => message.method === 'triggerTavernSlash'), false)
  bridge.receive({ type: 'dsh-tavern-helper-response', requestId: write.requestId, ok: true, result: { updated: true } })
  await tick()
  const trigger = bridge.sent.find(message => message.method === 'triggerTavernSlash')
  assert.ok(trigger)
  bridge.receive({ type: 'dsh-tavern-helper-response', requestId: trigger.requestId, ok: true, result: { submitted: true } })
  assert.equal((await sending).submitted, true)
})
