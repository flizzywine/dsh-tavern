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

test('脚本执行模块按 Helper Runtime 的真实检查结构报告 MVU 已就绪', () => {
  const inspection = {
    sessionId: 'session-a',
    frameCount: 1,
    scriptIds: ['__dsh_official_mvu__'],
    scripts: [{
      id: '__dsh_official_mvu__',
      loaded: true,
      subscriptionsReady: true,
      initializationFailed: false
    }]
  }

  assert.equal(client.tavernScriptRuntimeReady(inspection), true)
  inspection.scripts[0].subscriptionsReady = false
  assert.equal(client.tavernScriptRuntimeReady(inspection), false)
  inspection.scripts[0].initializationFailed = true
  assert.equal(client.tavernScriptRuntimeReady(inspection), false)
  inspection.scripts[0].id = 'optional-card-script'
  assert.equal(client.tavernScriptRuntimeReady(inspection), true)
})

test('长消息限制在 1200px 内并由 iframe 原生滚动', () => {
  assert.equal(client.clampTavernFrameHeight(48), 48)
  assert.equal(client.clampTavernFrameHeight(1200), 1200)
  assert.equal(client.clampTavernFrameHeight(5000), 1200)
  const documentHtml = client.buildTavernFrameDocument({ content: '正文', token: 'native-scroll-token' })
  assert.doesNotMatch(documentHtml, /dsh-tavern-touch-bridge|dsh-tavern-frame-pan/)
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

test('空白展示 part 不创建消息 iframe', () => {
  const parts = client.projectionPartsOf({
    version: 2,
    mode: 'rich',
    parts: [
      { kind: 'html', content: '   \n' },
      { kind: 'markdown', text: '' },
      { kind: 'html', content: '<p>有效内容</p>' }
    ]
  })
  assert.equal(parts.length, 1)
  assert.equal(parts[0].content, '<p>有效内容</p>')
})

test('没有文字、属性或运行能力的空 HTML 容器不创建消息 iframe', () => {
  const parts = client.projectionPartsOf({
    version: 2,
    mode: 'rich',
    parts: [
      { kind: 'html', content: '<statusplaceholderimpl></statusplaceholderimpl>' },
      { kind: 'html', content: '<div><span></span></div>' },
      { kind: 'html', content: '<div class="styled"></div>' },
      { kind: 'html', content: '<script>mountStatus()</script>' },
      { kind: 'html', content: '<p>正文</p>' }
    ]
  })

  assert.deepEqual(parts.map(part => part.content), [
    '<div class="styled"></div>',
    '<script>mountStatus()</script>',
    '<p>正文</p>'
  ])
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
    '/vendor/runtime-assets/fontawesome/css/all.min.css',
    '/vendor/runtime-assets/tailwind/index.global.js',
    '/vendor/runtime-assets/jquery/jquery.min.js',
    '/vendor/runtime-assets/jquery-ui/jquery-ui.min.js',
    '/vendor/runtime-assets/jquery-ui/themes/base/theme.min.css',
    '/vendor/runtime-assets/jquery-ui-touch-punch/jquery.ui.touch-punch.min.js',
    '/vendor/runtime-assets/vue/vue.runtime.global.prod.js',
    '/vendor/runtime-assets/vue-router/vue-router.global.prod.js'
  ]
  let previous = -1
  for (const marker of markers) {
    const current = document.indexOf(marker)
    assert.ok(current > previous, `${marker} 应按 Tavern Helper 官方顺序出现`)
    previous = current
  }
  assert.match(document, /\/vendor\/runtime-assets\/lodash\/lodash\.min\.js/)
  assert.doesNotMatch(document, /data-dsh-sillytavern-css-compat/)
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
  await assert.rejects(execute('/compact', 'session-magic-fairy'), /只允许调用/)
})

test('大凉入局按钮的带空格管道发送开局消息', async () => {
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
  const completed = execute('/send <开局信息>\n魔法少女 | /trigger', 'session-magic-fairy')

  assert.deepEqual(submissions, [['draft', '<开局信息>\n魔法少女 '], ['submit', 'queue']])
  summary.running = true
  listeners.forEach(listener => listener())
  summary.running = false
  listeners.forEach(listener => listener())
  assert.deepEqual(JSON.parse(JSON.stringify(await completed)), { submitted: true })
  assert.equal(listeners.size, 0)
  await assert.rejects(execute('/compact', 'session-magic-fairy'), /只允许调用/)
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

test('消息 iframe 在实际读取 MVU 数据时标记自身为 MVU View', () => {
  const document = client.buildTavernFrameDocument({
    content: '<script>Mvu.getMvuData({ type: "message" })</script>',
    token: 'mvu-view-token',
    helperContext: { messages: [{ variables: { hp: 10 } }] }
  })

  assert.match(document, /__dshTavernMvuViewUsed/)
  assert.match(document, /dsh-tavern-mvu-view-used/)
  assert.match(document, /mvuViewUsed/)
  assert.match(document, /dsh-tavern-helper-context/)
  assert.match(document, /VARIABLE_UPDATE_ENDED/)
})

test('持久状态 Runtime 关闭重复识别和消息级诊断采集', () => {
  const document = client.buildTavernFrameDocument({
    content: '<script>Mvu.getMvuData()</script>',
    token: 'persistent-status-token',
    helperContext: { messages: [] },
    observeMvuView: false,
    runtimeReporting: false
  })

  assert.match(document, /data-dsh-tavern-helper/)
  assert.doesNotMatch(document, /data-dsh-tavern-mvu-view-observer/)
  assert.doesNotMatch(document, /dsh-tavern-frame-runtime/)
  assert.match(document, /dsh-tavern-frame-height/)
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

test('变量回执区分后台结算中和过期结果', function () {
  assert.match(clientSource, /pending:\s*"变量结算中…"/)
  assert.match(clientSource, /stale:\s*"变量结算已过期，未覆盖当前状态"/)
  assert.match(clientSource, /rpc\("retrySettlement", \{ turn: props\.turn \}, props\.sessionId\)/)
  assert.match(clientSource, /"重试变量结算"/)
})

test('普通姿势结算失败时右侧状态栏提供统一重试入口', function () {
  const status = clientSource.slice(clientSource.indexOf('function TavernStatusPanel'), clientSource.indexOf('function TavernStatusTab'))
  assert.match(status, /rpc\("retrySettlement", \{ turn: view\.settlementTurn \}, props\.sessionId\)/)
  assert.match(status, /"重试后台结算"/)
  assert.match(status, /view\.settleError/)
})

test('Helper iframe 在增量版本失配时请求完整快照，不自行重载', () => {
  const document = client.buildTavernFrameDocument({
    content: '<script>getVariables()</script>',
    token: 'context-patch-token',
    helperContext: { version: 1, stateRevision: 1, messages: [] }
  })

  assert.match(document, /dsh-tavern-helper-context-update/)
  assert.match(document, /dsh-tavern-helper-context-request/)
  assert.match(document, /Helper Context 版本失配/)
})

test('消息 iframe 只在首次加载或错误诊断时采集 DOM，不监听普通 DOM mutation', () => {
  const document = client.buildTavernFrameDocument({ content: '<div>状态栏</div>', token: 'diagnostic-token' })
  const runtimeReporter = document.match(/<script data-dsh-tavern-frame>\(function\(\)\{var token=[\s\S]*?<\/script>/)?.[0] || ''
  assert.match(runtimeReporter, /document\.body\.cloneNode\(true\)/)
  assert.match(runtimeReporter, /addEventListener\("load",schedule\)/)
  assert.doesNotMatch(runtimeReporter, /new MutationObserver\(schedule\)/)
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

test('普通正则 HTML iframe 忽略已移除的手动样式配置，保留内置兼容样式', () => {
  const document = client.buildTavernFrameDocument({
    content: '<div class="mes_text">正文</div>',
    token: 'dynamic-style-token',
    styleEnvironment: {
      themeVariables: { '--SmartThemeBodyColor': 'rgb(1, 2, 3)' },
      customCss: '.mes_text{color:var(--SmartThemeBodyColor)} @import "https://theme.example/custom.css"; </style><script>bad()</script>',
      extensionStyles: ['https://extension.example/panel.css']
    }
  })
  assert.match(document, /data-dsh-sillytavern-css-compat/)
  assert.match(document, /data-dsh-sillytavern-iframe-adapter/)
  assert.doesNotMatch(document, /data-dsh-sillytavern-theme|data-dsh-sillytavern-custom-css|data-dsh-sillytavern-extension-style/)
  assert.doesNotMatch(document, /theme\.example|extension\.example|bad\(\)|rgb\(1, 2, 3\)/)
})

test('透明 iframe 默认跟随宿主明暗主题且不加文字阴影，卡片主题仍可覆盖', () => {
  const cardStyle = '<style>:root{--SmartThemeBodyColor:gold;--shadowWidth:3}p{color:red;text-shadow:1px 1px blue}</style>'
  const document = client.buildTavernFrameDocument({
    content: cardStyle + '<p>开场正文</p>',
    token: 'readable-frame',
    styleEnvironment: { themeVariables: { '--SmartThemeBodyColor': 'orange', '--shadowWidth': '4' } }
  })
  const adapter = document.match(/<style data-dsh-sillytavern-iframe-adapter>([\s\S]*?)<\/style>/)?.[1] || ''
  assert.match(adapter, /:root\{--SmartThemeBodyColor:CanvasText;--shadowWidth:0\}/)
  assert.match(adapter, /body\{[^}]*color-scheme:inherit/)
  assert.doesNotMatch(adapter, /(?:color|text-shadow|--SmartThemeBodyColor|--shadowWidth):[^;}]*!important/)
  assert.ok(document.indexOf('public%2Fstyle.css') < document.indexOf('data-dsh-sillytavern-iframe-adapter'))
  assert.ok(document.indexOf('data-dsh-sillytavern-iframe-adapter') < document.indexOf(cardStyle))
  assert.ok(document.includes(cardStyle))
})

test('Helper 脚本文档提供可见弹窗容器和固定 Tavern Helper 按钮事件格式', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'helper-token',
    script: { id: 'greeting-index', name: '开场白索引', content: 'void 0', buttons: [] },
    context: { messages: [] }
  })

  assert.match(document, /window\.SillyTavern = Object\.freeze\(sillyTavern\)/)
  assert.match(document, /data-dsh-tavern-icons/)
  assert.match(document, /dsh-tavern-helper-ui-open/)
  assert.match(document, /return String\(scriptId \|\| currentScript\(\)\.id\) \+ "_" \+ stringHash/)
  assert.match(document, /\/vendor\/runtime-assets\/vue\/vue\.runtime\.global\.prod\.js/)
  assert.match(document, /\/vendor\/runtime-assets\/vue-router\/vue-router\.global\.prod\.js/)
})

test('人物卡挂到宿主 Shadow DOM 的 Font Awesome 样式改用内置资源', () => {
  class FakeLink {}
  Object.defineProperty(FakeLink.prototype, 'href', {
    configurable: true,
    enumerable: true,
    get() { return this.value || '' },
    set(value) { this.value = String(value) }
  })
  const hostWindow = { HTMLLinkElement: FakeLink }
  const disposeFirst = client.createTavernHostStylesheetBridge({ window: hostWindow })
  const disposeSecond = client.createTavernHostStylesheetBridge({ window: hostWindow })
  const phoneIcons = new FakeLink()
  phoneIcons.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
  assert.equal(phoneIcons.href, '/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css')

  const unrelated = new FakeLink()
  unrelated.href = 'https://example.test/card-theme.css'
  assert.equal(unrelated.href, 'https://example.test/card-theme.css')

  disposeFirst()
  const shared = new FakeLink()
  shared.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
  assert.equal(shared.href, '/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css')
  disposeSecond()

  const restored = new FakeLink()
  restored.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
  assert.equal(restored.href, 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css')
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

test('只有空宿主和问号按钮的人物卡不展示手机应用区', () => {
  const attributes = new Map()
  const host = {
    id: 'improved-phone-shadow-host-empty-card',
    style: { setProperty() {} },
    shadowRoot: { querySelector() { return null } },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
    setAttribute(name, value) { attributes.set(name, String(value)) }
  }
  const slot = { clientWidth: 360, appendChild(node) { this.child = node; return node } }
  const document = {
    body: {},
    querySelectorAll(selector) { return selector.includes('shadow-host') ? [host] : [] },
    querySelector() { return null }
  }

  const controller = client.createTavernCardAppDock({
    document, slot, sessionId: 'session-empty-card', MutationObserver: null, ResizeObserver: null
  })

  assert.equal(controller.inspect().attached, false)
  assert.equal(slot.child, undefined, '空宿主不能撑出人物卡应用区域')
  controller.dispose()
})

test('人物卡手机切换对话重载期间保持应用槽，恢复后原位接管', () => {
  const timers = []
  const cleared = new Set()
  const states = []
  const presence = client.createTavernCardAppPresence({
    onChange(state) { states.push(state) },
    setTimeout(run) { timers.push(run); return timers.length - 1 },
    clearTimeout(id) { cleared.add(id) }
  })

  presence.change(true)
  presence.change(false)
  assert.deepEqual(JSON.parse(JSON.stringify(states.at(-1))), { visible: true, attached: false, recovering: true })

  presence.change(true)
  timers[0]()
  assert.ok(cleared.has(0))
  assert.deepEqual(JSON.parse(JSON.stringify(states.at(-1))), { visible: true, attached: true, recovering: false })

  presence.change(false)
  timers[1]()
  assert.deepEqual(JSON.parse(JSON.stringify(states.at(-1))), { visible: false, attached: false, recovering: false })
})

test('官方 MVU owner 作为共享沙箱首个系统模块本地加载', () => {
  const frames = []
  const hostWindow = {
    crypto: { randomUUID() { return 'official-runtime-token' } },
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
      const frame = { contentWindow: { postMessage() {} }, addEventListener() {}, remove() {} }
      frames.push(frame)
      return frame
    }
  }
  const runtime = client.createTavernHelperScriptRuntime({ window: hostWindow, document: hostDocument, rpc() { return Promise.resolve({}) }, reportError() {} })

  runtime.sync('session', {
    chatId: 'chat-1',
    playerName: '你',
    card: { name: '角色' },
    tavernHelper: { messages: [], scriptVariables: {} },
    tavernHelperScripts: [{ id: 'guard', name: '变量守卫', content: 'void 0', data: {}, buttons: [] }],
    tavernMvuRuntime: { owner: 'official', assetUrl: '/api/dsh-tavern/vendor/magvarupdate/bundle.js' }
  })

  assert.equal(frames.length, 1)
  assert.match(frames[0].srcdoc, /"officialMvu":true/)
  assert.ok(frames[0].srcdoc.indexOf('__dsh_official_mvu__') < frames[0].srcdoc.indexOf('guard'))
  const loaderUrl = frames[0].srcdoc.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1]
  const loader = Buffer.from(loaderUrl, 'base64').toString('utf8')
  const modules = JSON.parse(loader.match(/const scripts=(\[[^\n]*\]);\n/)[1])
  assert.equal(modules[0].assetUrl, '/api/dsh-tavern/vendor/magvarupdate/bundle.js')
  const officialModule = modules[0].content
  assert.match(officialModule, /vendor\/magvarupdate\/bundle\.js/)
  assert.match(loader, /await window\.waitGlobalInitialized\("Mvu"\)/)
  assert.match(loader, /finally\{window\.__dshTavernResolveCompanionScriptsReady\(\);\}/)
  assert.match(frames[0].srcdoc, /id="extensions_settings2" hidden/)
  assert.match(clientSource, /const queuedEvents = officialOwner \? \[\] : eventsBetween\(previous, nextSnapshot\)/)
  runtime.dispose()
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
  const inlineSpace = { nodeType: 3, nodeValue: ' ' }
  const meaningfulText = { nodeType: 3, nodeValue: '正文内容' }
  const nestedWhitespace = { nodeType: 3, nodeValue: '\n保留', parentNode: {} }
  const body = { childNodes: [topLevelWhitespace, inlineSpace, meaningfulText] }
  nestedWhitespace.parentNode = { childNodes: [nestedWhitespace] }
  vm.runInNewContext(normalizer[1], { document: { body }, Array })

  assert.equal(topLevelWhitespace.nodeValue, '')
  assert.equal(inlineSpace.nodeValue, ' ')
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

  function element({ top, bottom, position = 'static', overflow = 'visible', marginBottom = '0px', parent = null }) {
    return {
      parentElement: parent,
      scrollHeight: Math.max(0, bottom - top),
      getBoundingClientRect() { return { top, bottom, width: 100, height: bottom - top } },
      style: { position, overflow, overflowX: overflow, overflowY: overflow, marginBottom }
    }
  }

  const root = { toggleAttribute() {}, scrollHeight: 2304, parentElement: null }
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

test('消息 iframe 测高包含末尾折叠外边距，避免正文末尾被裁掉', () => {
  const documentHtml = client.buildTavernFrameDocument({ content: '正文', token: 'collapsed-margin-height-token' })
  const reporters = Array.from(documentHtml.matchAll(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/g))
  const reporter = reporters.at(-1)
  assert.ok(reporter)

  const root = { toggleAttribute() {}, scrollHeight: 1820, parentElement: null }
  const body = {
    parentElement: root,
    scrollHeight: 1800,
    getBoundingClientRect() { return { top: 0, bottom: 1800, width: 100, height: 1800 } },
    style: { position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', marginBottom: '0px' }
  }
  const trailingCard = {
    parentElement: body,
    scrollHeight: 200,
    getBoundingClientRect() { return { top: 1600, bottom: 1800, width: 100, height: 200 } },
    style: { position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', marginBottom: '20px' }
  }
  body.querySelectorAll = () => [trailingCard]

  let reportedHeight = 0
  class Observer { observe() {} }
  vm.runInNewContext(reporter[1], {
    document: { documentElement: root, body },
    window: { scrollY: 0 },
    parent: { postMessage(message) { reportedHeight = message.height } },
    getComputedStyle(node) { return node.style || { position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', marginBottom: '0px' } },
    ResizeObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame(callback) { callback() },
    addEventListener() {},
    Array,
    Math,
    Number,
    String,
    parseFloat
  })

  assert.equal(reportedHeight, 1820)
})

test('消息 iframe 在依赖和 DOM 稳定后报告可原子替换', () => {
  const documentHtml = client.buildTavernFrameDocument({
    content: '<div>状态栏</div>',
    token: 'ready-token',
    helperContext: { messages: [] }
  })

  assert.match(documentHtml, /data-dsh-tavern-frame-ready/)
  assert.match(documentHtml, /type:"dsh-tavern-frame-ready"/)
  assert.match(documentHtml, /Promise\.resolve\(window\.__dshTavernHelperReady\)/)
  assert.match(documentHtml, /new MutationObserver\(schedule\)/)
})

test('人物卡 Helper 脚本使用独立不透明 iframe，并获得脚本、世界书和 MVU facade', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'script-token',
    script: { id: 'dynamic-worldbook', name: '动态世界书', content: "import 'https://example.test/动态世界书.js'", data: { auto_apply: true }, buttons: [] },
    context: { messages: [], scriptVariables: { 'dynamic-worldbook': { auto_apply: true } }, worldbook: { name: '灯火阑珊', entries: [] } }
  })
  const encoded = document.match(/data:text\/javascript;base64,([^"']+)/)
  assert.ok(encoded)
  const loader = Buffer.from(encoded[1], 'base64').toString('utf8')
  const modules = JSON.parse(loader.match(/const scripts=(\[.*\]);/)[1])
  const source = modules[0].content
  assert.equal(source, "import 'https://example.test/动态世界书.js'")
  assert.match(loader, /await window\.__dshTavernInitializationTiming\.wait\("companion-module",loadModule\(script\.content,script\.id\),script\.id\)/)
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

test('官方 MVU 与人物卡脚本共用沙箱时仍先提供全局 Zod 与 YAML', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'official-mvu-zod-token',
    scripts: [
      { id: 'official-mvu', name: '官方 MVU', system: 'official-mvu', content: 'void 0', buttons: [] },
      { id: 'variable-schema', name: '变量结构', content: 'const schema = z.z.object({}); void schema', buttons: [] }
    ],
    context: { messages: [] }
  })
  const encoded = document.match(/data:text\/javascript;base64,([^"']+)/)
  assert.ok(encoded)
  const loader = Buffer.from(encoded[1], 'base64').toString('utf8')

  assert.match(document, /const officialMvuEnabled = metadata\.officialMvu === true/)
  assert.match(document, /import\("\/api\/dsh-tavern\/vendor\/runtime-assets\/zod\/index\.mjs"\)/)
  assert.match(document, /import\("\/api\/dsh-tavern\/vendor\/runtime-assets\/yaml\/index\.mjs"\)/)
  assert.match(document, /window\.z = modules\[0\]/)
  assert.match(document, /window\.YAML = modules\[1\]/)
  assert.doesNotMatch(document, /officialMvuEnabled\s*\?\s*Promise\.resolve/)
  assert.ok(loader.indexOf('await window.__dshTavernHelperReady') < loader.indexOf('for(const script of scripts)'))
})

test('Helper 脚本把本机缓存入口解析为 srcdoc 所属宿主地址', () => {
  const document = client.buildTavernHelperScriptDocument({
    token: 'cached-script-token',
    script: { id: 'cached', name: '缓存脚本', content: "import '/api/dsh-tavern/remote-assets/" + 'a'.repeat(64) + "/bundle.js'", data: {}, buttons: [] },
    context: { messages: [] }
  })
  const encoded = document.match(/data:text\/javascript;base64,([^"']+)/)
  const loader = Buffer.from(encoded[1], 'base64').toString('utf8')
  const modules = JSON.parse(loader.match(/const scripts=(\[.*\]);/)[1])
  const source = modules[0].content
  assert.equal(source, "import '/api/dsh-tavern/remote-assets/" + 'a'.repeat(64) + "/bundle.js'")
  assert.match(loader, /element\.type = "module"/)
  assert.match(loader, /document\.body\.appendChild\(element\)/)
  assert.doesNotMatch(loader, /element\.src\s*=/)
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

test('Helper Host 超时会指出正在执行的脚本、拒绝事件并屏蔽迟到写入', async () => {
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

  await assert.rejects(emitted, /变量守卫.*MESSAGE_RECEIVED.*超时/)
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

test('Tavern 消息 renderer 以更低 priority 接管 assistant 和 user 正式 keyed slot', () => {
  const registrations = []
  const labels = []
  const feature = client.createTavernAssistantRendererFeatureModule()
  const slots = {
    inject(name, activate) {
      assert.ok(['conversation.chat.node', 'conversation.chat.assistant-actions', 'conversation.session.header.actions'].includes(name))
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
      // The independent owner lifecycle is exercised in script-session-owner.test.mjs.
      if (label === 'dsh-tavern: game script owner') return function () {}
      return activate()
    }
  }

  feature.register({ ctx, slots })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registrations.length, 4)
  const runtime = registrations.shift()
  assert.equal(runtime.spec.name, 'conversation.session.header.actions')
  assert.equal(runtime.spec.id, 'dsh-tavern-script-runtime')
  assert.equal(typeof runtime.component, 'function')
  assert.equal(registrations[0].spec.name, 'conversation.chat.node')
  assert.equal(registrations[0].spec.key, 'assistant-step')
  assert.equal(registrations[0].spec.priority, -1)
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(registrations[1].spec.name, 'conversation.chat.node')
  assert.equal(registrations[1].spec.key, 'user')
  assert.equal(registrations[1].spec.priority, -1)
  assert.equal(typeof registrations[1].component, 'function')
  assert.equal(registrations[2].spec.name, 'conversation.chat.assistant-actions')
  assert.equal(registrations[2].spec.id, 'dsh-tavern-fork')
  assert.equal(registrations[2].spec.order, 20)
  assert.equal(typeof registrations[2].component, 'function')
  assert.deepEqual(labels, ['dsh-tavern: game script owner', 'dsh-tavern: conversation script lifecycle', 'dsh-tavern: inline assistant renderer', 'dsh-tavern: raw user message renderer', 'dsh-tavern: conversation fork action'])
})

test('用户气泡优先展示持久化原始输入，不展示 promptOnly 的 Session 投影', () => {
  const sessionContent = [{ type: 'text', text: '<interactive_input>\n原始输入\n</interactive_input>' }]

  assert.equal(client.tavernUserTextForTurn({ inputSources: { 2: '原始输入' } }, 2, sessionContent), '原始输入')
  assert.equal(client.tavernUserTextForTurn({}, 2, sessionContent), '<interactive_input>\n原始输入\n</interactive_input>')
})

test('变量更新回执按正文轮次定位，避免展示到错误消息下方', () => {
  const first = { status: 'unchanged', changes: [], failures: [] }
  const second = { status: 'updated', changes: [{ path: '/体力' }], failures: [] }
  const view = { mvuReceipts: [{ turn: 2, receipt: first }, { turn: 3, receipt: second }] }

  assert.equal(client.tavernMvuReceiptForTurn(view, 2), first)
  assert.equal(client.tavernMvuReceiptForTurn(view, 3), second)
  assert.equal(client.tavernMvuReceiptForTurn(view, 4), null)
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
  assert.match(image.getAttribute('src'), /^\/api\/dsh-tavern\/static-assets/)
})


test('plain scripted card frames load jQuery before remote-home loaders without a game helper context', () => {
  const html = "<body><script>$('body').load('https://example.com/home.html')</script></body>"
  const document = client.buildTavernFrameDocument({content:html})
  assert.ok(document.includes('runtime-assets/jquery/jquery.min.js'))
  assert.ok(document.indexOf('runtime-assets/jquery/jquery.min.js') < document.indexOf("$('body').load"))
  assert.ok(!document.includes('data-dsh-tavern-opening-preview'))
})

test('收起的 details 隐藏内容不撑高 iframe，展开后恢复测高', () => {
  const html = client.buildTavernFrameDocument({ content: '<details><summary>变量更新情况</summary><pre>数据</pre></details>', token: 'details-height' })
  const reporter = Array.from(html.matchAll(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/g)).at(-1)[1]
  const style = { position: 'static', overflow: 'visible', marginBottom: '0' }
  let scrollEnabled = false
  const root = { toggleAttribute(name, enabled) { assert.equal(name, "data-dsh-tavern-scroll"); scrollEnabled = enabled } }
  const node = (bottom, parentElement) => ({ parentElement, style, getBoundingClientRect: () => ({ top: 0, bottom, width: 100, height: bottom }) })
  const body = node(24, root); body.scrollHeight = 24
  const details = node(24, body); details.tagName = 'DETAILS'; details.open = false
  const summary = node(24, details); summary.contains = n => n === summary
  details.querySelector = () => summary
  const hidden = node(3656, details)
  body.querySelectorAll = () => [details, summary, hidden]
  let height = 0
  const run = () => vm.runInNewContext(reporter, {
    document: { body, documentElement: root }, window: { scrollY: 0 },
    parent: { postMessage: message => { height = message.height } },
    getComputedStyle: n => n.style || style,
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    requestAnimationFrame: callback => callback(), addEventListener() {},
  })
  run(); assert.equal(height, 48); assert.equal(scrollEnabled, false)
  details.open = true
  run(); assert.equal(height, 3656); assert.equal(scrollEnabled, true)
  assert.match(html, /html\[data-dsh-tavern-scroll\]\{overflow-y:auto!important\}/)
  assert.match(html, /html\[data-dsh-tavern-scroll\] body\{overflow-y:visible!important\}/)
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
      binding(id) { assert.equal(id, 'opening'); return { session: { prompt(content, mode) { prompts.push([content, mode]); return Promise.resolve(reply) } } } },
      list: {
        getSnapshot() { return { byId: { opening: summary } } },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
      }
    },
    get() { return { input: { for() { return { setDraft() { assert.fail('must preserve draft') }, submit() { assert.fail('must use native admission') } } } } } }
  }
  const execute = client.createTavernFrameSlashExecutor(ctx, { setTimeout, clearTimeout })
  const completion = execute('/trigger', 'opening')
  assert.deepEqual(JSON.parse(JSON.stringify(prompts)), [[[], 'queue']])
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

test('Host acknowledgements extend idle waits but cannot extend the total event deadline', async () => {
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

  const rejected = assert.rejects(emitted, /MESSAGE_RECEIVED.*超时/)
  for (const at of [20, 40, 60, 80]) {
    advance(at)
    receive({ source: frames[0].contentWindow, data: {
      type: 'dsh-tavern-helper-call', token: 'timeout-runtime-token', eventId: request.eventId,
      requestId: 'progress-' + at, method: 'updateTavernHelperVariables', args: { variables: { hp: at } }
    } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(errors.length, 0)
  }
  advance(99)
  assert.equal(errors.length, 0)
  advance(100)
  await rejected
  assert.equal(errors.length, 1)
  assert.equal(rpcCalls.length, 4)
  runtime.dispose()
})

test('trusted scripts await host jQuery before executing; isolated scripts do not access host', () => {
  for (const trustedCardMode of [true, false]) {
    const document = client.buildTavernHelperScriptDocument({ trustedCardMode, scripts: [{ id: 'ball', content: 'void 0' }] });
    const loader = Buffer.from(document.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1], 'base64').toString();
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
  assert.equal(removed.length, 3);
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
    const loader = Buffer.from(document.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1], 'base64').toString()
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
    const loader = Buffer.from(html.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1], 'base64').toString()
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
  const loader = Buffer.from(html.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1], 'base64').toString()
  const source = loader.slice(loader.indexOf('const loadModule=') + 17, loader.indexOf(';\nconst createMvuLoader='))
  const sandbox = { window: { jQuery: callback => callback(), addEventListener() {}, removeEventListener() {} }, document: {
    getElementById: () => null,
    createElement: () => ({ remove() {} }),
    body: { appendChild(element) { vm.runInContext('(function(){' + element.textContent + '\n})()', context) } }
  } }
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
  const refresh = vm.runInNewContext('(function(current){' + updater + '})', { response, cardPath: 'card.json', userName: '你' })
  const next = refresh({ card: { path: 'card.json' }, userName: '你', preparationId: 'old-draft', index: 1, openings: [{ id: 'primary' }, { id: 'alternate:0' }] })
  assert.equal(next.openings[next.index].id, 'alternate:0')
  assert.equal(next.preparationId, next.openings[next.index].openingPreview.preparationId)
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
  stop()
})
