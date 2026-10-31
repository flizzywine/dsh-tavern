import { helperLoaderSource } from './fixtures/helper-loader-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

async function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(clientSource, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

test('Helper Host 在共享沙箱全部脚本完成初始化后才开放事件', async () => {
  const windowListeners = new Map()
  const frames = []
  const readySessions = []
  const hostWindow = {
    crypto: { randomUUID() { return 'init-token' } },
    setTimeout,
    clearTimeout,
    addEventListener(name, handler) { windowListeners.set(name, handler) },
    removeEventListener(name) { windowListeners.delete(name) }
  }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const hostDocument = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (tag === 'div') return root
      const frame = {
        contentWindow: { messages: [], postMessage(message) { this.messages.push(message) } },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler },
        remove() {}
      }
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({
    window: hostWindow,
    document: hostDocument,
    rpc() { return Promise.resolve({}) },
    onReady(sessionId) { readySessions.push(sessionId) },
    reportError() {}
  })

  runtime.sync('session', {
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [
      { id: 'ready', name: '已就绪', content: 'void 0', data: {}, buttons: [] },
      { id: 'loading', name: '初始化中', content: 'void 0', data: {}, buttons: [] }
    ]
  })
  assert.equal(frames.length, 1, '进入对话时应立即建立一个共享脚本 iframe')
  frames[0].listeners.load()
  const receive = windowListeners.get('message')
  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions', token: 'init-token', names: ['mag_command_parsed'], ready: false,
      scripts: [
        { id: 'ready', names: ['mag_command_parsed'], ready: true, failed: false },
        { id: 'loading', names: [], ready: false, failed: false }
      ]
    }
  })
  assert.deepEqual(readySessions, [], '仍有脚本初始化中时不得提前宣布整组脚本就绪')

  assert.deepEqual(JSON.parse(JSON.stringify(await runtime.emit('mag_command_parsed', [{ hp: 1 }], { messages: [] }))), [{ hp: 1 }])
  assert.equal(frames[0].contentWindow.messages.some(item => item.type === 'dsh-tavern-helper-event'), false)

  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions', token: 'init-token', names: ['mag_command_parsed'], ready: true,
      scripts: [
        { id: 'ready', names: ['mag_command_parsed'], ready: true, failed: false },
        { id: 'loading', names: [], ready: true, failed: false }
      ]
    }
  })
  await Promise.resolve()
  assert.deepEqual(readySessions, ['session'])

  const emitted = runtime.emit('mag_command_parsed', [{ hp: 1 }], { messages: [] })
  await Promise.resolve()
  const request = frames[0].contentWindow.messages.at(-1)
  assert.equal(request.name, 'mag_command_parsed')
  receive({ source: frames[0].contentWindow, data: { type: 'dsh-tavern-helper-event-complete', token: 'init-token', eventId: request.eventId, args: [{ hp: 2 }] } })
  assert.deepEqual(JSON.parse(JSON.stringify(await emitted)), [{ hp: 2 }])
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.inspect().scripts)), [
    { id: 'ready', loaded: true, subscriptionsReady: true, initializationFailed: false },
    { id: 'loading', loaded: true, subscriptionsReady: true, initializationFailed: false }
  ])
  runtime.dispose()
})

test('开场 iframe 只选择现有 swipe，不伪造 MVU 或修改正式消息', async () => {
  const preview = { swipes: ['首页', '', '海边开场'], openingIds: ['primary', null, 'alternate:1'], selectedIndex: 0 }
  const document = client.buildTavernFrameDocument({ content: '<video controls></video>', token: 'preview-token', openingPreview: preview })
  assert.match(document, /jquery\/jquery.min.js/)
  const script = document.match(/<script data-dsh-tavern-opening-preview>([\s\S]*?)<\/script>/)[1]
  const messages = [], listeners = new Map(), parent = { postMessage(data) { messages.push(data) } }
  const window = {}
  vm.runInNewContext(script, { window, parent, addEventListener: (name, fn) => listeners.set(name, fn), setTimeout, clearTimeout, console })
  assert.equal(window.Mvu, undefined)
  assert.equal(window.getChatMessages('0', { include_swipe: true })[0].swipes[2], '海边开场')
  await assert.rejects(window.setChatMessage('篡改正文', 0, { swipe_id: 2 }), /已有开场/)
  await assert.rejects(window.setChatMessages([{ message_id: 0, swipe_id: 1 }]), /已有开场/)
  await assert.rejects(window.setChatMessages([{ message_id: 0, swipe_id: 2, data: { hp: 99 } }]), /已有开场/)
  const done = window.setChatMessage('海边开场', 0, { swipe_id: 2, refresh: 'display_and_render_current' })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].swipeId, 2)
  listeners.get('message')({ source: parent, data: { type: 'dsh-tavern-opening-response', token: 'preview-token', requestId: messages[0].requestId, ok: true } })
  await done
  assert.equal(window.getChatMessages('0')[0].swipe_id, 2)
  assert.equal(client.openingPreviewSelection(preview, 2), 'alternate:1')
  for (const index of [-1, 1, 9, 1.5, '2']) assert.throws(() => client.openingPreviewSelection(preview, index), /不存在/)
})

test('音视频源绕过整文件静态缓存，封面和图片继续缓存', () => {
  const html = '<video src="https://media.example/large.mp4" poster="https://media.example/cover.jpg"></video><audio src=https://media.example/bgm.mp3></audio><video><source src="https://media.example/stream?id=1"></video>'
  for (const doc of [client.buildOpeningPreviewDocument(html), client.buildTavernFrameDocument({ content: html })]) {
    assert.match(doc, /src="https:\/\/media.example\/large.mp4"/)
    assert.match(doc, /src="https:\/\/media.example\/bgm.mp3"/)
    assert.match(doc, /src="https:\/\/media.example\/stream\?id=1"/)
    assert.ok(doc.includes('/api/dsh-tavern/static-assets?url=' + encodeURIComponent('https://media.example/cover.jpg')))
  }
})

test('动态媒体 src 和属性观察器不重新代理，图片仍走缓存', () => {
  const document = client.buildTavernFrameDocument({ content: '<div>media</div>' })
  const script = document.match(/<script data-dsh-tavern-static-cache>([\s\S]*?)<\/script>/)[1]
  let observe
  class Element {
    constructor(tag) { this.tagName = tag; this.nodeType = 1; this.attrs = {} }
    setAttribute(k, v) { this.attrs[k] = v }
    getAttribute(k) { return this.attrs[k] }
  }
  class Video extends Element {}
  Object.defineProperty(Video.prototype, 'src', { configurable: true, get() { return this.attrs.src }, set(v) { this.attrs.src = v } })
  vm.runInNewContext(script, { window: { HTMLVideoElement: Video }, Element, document: { documentElement: {} }, MutationObserver: class { constructor(fn) { observe = fn } observe() {} } })
  const video = new Video('VIDEO'); video.src = 'https://media.example/movie.mp4'
  const audio = new Element('AUDIO'); audio.setAttribute('src', 'https://media.example/bgm.mp3')
  const source = new Element('SOURCE'); source.setAttribute('src', 'https://media.example/live')
  const image = new Element('IMG'); image.setAttribute('src', 'https://media.example/image.png')
  observe([video, audio, source, image].map(target => ({ target })))
  assert.equal(video.src, 'https://media.example/movie.mp4')
  assert.equal(audio.getAttribute('src'), 'https://media.example/bgm.mp3')
  assert.equal(source.getAttribute('src'), 'https://media.example/live')
  assert.match(image.attrs.src, /^\/api\/dsh-tavern\/static-assets/)
  // 卡片脚本读 src 时拿回原始 https（valid() 校验绝对地址），加载仍走缓存代理。
  assert.equal(image.getAttribute('src'), 'https://media.example/image.png')
})

test('style 观察器无法改写的远程地址不回写，避免自触发死循环；带括号的引号地址也走缓存', () => {
  const document = client.buildTavernFrameDocument({ content: `<div style="background-image:url('https://img.example/Saki%20(5).png')"></div>` })
  assert.ok(document.includes('/api/dsh-tavern/static-assets?url=' + encodeURIComponent('https://img.example/Saki%20(5).png')))
  const script = document.match(/<script data-dsh-tavern-static-cache>([\s\S]*?)<\/script>/)[1]
  let observe
  const writes = []
  class Element {
    constructor(tag) { this.tagName = tag; this.nodeType = 1; this.attrs = {} }
    setAttribute(k, v) { writes.push(k); this.attrs[k] = v }
    getAttribute(k) { return this.attrs[k] }
  }
  vm.runInNewContext(script, { window: {}, Element, document: { documentElement: {} }, MutationObserver: class { constructor(fn) { observe = fn } observe() {} } })
  const quoted = new Element('DIV'); quoted.attrs.style = 'background-image: url("https://img.example/Saki%20(5).png")'
  const text = new Element('DIV'); text.attrs.style = '--credit: "https://example.com"'
  observe([quoted, text].map(target => ({ target })))
  assert.equal(quoted.attrs.style, 'background-image: url("/api/dsh-tavern/static-assets?url=' + encodeURIComponent('https://img.example/Saki%20(5).png') + '")')
  writes.length = 0
  observe([quoted, text].map(target => ({ target })))
  assert.deepEqual(writes, [], '值不变时写回 style 会再次触发观察器')
})

test('同一页面重复注入静态缓存脚本时只安装一次，避免两个观察器互相触发卡死', () => {
  const script = client.buildTavernFrameDocument({ content: '<div></div>' }).match(/<script data-dsh-tavern-static-cache>([\s\S]*?)<\/script>/)[1]
  const observers = []
  const writes = []
  class Element {
    constructor(tag) { this.tagName = tag; this.nodeType = 1; this.attrs = {} }
    setAttribute(k, v) { writes.push(k); this.attrs[k] = v }
    getAttribute(k) { return this.attrs[k] }
  }
  const context = vm.createContext({ Element, document: { documentElement: {} }, MutationObserver: class { constructor(fn) { observers.push(fn) } observe() {} } })
  context.window = context
  vm.runInContext(script, context)
  vm.runInContext(script, context)
  assert.equal(observers.length, 1)
  const image = new Element('IMG'); image.setAttribute('src', 'https://img.example/a.png')
  writes.length = 0
  observers[0]([{ target: image }])
  assert.deepEqual(writes, [], '已代理的地址不应再次写回')
})

test('右侧持久页面记录被捕获的按钮异常和执行日志，但不采集 DOM', () => {
  const html = client.buildTavernFrameDocument({ content: '', token: 'diagnostics', persistent: true, helperContext: { messages: [] }, observeMvuView: false, runtimeReporting: true })
  const script = html.match(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/)[1]
  const pending = [], reports = []
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    parent: { postMessage(value) { reports.push(value) } },
    document: { body: { cloneNode() { throw new Error('must not capture DOM') } } },
    addEventListener() {}, setTimeout(fn) { pending.push(fn); return pending.length },
  }
  context.window = context
  vm.createContext(context)
  vm.runInContext(script, context)
  vm.runInContext('console.log("角色数据已写入"); console.error("踏上旅程失败", new Error("消息追加失败"))', context)
  for (const fn of pending) fn()
  const runtime = reports.at(-1).runtime
  assert.equal(runtime.dom, '')
  assert.equal(runtime.console[0].args[0], '角色数据已写入')
  assert.equal(runtime.console[1].args[1].message, '消息追加失败')
  assert.match(runtime.console[1].args[1].stack, /消息追加失败/)
})

test('standalone /trigger admits a native turn without overwriting the draft or duplicating helper messages', async () => {
  const listeners = new Set()
  const summary = { running: false }
  const prompts = []
  let reply = { ok: true }
  const ctx = {
    sessions: {
      scope() { return {} },
      binding(id) { assert.equal(id, 'opening'); return { session: { prompt(content, mode) { assert.ok(content.some(part => part.type === 'text' && part.text.trim()), '宿主拒绝空 prompt'); prompts.push([content, mode]); return Promise.resolve(reply) } } } },
      list: {
        getSnapshot() { return { byId: { opening: summary } } },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
      }
    },
    get() { return { input: { for() { return { setDraft() { assert.fail('must preserve draft') }, submit() { assert.fail('must use native admission') } } } } } }
  }
  const execute = client.createTavernFrameSlashExecutor(ctx, { setTimeout, clearTimeout })
  const completion = execute('/trigger', 'opening')
  assert.deepEqual(JSON.parse(JSON.stringify(prompts)), [[[ { type: 'text', text: '继续。' } ], 'queue']])
  summary.running = true
  listeners.forEach(fn => fn())
  summary.running = false
  listeners.forEach(fn => fn())
  assert.equal((await completion).submitted, true)
  assert.equal(listeners.size, 0)
  reply = { ok: false, error: { message: 'provider unavailable' } }
  await assert.rejects(execute('/trigger', 'opening'), /provider unavailable/)
  assert.equal(listeners.size, 0)
})

test('Host acknowledgements confirm liveness without imposing a total event deadline', async () => {
  const windowListeners = new Map()
  const frames = []
  const errors = []
  const rpcCalls = []
  let clock = 0
  let seq = 0
  const timers = new Map()
  function advance(to) {
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= to).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      clock = due[1].at; timers.delete(due[0]); due[1].fn()
    }
    clock = to
  }
  const hostWindow = {
    crypto: { randomUUID() { return 'timeout-runtime-token' } },
    setTimeout(fn, delay) { timers.set(++seq, { fn, at: clock + delay }); return seq },
    clearTimeout(id) { timers.delete(id) },
    addEventListener(name, handler) { windowListeners.set(name, handler) },
    removeEventListener(name) { windowListeners.delete(name) }
  }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const hostDocument = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (tag === 'div') return root
      const frame = {
        contentWindow: { messages: [], postMessage(message) { this.messages.push(message) } },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler },
        remove() {}
      }
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({
    window: hostWindow,
    document: hostDocument,
    eventTimeoutMs: 25,
    now() { return clock },
    rpc(method, args) { rpcCalls.push({ method, args }); return Promise.resolve({ updated: true }) },
    reportError(source, error) { errors.push({ source, message: error.message }) }
  })
  runtime.sync('session', {
    tavernHelper: { messages: [], scriptVariables: {}, lifecycleRevision: 1 },
    tavernHelperScripts: [{ id: 'guard', name: '变量守卫', content: 'void 0', data: {}, buttons: [] }]
  })
  frames[0].listeners.load()
  const receive = windowListeners.get('message')
  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions', token: 'timeout-runtime-token', names: ['MESSAGE_RECEIVED'], ready: true,
      scripts: [{ id: 'guard', names: ['MESSAGE_RECEIVED'], ready: true, failed: false }]
    }
  })

  const emitted = runtime.emit('MESSAGE_RECEIVED', [2], { messages: [], lifecycleRevision: 1 })
  await Promise.resolve()
  const request = frames[0].contentWindow.messages.find(item => item.type === 'dsh-tavern-helper-event')
  receive({
    source: frames[0].contentWindow,
    data: { type: 'dsh-tavern-helper-event-progress', token: 'timeout-runtime-token', eventId: request.eventId, scriptId: 'guard', phase: 'started' }
  })

  let finished = false
  const done = emitted.then(args => { finished = true; return args })
  for (const at of [20, 40, 60, 80, 100, 120]) {
    advance(at)
    receive({ source: frames[0].contentWindow, data: {
      type: 'dsh-tavern-helper-call', token: 'timeout-runtime-token', eventId: request.eventId,
      requestId: 'progress-' + at, method: 'updateTavernHelperVariables', args: { variables: { hp: at } }
    } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(errors.length, 0)
  }
  advance(139)
  assert.equal(errors.length, 0)
  assert.equal(finished, false)
  receive({ source: frames[0].contentWindow, data: {
    type: 'dsh-tavern-helper-event-complete', token: 'timeout-runtime-token', eventId: request.eventId, args: [2]
  } })
  assert.deepEqual(Array.from(await done), [2])
  assert.equal(errors.length, 0)
  assert.equal(rpcCalls.length, 6)
  runtime.dispose()
})

test('trusted scripts await host jQuery before executing; isolated scripts do not access host', () => {
  for (const trustedCardMode of [true, false]) {
    const document = client.buildTavernHelperScriptDocument({ trustedCardMode, scripts: [{ id: 'ball', content: 'void 0' }] });
    const loader = helperLoaderSource(document);
    assert.equal(loader.includes('await ensureHostJQuery(window.parent)'), trustedCardMode);
    if (trustedCardMode) assert.ok(loader.indexOf('await ensureHostJQuery(window.parent)') < loader.indexOf('for(const script of scripts)'));
  }
});

test('host jQuery dependency shares pending load, preserves existing globals and retries failure', async () => {
  let pending, loads = 0;
  const otherDollar = () => 'other library';
  const host = { $: otherDollar, setTimeout, clearTimeout, document: {
    querySelector: () => pending,
    createElement: () => ({ setAttribute() {}, remove() { pending = null; } }),
    head: { appendChild(node) { pending = node; loads++; } }
  } };
  const first = client.ensureTavernHostJQuery(host);
  assert.equal(client.ensureTavernHostJQuery(host), first);
  pending.onerror();
  await assert.rejects(first, /加载失败/);
  const retry = client.ensureTavernHostJQuery(host);
  const jq = { fn: { jquery: '3.7.1' }, noConflict() { host.$ = otherDollar; } };
  host.$ = host.jQuery = jq;
  pending.onload();
  await retry;
  assert.equal(host.$, otherDollar);
  assert.equal(host.jQuery, jq);
  await client.ensureTavernHostJQuery(host);
  assert.equal(loads, 2);
  assert.equal(pending, null);
});

test('host cleanup removes only callbacks from the retiring iframe realm', () => {
  const realm = vm.runInNewContext('({ Function, callback() {} })');
  const hostCallback = () => {};
  const element = {};
  const removed = [];
  const host = { document: { querySelectorAll: () => [element] }, jQuery: {
    hasData: () => true,
    _data: () => ({ click: [
      { origType: 'click', namespace: 'shared', handler: realm.callback, selector: '.ball' },
      { origType: 'click', namespace: 'shared', handler: hostCallback, selector: '.ball' }
    ] }),
    event: { remove: (...args) => removed.push(args) }
  } };
  client.releaseTavernHostJQueryHandlers(host, realm);
  assert.equal(removed.length, 4); // host, host document, element and retiring window
  assert.ok(removed.every(row => row[1] === 'click.shared' && row[2] === realm.callback && row[3] === '.ball'));
});

test('trusted card widgets await the full host jQuery UI before executing', async () => {
  let attached
  const jq = { fn: {} }
  const host = { jQuery: jq, setTimeout: () => 1, clearTimeout() {}, document: {
    querySelector: () => attached,
    createElement: () => ({ setAttribute() {}, remove() { attached = null } }),
    head: { appendChild(script) { attached = script } }
  } }
  const ready = client.ensureTavernHostJQueryUi(host)
  assert.equal(client.ensureTavernHostJQueryUi(host), ready)
  assert.match(attached.src, /jquery-ui\/jquery-ui.min.js$/)
  jq.fn.draggable = () => {}
  attached.onload()
  await ready
  await client.ensureTavernHostJQueryUi(host)
  assert.equal(attached, null)
})

test('trusted script UI uses host body and its installed draggable; isolation retains local body', async () => {
  for (const trustedCardMode of [true, false]) {
    const hostBody = {}, localBody = {}
    const hostJQuery = () => hostBody
    hostJQuery.fn = { jquery: '3.7.1', draggable() {} }
    const localJQuery = () => localBody
    const window = { parent: { jQuery: hostJQuery }, $: localJQuery, jQuery: localJQuery,
      __dshTavernHelperReady: Promise.resolve(), addEventListener() {}, __dshTavernResolveCompanionScriptsReady() {} }
    const document = client.buildTavernHelperScriptDocument({ trustedCardMode, scripts: [] })
    const loader = helperLoaderSource(document)
    await vm.runInNewContext('(async()=>{' + loader + '})()', { window })
    assert.equal(window.$('body'), trustedCardMode ? hostBody : localBody)
    if (trustedCardMode) assert.equal(typeof window.$.fn.draggable, 'function')
  }
})

test('trusted parent facade exposes real EJS readiness and restores the previous host on disposal', () => {
  const previous = { native: true }, host = { SillyTavern: previous }
  const frame = { SillyTavern: { getContext: () => ({ extensionSettings: { EjsTemplate: { enabled: true } } }) }, TavernHelper: {} }
  const dispose = client.installTavernTrustedHostFacade(host, frame)
  assert.equal(host.SillyTavern.getContext().extensionSettings.EjsTemplate.enabled, true)
  frame.SillyTavern = { getContext: () => ({ extensionSettings: { EjsTemplate: { enabled: false } } }) }
  assert.equal(host.SillyTavern.getContext().extensionSettings.EjsTemplate.enabled, false)
  assert.equal(host.TavernHelper, frame.TavernHelper)
  dispose()
  assert.equal(host.SillyTavern, previous)
  assert.equal(Object.hasOwn(host, 'TavernHelper'), false)
})

test('trusted #chat compatibility mount measures as the conversation pane', () => {
  const paneRect = { x: 280, y: 82, width: 510, height: 640 }
  const appended = []
  const document = {
    getElementById: () => null,
    createElement: () => ({ style: { setProperty() {} }, appendChild() {}, remove() {} }),
    querySelector: selector => selector === '[data-conversation-scroll]' ? { getBoundingClientRect: () => paneRect } : null,
    documentElement: { getBoundingClientRect: () => ({ width: 1440, height: 800 }) },
    body: { appendChild: node => appended.push(node) },
  }
  const dispose = client.installTavernTrustedHostFacade({ document }, { SillyTavern: {}, document: {} })
  const chat = appended.find(node => node.id === 'chat')
  assert.deepEqual(chat.getBoundingClientRect(), paneRect)
  dispose()
})

test('retiring an older trusted facade cannot clear the newer one or restore a disposed frame', () => {
  const original = { original: true }, host = { SillyTavern: original }
  const first = { SillyTavern: { id: 'a' } }, second = { SillyTavern: { id: 'b' } }
  const releaseFirst = client.installTavernTrustedHostFacade(host, first)
  const releaseSecond = client.installTavernTrustedHostFacade(host, second)
  releaseFirst()
  assert.equal(host.SillyTavern, second.SillyTavern)
  releaseSecond()
  assert.equal(host.SillyTavern, original)
})

test('trusted opening exposes live MVU and EJS to original parent-window checks', async () => {
  for (const trustedCardMode of [true, false]) {
    const host = { jQuery: Object.assign(() => {}, { fn: { jquery: '3.7.1', draggable() {} } }) }
    const events = {}
    const frame = { parent: host, __dshTavernHelperReady: Promise.resolve(),
      SillyTavern: { getContext: () => ({ extensionSettings: { EjsTemplate: { enabled: true } } }) },
      addEventListener(name, handler) { events[name] = handler },
      __dshTavernResolveCompanionScriptsReady() {} }
    const html = client.buildTavernFrameDocument({ trustedCardMode, openingPreview: { runtime: { context: {}, scripts: [] } } })
    const loader = helperLoaderSource(html)
    await vm.runInNewContext('(async()=>{' + loader + '})()', { window: frame })
    const bridge = html.match(/<script data-dsh-tavern-opening-host>([\s\S]*?)<\/script>/)
    if (bridge) vm.runInNewContext(bridge[1], { window: frame })
    const checkMvu = () => !!host.Mvu && typeof host.Mvu.getMvuData === 'function' && typeof host.Mvu.replaceMvuData === 'function'
    const checkEjs = () => !!host.SillyTavern?.getContext().extensionSettings.EjsTemplate.enabled
    assert.equal(checkMvu(), false, 'unloaded MVU must remain offline')
    frame.Mvu = { getMvuData() {}, replaceMvuData() {} }
    assert.equal(checkMvu(), trustedCardMode)
    assert.equal(checkEjs(), trustedCardMode)
    if (trustedCardMode) {
      frame.Mvu = undefined
      assert.equal(checkMvu(), false)
      events.pagehide()
      assert.equal(Object.hasOwn(host, 'SillyTavern'), false)
      assert.equal(Object.hasOwn(host, 'Mvu'), false)
    }
  }
})

test('managed MVU keeps jQuery when a card declares its own lexical dollar helper', async () => {
  const html = client.buildTavernHelperScriptDocument({ scripts: [] })
  const loader = helperLoaderSource(html)
  const source = loader.slice(loader.indexOf('const loadModule=') + 17, loader.indexOf(';\nconst createMvuLoader='))
  const sandbox = { window: { jQuery: callback => callback(), addEventListener() {}, removeEventListener() {} }, document: {
    getElementById: () => null,
    createElement: () => ({ remove() {} }),
    body: { appendChild(element) { vm.runInContext('(function(){' + element.textContent + '\n})()', context) } }
  } }
  sandbox.createTavernFrameLifecycle = client.createTavernFrameLifecycle
  const context = vm.createContext(sandbox)
  vm.runInContext('const $ = id => document.getElementById(id);', context)
  const load = vm.runInContext('(' + source + ')', context)
  await load('$(function(){window.Mvu = {initialized:true}});', '__dsh_official_mvu__')
  assert.equal(sandbox.window.Mvu?.initialized, true)
  assert.equal(vm.runInContext('$("missing")', context), null, 'the card keeps its own helper')
  await load('const $ = () => "card-local";window.cardResult=$();', 'user-card-script')
  assert.equal(sandbox.window.cardResult, 'card-local', 'user module declarations remain valid')
})

test('pending opening frame can initialize its private MVU draft before becoming visible', async () => {
  const listeners = new Map(), calls = [], replies = []
  const host = { sessionStorage: { getItem() { return null }, setItem() {} }, document: null, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } }
  const props = { sessionId: '', content: '<button>old</button>', turn: 1, eager: true,
    openingPreview: { preparationId: 'draft', swipes: ['old'], openingIds: ['primary'], selectedIndex: 0 } }
  const lifecycle = client.createTavernMessageFrameLifecycle(props, { window: host, async rpc(...args) { calls.push(args); return { updated: true } } })
  lifecycle.snapshot().visibleDocument.ref({ contentWindow: { postMessage() {} } })
  const stop = lifecycle.start(() => {})
  lifecycle.update({ ...props, content: '<button>new</button>' })
  const pending = lifecycle.snapshot().pendingDocument
  assert.ok(pending)
  const source = { postMessage(data) { replies.push(data) } }; pending.ref({ contentWindow: source })
  listeners.get('message')({ source, data: { type: 'dsh-tavern-helper-call', token: pending.token, requestId: 'init',
    method: 'updateTavernHelperVariables', args: { option: { type: 'message', message_id: 0 }, variables: { stat_data: {} } } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls[0]?.[0], 'callOpeningRuntime')
  assert.equal(calls[0]?.[1].id, 'draft')
  assert.equal(replies.find(reply => reply.requestId === 'init')?.ok, true)
  listeners.get('message')({ source, data: { type: 'dsh-tavern-opening-read', token: pending.token, requestId: 'read' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.at(-1)?.[0], 'getOpeningPreparation')
  assert.equal(replies.find(reply => reply.requestId === 'read')?.ok, true)
  stop()
})

test('opening script host stays inside the preview while transport retains its real parent', () => {
  const outer = { document: { name: 'app' } }
  const host = { parent: outer, document: { name: 'preview' }, addEventListener() { assert.equal(this, host) } }
  const scope = client.createTavernPreviewWindow(host)
  assert.equal(scope.parent, scope)
  assert.equal(scope.top.document, host.document)
  assert.equal(host.parent, outer)
  scope.addEventListener('message', () => {})
  scope.cardState = 1
  assert.equal(host.cardState, 1)
})

test('closing a trusted opening preserves unowned host UI created during its lifetime', () => {
  const body = { childNodes: [] }, head = { childNodes: [] }
  function add(root, id) { const node = { id, remove() { root.childNodes.splice(root.childNodes.indexOf(node), 1) } }; root.childNodes.push(node); return node }
  const app = add(body, 'app'), style = add(head, 'app-style')
  const host = { document: { body, head, getElementById() { return {} } },
    sessionStorage: { getItem() { return null } }, setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {} }
  const lifecycle = client.createTavernMessageFrameLifecycle({ content: 'opening', sessionId: '', trustedCardMode: true,
    openingPreview: { preparationId: 'draft', swipes: ['opening'], openingIds: ['primary'], selectedIndex: 0 } }, { window: host })
  const stop = lifecycle.start(() => {})
  const popup=add(body, 'native-popup'), lateStyle=add(head, 'native-style')
  stop()
  assert.deepEqual(body.childNodes, [app,popup])
  assert.deepEqual(head.childNodes, [style,lateStyle])
})

test('trusted host exposes a visible chat mount until the final owner leaves, without a fake composer', () => {
  const nodes = new Map()
  const document = { body: { appendChild(node) { nodes.set(node.id, node) } }, getElementById(id) { return nodes.get(id) }, createElement() { return { appendChild() {}, remove() { nodes.delete(this.id) } } } }
  const host = { document }
  const releaseA = client.installTavernTrustedHostFacade(host, {})
  const root = nodes.get('chat')
  assert.ok(root)
  assert.notEqual(root.hidden, true)
  assert.equal(nodes.has('send_textarea'), false)
  const releaseB = client.installTavernTrustedHostFacade(host, {})
  releaseA(); releaseA()
  assert.equal(nodes.get('chat'), root)
  releaseB()
  assert.equal(nodes.has('chat'), false)
  nodes.set('chat', { id: 'chat', existing: true })
  client.installTavernTrustedHostFacade(host, {})()
  assert.equal(nodes.get('chat').existing, true)
})

test('initializeGlobal publishes the value before waking existing global waiters', async () => {
  const source = clientSource.slice(clientSource.indexOf('window.initializeGlobal = function'), clientSource.indexOf('window.getTavernHelperVersion =', clientSource.indexOf('window.initializeGlobal = function')))
  const events = client.createTavernHelperEventBus({ currentScript: () => ({ id: 'publisher' }), withScript: (_id, fn) => fn(), reportSubscriptions() {}, post() {} })
  const window = { eventOn: events.listen, eventOff: events.off, eventEmit: events.emit }
  vm.runInNewContext(source, { window })
  const waiting = window.waitGlobalInitialized('Controller')
  const value = { ready: true }
  await window.initializeGlobal('Controller', value)
  assert.equal(await waiting, value)
  assert.equal(await window.waitGlobalInitialized('Controller'), value)
})

test('Helper 增量不遍历未变历史，替换、追加与截断保留旧状态', () => {
  const untouched = { message_id: 0, get variables() { throw new Error('不应读取未变历史变量') } }
  const previous = { stateRevision: 1, messages: [untouched, { variables: { hp: 10 } }], chatVariables: { location: 'old' } }
  const value = { variables: { hp: 9 } }
  const appended = { variables: { hp: 8 } }
  const patch = { version: 1, kind: 'patch', baseRevision: 1, stateRevision: 2, operations: [
    { op: 'message.replace', index: 1, value }, { op: 'messages.append', values: [appended] },
    { op: 'value.replace', key: 'chatVariables', value: { location: 'new' } }
  ] }
  const next = client.applyTavernHelperContextUpdate(previous, patch).context
  assert.equal(next.messages[0], untouched)
  assert.equal(previous.messages.length, 2)
  assert.equal(previous.messages[1].variables.hp, 10)
  assert.equal(previous.chatVariables.location, 'old')
  value.variables.hp = 0; appended.variables.hp = 0
  assert.equal(next.messages[1].variables.hp, 9)
  assert.equal(next.messages[2].variables.hp, 8)
  const truncated = client.applyTavernHelperContextUpdate(next, { version: 1, kind: 'patch', baseRevision: 2, stateRevision: 3, operations: [{ op: 'messages.truncate', length: 1 }] }).context
  assert.equal(truncated.messages.length, 1)
  assert.equal(next.messages.length, 3)
})

test('模板内生成命令在提交后返回，不占住模板队列等待下一轮', async () => {
  const calls=[]
  const ctx={sessions:{scope:()=>({}),binding:()=>({session:{prompt:async()=>({ok:true})}})},get:()=>({input:{for:()=>({setDraft:text=>calls.push(text),submit:mode=>calls.push(mode)})}})}
  const execute=client.createTavernFrameSlashExecutor(ctx,{setTimeout,clearTimeout})
  assert.equal((await execute('/send 下一步|/trigger','game',{waitForCompletion:false})).submitted,true)
  assert.deepEqual(calls,['下一步','queue'])
  assert.equal((await execute('/trigger','game',{waitForCompletion:false})).submitted,true)
})

test('保留多个正式会话时，parent.Mvu 随当前会话切换而不是最后创建的沙箱', () => {
  const host = { __dshTavernSelectedSessionId: 'A' }
  const a = { frameElement: { __dshTavernSessionId: 'A' }, Mvu: { owner: 'A' } }
  const b = { frameElement: { __dshTavernSessionId: 'B' }, Mvu: { owner: 'B' } }
  const releaseA = client.installTavernTrustedHostFacade(host, a)
  const releaseB = client.installTavernTrustedHostFacade(host, b)
  assert.equal(host.Mvu, a.Mvu)
  host.__dshTavernSelectedSessionId = 'B'; assert.equal(host.Mvu, b.Mvu)
  host.__dshTavernSelectedSessionId = 'A'; assert.equal(host.Mvu, a.Mvu)
  releaseB(); assert.equal(host.Mvu, a.Mvu)
  releaseA(); assert.equal(host.Mvu, undefined)
})
