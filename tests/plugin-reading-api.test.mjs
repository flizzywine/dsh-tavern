// tavernUi apiVersion 9: header tools, Tavern's own controls, the story read aloud and the voice channel hold.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

function load(extra = {}) {
  const calls = [], holds = []
  const context = {
    calls, holds,
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary', tavernPluginAllowed: () => true, tavernErrorHub: { report() {} },
    Slider: 'Slider', Segmented: 'Segmented', Switch: 'Switch', SearchBox: 'SearchBox', Icon: 'Icon', Spinner: 'Spinner', EmptyState: 'EmptyState',
    voiceChannel: { hold() { const token = {}; holds.push(token); return () => holds.splice(holds.indexOf(token), 1) } },
    tavernReading: new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return name === 'units' ? Promise.resolve([]) : true } }),
    ...extra
  }
  return { ui: vm.runInNewContext(factory + '; createTavernUiExtensions()', context), calls, holds }
}
// a plugin's own tavernUi: its Cordis context (effects run at once, disposed on unload)
function plugin(ui, name = 'dsh-tavern-audiobook') {
  const disposers = []
  const instance = { ctx: { fiber: { name }, effect(fn) { const dispose = fn(); disposers.push(dispose); return dispose } } }
  Object.setPrototypeOf(instance, ui.service)
  return { tavernUi: instance, unload: () => disposers.splice(0).forEach(dispose => dispose()) }
}

test('apiVersion 9：插件拿到酒馆自己的控件', () => {
  const { ui } = load()
  assert.equal(ui.service.apiVersion, 11)
  assert.deepEqual(Object.keys(ui.service.components), ['Slider', 'Segmented', 'Switch', 'SearchBox', 'Icon', 'Spinner', 'EmptyState'])
  assert.equal(ui.service.components.Slider, 'Slider')
})

test('顶栏工具：按插件登记，同名重复报错，卸载后消失', () => {
  const { ui } = load()
  const { tavernUi, unload } = plugin(ui)
  assert.throws(() => tavernUi.registerHeaderTool({ id: 'Bad Id', render() {} }), /id 只能用/)
  tavernUi.registerHeaderTool({ id: 'audiobook', render: ({ gameId, menu }) => gameId + ':' + menu })
  assert.throws(() => tavernUi.registerHeaderTool({ id: 'audiobook', render() {} }), /已注册/)
  const [tool] = ui.headerTools()
  assert.equal(tool.key, 'dsh-tavern-audiobook:audiobook')
  assert.equal(tool.render({ gameId: 'g', menu: true }), 'g:true')
  unload()
  assert.equal(ui.headerTools().length, 0)
})

test('朗读：各方法交给酒馆的朗读（舞台读法与语音播放器）；占住声音通道直到释放或插件卸载', async () => {
  const { ui, calls, holds } = load()
  const { tavernUi, unload } = plugin(ui)
  await tavernUi.readingUnits('g')
  tavernUi.prepareReading('g', 'k', { lines: 'reader' })
  tavernUi.playReading('g', 'k', { volume: 0.5 })
  tavernUi.pauseReading(); tavernUi.resumeReading(); tavernUi.tuneReading({ rate: 1.2 }); tavernUi.stopReading()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['units', 'g'], ['prepare', 'g', 'k', { lines: 'reader' }], ['play', 'g', 'k', { volume: 0.5 }], ['pause'], ['resume'], ['tune', { rate: 1.2 }], ['stop']])
  const release = tavernUi.holdVoice()
  assert.equal(holds.length, 1)
  release()
  assert.equal(holds.length, 0)
  tavernUi.holdVoice()
  unload()
  assert.equal(holds.length, 0, '插件卸载即释放')
})