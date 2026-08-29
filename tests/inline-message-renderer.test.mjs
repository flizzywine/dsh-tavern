import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadClient() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

test('普通长消息自动展开，只有极端高度才限制为单轮滚动', () => {
  assert.equal(client.clampTavernFrameHeight(48), 48)
  assert.equal(client.clampTavernFrameHeight(5000), 5000)
  assert.equal(client.clampTavernFrameHeight(12000), 12000)
  assert.equal(client.clampTavernFrameHeight(18000), 12000)
})

test('旧版分段展示投影仍按原始顺序回放', () => {
  const parts = client.projectionPartsOf({
    version: 2,
    mode: 'rich',
    text: '原始展示文本',
    parts: [
      { kind: 'markdown', text: '正文前' },
      { kind: 'html', content: '<body>卡片</body>' },
      { kind: 'html', content: '<p>正文后</p>' }
    ]
  })

  assert.deepEqual(parts.map(part => part.kind), ['markdown', 'html', 'html'])
  assert.equal(parts[1].content, '<body>卡片</body>')
})

test('旧版整条 HTML 投影仍可只读回放', () => {
  const parts = client.projectionPartsOf({ version: 1, mode: 'html', html: '<p>旧界面</p>' })
  assert.equal(parts.length, 1)
  assert.equal(parts[0].kind, 'html')
  assert.equal(parts[0].content, '<p>旧界面</p>')
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

test('Tavern Helper 消息 iframe 按官方顺序加载完整前端依赖', () => {
  const document = client.buildTavernFrameDocument({
    content: '<div class="card">状态栏</div>',
    token: 'helper-dependencies-token',
    helperContext: { messages: [] }
  })
  const markers = [
    '%40fortawesome%2Ffontawesome-free%406.7.2%2Fcss%2Fall.min.css',
    '%40tailwindcss%2Fbrowser%404.1.12%2Fdist%2Findex.global.js',
    'jquery%403.7.1%2Fdist%2Fjquery.min.js',
    'jquery-ui%401.14.1%2Fdist%2Fjquery-ui.min.js',
    'jquery-ui%401.14.1%2Fthemes%2Fbase%2Ftheme.min.css',
    'jquery-ui-touch-punch%400.2.3%2Fjquery.ui.touch-punch.min.js',
    'vue%403.5.41%2Fdist%2Fvue.runtime.global.prod.js',
    'vue-router%405.2.0%2Fdist%2Fvue-router.global.prod.js'
  ]
  let previous = -1
  for (const marker of markers) {
    const current = document.indexOf(marker)
    assert.ok(current > previous, `${marker} 应按 Tavern Helper 官方顺序出现`)
    previous = current
  }
  assert.match(document, /lodash%404\.18\.1%2Flodash\.min\.js/)
  assert.doesNotMatch(document, /data-dsh-sillytavern-css-compat/)
})

test('消息 iframe 在实际读取 MVU 数据时标记自身为 MVU View', () => {
  const document = client.buildTavernFrameDocument({
    content: '<script>Mvu.getMvuData({ type: "message" })</script>',
    token: 'mvu-view-token',
    helperContext: { messages: [{ variables: { hp: 10 } }] }
  })

  assert.match(document, /__dshTavernMvuViewUsed/)
  assert.match(document, /dsh-tavern-mvu-view-used/)
  assert.match(document, /mvuViewUsed/)
})

test('普通正则 HTML iframe 加载锁定版本的 SillyTavern CSS 兼容包', () => {
  const document = client.buildTavernFrameDocument({
    content: '<div class="mes"><div class="mes_block"><div class="mes_text"><button class="menu_button">操作</button></div></div></div>',
    token: 'st-css-token'
  })
  assert.match(document, /data-dsh-sillytavern-css-compat="1\.18\.0"/)
  assert.match(document, /SillyTavern%408172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8%2Fpublic%2Fstyle\.css/)
  assert.match(document, /public%2Fcss%2Fst-tailwind\.css/)
  assert.match(document, /public%2Fcss%2Fmobile-styles\.css/)
  assert.match(document, /data-dsh-sillytavern-iframe-adapter/)
  assert.ok(document.indexOf('public%2Fstyle.css') < document.indexOf('data-dsh-sillytavern-iframe-adapter'))
})

test('普通正则 HTML iframe 按动态顺序投影主题变量、Custom CSS 和扩展样式', () => {
  const document = client.buildTavernFrameDocument({
    content: '<div class="mes_text">正文</div>',
    token: 'dynamic-style-token',
    styleEnvironment: {
      themeVariables: { '--SmartThemeBodyColor': 'rgb(1, 2, 3)' },
      customCss: '.mes_text{color:var(--SmartThemeBodyColor)} @import "https://theme.example/custom.css"; </style><script>bad()</script>',
      extensionStyles: ['https://extension.example/panel.css']
    }
  })
  assert.match(document, /data-dsh-sillytavern-theme/)
  assert.match(document, /--SmartThemeBodyColor/)
  assert.match(document, /data-dsh-sillytavern-custom-css/)
  assert.match(document, /static-assets\?url=https%3A%2F%2Ftheme\.example%2Fcustom\.css/)
  assert.match(document, /data-dsh-sillytavern-extension-style="0"/)
  assert.match(document, /static-assets\?url=https%3A%2F%2Fextension\.example%2Fpanel\.css/)
  assert.doesNotMatch(document, /<\/style><script>bad\(\)/)
  assert.match(document, /<\\\/style><script>bad\(\)/)
  assert.ok(document.indexOf('data-dsh-sillytavern-iframe-adapter') < document.indexOf('data-dsh-sillytavern-theme'))
  assert.ok(document.indexOf('data-dsh-sillytavern-theme') < document.indexOf('data-dsh-sillytavern-custom-css'))
  assert.ok(document.indexOf('data-dsh-sillytavern-custom-css') < document.indexOf('data-dsh-sillytavern-extension-style'))
})

test('Helper 脚本文档提供可见弹窗容器和固定 Tavern Helper 按钮事件格式', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'helper-token',
    script: { id: 'greeting-index', name: '开场白索引', content: 'void 0', buttons: [] },
    context: { messages: [] }
  })

  assert.match(document, /window\.SillyTavern = Object\.freeze\(\{ Popup: HelperPopup/)
  assert.match(document, /data-dsh-tavern-icons/)
  assert.match(document, /dsh-tavern-helper-ui-open/)
  assert.match(document, /return scriptId \+ "_" \+ stringHash/)
  assert.match(document, /vue%403\.5\.41%2Fdist%2Fvue\.runtime\.global\.prod\.js/)
  assert.match(document, /vue-router%405\.2\.0%2Fdist%2Fvue-router\.global\.prod\.js/)
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

test('消息 iframe 清理完整 HTML 文档泄漏到正文层的顶级排版空白', () => {
  const document = client.buildTavernFrameDocument({
    content: '<maintext>正文内\n保留换行</maintext>\n\n    <meta charset="utf-8">\n    <div data-status>状态栏</div>',
    token: 'layout-token'
  })
  const normalizer = document.match(/<script data-dsh-tavern-layout>([\s\S]*?)<\/script>/)
  assert.ok(normalizer)
  assert.ok(document.indexOf('data-status') < document.lastIndexOf('<script data-dsh-tavern-layout>'))

  const topLevelWhitespace = { nodeType: 3, nodeValue: '\n\n    ' }
  const meaningfulText = { nodeType: 3, nodeValue: '正文内容' }
  const nestedWhitespace = { nodeType: 3, nodeValue: '\n保留', parentNode: {} }
  const body = { childNodes: [topLevelWhitespace, meaningfulText] }
  nestedWhitespace.parentNode = { childNodes: [nestedWhitespace] }
  vm.runInNewContext(normalizer[1], { document: { body }, Array })

  assert.equal(topLevelWhitespace.nodeValue, ' ')
  assert.equal(meaningfulText.nodeValue, '正文内容')
  assert.equal(nestedWhitespace.nodeValue, '\n保留')
})

test('消息 iframe 保留人物卡 maintext 中的开场白换行', () => {
  const document = client.buildTavernFrameDocument({
    content: '<maintext>第一段。\n\n第二段。</maintext>',
    token: 'opening-lines-token'
  })

  assert.match(document, /maintext\{[^}]*white-space:pre-wrap/)
})

test('消息 iframe 测高忽略被裁剪内容与固定悬浮元素', () => {
  const documentHtml = client.buildTavernFrameDocument({ content: '正文', token: 'height-token' })
  const reporters = Array.from(documentHtml.matchAll(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/g))
  const reporter = reporters.at(-1)
  assert.ok(reporter)

  function element({ top, bottom, position = 'static', overflow = 'visible', parent = null }) {
    return {
      parentElement: parent,
      scrollHeight: Math.max(0, bottom - top),
      getBoundingClientRect() { return { top, bottom, width: 100, height: bottom - top } },
      style: { position, overflow, overflowX: overflow, overflowY: overflow }
    }
  }

  const root = { scrollHeight: 2304, parentElement: null }
  const body = element({ top: 0, bottom: 1761, parent: root })
  body.scrollHeight = 1761
  const clippedContainer = element({ top: 1419, bottom: 1443, overflow: 'hidden', parent: body })
  const clippedCard = element({ top: 2033, bottom: 2304, parent: clippedContainer })
  const fixedButton = element({ top: 2240, bottom: 2290, position: 'fixed', parent: body })
  const visibleAbsolute = element({ top: 1740, bottom: 1800, position: 'absolute', parent: body })
  body.querySelectorAll = () => [clippedContainer, clippedCard, fixedButton, visibleAbsolute]

  let reportedHeight = 0
  class Observer { observe() {} }
  vm.runInNewContext(reporter[1], {
    document: { documentElement: root, body },
    window: { scrollY: 0 },
    parent: { postMessage(message) { reportedHeight = message.height } },
    getComputedStyle(node) { return node.style || { position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible' } },
    ResizeObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame(callback) { callback() },
    addEventListener() {},
    Array,
    Math,
    Number,
    String
  })

  assert.equal(reportedHeight, 1800)
})

test('人物卡 Helper 脚本使用独立不透明 iframe，并获得脚本、世界书和 MVU facade', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'script-token',
    script: { id: 'dynamic-worldbook', name: '动态世界书', content: "import 'https://example.test/动态世界书.js'", data: { auto_apply: true }, buttons: [] },
    context: { messages: [], scriptVariables: { 'dynamic-worldbook': { auto_apply: true } }, worldbook: { name: '灯火阑珊', entries: [] } }
  })
  const encoded = document.match(/data:text\/javascript;base64,([^"']+)/)
  assert.ok(encoded)
  assert.equal(Buffer.from(encoded[1], 'base64').toString('utf8'), "await window.__dshTavernHelperReady;\nawait import('https://example.test/动态世界书.js');\n;window.__dshTavernHelperSubscriptionsReady();")
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

test('Helper 脚本把本机缓存入口解析为 srcdoc 所属宿主地址', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'cached-script-token',
    script: { id: 'cached', name: '缓存脚本', content: "import '/api/dsh-tavern/remote-assets/" + 'a'.repeat(64) + "/bundle.js'", data: {}, buttons: [] },
    context: { messages: [] }
  })
  const encoded = document.match(/data:text\/javascript;base64,([^"']+)/)
  const source = Buffer.from(encoded[1], 'base64').toString('utf8')
  assert.match(source, /new URL\('\/api\/dsh-tavern\/remote-assets\/a{64}\/bundle\.js', document\.baseURI\)\.href/)
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

test('Helper Host 只等待订阅事件的脚本，并保持订阅脚本的串行修改顺序', async () => {
  const windowListeners = new Map()
  const frames = []
  let tokenSequence = 0
  const hostWindow = {
    crypto: { randomUUID() { tokenSequence += 1; return `runtime-token-${tokenSequence}` } },
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
  frames.forEach(frame => frame.listeners.load())
  const receive = windowListeners.get('message')
  receive({ source: frames[0].contentWindow, data: { type: 'dsh-tavern-helper-subscriptions', token: 'runtime-token-1', names: [], ready: true } })
  receive({ source: frames[1].contentWindow, data: { type: 'dsh-tavern-helper-subscriptions', token: 'runtime-token-2', names: ['mag_command_parsed'], ready: true } })
  receive({ source: frames[2].contentWindow, data: { type: 'dsh-tavern-helper-subscriptions', token: 'runtime-token-3', names: ['mag_command_parsed'], ready: true } })

  const emitted = runtime.emit('mag_command_parsed', [{ hp: 1 }], { messages: [] })
  await Promise.resolve()
  assert.equal(frames[0].contentWindow.messages.some(item => item.type === 'dsh-tavern-helper-event'), false)
  const firstRequest = frames[1].contentWindow.messages.at(-1)
  assert.equal(firstRequest.name, 'mag_command_parsed')
  assert.equal(frames[2].contentWindow.messages.some(item => item.type === 'dsh-tavern-helper-event'), false)

  receive({
    source: frames[1].contentWindow,
    data: { type: 'dsh-tavern-helper-event-complete', token: 'runtime-token-2', eventId: firstRequest.eventId, args: [{ hp: 2 }] }
  })
  await Promise.resolve()
  const secondRequest = frames[2].contentWindow.messages.at(-1)
  assert.equal(secondRequest.name, 'mag_command_parsed')
  assert.deepEqual(JSON.parse(JSON.stringify(secondRequest.args)), [{ hp: 2 }])
  receive({
    source: frames[2].contentWindow,
    data: { type: 'dsh-tavern-helper-event-complete', token: 'runtime-token-3', eventId: secondRequest.eventId, args: [{ hp: 3 }] }
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await emitted)), [{ hp: 3 }])
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
	assert.deepEqual(readySessions, ['session-1'])
	assert.deepEqual(frames[0].contentWindow.messages.map(item => item.type), ['dsh-tavern-helper-context'])
	assert.deepEqual(JSON.parse(JSON.stringify(frames[0].contentWindow.messages[0].context.character)), {
		name: '灯火阑珊',
		first_mes: '开场一',
		alternate_greetings: ['开场二'],
		data: { name: '灯火阑珊', first_mes: '开场一', alternate_greetings: ['开场二'] }
	})

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
  assert.deepEqual(calls, [{ method: 'getTavernHelperWorldbook', args: { name: '灯火阑珊' }, sessionId: 'session-1' }])
  assert.equal(frames[0].contentWindow.messages.at(-1).type, 'dsh-tavern-helper-response')
	assert.deepEqual(mutations, [])

	windowListeners.get('message')({
		source: frames[0].contentWindow,
		data: { type: 'dsh-tavern-helper-call', token: 'runtime-token', requestId: '2', method: 'updateTavernHelperMessages', args: { messages: [{ message_id: 0, swipe_id: 1 }] } }
	})
	await Promise.resolve()
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

test('Tavern 消息 renderer 以更低 priority 接管 assistant 和 user 正式 keyed slot', () => {
  const registrations = []
  const labels = []
  const feature = client.createTavernAssistantRendererFeatureModule()
  const slots = {
    inject(name, activate) {
      assert.equal(name, 'conversation.chat.node')
      return activate()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return function () {}
    }
  }
  const ctx = {
    effect(activate, label) {
      labels.push(label)
      return activate()
    }
  }

  feature.register({ ctx, slots })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registrations.length, 2)
  assert.equal(registrations[0].spec.name, 'conversation.chat.node')
  assert.equal(registrations[0].spec.key, 'assistant-step')
  assert.equal(registrations[0].spec.priority, -1)
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(registrations[1].spec.name, 'conversation.chat.node')
  assert.equal(registrations[1].spec.key, 'user')
  assert.equal(registrations[1].spec.priority, -1)
  assert.equal(typeof registrations[1].component, 'function')
  assert.deepEqual(labels, ['dsh-tavern: inline assistant renderer', 'dsh-tavern: raw user message renderer'])
})

test('用户气泡优先展示持久化原始输入，不展示 promptOnly 的 Session 投影', () => {
  const sessionContent = [{ type: 'text', text: '<interactive_input>\n原始输入\n</interactive_input>' }]

  assert.equal(client.tavernUserTextForTurn({ inputSources: { 2: '原始输入' } }, 2, sessionContent), '原始输入')
  assert.equal(client.tavernUserTextForTurn({}, 2, sessionContent), '<interactive_input>\n原始输入\n</interactive_input>')
})
