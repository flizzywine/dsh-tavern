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

test('消息 iframe 允许可信远程资源，同时保留不透明来源隔离和受控高度协议', () => {
  const document = client.buildTavernFrameDocument({
    content: '<p>正文</p><style>p{color:red}</style><script src="https://cdn.jsdelivr.net/example.js"></script>',
    token: 'height-token'
  })

  assert.match(document, /<p>正文<\/p><style>p\{color:red\}<\/style>/)
  assert.match(document, /cdn\.jsdelivr\.net\/example\.js/)
  assert.match(document, /default-src https: data: blob:/)
  assert.match(document, /connect-src https: wss: data: blob:/)
  assert.match(document, /frame-src https: data: blob:/)
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
