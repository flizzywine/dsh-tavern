import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
function gate() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture(options = {}) {
  let now = 1000, descriptor, draft = '', running = false, submit = () => undefined, nextSubmission = 0
  const calls = [], subscriptions = new Set(), timers = new Map(), windowListeners = new Set(), events = [], pendingSubmissions = [], prompts = [], appended = []
  const host = {
    document: null, sessionStorage: { getItem() { return null }, setItem() {} },
    crypto: { randomUUID() { return 'request-' + (++nextSubmission) } },
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) },
    addEventListener(name, fn) { if (name === 'message') windowListeners.add(fn) },
    removeEventListener(name, fn) { if (name === 'message') windowListeners.delete(fn) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options && options.detail } },
    dispatchEvent(event) { events.push(event) },
  }
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console,
    fetch: async (url, request) => {
      const payload = JSON.parse(request.body)
      assert.match(String(url), /appendPlayerInput$/)
      appended.push({ sessionId: payload.sessionId, requestId: payload.requestId, text: payload.text })
      return new Response(JSON.stringify({ ok: true, saved: true, requestId: payload.requestId, messageIndex: 7 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      })
    },
    Date: class extends Date { static now() { return now } } }
  vm.runInNewContext(clientSource, sandbox)
  const client = descriptor.factory(() => ({}))
  const input = { state: { getSnapshot: () => ({ draft }) },
    setDraft(value) { draft = value; calls.push(['draft', value]) },
    submit(mode) { calls.push(['submit', draft, mode]); return submit() } }
  const ctx = { sessions: {
    scope: () => ({}), binding: () => {
      const session = { prompt: async (content, mode, signal, requestId) => {
        prompts.push({ content: copy(content), mode, requestId })
        calls.push(['native', copy(content), mode])
        const result = await submit()
        return result === undefined ? { ok: true } : result
      } }
      if (options.nativeEcho) session.beginSubmission = input => {
        const requestId = 'request-' + (++nextSubmission), echo = { requestId, text: input.text }
        pendingSubmissions.push(echo); calls.push(['echo', input.text])
        return { requestId, abandon() {
          const index = pendingSubmissions.indexOf(echo)
          if (index >= 0) pendingSubmissions.splice(index, 1)
          calls.push(['abandon', requestId])
        } }
      }
      return { session }
    },
    list: { getSnapshot: () => ({ byId: { game: { running } } }), subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn) } },
  }, get: () => ({ input: { for: () => input } }) }
  const execute = client.createTavernFrameSlashExecutor(ctx, host)
  return { client, ctx, execute, calls, host, windowListeners, timers, subscriptions, events, pendingSubmissions, prompts, appended,
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
  assert.equal(h.prompts.at(-1).content[0].text, '玩家输入')
  await h.execute('/trigger await=false', 'game')
  assert.equal(h.calls.at(-1)[0], 'native')
  assert.equal(Object.hasOwn(h.ctx, '__dshTavernPendingSlashSend'), false)
})

test('player input refreshes before acceptance and assistant placeholder refreshes after acceptance', async () => {
  const h = fixture()
  let accept
  h.submitWith(() => new Promise(resolve => { accept = resolve }))
  const pending = h.execute('/send 新输入 | /trigger await=false', 'game', { waitForCompletion: false })
  await tick()
  assert.equal(h.calls.at(-1)[0], 'native')
  assert.deepEqual(h.appended.map(row => row.text), ['新输入'])
  assert.deepEqual(h.events.map(event => event.type), ['dsh-tavern-story-mutated'], '生成接受前已经显示持久玩家行')
  accept({ ok: true })
  assert.equal((await pending).submitted, true)
  assert.deepEqual(h.events.map(event => ({ type: event.type, sessionId: event.detail && event.detail.sessionId })), [
    { type: 'dsh-tavern-story-mutated', sessionId: 'game' },
    { type: 'dsh-tavern-story-mutated', sessionId: 'game' }
  ], '第二次刷新只领取正文占位，无需等待首个模型 token')
})

test('player input persists before a pending generation flush and prompts with the same request id', async () => {
  const h = fixture({ nativeEcho: true }), floor = hookedFrame(h)
  const sending = h.execute('/send 不等十五秒 | /trigger await=false', 'game', { waitForCompletion: false })
  await tick()
  assert.equal(h.prompts.length, 0, '生成前屏障仍未放行 Session 提交')
  assert.deepEqual(h.appended.map(row => row.text), ['不等十五秒'])
  assert.deepEqual(h.pendingSubmissions, [], '卡片路径不再创建宿主临时回声')
  assert.equal(h.events.length, 1)
  floor.reply()
  assert.equal((await sending).submitted, true)
  assert.equal(h.prompts.length, 1)
  assert.equal(h.prompts[0].requestId, 'request-1')
  assert.equal(h.appended[0].requestId, h.prompts[0].requestId)
  assert.equal(h.prompts[0].content[0].text, '不等十五秒')
  floor.stop()
})

test('failed generation flush keeps saved input and retries with the same request id', async () => {
  const h = fixture({ nativeEcho: true }), floor = hookedFrame(h)
  const sending = h.execute('/send 保留这条草稿 | /trigger await=false', 'game', { waitForCompletion: false })
  await tick()
  assert.equal(h.appended.length, 1)
  floor.reply('卡片刷新失败')
  await assert.rejects(sending, /卡片刷新失败/)
  assert.equal(h.appended.length, 1)
  assert.equal(h.pendingSubmissions.length, 0)
  assert.equal(h.prompts.length, 0)

  const retry = h.execute('/trigger await=false', 'game', { waitForCompletion: false })
  await tick()
  floor.reply()
  await retry
  assert.equal(h.appended.length, 2, '重试重复调用幂等落盘 RPC')
  assert.equal(h.appended[1].requestId, h.appended[0].requestId)
  assert.equal(h.prompts[0].requestId, h.appended[0].requestId)
  assert.equal(h.prompts[0].content[0].text, '保留这条草稿')
  floor.stop()
})

test('visible host composer persists input independently of Session acceptance', async () => {
  const h = fixture()
  const listeners = new Set()
  const session = {
    beginSubmission(input) { return { requestId: 'host-request', text: input.text, abandon() {} } },
    async prompt() { return { ok: false, error: { message: 'Session 不可用' } } }
  }
  const ctx = { sessions: {
    binding: () => ({ session }),
    list: { getSnapshot: () => ({ byId: { game: {} } }), subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  } }
  const stop = h.client.installTavernPlayerInputPersistence(ctx, h.host)
  session.beginSubmission({ mode: 'queue', text: '普通输入框', attachments: [] })
  await tick()
  assert.deepEqual(h.appended, [{ sessionId: 'game', requestId: 'host-request', text: '普通输入框' }])
  const result = await session.prompt()
  assert.equal(result.ok, false)
  assert.equal(h.appended.length, 1, 'Session 失败不撤回已保存输入')
  stop()
  session.beginSubmission({ mode: 'queue', text: '卸载后不再挂钩', attachments: [] })
  await tick()
  assert.equal(h.appended.length, 1)
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
      assert.equal(h.prompts.at(-1).content[0].text, '保留输入')
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
  assert.equal(h.prompts.filter(call => call.content[0]?.text === '一次输入').length, 1)
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
  assert.equal(h.prompts.at(-1).content[0].text, '不要丢失')
})

test('template-owned queue can explicitly avoid awaiting generation even with await=true', async () => {
  const h = fixture()
  await h.execute('/send 模板输入 | /trigger await=true', 'game', { waitForCompletion: false })
  assert.equal(h.prompts.at(-1).content[0].text, '模板输入')
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
  assert.equal(h.prompts.at(-1).content[0].text, '刷新失败也保留')
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
