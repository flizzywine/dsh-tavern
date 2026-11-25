// tavernUi apiVersion 11: openImage — a plugin's picture opens Tavern's own large-picture view (image-viewer.js).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

function load() {
  const opened = [], reports = []
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    document: {},
    tavernPluginBoundary: () => 'Boundary', tavernPluginAllowed: () => true,
    tavernErrorHub: { report(label, error) { reports.push([label, error.message]) } },
    openImageViewer(options) {
      const view = { options, open: true, close() { if (!view.open) return; view.open = false; if (options.onClose) options.onClose() } }
      opened.push(view)
      return view
    },
  }
  return { ui: vm.runInNewContext(factory + '; createTavernUiExtensions()', context), opened, reports }
}
function plugin(ui, name = 'dsh-runninghub') {
  const disposers = []
  const instance = { ctx: { fiber: { name }, effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose } } }
  Object.setPrototypeOf(instance, ui.service)
  return { tavernUi: instance, unload: () => disposers.splice(0).forEach(dispose => dispose()) }
}

test('apiVersion 11：openImage 用酒馆自己的大图查看器打开插件图片', () => {
  const { ui, opened } = load()
  const { tavernUi } = plugin(ui)
  assert.equal(ui.service.apiVersion, 11)
  let closed = 0
  const handle = tavernUi.openImage({ src: '/api/dsh-runninghub/media?id=a', alt: '漫画页', onClose: () => { closed++ } })
  assert.equal(opened.length, 1)
  assert.equal(opened[0].options.src, '/api/dsh-runninghub/media?id=a')
  assert.equal(opened[0].options.alt, '漫画页')
  handle.close()
  assert.equal(opened[0].open, false)
  assert.equal(closed, 1)
  handle.close()
  assert.equal(closed, 1, 'onClose 只调用一次')
})

test('openImage：只传地址也行；玩家自己关掉后插件卸载不再重复回调', () => {
  const { ui, opened } = load()
  const { tavernUi, unload } = plugin(ui)
  let closed = 0
  tavernUi.openImage('/x.png')
  tavernUi.openImage({ src: '/y.png', onClose: () => { closed++ } })
  assert.equal(opened[0].options.alt, '插图')
  opened[1].close()
  assert.equal(closed, 1)
  unload()
  assert.equal(opened[0].open, false, '插件卸载时关掉还开着的大图')
  assert.equal(closed, 1)
})

test('openImage：参数不对直接报错；onClose 出错记进错误中心', () => {
  const { ui, opened, reports } = load()
  const { tavernUi } = plugin(ui)
  assert.throws(() => tavernUi.openImage({}), /需要图片地址 src/)
  assert.throws(() => tavernUi.openImage({ src: '/a.png', alt: 3 }), /alt 必须是字符串/)
  assert.throws(() => tavernUi.openImage({ src: '/a.png', onClose: 1 }), /onClose 必须是函数/)
  assert.equal(opened.length, 0)
  tavernUi.openImage({ src: '/a.png', onClose: () => { throw new Error('boom') } }).close()
  assert.deepEqual(reports, [['插件 dsh-runninghub', 'boom']])
})
