// 外观 → 正文排版：行距、字距只在调过时接管正文；字号就是 DSH 通用设置里的字号。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { clientControls } from './fixtures/native-controls.mjs'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
// 正文排版的行距/字距读的是同一个设置对象，自动分段的规则与开关在 prose-layout.js 里，
// 所以从那份源码开始切，免得切片里引用不到 normalizeTavernProseLayout。
const start = client.indexOf('const TAVERN_PROSE_DEFAULTS')
const marker = 'const tavernTextLayoutFeature = createTavernTextLayoutFeature();'
const source = client.slice(start, client.indexOf(marker) + marker.length)

async function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = (await import('react')).default
  const controls = clientControls(React)
  const api = new Function('React', 'window', 'document', ...Object.keys(controls), source + '\nreturn { feature: tavernTextLayoutFeature, prose: tavernProseLayoutSettings, layoutText: layoutTavernProseText };')(React, dom.window, dom.window.document, ...Object.values(controls))
  return { dom, React, feature: api.feature, prose: api.prose, layoutText: api.layoutText }
}

test('调过才写变量和开关属性；恢复默认后撤掉，并保存在本机', async () => {
  const { dom, feature } = await setup()
  const root = dom.window.document.documentElement
  feature.apply(feature.normalize(null))
  assert.equal(root.hasAttribute('data-dsh-text-layout'), false)
  feature.update({ lineHeight: 2.2, letterSpacing: 0.05 })
  assert.equal(root.hasAttribute('data-dsh-text-layout'), true)
  assert.equal(root.style.getPropertyValue('--dsh-tavern-line-height'), '2.2')
  assert.equal(root.style.getPropertyValue('--dsh-tavern-letter-spacing'), '0.05em')
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('dsh-tavern-text-layout')), { lineHeight: 2.2, letterSpacing: 0.05, paragraphs: true, sentences: 2, indent: false })
  feature.update({ lineHeight: null, letterSpacing: null })
  assert.equal(root.hasAttribute('data-dsh-text-layout'), false)
  assert.equal(root.style.getPropertyValue('--dsh-tavern-line-height'), '')
})

test('DSH 0.2.0 宿主：字号是单个数值，setFontSize(px) 也能调节；超过宿主上限时夹到上限而不是报错', async () => {
  const { dom, React, feature } = await setup()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  let snapshot = { fontSize: 17 }
  const changes = new Set()
  const writes = []
  const theme = {
    getTheme: () => snapshot,
    setFontSize: (px) => {
      if (!Number.isInteger(px) || px < 10 || px > 22) throw new Error(`font size ${px} is outside 10..22`)
      writes.push(px)
      snapshot = { fontSize: px }
      changes.forEach(fn => fn(snapshot))
    }
  }
  let registered, Row
  const ctx = {
    theme, on: (_event, fn) => { changes.add(fn); return () => changes.delete(fn) },
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; Row = component; return () => {} } }
  }
  feature.register(ctx)
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Row, registered.inject())) })
  const values = () => [...dom.window.document.querySelectorAll('.dsh-tavern-text-layout-value')].map(node => node.textContent)
  assert.equal(values()[0], '17px', '0.2.0 的 snapshot 只有 fontSize，也要读到')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  const size = dom.window.document.querySelector('.dsh-tavern-text-layout input[type=range]')
  await act(async () => { setter.call(size, '20'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes, [20], '按 0.2.0 的 setFontSize(px) 写入')
  await act(async () => { setter.call(size, '30'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes, [20, 22], '超过 0.2.0 的 22px 上限时改用上限值')
  assert.equal(size.max, '22', '滑杆跟着宿主上限收窄')
  assert.equal(values()[0], '22px')
  assert.equal(dom.window.document.querySelector('.dsh-tavern-settings-error'), null, '不把宿主上限报错摆在设置页上')
  await act(async () => { setter.call(size, '12'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.equal(writes.at(-1), 12, '收窄后仍能正常调节')
  await act(async () => { root.unmount() })
})

test('自动分段：开关写进同一份设置、立刻改显示，并通知已挂着的正文重画', async () => {
  const { dom, React, feature, prose } = await setup()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  let registered, Row
  const ctx = {
    theme: { getTheme: () => ({ fontSizes: { text: 14 } }), setFontSize: () => {} },
    on: () => () => {},
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; Row = component; return () => {} } }
  }
  feature.register(ctx)
  const changed = []
  dom.window.addEventListener('dsh-tavern-prose-layout', () => changed.push(true))
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Row, registered.inject())) })

  const rootNode = dom.window.document.documentElement
  assert.equal(rootNode.hasAttribute('data-dsh-tavern-prose-indent'), false, '默认不缩进')
  assert.equal(prose().paragraphs, true, '默认开着自动分段')

  const layers = () => [...dom.window.document.querySelectorAll('.dsh-tavern-text-layout-switch input[role="switch"]')]
  await act(async () => { layers()[0].click() })
  assert.equal(prose().paragraphs, false, '关掉后正文不再自动分段')
  assert.equal(JSON.parse(dom.window.localStorage.getItem('dsh-tavern-text-layout')).paragraphs, false)
  assert.ok(changed.length >= 1, '改完通知正文重画')

  await act(async () => { layers()[1].click() })
  assert.equal(prose().indent, true, '段首缩进开关生效')
  assert.equal(rootNode.hasAttribute('data-dsh-tavern-prose-indent'), true)

  const sentences = dom.window.document.querySelectorAll('.dsh-tavern-text-layout input[type=range]')[3]
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(sentences, '4'); sentences.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.equal(prose().sentences, 4, '每段句数可调')
  await act(async () => { root.unmount() })
})
