import assert from 'node:assert/strict'

import test from 'node:test'
import vm from 'node:vm'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

const assembled = await assembleTavernClient()

const tick = () => new Promise(resolve => setImmediate(resolve))
const copy = value => JSON.parse(JSON.stringify(value))
const context = () => ({ version: 1, chatId: 'chat-A', lifecycleRevision: 2, stateRevision: 3, messages: [] })

function host() {
  const listeners = new Set(), timers = new Map()
  let id = 0, descriptor
  const window = {
    crypto: { randomUUID: () => 'token-' + ++id }, sessionStorage: { getItem() {}, setItem() {} },
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id }, clearTimeout(id) { timers.delete(id) },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn) },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn) },
    __ModuleLoader__: { load(value) { descriptor = value } }
  }
  vm.runInNewContext(assembled, { window, console })
  return { window, client: descriptor.factory(() => ({})), deliver(source, data) { for (const fn of listeners) fn({ source, data }) } }
}
function scriptHost(options = {}) {
  const h = host(), frames = []
  const document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'div') return { isConnected: true, appendChild() {}, remove() {}, style: {} }
    const frame = { contentWindow: { messages: [], postMessage(data) { this.messages.push(copy(data)) } }, style: {},
      addEventListener(type, fn) { if (type === 'load') this.load = fn }, remove() {} }
    frames.push(frame); return frame
  } }
  const runtime = h.client.createTavernHelperScriptRuntime({ window: h.window, document,
    rpc: async () => ({ updated: true }), reportError() {}, resolveError() {}, onMutation() {}, ...options })
  runtime.sync('A', { chatId: 'chat-A', tavernHelper: context(), tavernHelperScripts: [{ id: 'script', name: 'test', content: '' }] })
  const frame = frames.at(-1)
  frame.load()
  const token = frame.contentWindow.messages[0].token
  h.deliver(frame.contentWindow, { token, type: 'dsh-tavern-helper-subscriptions', ready: true, names: ['UPDATE'] })
  return { ...h, runtime, frame, call(method, args = {}, extra = {}) {
    h.deliver(frame.contentWindow, { type: 'dsh-tavern-helper-call', token, requestId: 'request', scriptId: 'script', lifecycleRevision: 2, method, args, ...extra })
  }, response() { return frame.contentWindow.messages.findLast(data => data.type === 'dsh-tavern-helper-response') } }
}

test('script slash rejects background, stale and closed-event calls without executing', async t => {
  const calls = []
  const h = scriptHost({ executeSlash: async (...args) => { calls.push(args); return '' } })
  t.after(() => h.runtime.dispose())
  h.runtime.setForeground(false)
  h.call('triggerTavernSlash', { line: '/pass hi' }); await tick()
  assert.match(h.response().error, /对话已切换/)
  h.runtime.setForeground(true)
  h.call('triggerTavernSlash', { line: '/pass hi' }, { lifecycleRevision: 1 }); await tick()
  assert.match(h.response().error, /版本已变化/)
  const event = h.runtime.emit('UPDATE', [], context(), [], 'closed-event')
  const dispatched = h.frame.contentWindow.messages.findLast(data => data.type === 'dsh-tavern-helper-event')
  h.deliver(h.frame.contentWindow, { type: 'dsh-tavern-helper-event-complete', token: dispatched.token, eventId: dispatched.eventId, args: [] })
  await event
  h.call('triggerTavernSlash', { line: '/pass hi' }, { eventId: 'closed-event' }); await tick()
  assert.equal(h.response().errorCode, 'TAVERN_SCRIPT_EVENT_CLOSED')
  assert.deepEqual(calls, [])
})

test('queued Helper generation can be cancelled before earlier writes finish', async t => {
  let finishWrite
  const calls = []
  const h = scriptHost({rpc: async (method, args) => {
    calls.push([method, args])
    if (method === 'updateTavernHelperMessages') return await new Promise(resolve => {finishWrite = resolve})
    if (method === 'stopTavernHelperGeneration') return {stopped: false}
    if (method.startsWith('generate')) assert.fail('cancelled queued generation must never reach the model')
    return {}
  }})
  t.after(() => h.runtime.dispose())
  h.call('updateTavernHelperMessages', {messages: []}, {requestId: 'write'}); await tick()
  h.call('generateTavernHelper', {config: {generation_id: 'g'}}, {requestId: 'gen'})
  h.call('stopTavernHelperGeneration', {generationId: 'g'}, {requestId: 'stop'}); await tick()
  const stopped = h.frame.contentWindow.messages.find(row => row.requestId === 'stop')
  assert.equal(stopped.result.stopped, true)
  assert.deepEqual(calls.map(row => row[0]), ['updateTavernHelperMessages', 'stopTavernHelperGeneration'])
  const generated = h.frame.contentWindow.messages.find(row => row.requestId === 'gen')
  assert.equal(generated.ok, false)
  assert.match(generated.error, /取消/)
  // Cancellation settles even if this preceding write would never finish.
  finishWrite({updated: false}); await tick(); await tick()
  assert.equal(calls.some(row => row[0].startsWith('generate')), false)
})

test('active model jobs do not block state writes or immediate cancellation', async t => {
  let rejectGeneration
  const calls = []
  const h = scriptHost({rpc: async (method, args) => {
    calls.push([method, args])
    if (method === 'generateTavernHelperRaw') return await new Promise((_resolve, reject) => {rejectGeneration = reject})
    if (method === 'stopTavernHelperGeneration') {rejectGeneration(new Error('model cancelled')); return {stopped: true}}
    return {updated: false}
  }})
  t.after(() => h.runtime.dispose())
  h.call('generateTavernHelperRaw', {config: {generation_id: 'g'}}, {requestId: 'gen'}); await tick()
  h.call('updateTavernHelperMessages', {messages: []}, {requestId: 'write'}); await tick()
  assert.equal(calls[1][0], 'updateTavernHelperMessages')
  h.call('stopTavernHelperGeneration', {generationId: 'g'}, {requestId: 'stop'}); await tick(); await tick()
  assert.equal(h.frame.contentWindow.messages.find(row => row.requestId === 'stop').result.stopped, true)
  assert.match(h.frame.contentWindow.messages.find(row => row.requestId === 'gen').error, /取消/)
})

for (const opening of [false, true]) test('retiring message documents cancels only their owned generation: opening=' + opening, async () => {
  const h = host(), calls = [], pending = new Map()
  const initial = {sessionId: opening ? undefined : 'A', openingPreview: opening ? {preparationId: 'preview'} : undefined,
    helperContext: context(), content: '<p>body</p>', turn: 1, eager: true}
  const lifecycle = h.client.createTavernMessageFrameLifecycle(initial, {window: h.window, rpc: async (method, args, sessionId) => {
    calls.push({method, args:copy(args), sessionId})
    const actual = method === 'callOpeningRuntime' ? args.method : method, payload = method === 'callOpeningRuntime' ? args.args : args
    if (actual === 'generateTavernHelper') return await new Promise((_resolve, reject) => pending.set(payload.config.generation_id, reject))
    if (actual === 'stopTavernHelperGeneration') {pending.get(payload.generationId)?.(new Error('cancelled')); return {stopped: true}}
    return {}
  }})
  const stop = lifecycle.start(() => {}), document = lifecycle.snapshot().visibleDocument
  const frame = {contentWindow: {postMessage() {}}}
  document.ref(frame)
  h.deliver(frame.contentWindow, {token: document.token, type: 'dsh-tavern-helper-call', requestId: 'g', method: 'generateTavernHelper', args: {config: {generation_id: 'g'}, generationToken:'request-token'}})
  await tick()
  document.ref(null); await tick(); await tick()
  const cancelled = calls.find(row => (row.method === 'callOpeningRuntime' ? row.args.method : row.method) === 'stopTavernHelperGeneration')
  assert.ok(cancelled)
  const payload = opening ? cancelled.args.args : cancelled.args
  assert.deepEqual(payload, {generationId:'g', generationToken:'request-token', pending:true})
  if (opening) assert.equal(cancelled.args.id, 'preview')
  else assert.equal(cancelled.sessionId, 'A')
  stop()
})
