import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// The host's MarkdownText keeps its streaming parser only while `labels` keeps its
// identity (dsh-client-ui-primitives: `streamLabelsRef.current !== labels` rebuilds
// StreamingRenderer and re-parses the whole reply). A fresh object literal per render
// silently turns every streamed frame into a full markdown parse, so the labels handed
// to it must be stable, shared variants.
const bundle = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')
const textColors = readFileSync(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8')

function labelHelpers() {
  const start = bundle.indexOf('const tavernCodeLabelVariants')
  const end = bundle.indexOf('function renderTavernProjection(')
  assert.ok(start >= 0 && end > start, '构建产物缺少标签变体缓存')
  const context = vm.createContext({})
  vm.runInContext(bundle.slice(start, end) + '\nthis.tavernCodeLabels = tavernCodeLabels; this.tavernMarkdownLabels = tavernMarkdownLabels', context)
  return context
}

test('代码块标签按译文复用同一个对象', () => {
  const context = labelHelpers()
  const translate = key => (key === 'copy' ? '复制' : key === 'copied' ? '已复制' : key)
  const first = context.tavernCodeLabels(translate)
  const second = context.tavernCodeLabels(translate)
  assert.equal(first, second, '相同译文必须复用同一对象')
  assert.deepEqual({ ...first }, { copyLabel: '复制', copiedLabel: '已复制' })
  const english = context.tavernCodeLabels(key => (key === 'copy' ? 'Copy' : 'Copied'))
  assert.notEqual(english, first, '译文变化时换新对象')
  assert.equal(english, context.tavernCodeLabels(key => (key === 'copy' ? 'Copy' : 'Copied')))
})

test('markdown labels 按 codeLabels 复用同一个对象', () => {
  const context = labelHelpers()
  const translate = key => (key === 'copy' ? '复制' : '已复制')
  const codeLabels = context.tavernCodeLabels(translate)
  const first = context.tavernMarkdownLabels(codeLabels)
  const second = context.tavernMarkdownLabels(codeLabels)
  assert.equal(first, second, '每帧新建 labels 会让宿主丢弃流式解析缓存')
  assert.equal(first.code, codeLabels)
  assert.equal(first.footnotes, '脚注')
  assert.notEqual(context.tavernMarkdownLabels(undefined), first)
})

test('正文渲染点不再传 labels 字面量', () => {
  assert.equal((bundle.match(/labels: \{ code:/g) || []).length, 0, '构建产物里仍有每帧新建的 labels 字面量')
  assert.equal((source.match(/labels: \{ code:/g) || []).length, 0, '源码里仍有每帧新建的 labels 字面量')
  const sites = (bundle.match(/labels: tavernMarkdownLabels\(/g) || []).length
  assert.ok(sites >= 3, `正文渲染点应统一走 tavernMarkdownLabels，实际 ${sites} 处`)
  assert.ok(/const codeLabels = (?:input\.codeLabels \|\| )?tavernCodeLabels\(translate\)/.test(bundle), 'codeLabels 未走缓存')
})

test('流式中的正文不挂着色观察器', () => {
  const start = textColors.indexOf('function TavernColoredMarkdown(props)')
  assert.ok(start >= 0, '缺少 TavernColoredMarkdown')
  const body = textColors.slice(start, textColors.indexOf('\n}', start) + 2)
  assert.ok(/const suspend = props\.streaming === true/.test(body), '未读取 streaming 状态')
  assert.ok(/if \(suspend\) return undefined/.test(body), '流式中仍会安装整块着色观察器')
  assert.ok(/\}, \[suspend\]\)/.test(body), 'effect 需要在 streaming 变化时重跑，结算后再上色')
})

// Behaviour: the component must not attach the per-block MutationObserver while the
// reply is still streaming, and must attach it once the text settles.
test('流式结束后才安装着色观察器', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body><main id="prose"><p>“你好”</p></main></body>')
  const win = dom.window
  win.CSS = { highlights: new Map(), supports: () => true }
  win.Highlight = class Highlight extends Set { constructor() { super(); this.priority = 0 } }
  let observers = 0
  const NativeObserver = win.MutationObserver
  win.MutationObserver = class CountingObserver extends NativeObserver { constructor(fn) { super(fn); observers++ } }
  const cleanups = []
  const React = {
    useRef: initial => ({ current: initial }),
    useSyncExternalStore: (_, snapshot) => snapshot(),
    useLayoutEffect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    createElement: () => null
  }
  const context = vm.createContext({
    React,
    DshUi: { MarkdownText: function MarkdownText() {} },
    window: win,
    document: win.document,
    getComputedStyle: (...args) => win.getComputedStyle(...args),
    Array, Object, String, Number, Boolean, Math, Map, WeakMap, Set, WeakSet, JSON, Error, RegExp, Symbol, Promise, console
  })
  vm.runInContext(textColors + '\nthis.TavernColoredMarkdown = TavernColoredMarkdown', context)
  const root = win.document.querySelector('#prose')
  const render = streaming => context.TavernColoredMarkdown({ text: '“你好”', streaming, labels: {} })
  const run = streaming => {
    const previous = React.useRef
    let refs = 0
    React.useRef = value => ({ current: refs++ === 0 ? root : value })
    try { render(streaming) } finally { React.useRef = previous }
  }
  observers = 0
  run(true)
  assert.equal(observers, 0, '流式中不应安装观察器（每帧整块重扫）')
  run(false)
  // 一个共享主题观察器（首个使用者创建）+ 一个本块观察器。
  assert.equal(observers, 2, '结算后应安装本块观察器')
  for (const cleanup of cleanups.splice(0)) cleanup()
  win.close()
})
