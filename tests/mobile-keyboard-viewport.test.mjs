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

function makeView(doc, { height = 800, visual, keyboardRect } = {}) {
  const frames = new Map()
  let nextFrame = 1
  const listeners = new Map()
  const vvListeners = new Map()
  const keyboardListeners = new Map()
  const keyboard = keyboardRect === undefined ? null : {
    boundingRect: { ...keyboardRect },
    addEventListener: (name, handler) => keyboardListeners.set(name, [...(keyboardListeners.get(name) || []), handler]),
    removeEventListener: (name, handler) => keyboardListeners.set(name, (keyboardListeners.get(name) || []).filter(item => item !== handler)),
    dispatch: name => (keyboardListeners.get(name) || []).forEach(handler => handler())
  }
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
    navigator: keyboard ? { virtualKeyboard: keyboard } : undefined,
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
    keyboard,
    // 一帧一帧地跑排队的 rAF 回调。
    flush: () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(handler => handler()) },
    pending: () => frames.size
  }
}

const header = { getBoundingClientRect: () => ({ bottom: 44 }) }

function installPin(options) {
  const doc = makeDocument()
  const harness = makeView(doc, options)
  doc.view = harness.view
  doc.defaultView = harness.view
  doc.querySelector = selector => selector === '[data-composer-seat]' ? doc.seat : selector === '[data-composer-card]' ? doc.card : selector.includes('header') ? header : null
  const clock = { now: 1000 }
  const sandbox = {
    Date: { now: () => clock.now },
    composerOffsetPx: () => 0,
    sheetMaxPx: () => 0
  }
  const factory = vm.runInNewContext(`${layoutSource}\n;({ tavernShellHeight, keyboardPadPx, installVisualViewportPin, TAVERN_KEYBOARD_INSET_MIN, TAVERN_KEYBOARD_SETTLE_MS })`, sandbox)
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

test('输入法压住多少就直接给输入条垫多少', () => {
  const { factory } = installPin()
  // 布局视口和可视化视口都停在 800，键盘其实从 786 起 —— 底下 14px 的输入框被盖住。
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: 786, height: 663 } }, 800), 14)
  // 键盘收齐时矩形是零，不能拿它当遮挡。
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: 0, height: 0 } }, 800), 0)
  assert.equal(factory.keyboardPadPx(null, 800), 0)
  // 键盘整个在下面（布局视口已经缩到键盘上方）就没有要垫的。
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: 800, height: 663 } }, 800), 0)
  // 坐标系对不上的值（上沿跑到可视区上半段）一律不认，垫多了会把输入条顶到屏幕中间。
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: 51, height: 663 } }, 800), 0)
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: Number.NaN, height: 663 } }, 800), 0)
  // 垫高不超过输入法自身高度。
  assert.equal(factory.keyboardPadPx({ boundingRect: { top: 480, height: 200 } }, 800), 200)
})

test('输入法几何一变就当场垫底，不等可视化视口事件', () => {
  const { harness, style, release } = installPin({ keyboardRect: { top: 786, height: 663 } })
  assert.equal(style.getPropertyValue('--dsh-keyboard-inset'), '14px', '进页面就按输入法压住的那一截垫底')
  assert.equal(style.getPropertyValue('--dsh-shell-height'), '100%', '外壳不必再缩')
  assert.equal(style.getPropertyValue('--dsh-vv-height'), '786px', '可视高度扣掉垫底那一段')
  harness.keyboard.boundingRect.top = 800
  harness.keyboard.boundingRect.height = 0
  harness.keyboard.dispatch('geometrychange')
  assert.equal(style.getPropertyValue('--dsh-keyboard-inset'), '0px', '键盘收起立刻回落到 0')
  harness.keyboard.boundingRect.top = 786
  harness.keyboard.boundingRect.height = 663
  harness.keyboard.dispatch('geometrychange')
  assert.equal(style.getPropertyValue('--dsh-keyboard-inset'), '14px')
  release()
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

test('输入条底部按输入法上报的高度垫底', () => {
  const start = css.indexOf('html.dsh-tavern-coarse-play [data-composer-seat]')
  assert.ok(start > 0)
  const rule = css.slice(start, css.indexOf('}', start))
  assert.match(rule, /padding-bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ var\(--dsh-keyboard-inset, 0px\)\)/)
  assert.equal(css.match(/var\(--dsh-keyboard-inset, 0px\)/g).length, 2, '两条输入条规则都要垫')
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
