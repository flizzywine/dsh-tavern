import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const layoutSource = await readFile(new URL('../tavern-plugin/src/client/modules/mobile-layout.js', import.meta.url), 'utf8')
const entrySource = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// 取出一个具名函数（含函数体），宿主客户端是 IIFE 拼装出来的，只能按平衡括号切片。
function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `缺少 ${name}`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (!depth) return source.slice(start, index + 1)
    }
  }
  throw new Error(`${name} 括号不闭合`)
}

function makeClassList() {
  const names = new Set()
  return {
    add: (...values) => values.forEach(value => names.add(value)),
    remove: (...values) => values.forEach(value => names.delete(value)),
    contains: value => names.has(value),
    toggle: (value, on) => { if (on === undefined ? !names.has(value) : on) names.add(value); else names.delete(value) },
    values: () => [...names]
  }
}

function makeStyle() {
  const values = new Map()
  return {
    getPropertyValue: name => values.get(name) || '',
    getPropertyPriority: () => '',
    setProperty: (name, value) => values.set(name, String(value)),
    removeProperty: name => values.delete(name)
  }
}

function makeDocument({ width = 390 } = {}) {
  const listeners = new Map()
  const doc = {
    documentElement: { style: makeStyle(), classList: makeClassList() },
    body: {},
    querySelector: selector => selector === '[data-composer-seat]' ? doc.seat : selector === '[data-composer-card]' ? doc.card : null,
    addEventListener: (name, handler) => listeners.set(name, [...(listeners.get(name) || []), handler]),
    removeEventListener: (name, handler) => listeners.set(name, (listeners.get(name) || []).filter(item => item !== handler)),
    dispatch: (name, event = {}) => (listeners.get(name) || []).forEach(handler => handler(event))
  }
  doc.seat = { getBoundingClientRect: () => ({ top: 700 - (800 - doc.view.innerHeight), left: 0, width }), scrollHeight: 0, clientHeight: 0, isConnected: true, children: [] }
  doc.card = { getBoundingClientRect: () => ({ top: 700, left: 0, width }) }
  return doc
}

function makeView(doc, { height = 800, visual } = {}) {
  const frames = new Map()
  let nextFrame = 1
  const listeners = new Map()
  const vvListeners = new Map()
  const vv = {
    height: visual ?? height,
    offsetTop: 0,
    scale: 1,
    addEventListener: (name, handler) => vvListeners.set(name, [...(vvListeners.get(name) || []), handler]),
    removeEventListener: (name, handler) => vvListeners.set(name, (vvListeners.get(name) || []).filter(item => item !== handler)),
    dispatch: name => (vvListeners.get(name) || []).forEach(handler => handler())
  }
  const view = {
    innerHeight: height,
    visualViewport: vv,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: handler => { const id = nextFrame++; frames.set(id, handler); return id },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, handler) => listeners.set(name, [...(listeners.get(name) || []), handler]),
    removeEventListener: (name, handler) => listeners.set(name, (listeners.get(name) || []).filter(item => item !== handler)),
    dispatch: name => (listeners.get(name) || []).forEach(handler => handler())
  }
  return {
    view,
    vv,
    // 一帧一帧地跑排队的 rAF 回调。
    flush: () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(handler => handler()) },
    pending: () => frames.size
  }
}

const header = { getBoundingClientRect: () => ({ bottom: 44 }) }

function installPin() {
  const doc = makeDocument()
  const harness = makeView(doc)
  doc.view = harness.view
  doc.defaultView = harness.view
  doc.querySelector = selector => selector === '[data-composer-seat]' ? doc.seat : selector === '[data-composer-card]' ? doc.card : selector.includes('header') ? header : null
  const clock = { now: 1000 }
  const sandbox = {
    Date: { now: () => clock.now },
    composerOffsetPx: () => 0,
    sheetMaxPx: () => 0
  }
  const factory = vm.runInNewContext(`${layoutSource}\n;({ tavernShellHeight, installVisualViewportPin, TAVERN_KEYBOARD_INSET_MIN, TAVERN_KEYBOARD_SETTLE_MS })`, sandbox)
  const release = factory.installVisualViewportPin(doc)
  return { doc, harness, factory, release, clock, style: doc.documentElement.style }
}

test('键盘顶起页面时外壳跟随布局视口，而不是可视区像素', () => {
  const { style, factory } = installPin()
  // 没有键盘：布局视口就是可视区。
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
  // Chrome resizes-visual：布局视口不动，可视区缩了 → 必须按像素锁高，否则输入条被键盘盖住。
  assert.equal(factory.tavernShellHeight(800, 460), '460px')
  // 原生窗口或父级 iframe 跟着键盘缩了：布局视口自己就变短了 → 100% 就是同帧跟随。
  assert.equal(factory.tavernShellHeight(470, 470), '100%')
  assert.equal(factory.tavernShellHeight(0, 0), null)
  assert.equal(factory.tavernShellHeight(800, 795), '100%', '取整误差不能当成键盘')
  assert.equal(factory.tavernShellHeight(800, 780), '780px', '明显的遮挡仍要按可视区缩')
})

test('visualViewport 缩小时当场改高度，不等下一帧', () => {
  const { harness, style } = installPin()
  harness.view.innerHeight = 800
  harness.vv.height = 420
  harness.vv.dispatch('resize')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '420px')
  harness.vv.height = 800
  harness.vv.dispatch('resize')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
})

test('布局视口被原生顶上去时切换成 100%，关闭后回落', () => {
  const { harness, style } = installPin()
  harness.view.innerHeight = 470
  harness.vv.height = 470
  harness.view.dispatch('resize')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
  harness.view.innerHeight = 800
  harness.vv.height = 800
  harness.view.dispatch('resize')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
})

test('漏掉一次 resize 事件也能在后续帧里自己纠正（不顶上去/不回落）', () => {
  const { harness, style, clock } = installPin()
  // 键盘弹出：事件照常来，进入跟随模式。
  harness.vv.dispatch('resize')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
  // 键盘真的弹出来，但这次系统一个事件都没发。
  harness.view.innerHeight = 800
  harness.vv.height = 430
  clock.now += 16
  harness.flush()
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '430px', '自行刷帧要把页面拉回键盘上方')
  // 键盘收起同样不发事件。
  harness.vv.height = 800
  clock.now += 16
  harness.flush()
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%')
})

test('刷新窗口只在输入法动画期间持续', () => {
  const { harness, clock, factory } = installPin()
  harness.vv.dispatch('resize')
  let frames = 0
  while (harness.pending()) {
    clock.now += 16
    harness.flush()
    assert.ok(++frames < 100, '刷新必须自己停下来')
  }
  assert.ok(clock.now - 1000 >= factory.TAVERN_KEYBOARD_SETTLE_MS, '至少覆盖一次输入法动画')
})

test('外壳高度走 --dsh-shell-height，不再直接吃 --dsh-vv-height', () => {
  const start = css.indexOf('body.dsh-tavern-shell-active [data-slot="root"] > [class*="_frame"]')
  assert.ok(start > 0)
  const rule = css.slice(start, css.indexOf('}', start))
  assert.match(rule, /height: var\(--dsh-shell-height, 100dvh\) !important/)
  assert.doesNotMatch(rule, /height: var\(--dsh-vv-height/)
})

test('内嵌酒馆的 iframe 外壳同样跟随布局视口', () => {
  const source = sliceFunction(entrySource, 'installEmbeddedViewport')
  const constants = entrySource.slice(entrySource.indexOf('const EMBED_KEYBOARD_INSET_MIN'), entrySource.indexOf('function installEmbeddedViewport('))
  assert.match(constants, /EMBED_KEYBOARD_INSET_MIN/)
  const clock = { now: 1000 }
  const sandbox = { Date: { now: () => clock.now } }
  const factory = vm.runInNewContext(`${constants}\n${source}\n;({ installEmbeddedViewport })`, sandbox)
  const doc = makeDocument()
  const harness = makeView(doc)
  // 内嵌外壳直接写 DOM style 属性，不是 setProperty。
  const root = { style: { removeProperty(name) { delete this[name] } }, ownerDocument: { defaultView: harness.view } }
  const release = factory.installEmbeddedViewport(root)
  assert.equal(root.style.height, '100%', '没键盘时铺满顶层布局视口')
  // 浏览器 resizes-visual：顶层布局视口不动，只有可视区缩了 → 外壳按像素缩，否则输入条被键盘盖住。
  harness.view.innerHeight = 800
  harness.vv.height = 380
  harness.vv.dispatch('resize')
  assert.equal(root.style.height, '380px')
  // 原生把窗口顶上去之后交回布局视口，内部酒馆就跟着原生重排，不再等事件。
  harness.view.innerHeight = 380
  harness.vv.height = 380
  harness.view.dispatch('resize')
  assert.equal(root.style.height, '100%')
  release()
})
