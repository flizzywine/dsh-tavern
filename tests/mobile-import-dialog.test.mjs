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

test('列表按修改时间新→旧渲染全部文件，PNG 带缩略图、JSON 走占位', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  assert.ok(dialog(), '对话框应打开')
  assert.equal(rows().length, FILES.length, '应列出全部文件')
  assert.equal(rowNames()[0], '【MoM】糖糖公司 V3.8正式版.json', '默认最新修改在前')
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /共 5 个文件/)

  const pngRow = rows().find(row => row.querySelector('img'))
  const jsonRow = rows().find(row => !row.querySelector('img'))
  assert.match(pngRow.querySelector('img').getAttribute('src'), /^\/api\/dsh-tavern\/mobile-card-thumbnail\?id=download%3A/)
  assert.equal(pngRow.querySelector('img').getAttribute('loading'), 'lazy')
  assert.equal(jsonRow.querySelector('.dsh-tavern-mobile-import-thumb-fallback').textContent, 'JSON')
  assert.equal(jsonRow.querySelector('b').getAttribute('title'), jsonRow.querySelector('b').textContent, '长文件名应带 title')
  await act(async () => { reactRoot.unmount() })
})

test('排序支持大小、文件名与类型优先，选择会记住', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  const select = () => dialog().querySelector('.dsh-tavern-mobile-import-sort')
  assert.equal(select().value, 'modified-desc', '默认排序')

  await act(async () => { setValue(select(), 'size-desc') })
  assert.equal(rowNames()[0], 'Collection.png', '大→小排序后最大的在前')
  await act(async () => { setValue(select(), 'size-asc') })
  assert.equal(rowNames()[0], '【MoM】糖糖公司 V3.8正式版.json', '小→大排序后最小的在前')
  await act(async () => { setValue(select(), 'png-first') })
  assert.ok(rows()[0].querySelector('img'), 'PNG 优先时第一行是图片')
  assert.equal(rows()[FILES.length - 1].querySelector('img'), null, 'PNG 优先时最后一行是 JSON')
  await act(async () => { setValue(select(), 'json-first') })
  assert.equal(rows()[0].querySelector('img'), null, 'JSON 优先时第一行是 JSON')

  await act(async () => { reactRoot.unmount() })
  const remount = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  assert.equal(dialog().querySelector('.dsh-tavern-mobile-import-sort').value, 'json-first', '排序选择应写入 localStorage 并复用')
  await act(async () => { remount.unmount() })
  dom.window.localStorage.clear()
})

test('筛选与计数', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  const search = () => dialog().querySelector('.dsh-tavern-mobile-import-search')
  await act(async () => { setValue(search(), 'mvu版本') })
  assert.equal(rows().length, 2, '筛选后只留匹配行')
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /匹配 2 个/)
  await act(async () => { setValue(search(), '不存在的名字') })
  assert.equal(rows().length, 0)
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-empty, .dsh-tavern-empty').textContent, /没有匹配/)
  await act(async () => { setValue(search(), '') })
  assert.equal(rows().length, FILES.length)
  await act(async () => { reactRoot.unmount() })
})

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

test('批量导入按当前顺序逐个导入，成功后关闭并只刷新一次列表', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  await act(async () => { click(buttonByText('多选')) })
  await act(async () => { setValue(dialog().querySelector('.dsh-tavern-mobile-import-sort'), 'modified-asc') })
  const expected = [rowId(rows()[1].querySelector('b').textContent), rowId(rows()[3].querySelector('b').textContent)]
  await act(async () => { click(rows()[1]); click(rows()[3]) })
  await act(async () => { click(buttonByText('导入选中 2 个')) })
  assert.deepEqual(component.rpcCalls, expected, '按当前排序顺序导入选中的文件')
  assert.equal(component.imported.length, 1, 'onImported 只回调一次')
  assert.equal(dialog(), null, '全部成功后关闭对话框')
  await act(async () => { reactRoot.unmount() })
})

test('非多选模式点条目仍然直接导入该文件', async function () {
  const component = createComponent()
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  const name = rows()[2].querySelector('b').textContent
  await act(async () => { click(rows()[2]) })
  assert.deepEqual(component.rpcCalls, [rowId(name)])
  assert.equal(component.imported.length, 1)
  assert.equal(dialog(), null)
  await act(async () => { reactRoot.unmount() })
})

test('部分失败时保留对话框、汇总错误，并刷新已成功导入的部分', async function () {
  const component = createComponent({ failures: ['download:cc'] })
  const reactRoot = await mount(component)
  await act(async () => { click(buttonByText('导入人物卡')) })
  await act(async () => { click(buttonByText('多选')) })
  await act(async () => { click(rows().find(row => row.querySelector('b').textContent === 'Collection.png')); click(rows()[0]) })
  await act(async () => { click(buttonByText('导入选中 2 个')) })
  assert.equal(component.rpcCalls.length, 2)
  assert.equal(component.imported.length, 1, '成功的那次仍刷新列表')
  assert.ok(dialog(), '有失败时保留对话框')
  const alert = dialog().querySelector('.dsh-tavern-dock-error')
  assert.match(alert.textContent, /1 个文件导入失败/)
  assert.match(alert.textContent, /Collection\.png/)
  await act(async () => { click(buttonByText('关闭')) })
  await act(async () => { click(buttonByText('导入人物卡')) })
  assert.match(dialog().querySelector('.dsh-tavern-mobile-import-count').textContent, /^共 5 个文件$/, '重新打开时不带已选状态')
  await act(async () => { reactRoot.unmount() })
})

test('读取失败时退回系统文件选择器可用', async function () {
  const component = createComponent({ catalog: { available: false, files: [] } })
  const input = { current: { clicked: 0, click() { this.clicked += 1 } } }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const reactRoot = createRoot(host)
  await act(async () => {
    reactRoot.render(React.createElement(component.MobileCardImportButton, { inputRef: input, disabled: false, onImported: async () => {} }))
  })
  await act(async () => { click(buttonByText('导入人物卡')) })
  assert.equal(input.current.clicked, 1, '宿主不支持时应直接打开系统文件选择器')
  await act(async () => { reactRoot.unmount() })
})

test('样式回归：列表可滚动、行不被压缩（此前 1252 行被压扁的根因）', async function () {
  const css = readFileSync(stylePath, 'utf8')
  const rule = selector => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp('(?:^|[\\n}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(css)
    assert.ok(match, '缺少样式规则 ' + selector)
    return match[1]
  }
  assert.match(rule('.dsh-tavern-mobile-import-file'), /flex:\s*none/)
  assert.match(rule('.dsh-tavern-mobile-import-panel > .dsh-tavern-mobile-import-list'), /flex:\s*1 1 auto/)
  assert.match(rule('.dsh-tavern-mobile-import-list'), /overflow-y:\s*auto/)
  assert.match(rule('.dsh-tavern-mobile-import-panel > \*'), /flex:\s*none/)
  assert.match(rule('.dsh-tavern-mobile-import-tools'), /grid-template-columns/)
  assert.match(rule('.dsh-tavern-mobile-import-actions'), /grid-template-columns:\s*repeat\(2/)
  assert.match(rule('.dsh-tavern-mobile-import'), /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '外层网格轨道不能吃到最小内容宽度')
  assert.match(rule('.dsh-tavern-mobile-import-meta b'), /text-overflow:\s*ellipsis/)
})
