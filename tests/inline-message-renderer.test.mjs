import { helperLoaderSource } from './fixtures/helper-loader-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

async function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(clientSource, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

test('预览与正文 iframe 缓存不带引号的资源地址，保留其他属性与跳转链接', () => {
  const content = [
    '<img src=https://assets.example/image.png width=30% />',
    '<video poster=https://assets.example/poster.png></video>',
    '<script src=https://assets.example/app.js></script>',
    '<link rel=stylesheet href=https://assets.example/style.css>',
    '<img src="https://assets.example/quoted.png">',
    '<a href=https://example.com/page>查看更新</a>',
    '<div data-src=https://assets.example/lazy.png></div>'
  ].join('\n')
  for (const document of [client.buildOpeningPreviewDocument(content), client.buildTavernFrameDocument({ content })]) {
    for (const name of ['image.png', 'poster.png', 'app.js', 'style.css', 'quoted.png']) {
      assert.ok(document.includes('/api/dsh-tavern/static-assets?url=' + encodeURIComponent('https://assets.example/' + name)), name)
    }
    assert.ok(document.includes('width=30% />'))
    assert.ok(document.includes('<a href=https://example.com/page>'))
    assert.ok(document.includes('data-src=https://assets.example/lazy.png'))
    assert.ok(!document.includes('src=https://assets.example/image.png'))
  }
})

test('服务端启动标识变化时只触发一次前端刷新', async () => {
  let refreshCount = 0
  const scheduled = []
  const monitor = client.createTavernRuntimeGenerationMonitor({
    load: async function () { return { runtimeGeneration: 'runtime-a' } },
    refresh: function () { refreshCount += 1 },
    schedule(run, delay) { scheduled.push({ run, delay }); return scheduled.length },
    cancel() {},
    intervalMs: 30000
  })

  const stop = monitor.start()
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.equal(monitor.inspect().observed, 'runtime-a')
  assert.equal(refreshCount, 0)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 30000)

  assert.equal(monitor.observe('runtime-a'), false)
  assert.equal(monitor.observe('runtime-b'), true)
  assert.equal(monitor.observe('runtime-c'), false)
  await new Promise(function (resolve) { setImmediate(resolve) })
  assert.equal(refreshCount, 1)
  stop()
})

test('消息 iframe 将可信远程资源转入持久缓存，同时保留不透明来源隔离和受控高度协议', () => {
  const document = client.buildTavernFrameDocument({
    content: '<p>正文</p><style>p{color:red}</style><script src="https://cdn.jsdelivr.net/example.js"></script>',
    token: 'height-token'
  })

  assert.match(document, /<p>正文<\/p><style>p\{color:red\}<\/style>/)
  assert.match(document, /static-assets\?url=https%3A%2F%2Fcdn\.jsdelivr\.net%2Fexample\.js/)
  assert.match(document, /data-dsh-tavern-static-cache/)
  assert.match(document, /data-dsh-sillytavern-css-compat="1\.18\.0"/)
  assert.match(document, /public%2Fcss%2Fsolid\.min\.css/)
  assert.match(document, /HTMLImageElement/)
  assert.match(document, /default-src https: http: data: blob:/)
  assert.match(document, /connect-src https: http: wss: data: blob:/)
  assert.match(document, /frame-src https: http: data: blob:/)
  assert.match(document, /object-src 'none'/)
  assert.match(document, /form-action 'none'/)
  assert.match(document, /ResizeObserver/)
  assert.match(document, /getBoundingClientRect/)
  assert.match(document, /document\.fonts\.ready/)
  assert.match(document, /dsh-tavern-frame-height/)
  assert.match(document, /dsh-tavern-frame-runtime/)
  assert.match(document, /unhandledrejection/)
  assert.match(document, /XMLHttpRequest/)
  assert.match(document, /window\.fetch/)
  assert.match(document, /document\.body\.cloneNode\(true\)/)
  assert.match(document, /script\[data-dsh-tavern-frame\]/)
  assert.match(document, /height-token/)
  assert.match(document, /body\{padding:0 1px;overflow-wrap:anywhere;white-space:pre-wrap\}/)
  assert.match(document, /body>\*\{white-space:normal\}/)
})

test('交互消息 iframe 可经鉴权桥接读写世界书并触发当前对话发送', async () => {
  const listeners = new Map()
  const calls = []
  const slashCalls = []
  const frame = { contentWindow: { messages: [], postMessage(message) { this.messages.push(message) } } }
  const hostWindow = {
    crypto: { randomUUID() { return 'interactive-message-token' } },
    sessionStorage: { getItem() { return null }, setItem() {} },
    document: null,
    setTimeout,
    clearTimeout,
    addEventListener(name, handler) { listeners.set(name, handler) },
    removeEventListener(name) { listeners.delete(name) }
  }
  const lifecycle = client.createTavernMessageFrameLifecycle({
    sessionId: 'session-magic-fairy', content: '<button>开始游戏</button>', turn: 1, partIndex: 0,
    helperContext: { lifecycleRevision: 3, messages: [] }, eager: true
  }, {
    window: hostWindow,
    rpc(method, args, sessionId) {
      calls.push({ method, args, sessionId })
      if (method === 'getSession') return Promise.resolve({ view: { tavernHelper: { lifecycleRevision: 4, messages: [{ role: 'assistant', variables: {} }, { role: 'user', variables: {} }, { role: 'assistant', variables: {} }] } } })
      return Promise.resolve(method === 'getTavernHelperWorldbook'
        ? { worldbook: { name: args.name, entries: [] } }
        : { worldbook: { name: args.name, entries: args.entries || [] } })
    },
    executeSlash(line, sessionId) { slashCalls.push({ line, sessionId }); return Promise.resolve({ submitted: true }) }
  })
  const document = lifecycle.snapshot().visibleDocument
  document.ref(frame)
  const stop = lifecycle.start(function () {})
  const receive = listeners.get('message')

  receive({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: document.token, requestId: 'worldbook', method: 'getTavernHelperWorldbook', args: { name: '群星的资料库 v4.0' } } })
  receive({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: document.token, requestId: 'send', method: 'triggerTavernSlash', args: { line: '/send 开始冒险|/trigger' } } })
	await new Promise(resolve => setImmediate(resolve))

  assert.equal(calls[0].method, 'getTavernHelperWorldbook')
  assert.equal(calls[0].sessionId, 'session-magic-fairy')
	assert.equal(calls[1].method, 'getSession')
  assert.deepEqual(slashCalls, [{ line: '/send 开始冒险|/trigger', sessionId: 'session-magic-fairy' }])
  assert.deepEqual(frame.contentWindow.messages.map(message => [message.requestId, message.ok]), [['worldbook', true], ['send', true]])
  stop()
})

test('消息界面的 /send …|/trigger 通过当前 composer 提交并等待该轮完成', async () => {
  const listeners = new Set()
  const summary = { running: false }
  const submissions = []
  const input = {
    setDraft(value) { submissions.push(['draft', value]) },
    submit(mode) { submissions.push(['submit', mode]) }
  }
  const sessions = {
    scope(id) { return id === 'session-magic-fairy' ? {} : undefined },
    list: {
      getSnapshot() { return { byId: { 'session-magic-fairy': summary } } },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
    }
  }
  const ctx = { sessions, get(name) { return name === 'conversation' ? { input: { for() { return input } } } : undefined } }
  const execute = client.createTavernFrameSlashExecutor(ctx, { setTimeout, clearTimeout })
  const completed = execute('/send <开局信息>\n魔法少女|/trigger', 'session-magic-fairy')

  assert.deepEqual(submissions, [['draft', '<开局信息>\n魔法少女'], ['submit', 'queue']])
  summary.running = true
  listeners.forEach(listener => listener())
  summary.running = false
  listeners.forEach(listener => listener())
  assert.deepEqual(JSON.parse(JSON.stringify(await completed)), { submitted: true })
  assert.equal(listeners.size, 0)
  await assert.rejects(execute('/compact', 'session-magic-fairy'), /没有注册这条命令/)
})

test('消息 iframe 首次缺少 Helper Context 时，在上下文抵达后重建为可交互文档', () => {
  const lifecycle = client.createTavernMessageFrameLifecycle({
    sessionId: 'session-late-context', content: '<button>开始游戏</button>', turn: 1, partIndex: 0,
    helperContext: null, eager: true
  }, { window: { crypto: { randomUUID: (() => { let id = 0; return () => `late-context-${++id}` })() }, sessionStorage: { getItem() { return null }, setItem() {} }, document: null, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} } })
  const first = lifecycle.snapshot().visibleDocument
  assert.doesNotMatch(first.html, /data-dsh-tavern-helper/)

  lifecycle.update({
    sessionId: 'session-late-context', content: '<button>开始游戏</button>', turn: 1, partIndex: 0,
    helperContext: { lifecycleRevision: 1, messages: [] }, eager: true
  })
  const pending = lifecycle.snapshot().pendingDocument
  assert.ok(pending)
  assert.match(pending.html, /data-dsh-tavern-helper/)
})

test('Helper Context 首次快照后只发送消息和变量增量', () => {
  const previous = {
    version: 1,
    stateRevision: 4,
    lifecycleRevision: 0,
    messages: [{ message_id: 0, role: 'assistant', message: '开场', variables: { hp: 10 } }],
    turnMessageIds: { 1: 0 },
    chatVariables: {},
    scriptVariables: {}
  }
  const next = {
    version: 1,
    stateRevision: 5,
    lifecycleRevision: 0,
    messages: [
      { message_id: 0, role: 'assistant', message: '开场', variables: { hp: 9 } },
      { message_id: 1, role: 'assistant', message: '正文', variables: { hp: 8 } }
    ],
    turnMessageIds: { 1: 0, 2: 1 },
    chatVariables: {},
    scriptVariables: {}
  }

  const update = client.createTavernHelperContextUpdate(previous, next, 1, 2)

  assert.equal(update.kind, 'patch')
  assert.equal(update.baseRevision, 4)
  assert.deepEqual(JSON.parse(JSON.stringify(update.operations.map(item => item.op))), ['message.replace', 'messages.append', 'value.replace'])
  assert.deepEqual(JSON.parse(JSON.stringify(update.events)), ['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'mag_variable_update_ended'])
  assert.deepEqual(JSON.parse(JSON.stringify(client.applyTavernHelperContextUpdate(previous, update))), { context: next, turn: 2, events: JSON.parse(JSON.stringify(update.events)) })
  assert.throws(function () {
    client.applyTavernHelperContextUpdate(Object.assign({}, previous, { stateRevision: 3 }), update)
  }, /版本失配/)
})

test('人物卡手机进入酒馆状态应用槽并由 ShadowRoot 直接加载内置图标', async () => {
  const shadowChildren = []
  const phoneWrapper = { className: 'phone-wrapper' }
  let phoneMounted = false
  let iconsInstalledAfterMount = false
  const shadowRoot = {
    ownerDocument: null,
    querySelector(selector) {
      if (selector === '.phone-wrapper') return phoneWrapper
      if (selector.includes('font-awesome') || selector.includes('fontawesome')) return shadowChildren.find((node) => node.tagName === 'LINK') || null
      if (selector === '[data-dsh-tavern-card-app-layout]') return shadowChildren.find((node) => node.layoutStyle) || null
      return null
    },
    appendChild(node) { shadowChildren.push(node); node.parentNode = this; return node }
  }
  function element(tagName) {
    const attributes = new Map()
    return {
      tagName: tagName.toUpperCase(), style: { setProperty(name, value) { this[name] = value } },
      appendChild(node) { node.parentNode = this; this.child = node; return node },
      setAttribute(name, value) {
        attributes.set(name, String(value))
        if (name === 'href') this.href = String(value)
      },
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
      removeAttribute(name) { attributes.delete(name) }
    }
  }
  const body = { children: [], appendChild(node) { node.parentNode = this; this.children.push(node); return node } }
  const head = { appendChild(node) { node.parentNode = this; this.child = node; return node } }
  const host = element('div')
  host.id = 'improved-phone-shadow-host-card-script'
  host.shadowRoot = shadowRoot
  body.appendChild(host)
  const floatingButton = element('button')
  floatingButton.id = 'improved-phone-floating-button-card-script'
  const document = {
    body, head,
    createElement: element,
    querySelectorAll(selector) { return selector.includes('shadow-host') ? [host] : [] },
    querySelector(selector) {
      if (selector.includes('floating-button')) return floatingButton
      return body.children.find((node) => node.getAttribute && node.getAttribute('data-dsh-tavern-card-app-parking') !== null) || null
    }
  }
  shadowRoot.ownerDocument = document
  const slot = { clientWidth: 320, appendChild(node) { phoneMounted = true; node.parentNode = this; this.child = node; return node } }

  const controller = client.createTavernCardAppDock({
    document, slot, sessionId: 'session-phone', MutationObserver: null, ResizeObserver: null,
    loadIconCss() { iconsInstalledAfterMount = phoneMounted; return Promise.resolve('.fas{font-family:icons}') }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(slot.child, host)
  assert.equal(host.style.position, 'relative')
  assert.equal(host.style['--dsh-tavern-card-app-scale'], String(296 / 360))
  const icons = shadowChildren.find((node) => node.tagName === 'STYLE' && !node.layoutStyle)
  assert.equal(icons.textContent, '.fas{font-family:icons}')
  assert.equal(iconsInstalledAfterMount, true, 'ShadowRoot stylesheet must be installed after cross-document adoption')
  assert.match(head.child.textContent, /Font Awesome 6 Free/)
  assert.match(head.child.textContent, /fontawesome\/webfonts\/fa-solid-900\.woff2/)
  assert.ok(shadowChildren.some((node) => node.layoutStyle))
  assert.equal(floatingButton.style.display, 'none')

  controller.dispose()
  const parking = body.children.find((node) => node.getAttribute && node.getAttribute('data-dsh-tavern-card-app-parking') !== null)
  assert.ok(parking, '状态面板卸载后必须保留一个隐藏停放容器')
  assert.equal(parking.hidden, true)
  assert.equal(parking.child, host, '手机必须停放在隐藏容器，不能恢复成全局浮层')
  assert.equal(floatingButton.style.display, 'none')

  const unrelatedSlot = { clientWidth: 360, appendChild(node) { node.parentNode = this; this.child = node; return node } }
  const unrelatedController = client.createTavernCardAppDock({ document, slot: unrelatedSlot, sessionId: 'session-without-phone', MutationObserver: null, ResizeObserver: null, loadIconCss() { return Promise.resolve('') } })
  assert.equal(unrelatedSlot.child, undefined, '没有手机的新 Session 不能接管上一张卡停放的手机')
  assert.equal(unrelatedController.inspect().attached, false)
  unrelatedController.dispose()

  const nextSlot = { clientWidth: 360, appendChild(node) { node.parentNode = this; this.child = node; return node } }
  const nextController = client.createTavernCardAppDock({ document, slot: nextSlot, sessionId: 'session-phone', MutationObserver: null, ResizeObserver: null, loadIconCss() { return Promise.resolve('') } })
  assert.equal(nextSlot.child, host, '重新进入酒馆状态面板后应接回同一个手机实例')
  nextController.dispose()
})

test('消息 iframe 在人物卡脚本前提供隔离的 localStorage 兼容层', () => {
  const document = client.buildTavernFrameDocument({
    content: '<script data-card-script>window.cardTheme = localStorage.getItem("theme") || "night";<\/script>',
    token: 'storage-token'
  })
  const shim = document.match(/<script data-dsh-tavern-storage>([\s\S]*?)<\/script>/)
  assert.ok(shim)
  assert.ok(document.indexOf('data-dsh-tavern-storage') < document.indexOf('data-card-script'))

  const isolatedWindow = {}
  Object.defineProperty(isolatedWindow, 'localStorage', {
    configurable: true,
    get() { throw new Error('opaque origin') }
  })
  vm.runInNewContext(shim[1], { window: isolatedWindow })

  assert.equal(isolatedWindow.localStorage.getItem('theme'), null)
  isolatedWindow.localStorage.setItem('theme', 'jade')
  assert.equal(isolatedWindow.localStorage.getItem('theme'), 'jade')
  assert.equal(isolatedWindow.localStorage.length, 1)
  assert.equal(isolatedWindow.localStorage.key(0), 'theme')
  isolatedWindow.localStorage.removeItem('theme')
  assert.equal(isolatedWindow.localStorage.getItem('theme'), null)
})

test('人物卡 Helper 脚本使用独立不透明 iframe，并获得脚本、世界书和 MVU facade', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'script-token',
    script: { id: 'dynamic-worldbook', name: '动态世界书', content: "import 'https://example.test/动态世界书.js'", data: { auto_apply: true }, buttons: [] },
    context: { messages: [], scriptVariables: { 'dynamic-worldbook': { auto_apply: true } }, worldbook: { name: '灯火阑珊', entries: [] } }
  })
  const loader = helperLoaderSource(document)
  const modules = JSON.parse(loader.match(/const scripts=(\[.*\]);/)[1])
  const source = modules[0].content
  assert.equal(source, "import 'https://example.test/动态世界书.js'")
  assert.match(loader, /await window\.__dshTavernInitializationTiming\.wait\("companion-module",loadModule\(script\.content,script\.id,false,installComposer\),script\.id\)/)
  assert.match(loader, /__dshTavernHelperSetCurrentScript\(script\.id\)/)
  assert.match(loader, /__dshTavernHelperSubscriptionsReady\(script\.id\)/)
  assert.match(document, /getScriptId/)
  assert.match(document, /updateWorldbookWith/)
  assert.match(document, /appendInexistentScriptButtons/)
	assert.match(document, /getCharData/)
  assert.match(document, /insertOrAssignVariables/)
  assert.match(document, /insertVariables/)
  assert.match(document, /localStorage/)
  assert.match(document, /VARIABLE_UPDATE_ENDED:\s*"mag_variable_update_ended"/)
  assert.match(document, /COMMAND_PARSED:\s*"mag_command_parsed"/)
  assert.match(document, /dsh-tavern-helper-script-runtime/)
  assert.match(document, /object-src 'none'/)
  assert.doesNotMatch(document, /allow-same-origin/)
})

test('Helper Host 在受信任人物卡模式中完全移除 sandbox', () => {
  const frames = []
  const hostWindow = {
    crypto: { randomUUID() { return 'trusted-runtime-token' } },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const hostDocument = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (['html', 'head', 'body'].includes(tag)) return { appendChild() {} }
      if (tag === 'div') return root
      const frame = { contentWindow: { postMessage() {} }, addEventListener() {}, remove() { this.removed = true } }
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({ window: hostWindow, document: hostDocument, rpc() { return Promise.resolve({}) }, reportError() {} })
  const base = { tavernHelper: { messages: [], scriptVariables: {} }, tavernHelperScripts: [{ id: 'script', name: '脚本', content: 'void 0', data: {}, buttons: [] }] }

  runtime.sync('session', base)
  assert.equal(frames[0].sandbox, 'allow-scripts')

  runtime.sync('session', Object.assign({}, base, { tavernRuntimePolicy: { trustedCardMode: true } }))
  assert.equal(frames[0].removed, true)
  assert.equal(frames[1].sandbox, undefined)
})

test('Helper Host 切换人物卡时清理旧卡注入宿主的顶层节点和样式', () => {
  function node(name) {
    return {
      name,
      parentNode: null,
      remove() {
        if (!this.parentNode) return
        const index = this.parentNode.childNodes.indexOf(this)
        if (index >= 0) this.parentNode.childNodes.splice(index, 1)
        this.parentNode = null
      }
    }
  }
  function container(children = []) {
    const value = node('container')
    value.childNodes = children
    value.appendChild = child => {
      child.parentNode = value
      value.childNodes.push(child)
      return child
    }
    for (const child of children) child.parentNode = value
    return value
  }

  const permanentBodyNode = node('application-root')
  const permanentHeadNode = node('application-style')
  const body = container([permanentBodyNode])
  const head = container([permanentHeadNode])
  const frames = []
  const hostWindow = {
    crypto: { randomUUID() { return String(frames.length + 1) } },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  }
  const hostDocument = {
    body,
    head,
    documentElement: body,
    createElement(tag) {
      if (['html', 'head', 'body'].includes(tag)) return container()
      if (tag === 'div') {
        const root = container()
        root.isConnected = true
        root.remove = node('root').remove
        return root
      }
      const frame = node('iframe')
      frame.contentWindow = { postMessage() {} }
      frame.addEventListener = () => {}
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({ window: hostWindow, document: hostDocument, rpc() { return Promise.resolve({}) }, reportError() {} })
  const view = content => ({
    tavernRuntimePolicy: { trustedCardMode: true },
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [{ id: 'script', name: '脚本', content, data: {}, buttons: [] }]
  })

  runtime.sync('session', view('card A'))
  const leakedButton = node('card A floating button')
  const leakedStyle = node('card A style')
  frames[0].__dshTavernHostArtifacts.trackNode(leakedButton)
  frames[0].__dshTavernHostArtifacts.trackNode(leakedStyle)
  body.appendChild(leakedButton)
  head.appendChild(leakedStyle)

  runtime.sync('session', view('card A'))
  assert.deepEqual(body.childNodes.includes(leakedButton), true)
  assert.deepEqual(head.childNodes.includes(leakedStyle), true)

  runtime.sync('session', view('card B'))

  assert.deepEqual(body.childNodes.includes(permanentBodyNode), true)
  assert.deepEqual(head.childNodes.includes(permanentHeadNode), true)
  assert.deepEqual(body.childNodes.includes(leakedButton), false)
  assert.deepEqual(head.childNodes.includes(leakedStyle), false)
})

test('Helper Host 每个对话只创建一个共享脚本沙箱并只投递一次事件', async () => {
  const windowListeners = new Map()
  const frames = []
  const hostWindow = {
    crypto: { randomUUID() { return 'shared-runtime-token' } },
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
    reportError() {}
  })
  runtime.sync('session', {
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [
      { id: 'idle', name: '未订阅脚本', content: 'void 0', data: {}, buttons: [] },
      { id: 'first', name: '变量守卫一', content: 'void 0', data: {}, buttons: [] },
      { id: 'second', name: '变量守卫二', content: 'void 0', data: {}, buttons: [] }
    ]
  })
  assert.equal(frames.length, 1)
  frames[0].listeners.load()
  const receive = windowListeners.get('message')
  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions',
      token: 'shared-runtime-token',
      names: ['mag_command_parsed'],
      ready: true,
      scripts: [
        { id: 'idle', names: [], ready: true, failed: false },
        { id: 'first', names: ['mag_command_parsed'], ready: true, failed: false },
        { id: 'second', names: ['mag_command_parsed'], ready: true, failed: false }
      ]
    }
  })

  const emitted = runtime.emit('mag_command_parsed', [{ hp: 1 }], { messages: [] })
  await Promise.resolve()
  const requests = frames[0].contentWindow.messages.filter(item => item.type === 'dsh-tavern-helper-event')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'mag_command_parsed')
  receive({
    source: frames[0].contentWindow,
    data: { type: 'dsh-tavern-helper-event-complete', token: 'shared-runtime-token', eventId: requests[0].eventId, args: [{ hp: 3 }] }
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await emitted)), [{ hp: 3 }])
  runtime.dispose()
})

test('Helper Host 生命周期事件保留官方 MVU 识别角色回复所需的消息身份', async () => {
  const windowListeners = new Map()
  const frames = []
  const hostWindow = {
    crypto: { randomUUID() { return 'identity-runtime-token' } },
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
    reportError() {}
  })
  runtime.sync('session', {
    chatId: 'chat-1',
    playerName: '你',
    card: { name: '灯火阑珊' },
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [{ id: 'official', name: '官方 MVU Core', content: 'void 0', data: {}, buttons: [] }]
  })
  frames[0].listeners.load()
  const receive = windowListeners.get('message')
  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions', token: 'identity-runtime-token', names: ['MESSAGE_RECEIVED'], ready: true,
      scripts: [{ id: 'official', names: ['MESSAGE_RECEIVED'], ready: true, failed: false }]
    }
  })

  const diagnostics = []
  const emitted = runtime.emit('MESSAGE_RECEIVED', [0], {
    lifecycleRevision: 2,
    messages: [{ message_id: 0, role: 'assistant', message: '正文\n\n<UpdateVariable>...</UpdateVariable>', swipe_id: 0 }]
  }, diagnostics)
  await Promise.resolve()
  const contextMessage = frames[0].contentWindow.messages.filter(item => item.type === 'dsh-tavern-helper-context').at(-1)
  assert.equal(contextMessage.context.characterName, '灯火阑珊')
  assert.equal(contextMessage.context.playerName, '你')
  assert.equal(contextMessage.context.messages[0].name, '灯火阑珊')
  assert.equal(contextMessage.context.messages[0].is_user, false)
  assert.equal(contextMessage.context.messages[0].mes, '正文\n\n<UpdateVariable>...</UpdateVariable>')

  const request = frames[0].contentWindow.messages.find(item => item.type === 'dsh-tavern-helper-event')
  receive({ source: frames[0].contentWindow, data: { type: 'dsh-tavern-helper-diagnostic', token: 'identity-runtime-token', eventId: request.eventId, scriptId: 'official', level: 'warn', message: '初始化尚未完成' } })
  receive({ source: {}, data: { type: 'dsh-tavern-helper-diagnostic', token: 'identity-runtime-token', eventId: request.eventId, level: 'warn', message: 'forged' } })
  receive({
    source: frames[0].contentWindow,
    data: { type: 'dsh-tavern-helper-event-complete', token: 'identity-runtime-token', eventId: request.eventId, args: [0] }
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await emitted)), [0])
  assert.equal(diagnostics.length, 2)
  assert.equal(diagnostics[0].subscribed, true)
  assert.equal(diagnostics[1].message, '初始化尚未完成')
  runtime.dispose()
})

test('Helper Host 失联会指出正在执行的脚本、关闭事件并屏蔽迟到写入', async () => {
  const windowListeners = new Map()
  const frames = []
  const errors = []
  const rpcCalls = []
  const hostWindow = {
    crypto: { randomUUID() { return 'timeout-runtime-token' } },
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
    eventTimeoutMs: 25,
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

  await assert.rejects(emitted, /变量守卫.*MESSAGE_RECEIVED.*失联/)
  assert.deepEqual(errors.map(item => item.source), ['人物卡脚本「变量守卫」'])

  receive({
    source: frames[0].contentWindow,
    data: {
      type: 'dsh-tavern-helper-call', token: 'timeout-runtime-token', eventId: request.eventId,
      requestId: 'late-call', method: 'updateTavernHelperVariables', args: { variables: { hp: 1 } }
    }
  })
  await Promise.resolve()
  assert.equal(rpcCalls.length, 0)
  assert.equal(frames[0].contentWindow.messages.find(item => item.requestId === 'late-call').ok, false)
  runtime.dispose()
})

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

test('Helper Host 成功初始化后只请求清除本次启动前的同源错误', async () => {
  const windowListeners = new Map()
  const resolved = []
  const hostWindow = {
    crypto: { randomUUID() { return 'resolve-old-error-token' } },
    setTimeout,
    clearTimeout,
    addEventListener(name, handler) { windowListeners.set(name, handler) },
    removeEventListener(name) { windowListeners.delete(name) }
  }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  let frame
  const hostDocument = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (tag === 'div') return root
      frame = {
        contentWindow: { postMessage() {} },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler },
        remove() {}
      }
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({
    window: hostWindow,
    document: hostDocument,
    rpc() { return Promise.resolve({}) },
    reportError() {},
    resolveError(source, beforeAt) { resolved.push({ source, beforeAt }) }
  })

  runtime.sync('session', {
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [{ id: 'schema', name: '变量结构', content: 'void 0', data: {}, buttons: [] }]
  })
  frame.listeners.load()
  windowListeners.get('message')({
    source: frame.contentWindow,
    data: {
      type: 'dsh-tavern-helper-subscriptions',
      token: 'resolve-old-error-token',
      names: [],
      ready: true,
      scripts: [{ id: 'schema', names: [], ready: true, failed: false }]
    }
  })

  assert.deepEqual(resolved.map(item => item.source), ['人物卡脚本「变量结构」', '人物卡共享脚本沙箱'])
  assert.ok(resolved.every(item => Number.isFinite(item.beforeAt)))
  runtime.dispose()
})

test('Helper Host 初始化超时只结算一次并继续启动其他能力', async () => {
  const windowListeners = new Map()
  const timers = new Map()
  const errors = []
  const readySessions = []
  let timerSequence = 0
  const hostWindow = {
    crypto: { randomUUID() { return 'timeout-token' } },
    setTimeout(handler) { timerSequence += 1; timers.set(timerSequence, handler); return timerSequence },
    clearTimeout(id) { timers.delete(id) },
    addEventListener(name, handler) { windowListeners.set(name, handler) },
    removeEventListener(name) { windowListeners.delete(name) }
  }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  let frame
  const hostDocument = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (tag === 'div') return root
      frame = {
        contentWindow: { postMessage() {} },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler },
        remove() {}
      }
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({
    window: hostWindow,
    document: hostDocument,
    initializationTimeoutMs: 1000,
    rpc() { return Promise.resolve({}) },
    onReady(sessionId) { readySessions.push(sessionId) },
    reportError(source, error) { errors.push({ source, message: error.message }) }
  })
  runtime.sync('session', {
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [{ id: 'broken', name: '损坏脚本', content: 'void 0', data: {}, buttons: [] }]
  })
  frame.listeners.load()
  assert.equal(timers.size, 1)
  timers.values().next().value()
  await Promise.resolve()

  assert.deepEqual(readySessions, ['session'])
  assert.deepEqual(errors, [{ source: '人物卡脚本「损坏脚本」', message: '初始化超时（1000ms）' }])
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.inspect().scripts)), [
    { id: 'broken', loaded: true, subscriptionsReady: false, initializationFailed: true }
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(await runtime.emit('mag_command_parsed', [{ hp: 1 }], { messages: [] }))), [{ hp: 1 }])
  assert.equal(errors.length, 1)
  runtime.dispose()
})

test('持久 Helper Host 复用同一脚本 iframe、发送生命周期事件并限制 RPC', async () => {
  const windowListeners = new Map()
  const frames = []
  const calls = []
	const mutations = []
	const readySessions = []
  const hostWindow = {
	crypto: { randomUUID() { return 'runtime-token' } },
	setTimeout,
	clearTimeout,
    addEventListener(name, handler) { windowListeners.set(name, handler) },
    removeEventListener(name) { windowListeners.delete(name) }
  }
  const root = {
    isConnected: true,
	style: {},
    children: [],
    appendChild(node) { this.children.push(node); node.parent = this },
    remove() { this.isConnected = false }
  }
  const hostDocument = {
    body: { appendChild(node) { node.isConnected = true } },
    documentElement: { appendChild() {} },
    createElement(tag) {
      if (tag === 'div') return root
      const frame = {
		style: {},
        contentWindow: { messages: [], postMessage(message) { this.messages.push(message) } },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler },
        remove() { this.removed = true }
      }
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({
    window: hostWindow,
    document: hostDocument,
    rpc(method, args, sessionId) { calls.push({ method, args, sessionId }); return Promise.resolve({ ok: true }) },
	onMutation(sessionId, method) { mutations.push({ sessionId, method }) },
	onReady(sessionId) { readySessions.push(sessionId) },
    reportError() {}
  })
  function view(messages) {
    return {
		card: { name: '灯火阑珊', first_mes: '开场一', alternate_greetings: ['开场二'] },
      tavernHelper: { messages, scriptVariables: {} },
      tavernHelperWorldbook: { name: '灯火阑珊', entries: [] },
      tavernHelperScripts: [{ id: 'dynamic', name: '动态世界书', content: 'void 0', data: { enabled: true }, buttons: [] }]
    }
  }
  runtime.sync('session-1', view([]))
  assert.equal(runtime.inspect().sessionId, 'session-1')
  assert.deepEqual(Array.from(runtime.inspect().scriptIds), ['dynamic'])
  assert.equal(frames[0].sandbox, 'allow-scripts')
	frames[0].listeners.load()
	await Promise.resolve()
	assert.deepEqual(readySessions, [])
	assert.deepEqual(frames[0].contentWindow.messages.map(item => item.type), ['dsh-tavern-helper-context'])
	assert.deepEqual(JSON.parse(JSON.stringify(frames[0].contentWindow.messages[0].context.character)), {
		name: '灯火阑珊',
		first_mes: '开场一',
		alternate_greetings: ['开场二'],
		data: { name: '灯火阑珊', first_mes: '开场一', alternate_greetings: ['开场二'] }
	})
	windowListeners.get('message')({
		source: frames[0].contentWindow,
		data: { type: 'dsh-tavern-helper-subscriptions', token: 'runtime-token', names: ['dynamic_7510203320239904', 'MESSAGE_RECEIVED', 'COMMAND_PARSED'], ready: true }
	})
	await Promise.resolve()
	assert.deepEqual(readySessions, ['session-1'])

	const buttonResult = runtime.triggerButton('dynamic', '开场白索引')
	const buttonRequest = frames[0].contentWindow.messages.at(-1)
	assert.equal(buttonRequest.name, 'dynamic_7510203320239904')
	windowListeners.get('message')({
		source: frames[0].contentWindow,
		data: { type: 'dsh-tavern-helper-event-complete', token: 'runtime-token', eventId: buttonRequest.eventId, args: [] }
	})
	assert.deepEqual(JSON.parse(JSON.stringify(await buttonResult)), [])
	windowListeners.get('message')({ source: frames[0].contentWindow, data: { type: 'dsh-tavern-helper-ui-open', token: 'runtime-token' } })
	assert.equal(root.hidden, false)
	assert.match(frames[0].style.cssText, /width:100%/)
	windowListeners.get('message')({ source: frames[0].contentWindow, data: { type: 'dsh-tavern-helper-ui-close', token: 'runtime-token' } })
	assert.equal(root.hidden, true)

	runtime.sync('session-1', view([{ message_id: 0, role: 'assistant', message: '正文', swipe_id: 0, variables: { stat_data: { hp: 1 } } }]))
  assert.equal(frames.length, 1)
	assert.deepEqual(readySessions, ['session-1'], '同一批脚本的普通上下文刷新不得重复触发初始化')
	assert.deepEqual(frames[0].contentWindow.messages.filter(item => item.type === 'dsh-tavern-helper-event').map(item => item.name), ['dynamic_7510203320239904', 'MESSAGE_RECEIVED'])

	const explicitLifecycle = view([{ message_id: 0, role: 'assistant', message: '新正文', swipe_id: 1, variables: { stat_data: { hp: 2 } } }])
	explicitLifecycle.tavernHelper.lifecycleRevision = 1
	runtime.sync('session-1', explicitLifecycle)
	assert.deepEqual(frames[0].contentWindow.messages.filter(item => item.type === 'dsh-tavern-helper-event').map(item => item.name), ['dynamic_7510203320239904', 'MESSAGE_RECEIVED'])

  windowListeners.get('message')({
    source: frames[0].contentWindow,
    data: { type: 'dsh-tavern-helper-call', token: 'runtime-token', requestId: '1', method: 'getTavernHelperWorldbook', args: { name: '灯火阑珊' } }
  })
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ method: 'getTavernHelperWorldbook', args: { name: '灯火阑珊', apiCallOrigin: { scriptId: '', scriptName: '', eventId: '', requestId: '1' } }, sessionId: 'session-1' }])
  assert.equal(frames[0].contentWindow.messages.at(-1).type, 'dsh-tavern-helper-response')
	assert.deepEqual(mutations, [])

	windowListeners.get('message')({
		source: frames[0].contentWindow,
		data: { type: 'dsh-tavern-helper-call', token: 'runtime-token', requestId: '2', method: 'updateTavernHelperMessages', args: { messages: [{ message_id: 0, swipe_id: 1 }] } }
	})
	await Promise.resolve()
	await new Promise(resolve => setImmediate(resolve))
	assert.deepEqual(mutations, [{ sessionId: 'session-1', method: 'updateTavernHelperMessages' }])

  const emitted = runtime.emit('COMMAND_PARSED', [{ stat_data: {} }, [{ type: 'set' }]], { messages: [] })
	const request = frames[0].contentWindow.messages.at(-1)
	assert.equal(request.type, 'dsh-tavern-helper-event')
	assert.equal(request.name, 'COMMAND_PARSED')
	windowListeners.get('message')({
		source: frames[0].contentWindow,
		data: { type: 'dsh-tavern-helper-event-complete', token: 'runtime-token', eventId: request.eventId, args: [{ stat_data: {} }, []] }
	})
	assert.deepEqual(JSON.parse(JSON.stringify(await emitted)), [{ stat_data: {} }, []])
  runtime.dispose()
})

test('用户气泡优先展示持久化原始输入，不展示 promptOnly 的 Session 投影', () => {
  const sessionContent = [{ type: 'text', text: '<interactive_input>\n原始输入\n</interactive_input>' }]

  assert.equal(client.tavernUserTextForTurn({ inputSources: { 2: '原始输入' } }, 2, sessionContent), '原始输入')
  assert.equal(client.tavernUserTextForTurn({}, 2, sessionContent), '<interactive_input>\n原始输入\n</interactive_input>')
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

test('开场选择经过当前 iframe 来源校验，不调用 Session RPC，卸载后旧页面失效', () => {
  const listeners = new Map(), chosen = [], replies = []
  const frame = { contentWindow: { postMessage(data) { replies.push(data) } } }
  const host = { sessionStorage: { getItem() { return null }, setItem() {} }, document: null, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } }
  const lifecycle = client.createTavernMessageFrameLifecycle({ sessionId: '', content: '<button>选择开场</button>', turn: 1,
    openingPreview: { swipes: ['首页', '海边'], openingIds: ['primary', 'alternate:0'], selectedIndex: 0 },
    onSelectOpening: id => chosen.push(id)
  }, { window: host, rpc() { throw Error('预览不得写入 Session') } })
  const doc = lifecycle.snapshot().visibleDocument; doc.ref(frame)
  const stop = lifecycle.start(() => {}), receive = listeners.get('message')
  const data = { type: 'dsh-tavern-opening-select', token: doc.token, requestId: '1', swipeId: 1 }
  receive({ source: {}, data }); assert.equal(chosen.length, 0)
  receive({ source: frame.contentWindow, data }); assert.deepEqual(chosen, ['alternate:0'])
  receive({ source: frame.contentWindow, data: { ...data, swipeId: 999 } }); assert.equal(replies.at(-1).ok, false)
  lifecycle.update({ sessionId: '', content: '<button>另一张卡</button>', turn: 1, openingPreview: { swipes: ['新首页', '新开场'], openingIds: ['primary', 'alternate:0'], selectedIndex: 0 }, onSelectOpening: id => chosen.push(id) })
  receive({ source: frame.contentWindow, data }); assert.equal(chosen.length, 1, '旧预览不能切换新卡的开场')
  stop(); assert.equal(listeners.has('message'), false)
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

test('iframe 是独立页面导航，不经静态缓存代理', () => {
  const html = '<iframe src="https://app.example/hud/"></iframe><img src="https://app.example/a.png">'
  for (const doc of [client.buildOpeningPreviewDocument(html), client.buildTavernFrameDocument({ content: html })]) {
    assert.match(doc, /<iframe src="https:\/\/app.example\/hud\/"/)
    assert.ok(doc.includes('/api/dsh-tavern/static-assets?url=' + encodeURIComponent('https://app.example/a.png')))
  }
  const script = client.buildTavernFrameDocument({ content: '<div></div>' }).match(/<script data-dsh-tavern-static-cache>([\s\S]*?)<\/script>/)[1]
  let observe
  class Element {
    constructor(tag) { this.tagName = tag; this.nodeType = 1; this.attrs = {} }
    setAttribute(k, v) { this.attrs[k] = v }
    getAttribute(k) { return this.attrs[k] }
  }
  class Frame extends Element {}
  Object.defineProperty(Frame.prototype, 'src', { configurable: true, get() { return this.attrs.src }, set(v) { this.attrs.src = v } })
  vm.runInNewContext(script, { window: { HTMLIFrameElement: Frame }, Element, document: { documentElement: {} }, MutationObserver: class { constructor(fn) { observe = fn } observe() {} } })
  const byProperty = new Frame('IFRAME'); byProperty.src = 'https://app.example/hud/?mode=landscape'
  const byAttribute = new Frame('IFRAME'); byAttribute.setAttribute('src', 'https://app.example/hud/')
  observe([byProperty, byAttribute].map(target => ({ target })))
  assert.equal(byProperty.src, 'https://app.example/hud/?mode=landscape')
  assert.equal(byAttribute.getAttribute('src'), 'https://app.example/hud/')
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

test('frame slash requests reject promptly when generation is unavailable instead of remaining pending', async () => {
  for (const executeSlash of [undefined, () => { throw new Error('executor failed') }]) {
    const listeners = new Map()
    const replies = []
    const frame = { contentWindow: { postMessage(message) { replies.push(message) } } }
    const lifecycle = client.createTavernMessageFrameLifecycle({
      sessionId: 'opening', content: '<button>start</button>', turn: 1, partIndex: 0,
      helperContext: { lifecycleRevision: 1, messages: [] }, eager: true, executeSlash
    }, { window: {
      crypto: { randomUUID() { return 'slash-token' } },
      sessionStorage: { getItem() { return null }, setItem() {} }, document: null, setTimeout, clearTimeout,
      addEventListener(name, handler) { listeners.set(name, handler) }, removeEventListener(name) { listeners.delete(name) }
    } })
    const doc = lifecycle.snapshot().visibleDocument
    doc.ref(frame)
    const stop = lifecycle.start(() => {})
    listeners.get('message')({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: doc.token, requestId: 'trigger', method: 'triggerTavernSlash', args: { line: '/trigger' } } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(replies.length, 1)
    assert.equal(replies[0].ok, false)
    assert.match(replies[0].error, /无法触发生成|executor failed/)
    stop()
  }
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

test('preparation host APIs retain priority over a background session runtime', () => {
  const host = {}, preparation = { Mvu: { id: 'preparation' }, _: {} }, session = { Mvu: { id: 'session' } }
  const releasePreparation = client.installTavernTrustedHostFacade(host, preparation, 10)
  const releaseSession = client.installTavernTrustedHostFacade(host, session)
  assert.equal(host.Mvu, preparation.Mvu)
  releasePreparation()
  assert.equal(host.Mvu, session.Mvu)
  releaseSession()
  assert.equal(Object.hasOwn(host, 'Mvu'), false)
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

test('opening refresh submits the same preparation draft that its iframe writes', () => {
  const updater = clientSource.match(/setOpeningPicker\(function \(current\) \{([\s\S]*?)\n\s*\}\);/)[1]
  const response = { preparationId: 'new-draft', trustedCardMode: true, openings: [
    { id: 'alternate:0', openingPreview: { preparationId: 'new-draft' } }, { id: 'primary' }
  ] }
  const refresh = vm.runInNewContext('(function(current){' + updater + '})', { response, cardPath: 'card.json', userName: '你', preparedKey: '["你","dsh"]' })
  const next = refresh({ card: { path: 'card.json' }, userName: '你', preparationId: 'old-draft', index: 1, openings: [{ id: 'primary' }, { id: 'alternate:0' }] })
  assert.equal(next.openings[next.index].id, 'alternate:0')
  assert.equal(next.preparationId, next.openings[next.index].openingPreview.preparationId)
  assert.equal(next.preparedKey, '["你","dsh"]')
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

test('独立 /trigger 不向拒绝空输入的宿主提交空 prompt', async () => {
  const calls = []
  const ctx = {
    sessions: {
      scope: () => ({}),
      binding: () => ({ session: { prompt: async content => {
        calls.push(content)
        if (!content.some(part => part.type === 'text' && part.text.trim())) {
          return { ok: false, error: { message: 'prompt content must include non-whitespace text or an attachment (gateway/bad-request)' } }
        }
        return { ok: true }
      } } })
    },
    get: () => ({ input: { for: () => ({ setDraft: assert.fail, submit: assert.fail }) } })
  }
  const execute = client.createTavernFrameSlashExecutor(ctx, { setTimeout, clearTimeout })
  assert.equal((await execute('/trigger', 'game', { waitForCompletion: false })).submitted, true)
  assert.equal(calls.length, 1)
})

test('unsupported card pipelines fail before draft mutation or generation', async () => {
  const calls = []
  const ctx = { sessions: { scope: () => ({}) }, get: () => ({ input: { for: () => ({ setDraft: x => calls.push(x), submit: () => calls.push('submit') }) } }), remote: { commands: { execute: async () => { calls.push('remote'); return {} } } } }
  const execute = client.createTavernFrameSlashExecutor(ctx, { setTimeout, clearTimeout })
  for (const command of ['/cut', '/unknown']) {
    await assert.rejects(execute(`/send 创建结果 | ${command} 0 | /trigger`, 'game', { waitForCompletion: false }), error => error.code === 'UNSUPPORTED_SLASH_PIPELINE' && error.message.includes(command))
  }
  await assert.rejects(execute('/cut 0', 'game'), /未发送消息/ )
  assert.deepEqual(calls, [])
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

test('deferred Helper starts once with authenticated complete context and waits for dependencies',async()=>{
 const listeners=new Set(),parent={postMessage(){}}
 const window={addEventListener(_kind,fn){listeners.add(fn)},removeEventListener(_kind,fn){listeners.delete(fn)}}
 const start=vm.runInNewContext('('+client.startTavernHelperFromMessage.toString()+')',{window,parent,Promise})
 let calls=0,received,finish
 start({token:'t'},context=>{calls++;received=context;window.__dshTavernHelperReady=new Promise(resolve=>{finish=resolve})})
 const ready=window.__dshTavernHelperReady,receive=[...listeners][0],context={messages:[{message_id:0,message:'old'},{message_id:9999,message:'latest'}]}
 receive({source:{},data:{type:'dsh-tavern-helper-context',token:'t',context}})
 receive({source:parent,data:{type:'dsh-tavern-helper-context',token:'wrong',context}})
 assert.equal(calls,0)
 receive({source:parent,data:{type:'dsh-tavern-helper-context',token:'t',context}})
 assert.equal(calls,1);assert.equal(received,context);assert.equal(listeners.size,0)
 let settled=false;ready.then(()=>{settled=true});await Promise.resolve();assert.equal(settled,false)
 finish(true);assert.equal(await ready,true)
})

test('opening wire window expands absolute Helper ids without mutating the transport baseline',()=>{
 const input={historyWindow:{from:9998,to:9999,messageCount:10000,revision:2},tavernHelper:{stateRevision:2,messages:[{message_id:9998,message:'one'},{message_id:9999,message:'two'}],messagesPending:{from:0,to:9997}}}
 const view=client.expandTavernOpeningWindow(input)
 assert.equal(input.tavernHelper.messages.length,2)
 assert.equal(view.tavernHelper.messages.length,10000)
 assert.equal(view.tavernHelper.messages[9998].message,'one')
 assert.equal(view.tavernHelper.messages[0].stub,true)
 assert.equal(view.tavernHelper.messages[0].message_id,0)
 assert.equal(client.expandTavernOpeningWindow({tavernHelper:null}).tavernHelper,null)
})

test('on-demand Helper reads preserve synchronous old-floor values without loading history on open',()=>{
 const state={historyAccess:{token:'cap',revision:7},messages:[{message_id:0,stub:true},{message_id:1,message:'latest',variables:{hp:9}}]}
 const calls=[]
 const read=client.createTavernHistoryReader({context:()=>state,install:row=>{state.messages[row.message_id]=row},request:args=>{calls.push(args);return {revision:7,messages:[{message_id:0,message:'old',variables:{hp:4}}]}}})
 assert.equal(calls.length,0)
 assert.equal(read(1).variables.hp,9)
 assert.equal(calls.length,0)
 assert.equal(read(0).variables.hp,4)
 assert.equal(read(0).message,'old')
 assert.equal(calls.length,1)
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{token:'cap',revision:7,from:0,to:0})
})

test('lazy native chat facade saves no placeholder data and keeps loaded edits across window refresh', async()=>{
 let state={chatId:'a',lifecycleRevision:1,stateRevision:1,messages:[{message_id:0,stub:true},{message_id:1,message:'recent',role:'assistant',variables:{hp:1}}]}
 let reads=0, saves=0
 const facade=client.createTavernChatDataFacade({copy:structuredClone,context:()=>state,readMessage:id=>{reads++;const row={message_id:id,message:'old',role:'assistant',pluginData:{saved:1}};state.messages[id]=row;return row},request:async(_method,args)=>{saves++;return {context:state}}})
 assert.equal(facade.chat().length,2)
 await facade.save()
 assert.equal(reads,0)
 assert.equal(saves,0,'untouched placeholders are never plugin edits')
 const old=facade.chat()[0]
 old.local=2
 state={...state,stateRevision:2,messages:[{message_id:0,stub:true},state.messages[1]]}
 facade.sync(state)
 assert.equal(facade.chat()[0],old)
 assert.equal(old.local,2)
 assert.equal(reads,2)
 const held=facade.chat()
 state={...state,chatId:'b',messages:[]}
 facade.sync(state)
 assert.notEqual(facade.chat(),held)
 assert.equal(held[0],old,'an old held chat cannot resolve into a new session')
})

test('on-demand native chat remains a structured-cloneable array',()=>{
 const state={chatId:'a',stateRevision:1,messages:[{message_id:0,stub:true}]}
 const facade=client.createTavernChatDataFacade({context:()=>state,copy:structuredClone,request:async()=>({}),readMessage:()=>({message_id:0,role:'assistant',message:'old'})})
 const copied=structuredClone(facade.chat())
 assert.equal(copied[0].mes,'old')
 assert.equal(Array.isArray(copied),true)
})

test('window refresh invalidates clean historical rows without eagerly fetching them',()=>{
 let state={chatId:'a',stateRevision:1,messages:Array.from({length:100},(_,message_id)=>({message_id,role:'assistant',message:'old'}))}
 let reads=0
 const facade=client.createTavernChatDataFacade({context:()=>state,copy:structuredClone,request:async()=>({}),readMessage:id=>{reads++;return {message_id:id,role:'assistant',message:'fresh'}}})
 facade.chat()
 state={...state,stateRevision:2,messages:state.messages.map(({message_id})=>({message_id,stub:true}))}
 facade.sync(state)
 assert.equal(reads,0)
 assert.equal(facade.chat()[7].mes,'fresh')
 assert.equal(reads,1)
})

test('旧式开场脚本拥有独立 DOM，替换向导后隐藏原文且不破坏 React 节点', async () => {
  const {JSDOM}=await import('jsdom')
  const dom=new JSDOM('<div class="mes" mesid="0"><div id="native"><p>原文</p></div><div id="owned"></div></div>')
  const {document}=dom.window, node=document.getElementById('owned'), native=document.getElementById('native')
  const original=native.firstChild
  const stop=client.mountTavernLegacyMessage({node,native,source:'BOOT <script>unsafe()</script>'})
  assert.equal(node.hidden,true)
  assert.equal(native.hidden,false)
  const text=document.querySelector('.mes[mesid="0"] .mes_text')
  assert.equal(text.querySelector('script'),null)
  text.innerHTML='<button id="wizard">开始绑定</button>'
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(node.hidden,false)
  assert.equal(native.hidden,true)
  assert.equal(native.firstChild,original)
  original.textContent='React 后续刷新'
  assert.ok(document.getElementById('wizard'))
  stop()
  assert.equal(native.hidden,false)
  assert.equal(node.children.length,0)
  dom.window.close()
})

test('懒读取的历史楼层保存插件数据时不误判变量被修改', async () => {
  const message={message_id:0,role:'assistant',message:'旧楼层',swipe_id:0,swipes:['旧楼层'],swipes_data:[{hp:1}],pluginData:{}}
  const context={chatId:'lazy',stateRevision:5,lifecycleRevision:2,messages:[{...message,stub:true,swipes_data:[]}]}
  let submitted
  const facade=client.createTavernChatDataFacade({copy:structuredClone,context:()=>context,readMessage:()=>structuredClone(message),request:async(_method,args)=>{
    submitted=args.request
    return {updated:true,context:{...context,stateRevision:6,messages:[{...message,pluginData:{note:1}}]}}
  }})
  facade.chat()[0].note=1
  await facade.save()
  assert.equal(submitted.variableUpdates,undefined)
  assert.equal(submitted.messages[0].data.note,1)
})

test('sandbox text submission targets its original session without parsing slash text or changing draft', async () => {
  const calls = []
  const execute = client.createTavernFrameSlashExecutor({ sessions: { binding(id) { return { session: { prompt: async (content, mode) => { calls.push({ id, content, mode }); return { ok:true } } } } } }, get: assert.fail }, {})
  const text = 'Neutral opening\nLiteral | /cut 0 | /trigger'
  await execute('', 'original-session', { inputText:text })
  assert.equal(calls[0].id, 'original-session')
  assert.equal(calls[0].content[0].text, text)
  await assert.rejects(execute('', 'original-session', { inputText:'  ' }), /为空/)
})

test('saved greeting source never replaces the formatted native body before a DOM edit', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="native"><strong>Opening</strong><p>Hello Player</p></div><div id="owned"></div>')
  const document = dom.window.document, native = document.getElementById('native'), node = document.getElementById('owned')
  const stop = client.mountTavernLegacyMessage({ node, native, source:'**Opening**\nHello {{user}}', showInitial:true })
  assert.equal(node.hidden, true)
  assert.equal(native.hidden, false)
  assert.equal(native.querySelector('strong').textContent, 'Opening')
  node.querySelector('.mes_text').innerHTML = '<button>Script panel</button>'
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node.hidden, false)
  assert.equal(native.hidden, true)
  stop(); dom.window.close()
})

test('opening submit helper uses native start, deduplicates and retries failures', async () => {
  const listeners = new Map(), replies = [], sent = []
  const frame = { contentWindow: { postMessage(data) { replies.push(data) } } }
  const host = { sessionStorage: { getItem() { return null } }, document: null, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } }
  let fail = true
  const lifecycle = client.createTavernMessageFrameLifecycle({ sessionId: '', content: 'opening',
    openingPreview: { preparationId: 'draft' }, onSubmitOpening(text) {
      sent.push(text); if (fail) throw Error('retry'); return { started: true }
    }
  }, { window: host, rpc() { throw Error('must not route submit to draft RPC') } })
  const doc = lifecycle.snapshot().visibleDocument; doc.ref(frame)
  const stop = lifecycle.start(() => {}), receive = listeners.get('message')
  const data = { type: 'dsh-tavern-helper-call', token: doc.token, requestId: '1', method: 'submitTavernHelperInput', args: { text: 'start story' } }
  receive({ source: {}, data }); assert.equal(sent.length, 0)
  receive({ source: frame.contentWindow, data })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(replies.at(-1).ok, false)
  fail = false
  receive({ source: frame.contentWindow, data: { ...data, requestId: '2' } })
  receive({ source: frame.contentWindow, data: { ...data, requestId: '3' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['start story', 'start story'])
  assert.equal(replies.at(-1).ok, true)
  stop()
})

test('native opening send resolves identity macros using the chosen player name', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const identity = source.slice(source.indexOf('function substituteTavernIdentityMacros('), source.indexOf('function scrollTavernTouchChain('))
  const start = source.slice(source.indexOf('async function newConversation('), source.indexOf('async function preparePlayConversation('))
  const sent = []
  const timing = { measure: (_name, fn) => fn(), finish() {} }
  const sandbox = { uiMode: 'play', openingPicker: null, compatibilityAvailable: false, requestMode: 'dsh',
    openingPerformance: { begin: () => timing }, tavernSessionTransition: { begin() {}, end() {} },
    setBusy() {}, setError(error) { if (error) throw Error(error) }, setOpeningPicker() {},
    playPrewarmRef: { current: { claim: async () => '' } },
    conversationLifecycle: { start: async () => ({ sessionId: 'new-session' }) },
    props: { executeSlash: async (line, sessionId) => sent.push({ line, sessionId }) },
    window: { localStorage: { setItem() {} } }, console: { info() {}, warn() {} }
  }
  vm.runInNewContext(identity + start + '\nthis.start = newConversation;', sandbox)
  await sandbox.start({ name: '角色甲' }, 'play', 'primary', '小林', '{{user}}遇见{{char}}，{{ USER }}继续。')
  assert.deepEqual(sent, [{ line: '/send 小林遇见角色甲，小林继续。|/trigger', sessionId: 'new-session' }])
})
