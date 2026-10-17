import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 「从手机下载目录导入」对话框的行为回归测试。
// 用 tavern-plugin 自带的 react / react-dom / jsdom 在真实 DOM 上挂载组件源码，
// 数据是内置夹具，不依赖任何真实设备、服务或网络。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'tavern-plugin/src/client/main.js')
const stylePath = path.join(root, 'tavern-plugin/lib/client-assets/tavern.css')
const SEARCH_ROOTS = [path.join(root, 'tavern-plugin/node_modules'), path.join(root, 'node_modules')]
function loadPackage(name) {
  let failure = null
  for (const base of SEARCH_ROOTS) {
    try { return createRequire(path.join(base, 'noop.js'))(name) } catch (error) { failure = error }
  }
  throw new Error('缺少测试依赖 ' + name + '，请先在 tavern-plugin 下安装依赖：' + (failure && failure.message))
}

const { JSDOM } = loadPackage('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:41661/' })
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true
})) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })

const React = loadPackage('react')
const { createRoot } = loadPackage('react-dom/client')
const act = React.act || loadPackage('react-dom/test-utils').act

const FILES = [
  { id: 'download:aa', name: '【MoM】糖糖公司 V3.8正式版.json', directory: '手机 Download', size: 699392, modifiedAt: 5000 },
  { id: 'download:bb', name: '梦鲸思客V4-0915.json', directory: '手机 Download', size: 1429504, modifiedAt: 4000 },
  { id: 'download:cc', name: 'Collection.png', directory: '手机 Download', size: 13312000, modifiedAt: 3000 },
  { id: 'download:dd', name: '各色熟女仙子被屁孩的我装纯攻略 MVU版本.png', directory: '手机 Download', size: 1845248, modifiedAt: 2000 },
  { id: 'download:ee', name: '假戏真做的反派 MVU版本.png', directory: '手机 Download', size: 1623552, modifiedAt: 1000 }
]
const CATALOG = { available: true, storageAccessible: true, total: FILES.length, files: FILES }

function componentSource() {
  const source = readFileSync(sourcePath, 'utf8')
  const start = source.indexOf('const MOBILE_IMPORT_SORTS')
  const end = source.indexOf('\n\t\t// @include modules/runtime-generation-monitor.js')
  assert.ok(start > 0 && end > start, '无法在客户端源码里定位 MobileCardImportButton')
  return source.slice(start, end)
}

function createComponent(options = {}) {
  const imported = []
  const rpcCalls = []
  const failures = new Set(options.failures || [])
  const factory = new Function('React', 'rpcWithTimeout', 'rpc', componentSource() + '\nreturn { MobileCardImportButton, MOBILE_IMPORT_SORTS };')
  const { MobileCardImportButton, MOBILE_IMPORT_SORTS } = factory(
    React,
    async function () { return options.catalog === undefined ? CATALOG : options.catalog },
    async function (method, args) {
      rpcCalls.push(args.id)
      if (failures.has(args.id)) throw new Error('手机文件不存在、过大或不允许读取')
      return { card: { path: args.id + '.json' } }
    }
  )
  return { MobileCardImportButton, MOBILE_IMPORT_SORTS, imported, rpcCalls }
}

const rows = () => Array.from(document.querySelectorAll('.dsh-tavern-mobile-import-file'))
const rowNames = () => rows().map(row => row.querySelector('b').textContent)
const rowId = rowName => FILES.find(file => file.name === rowName).id
const dialog = () => document.querySelector('[aria-label="从手机下载目录导入人物卡"]')
const buttonByText = text => Array.from(document.querySelectorAll('button')).find(node => node.textContent === text) || null
const buttonMatching = pattern => Array.from(document.querySelectorAll('button')).find(node => pattern.test(node.textContent)) || null
const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
function setValue(element, value) {
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
  element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
async function mount(component, onImported) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const reactRoot = createRoot(host)
  await act(async () => {
    reactRoot.render(React.createElement(component.MobileCardImportButton, {
      inputRef: { current: null },
      disabled: false,
      onImported: async card => { component.imported.push(card); if (onImported) onImported(card) }
    }))
  })
  return reactRoot
}

test('多选：勾选、跨筛选累计、全选与清空', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  await act(async () => { click(buttonByText('多选')) })
  assert.ok(document.querySelector('.dsh-tavern-mobile-import-selection'), '多选条应出现')

  const selectedNames = () => rows().filter(row => row.classList.contains('selected')).map(row => row.querySelector('b').textContent)
  const first = rows()[0].querySelector('b').textContent
  const second = rows()[1].querySelector('b').textContent
  await act(async () => { click(rows()[0]); click(rows()[1]) })
  assert.deepEqual(selectedNames(), [first, second], '点条目应勾选')
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /已选 2 个/)
  assert.ok(buttonByText('导入选中 2 个'), '批量按钮应显示数量')

  await act(async () => { click(rows()[0]) })
  assert.deepEqual(selectedNames(), [second], '再点一次取消勾选')

  const search = () => dialog().querySelector('.dsh-tavern-mobile-import-search')
  await act(async () => { setValue(search(), 'Collection') })
  assert.equal(rows().length, 1, '筛选到单行')
  assert.equal(selectedNames().length, 0, '该行未被勾选')
  await act(async () => { click(buttonMatching(/^全选/)) })
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /已选 2 个/, '跨筛选累计')
  await act(async () => { click(buttonMatching(/^取消全选$/)) })
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /已选 1 个/, '取消全选只影响当前筛选')
  await act(async () => { setValue(search(), '') })
  await act(async () => { click(buttonByText('清空选择')) })
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /^共 5 个文件$/, '清空后不再有已选')
  await act(async () => { reactRoot.unmount() })
})
