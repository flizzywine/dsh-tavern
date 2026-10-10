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

test('开始页分组：插件声明的分组排在 Tavern 自带分组之后，组内的页不再出现在「插件」「其他」里', () => {
  const ui = load()
  const plugin = { ctx: { fiber: { name: 'narrative-anchor' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const dispose = plugin.registerStartGroup({ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'state', 'dsh-tavern:status'] })
  assert.deepEqual(JSON.parse(JSON.stringify(ui.startGroups())), [{ title: '叙事锚定', tabs: ['narrative-anchor:settings', 'tavern-plugin:narrative-anchor:state', 'dsh-tavern:status'] }])
  assert.throws(() => plugin.registerStartGroup({ title: '', tabs: ['a:b'] }), /title/)
  assert.throws(() => plugin.registerStartGroup({ title: 'x', tabs: [] }), /tabs/)

  const start = source.indexOf('function TavernStartCards(props)')
  const body = source.slice(start, source.indexOf('function registerTavernStartPage', start))
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const Cards = vm.runInNewContext(body + '; TavernStartCards', { React: { createElement: h } })
  const options = ['dsh-tavern:status', 'narrative-anchor:settings', 'narrative-anchor:quick', 'tavern-plugin:narrative-anchor:state', 'tavern-plugin:other:x', 'misc:tab'].map(id => ({ id, label: id }))
  const tree = Cards({ newTabOptions: options, onNewTab() {}, pluginGroups: ui.startGroups() })
  const sections = tree.children.filter(child => child && child.type === 'section').map(section => [section.props['aria-label'], section.children[1].children.map(card => card.props.key)])
  assert.deepEqual(sections, [
    ['本局', ['dsh-tavern:status']],
    ['叙事锚定', ['narrative-anchor:settings', 'tavern-plugin:narrative-anchor:state']],
    ['插件', ['tavern-plugin:other:x']],
    ['其他', ['narrative-anchor:quick', 'misc:tab']],
  ])
  dispose()
  assert.equal(ui.startGroups().length, 0)
})
