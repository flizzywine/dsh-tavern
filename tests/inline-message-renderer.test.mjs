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
  assert.match(clientSource, /rpc\("retryMvuSettlement", \{ turn: props\.turn \}, props\.sessionId\)/)
  assert.match(clientSource, /"重试变量结算"/)
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
  assert.match(document, /vue%403\.5\.41%2Fdist%2Fvue\.runtime\.global\.prod\.js/)
  assert.match(document, /vue-router%405\.2\.0%2Fdist%2Fvue-router\.global\.prod\.js/)
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
  const modules = JSON.parse(loader.match(/const scripts=(\[[\s\S]*?\]);\ntry/)[1])
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

test('消息 iframe 只把无法由内层消费的纵向触摸位移交给宿主', () => {
  const documentHtml = client.buildTavernFrameDocument({ content: '<button>操作</button>', token: 'touch-token' })
  const bridge = documentHtml.match(/<script data-dsh-tavern-touch-bridge>([\s\S]*?)<\/script>/)
  assert.ok(bridge)

  const listeners = new Map(), messages = []
  const root = { parentElement: null, scrollTop: 0, clientHeight: 300, scrollHeight: 300, style: { overflowY: 'visible' } }
  const body = { parentElement: root, scrollTop: 0, clientHeight: 300, scrollHeight: 300, style: { overflowY: 'visible' } }
  const target = { parentElement: body, style: { overflowY: 'visible' } }
  vm.runInNewContext(bridge[1], {
    document: {
      body,
      documentElement: root,
      scrollingElement: root,
      addEventListener(type, run) { listeners.set(type, run) }
    },
    parent: { postMessage(message) { messages.push(message) } },
    getComputedStyle(node) { return node.style || { overflowY: 'visible' } },
    Math,
    Number,
    String
  })

  function touch(type, x, y, node = target) {
    let prevented = false
    listeners.get(type)({ target: node, touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }], preventDefault() { prevented = true } })
    return prevented
  }

  touch('touchstart', 100, 100)
  assert.equal(touch('touchmove', 100, 96), false, '小幅移动不应破坏点击')
  assert.equal(messages.length, 0)
  assert.equal(touch('touchmove', 100, 70), true)
  assert.deepEqual(messages.map(message => ({ type: message.type, token: message.token, deltaY: message.deltaY })), [
    { type: 'dsh-tavern-frame-pan', token: 'touch-token', deltaY: 30 }
  ])
  touch('touchend', 100, 70)

  messages.length = 0
  touch('touchstart', 100, 100)
  assert.equal(touch('touchmove', 130, 98), false, '横向操作留给卡片自己')
  assert.equal(messages.length, 0)
  touch('touchend', 130, 98)

  const scroller = { parentElement: body, scrollTop: 20, clientHeight: 100, scrollHeight: 300, style: { overflowY: 'auto' } }
  const innerTarget = { parentElement: scroller, style: { overflowY: 'visible' } }
  touch('touchstart', 100, 100, innerTarget)
  assert.equal(touch('touchmove', 100, 70, innerTarget), false, '内层确实可滚时不接管')
  assert.equal(messages.length, 0)
  touch('touchend', 100, 70, innerTarget)

  scroller.scrollTop = 200
  touch('touchstart', 100, 100, innerTarget)
  assert.equal(touch('touchmove', 100, 70, innerTarget), true, '内层到边界后再交给外层')
  assert.equal(messages[0].deltaY, 30)
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

test('消息 iframe 测高包含末尾折叠外边距，避免正文末尾被裁掉', () => {
  const documentHtml = client.buildTavernFrameDocument({ content: '正文', token: 'collapsed-margin-height-token' })
  const reporters = Array.from(documentHtml.matchAll(/<script data-dsh-tavern-frame>([\s\S]*?)<\/script>/g))
  const reporter = reporters.at(-1)
  assert.ok(reporter)

  const root = { scrollHeight: 1820, parentElement: null }
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
  assert.match(loader, /await loadModule\(script\.content\)/)
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

test('官方 MVU 与人物卡脚本共用沙箱时仍先提供全局 Zod', () => {
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
  assert.match(document, /const ready = import\(window\.__dshTavernStaticAssetUrl\("https:\/\/testingcf\.jsdelivr\.net\/npm\/zod@4\.4\.3\/\+esm"\)\)\.then\(function \(module\) \{ window\.z = module; return true; \}\)/)
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
      assert.ok(['conversation.chat.node', 'conversation.input.dock'].includes(name))
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
  assert.equal(registrations.length, 3)
  const runtime = registrations.shift()
  assert.equal(runtime.spec.name, 'conversation.input.dock')
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
  assert.deepEqual(labels, ['dsh-tavern: conversation script lifecycle', 'dsh-tavern: inline assistant renderer', 'dsh-tavern: raw user message renderer'])
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
