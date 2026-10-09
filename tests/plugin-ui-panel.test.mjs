import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTavernUiExtensions()')
const factory = source.slice(start, source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start))

function load() {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary'
  }
  return vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
}

test('插件面板：注册为当前游戏的侧栏页，卸载时移除；没有打开游戏时给出提示', () => {
  const ui = load()
  const tabs = new Map()
  ui.attachHost({ betterSidebar: { registerTab(tab) { tabs.set(tab.id, tab); return () => tabs.delete(tab.id) } } })
  const plugin = { ctx: { fiber: { name: 'memory-plugin' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const seen = []
  const dispose = plugin.registerPanel({ id: 'state', title: '记忆', render: ({ gameId }) => { seen.push(gameId); return 'panel:' + gameId } })
  const tab = tabs.get('tavern-plugin:memory-plugin:state')
  assert.equal(tab.title, '记忆')
  assert.equal(ui.service.apiVersion, 2)
  const rendered = tab.component({ scope: { sessionId: 'game-1' } })
  assert.equal(rendered.type, 'Boundary')
  assert.equal(rendered.children[0], 'panel:game-1')
  assert.deepEqual(seen, ['game-1'])
  assert.match(tab.component({ scope: {} }).children[0].children[0], /请先打开一局游戏/)
  assert.throws(() => plugin.registerPanel({ id: 'state', title: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerPanel({ id: 'Bad Id', title: 'x', render() {} }), /id/)
  dispose()
  assert.equal(tabs.size, 0)
})
