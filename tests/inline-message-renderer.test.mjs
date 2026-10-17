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
