import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
function gate() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture() {
  let now = 1000, descriptor, draft = '', running = false, submit = () => undefined
  const calls = [], subscriptions = new Set(), timers = new Map(), windowListeners = new Set(), events = []
  const host = {
    document: null, sessionStorage: { getItem() { return null }, setItem() {} },
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) },
    addEventListener(name, fn) { if (name === 'message') windowListeners.add(fn) },
    removeEventListener(name, fn) { if (name === 'message') windowListeners.delete(fn) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options && options.detail } },
    dispatchEvent(event) { events.push(event) },
  }
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console,
    Date: class extends Date { static now() { return now } } }
  vm.runInNewContext(clientSource, sandbox)
  const client = descriptor.factory(() => ({}))
  const input = { state: { getSnapshot: () => ({ draft }) },
    setDraft(value) { draft = value; calls.push(['draft', value]) },
    submit(mode) { calls.push(['submit', draft, mode]); return submit() } }
  const ctx = { sessions: {
    scope: () => ({}), binding: () => ({ session: { prompt: async (content, mode) => { calls.push(['native', copy(content), mode]); return { ok: true } } } }),
    list: { getSnapshot: () => ({ byId: { game: { running } } }), subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn) } },
  }, get: () => ({ input: { for: () => input } }) }
  const execute = client.createTavernFrameSlashExecutor(ctx, host)
  return { client, ctx, execute, calls, host, windowListeners, timers, subscriptions, events,
    get draft() { return draft }, edit(value) { draft = value }, advance(ms) { now += ms },
    submitWith(fn) { submit = fn },
    running(value) { running = value; for (const fn of subscriptions) fn() },
  }
}

function hookedFrame(h) {
  let request
  const lifecycle = h.client.createTavernMessageFrameLifecycle(
    { sessionId: 'game', content: '<div>floor</div>', turn: 2, helperContext: { messages: [] } },
    { window: h.host, async rpc() { return {} } },
  )
  const doc = lifecycle.snapshot().visibleDocument
  const source = { postMessage(data) { if (data.type === 'dsh-tavern-frame-before-generate') request = data } }
  doc.ref({ contentWindow: source })
  const stop = lifecycle.start(() => {})
  const receive = data => { for (const fn of h.windowListeners) fn({ source, data: { token: doc.token, ...data } }) }
  receive({ type: 'dsh-tavern-frame-before-generate-hook', active: true })
  return { stop, reply(error) {
    assert.ok(request, 'host must refresh the selected frame before submission')
    receive({ type: 'dsh-tavern-frame-before-generate-done', requestId: request.requestId, ok: !error, ...(error ? { error } : {}) })
    request = undefined
  } }
}

test('split send submits once, honors await=false and keeps executor instances isolated', async () => {
  const h = fixture()
  await h.execute('/send 玩家输入', 'game')
  const other = h.client.createTavernFrameSlashExecutor(h.ctx, h.host)
  await other('/trigger await=false', 'game')
  assert.equal(h.calls.at(-1)[0], 'native')
  await h.execute('/trigger await=false', 'game')
  assert.deepEqual(h.calls.at(-1), ['submit', '玩家输入', 'queue'])
  await h.execute('/trigger await=false', 'game')
  assert.equal(h.calls.at(-1)[0], 'native')
  assert.equal(Object.hasOwn(h.ctx, '__dshTavernPendingSlashSend'), false)
})

test('accepted card submission refreshes story rows before the first partial', async () => {
  const h = fixture()
  let accept
  h.submitWith(() => new Promise(resolve => { accept = resolve }))
  const pending = h.execute('/send 新输入 | /trigger await=false', 'game', { waitForCompletion: false })
  await tick()
  assert.equal(h.calls.at(-1)[0], 'submit')
  assert.deepEqual(h.events, [], '提交尚未被接受时不能读取到不存在的用户行')
  accept({ ok: true })
  assert.equal((await pending).submitted, true)
  assert.deepEqual(h.events.map(event => ({ type: event.type, sessionId: event.detail && event.detail.sessionId })), [
    { type: 'dsh-tavern-story-mutated', sessionId: 'game' }
  ], '队列接受后立即通知故事流，无需等待首个模型 token')
})

test('expired, setinput-replaced and manually edited drafts never resend stale staged text', async () => {
  for (const change of [h => h.advance(15001), h => h.execute('/setinput 手动草稿', 'game'), h => h.edit('手动草稿')]) {
    const h = fixture()
    await h.execute('/send 旧输入', 'game')
    await change(h)
    const draft = h.draft
    await h.execute('/trigger await=false', 'game')
    assert.equal(h.calls.at(-1)[0], 'native')
    assert.equal(h.draft, draft)
    assert.equal(h.calls.some(call => call[0] === 'submit'), false)
  }
})

for (const awaitValue of ['true', 'false']) {
  test(`await=${awaitValue} rejects failed submissions and preserves the staged input for retry`, async () => {
    for (const failure of [() => Promise.reject(new Error('网络失败')), () => Promise.resolve({ ok: false, error: { message: '提交失败' } })]) {
      const h = fixture()
      await h.execute('/send 保留输入', 'game')
      h.submitWith(failure)
      await assert.rejects(h.execute('/trigger await=' + awaitValue, 'game'), /失败/)
      assert.equal(h.subscriptions.size, 0)
      assert.equal(h.timers.size, 0)
      h.submitWith(() => undefined)
      await h.execute('/trigger await=false', 'game')
      assert.deepEqual(h.calls.at(-1), ['submit', '保留输入', 'queue'])
    }
  })
}

test('await=true waits for both submission acceptance and observed completion; duplicate triggers cannot consume staged input', async () => {
  const h = fixture(), accepted = gate()
  h.submitWith(() => { h.running(true); h.running(false); return accepted.promise })
  await h.execute('/send 一次输入', 'game')
  let done = false
  const pending = h.execute('/trigger await=true', 'game').then(value => { done = true; return value })
  await tick()
  assert.equal(done, false)
  await assert.rejects(h.execute('/trigger await=false', 'game'), /正在提交/)
  accepted.resolve({ ok: true })
  assert.equal((await pending).submitted, true)
  assert.equal(h.calls.filter(call => call[0] === 'submit').length, 1)
  assert.equal(h.subscriptions.size, 0)
})

test('a completed run does not hide a later rejection of the submission promise', async () => {
  const h = fixture(), accepted = gate()
  h.submitWith(() => { h.running(true); h.running(false); return accepted.promise })
  await h.execute('/send 不要丢失', 'game')
  const pending = h.execute('/trigger await=true', 'game')
  const rejected = assert.rejects(pending, /拒绝/)
  await tick()
  accepted.reject(new Error('提交被拒绝'))
  await rejected
  h.submitWith(() => undefined)
  await h.execute('/trigger await=false', 'game')
  assert.deepEqual(h.calls.at(-1), ['submit', '不要丢失', 'queue'])
})

test('template-owned queue can explicitly avoid awaiting generation even with await=true', async () => {
  const h = fixture()
  await h.execute('/send 模板输入 | /trigger await=true', 'game', { waitForCompletion: false })
  assert.deepEqual(h.calls.at(-1), ['submit', '模板输入', 'queue'])
  assert.equal(h.subscriptions.size, 0)
})

test('failed prompt refresh keeps staged input available for an explicit retry', async t => {
  const h = fixture(), frame = hookedFrame(h)
  t.after(frame.stop)
  await h.execute('/send 刷新失败也保留', 'game')
  const first = h.execute('/trigger await=false', 'game', { beforeGenerateFlushedToken: 'untrusted-old-token' })
  const rejected = assert.rejects(first, /注入失败/)
  await tick()
  assert.equal(h.calls.some(call => call[0] === 'submit'), false)
  h.advance(20000)
  frame.reply('注入失败')
  await rejected
  const retry = h.execute('/trigger await=false', 'game')
  await tick()
  frame.reply()
  await retry
  assert.deepEqual(h.calls.at(-1), ['submit', '刷新失败也保留', 'queue'])
})

test('editing a staged draft during prompt refresh prevents stale overwrite and submission', async t => {
  const h = fixture(), frame = hookedFrame(h)
  t.after(frame.stop)
  await h.execute('/send 待发送输入', 'game')
  const pending = h.execute('/trigger await=false', 'game')
  const rejected = assert.rejects(pending, /草稿已变化/)
  await tick()
  h.edit('玩家新的输入')
  frame.reply()
  await rejected
  assert.equal(h.draft, '玩家新的输入')
  assert.equal(h.calls.some(call => call[0] === 'submit'), false)
})
