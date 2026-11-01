import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

// The module is inlined into the classic client bundle, so it is loaded here the same
// way the bundle sees it: one script, no module scope, sharing the page's document.
const source = await readFile(new URL('../tavern-plugin/src/client/modules/floor-text-measure.js', import.meta.url), 'utf8')

function sandbox({ width = 320, canvas = false } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="floor"></div></body></html>', { url: 'http://localhost/' })
    const { window } = dom
    if (canvas) {
        window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {}
        const create = window.document.createElement.bind(window.document)
        window.document.createElement = function (tag) {
            return String(tag).toLowerCase() === 'canvas' ? { getContext: () => ({ measureText: () => ({ width: 0 }) }) } : create(tag)
        }
    }
    const node = window.document.getElementById('floor')
    Object.defineProperty(node, 'clientWidth', { configurable: true, value: width })
    const context = vm.createContext({
        window, document: window.document, console,
        URL, Math, Number, String, Array, Object, Map, Set, Promise, Error, Boolean, JSON
    })
    const bridge = '\n;globalThis.__floorMeasure = { state: tavernTextMeasureState, supported: tavernTextMeasureSupported,'
        + ' whenReady: tavernTextMeasureWhenReady, fallback: tavernTextMeasureFallback,'
        + ' reserve: tavernFloorReserveHeight, text: tavernFloorMeasureText,'
        + ' key: tavernFloorHeightStorageKey, remember: tavernFloorHeightRemember,'
        + ' recall: tavernFloorHeightRecall };'
    vm.runInContext(source + bridge, context, { filename: 'floor-text-measure.js' })
    return { context, measure: context.__floorMeasure, node, window }
}

function readyApi(layout) {
    return {
        prepare: function (text, font, options) { return { text: text, font: font, options: options } },
        layout: layout || function (prepared, width, lineHeight) { return { height: lineHeight * 3, lineCount: 3 } }
    }
}

test('未就绪时不猜高度，调用方保留 800 px 兜底', () => {
    const { measure, node } = sandbox()
    assert.equal(measure.reserve(node, '第一段\n\n第二段'), 0)
    assert.equal(measure.fallback(), 800)
})

test('测量模块就绪后按段落算出预留高度', () => {
    const { measure, node } = sandbox()
    measure.state.api = readyApi()
    // 两段各 3 行 × 24 px，段间一个 0.6 行间距（末段不计）
    const height = measure.reserve(node, '第一段\n\n第二段')
    assert.ok(height >= 158 && height <= 160, String(height))
})

test('同一段文本只准备一次，line 布局仍按宽度重算', () => {
    const { measure, node } = sandbox()
    const prepared = [], laid = []
    measure.state.api = {
        prepare: function (text) { prepared.push(text); return { text: text } },
        layout: function (item, width, lineHeight) { laid.push(width); return { height: lineHeight, lineCount: 1 } }
    }
    measure.reserve(node, '缓存我')
    measure.reserve(node, '缓存我')
    assert.deepEqual(prepared, ['缓存我'])
    assert.deepEqual(laid, [320, 320])
})

test('没有可测宽度或空文本时不返回推测值', () => {
    const { measure, node } = sandbox({ width: 0 })
    measure.state.api = readyApi()
    assert.equal(measure.reserve(node, '正文'), 0)
    const other = sandbox()
    other.measure.state.api = readyApi()
    assert.equal(other.measure.reserve(other.node, '   \n  '), 0)
})

test('排版抛错时退回兜底而不是渲染坏高度', () => {
    const { measure, node } = sandbox()
    measure.state.api = readyApi(function () { throw new Error('layout failed') })
    assert.equal(measure.reserve(node, '正文'), 0)
})

test('有 canvas 2d 的浏览器判定为可测量', () => {
    const { measure } = sandbox({ canvas: true })
    assert.equal(measure.supported(), true)
})

test('无 canvas 的环境把测量判为不可用，不抛错', () => {
    const { measure } = sandbox()
    assert.equal(measure.supported(), false)
    measure.whenReady(function () {})
    assert.equal(measure.state.status, 'unavailable')
})

test('只把 text 块算进预留高度，reocrd 其他块跳过', () => {
    const { measure } = sandbox()
    assert.equal(measure.text([
        { kind: 'text', text: '正文一' },
        { kind: 'reasoning', text: '思考不算' },
        { kind: 'text', text: '   ' },
        { kind: 'text', text: '正文二' }
    ]), '正文一\n正文二')
    assert.equal(measure.text(null), '')
})

test('延迟楼层占位改用测量值，不再是写死的 800 px', async () => {
    const { readFile } = await import('node:fs/promises')
    const renderer = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
    assert.match(renderer, /data-deferred-reserve/, '占位元素要能区分 measured / fallback')
    assert.match(renderer, /\(deferredFloorReserve \|\| tavernTextMeasureFallback\(\)\)/, '兜底仍须是 800 px')
    assert.equal(renderer.includes('"data-deferred-floor": true, style: { minHeight: "800px" }'), false)
})

test('已渲染过的楼层按真实高度回读，宽度变了就作废', () => {
    const { measure, window } = sandbox({ width: 420 })
    const key = measure.key('sess-1', 3, '正文正文')
    assert.match(key, /^dsh-tavern-floor-height:sess-1:3:4$/)
    measure.remember(key, 420, 617)
    assert.equal(measure.recall(key, 420), 617)
    assert.equal(measure.recall(key, 426), 617, '8px 内的列宽差仍可复用')
    assert.equal(measure.recall(key, 520), 0, '换了列宽就必须重新量')
    assert.equal(measure.recall(key, 420), 617)
    window.sessionStorage.clear()
})

test('楼层正文改过长度后旧高度不再命中', () => {
    const { measure, window } = sandbox()
    measure.remember(measure.key('sess-1', 3, '很长很长的正文'), 420, 500)
    assert.equal(measure.recall(measure.key('sess-1', 3, '改短了'), 420), 0)
    window.sessionStorage.clear()
})

test('坏记录、越界高度和空会话都不会污染预留高度', () => {
    const { measure, window } = sandbox()
    const key = measure.key('sess-1', 1, '正文')
    window.sessionStorage.setItem(key, '{not json')
    assert.equal(measure.recall(key, 420), 0)
    measure.remember(key, 420, 0)
    assert.equal(measure.recall(key, 420), 0, '0 高不写入')
    measure.remember(key, 0, 300)
    assert.equal(measure.recall(key, 420), 0, '没有列宽不写入')
    measure.remember(key, 420, 999999)
    assert.equal(measure.recall(key, 420), 32000, '上限仍是 32000')
    assert.equal(measure.key('', 1, '正文'), '', '没有会话就没有 key')
    window.sessionStorage.clear()
})
