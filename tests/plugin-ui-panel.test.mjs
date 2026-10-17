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
  assert.equal(seen.length, 0, '渲染回调由边界内的子组件执行')
  assert.equal(rendered.children[0].type(rendered.children[0].props), 'panel:game-1')
  assert.deepEqual(seen, ['game-1'])
  assert.match(tab.component({ scope: {} }).children[0].children[0], /请先打开一局游戏/)
  assert.throws(() => plugin.registerPanel({ id: 'state', title: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerPanel({ id: 'Bad Id', title: 'x', render() {} }), /id/)
  dispose()
  assert.equal(tabs.size, 0)
})

function loadWith(extra) {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    tavernPluginBoundary: () => 'Boundary', tavernErrorHub: { report() {} }, ...extra
  }
  return vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
}

test('人物卡列表视图：插件视图拿到筛选后的卡片和动作，批量管理时点卡只勾选；出错或返回 null 时退回内置列表', () => {
  const ui = load()
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-grid' } } }
  Object.setPrototypeOf(plugin, ui.service)
  let seen = null
  const dispose = plugin.registerCardListView({ id: 'grid', label: '瀑布', render: input => { seen = input; return input.place === 'play' ? null : 'grid' } })
  assert.throws(() => plugin.registerCardListView({ id: 'grid', label: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerCardListView({ id: 'Bad', label: 'x', render() {} }), /id/)
  assert.throws(() => plugin.registerCardListView({ id: 'x', label: '', render() {} }), /label/)

  const start = source.indexOf('const TAVERN_CARD_LIST_VIEW_KEY')
  const end = source.indexOf('\n\t\t}\n', source.indexOf('function TavernCardList(props)', start)) + 4
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const stored = new Map()
  const List = vm.runInNewContext(source.slice(start, end) + '; TavernCardList', {
    React: { createElement: h, Fragment: 'Fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}] },
    useTavernUiExtensions() {}, tavernUiExtensions: ui, tavernPluginBoundary: () => 'Boundary',
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } }
  })
  const cards = [{ path: 'cards/甲.png', name: '甲', hasImage: true, script: { path: 's', title: '剧本一' }, group: '常玩', starred: true }, { path: 'cards\\乙.json', name: '乙', hasImage: false, script: null, readError: '坏了' }]
  const opened = [], toggled = []
  let managing = false
  const batch = { get managing() { return managing }, isSelected: path => path === 'cards/甲.png', toggle: path => toggled.push(path) }
  const props = place => ({ place, cards, batch, busy: false, open: card => opened.push(card.path), menu: place === 'library' ? card => 'menu:' + card.name : undefined, mention: place === 'library' ? card => '@' + card.name : undefined, builtin: () => 'builtin' })

  // Nothing chosen yet: Tavern's own list, with a switcher for its grid and the plugin view.
  let tree = List(props('library'))
  assert.equal(tree.children[1], 'builtin')
  const choices = tree.children[0].children
  assert.deepEqual(choices.map(button => button.children[0]), ['列表', '宫格', '瀑布'])
  choices[2].props.onClick()
  assert.equal(stored.get('dsh-tavern-card-list-view'), 'dsh-tavern-grid:grid')

  tree = List(props('library'))
  const boundary = tree.children[1]
  assert.equal(boundary.type, 'Boundary')
  assert.equal(boundary.props.fallback, 'builtin')
  const body = boundary.children[0]
  assert.equal(body.type(body.props), 'grid')
  assert.deepEqual(JSON.parse(JSON.stringify(seen.cards)), [
    { path: 'cards/甲.png', name: '甲', fileName: '甲.png', imageUrl: '/api/dsh-tavern/card-image?path=' + encodeURIComponent('cards/甲.png'), script: { title: '剧本一' }, group: '常玩', starred: true, error: '' },
    { path: 'cards\\乙.json', name: '乙', fileName: '乙.json', imageUrl: '', script: null, group: '', starred: false, error: '坏了' }])
  assert.equal(seen.selecting, false)
  assert.equal(seen.isSelected('cards/甲.png'), false)
  assert.equal(seen.menu('cards/甲.png'), 'menu:甲')
  assert.equal(seen.mention('cards/甲.png'), '@甲')
  seen.open('cards/甲.png'); seen.open('cards/不存在.png')
  assert.deepEqual(opened, ['cards/甲.png'])

  managing = true
  tree = List(props('library'))
  tree.children[1].children[0].type(tree.children[1].children[0].props)
  assert.equal(seen.selecting, true)
  assert.equal(seen.isSelected('cards/甲.png'), true)
  assert.equal(seen.menu('cards/甲.png'), null)
  assert.equal(seen.mention('cards/甲.png'), null)
  seen.open('cards/甲.png')
  assert.deepEqual(opened, ['cards/甲.png'])
  assert.deepEqual(toggled, ['cards/甲.png'])

  // A view that returns null for a place leaves Tavern's own list there.
  tree = List(props('play'))
  assert.equal(tree.children[1].children[0].type(tree.children[1].children[0].props), 'builtin')
  assert.equal(seen.mention('cards/甲.png'), null)

  dispose()
  tree = List(props('library'))
  assert.deepEqual(tree.children[0].children.map(button => button.children[0]), ['列表', '宫格'])
  assert.equal(tree.children[1], 'builtin')

  // Tavern's own grid: covers and names; a broken card cannot start a game; corner holds @ and ⋯.
  stored.set('dsh-tavern-card-list-view', 'dsh-tavern:grid')
  managing = false
  const gridOf = place => { const t = List(props(place)).children[1].children[0]; return t.type(t.props) }
  let grid = gridOf('library')
  assert.equal(grid.props.className, 'dsh-tavern-card-grid')
  const [first, second] = grid.children
  const open = first.children[0]
  assert.equal(open.children[0].props.src, '/api/dsh-tavern/card-image?path=' + encodeURIComponent('cards/甲.png'))
  assert.equal(open.children[1].children[0], '甲')
  assert.equal(second.children[0].children[0].children[0], '乙')
  assert.deepEqual(first.children[2].children, ['@甲', 'menu:甲'])
  open.props.onClick()
  assert.deepEqual(opened.slice(-1), ['cards/甲.png'])
  grid = gridOf('play')
  assert.equal(grid.children[1].children[0].props.disabled, true)
  assert.equal(grid.children[0].children[2], null)
})

 test('回合订阅忽略迟到的旧响应，卸载后不再通知', async () => {
  const requests = [], seen = []
  let signal
  const ui = loadWith({
    rpc: () => new Promise(resolve => requests.push(resolve)),
    liveTavernView: { subscribe(_id, listener) { signal = listener; listener(); return () => {} } }
  })
  const stop = ui.service.watchTurnState('g', state => seen.push(state))
  const flush = () => new Promise(resolve => setImmediate(resolve))
  await flush()
  signal()
  await flush()
  requests[1]({ state: { gameId: 'g', turn: 2, busy: false } })
  await flush()
  requests[0]({ state: { gameId: 'g', turn: 1, busy: true } })
  await flush()
  assert.deepEqual(seen, [{ gameId: 'g', turn: 2, busy: false }])
  signal()
  await flush()
  stop()
  requests[2]({ state: { gameId: 'g', turn: 3, busy: true } })
  await flush()
  assert.equal(seen.length, 1)
})

test('舞台视图：插件注册后默认用它，拿到舞台数据与当前一句，返回 null 或出错时用内置舞台；玩家可选回内置', async () => {
  const ui = loadWith({ rpc: async (method, args, gameId) => ({ method, args, gameId, enabled: true, player: '你', card: { name: 'A' }, cast: [{ name: '林曦' }], turns: [{ turn: 2, text: 't', lines: [] }] }),
    tavernStagePublicData: data => ({ enabled: data.enabled !== false, player: data.player, card: data.card, characters: data.cast || [], turns: data.turns || [] }) })
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-galgame' } } }
  Object.setPrototypeOf(plugin, ui.service)
  assert.deepEqual(JSON.parse(JSON.stringify(await plugin.getStage('game-1'))), { enabled: true, player: '你', card: { name: 'A' }, characters: [{ name: '林曦' }], turns: [{ turn: 2, text: 't', lines: [] }] })
  let input = null
  const dispose = plugin.registerStageView({ id: 'vn', label: '视觉小说', render: value => { input = value; return value.fullscreen ? 'vn-scene' : null } })
  assert.throws(() => plugin.registerStageView({ id: 'vn', label: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerStageView({ id: 'Bad', label: 'x', render() {} }), /id/)

  const start = source.indexOf('function tavernStagePublicData(data)')
  const code = source.slice(start, source.indexOf('function useTavernStageReader(', start))
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const stored = new Map()
  const stage = vm.runInNewContext(code + '; ({ useTavernStageView, TavernStageSceneView, TavernStageViewSwitch })', {
    React: { createElement: h, useState: init => [typeof init === 'function' ? init() : init, () => {}] },
    useTavernUiExtensions() {}, tavernUiExtensions: ui, tavernPluginBoundary: () => 'Boundary', TavernStageScene: 'Builtin',
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } }
  })
  let choice = stage.useTavernStageView()
  assert.equal(choice.view.label, '视觉小说', '没选过时用插件视图')
  const beats = [{ kind: 'line', text: '“你好。”', speaker: '林曦', emotion: 'joy' }]
  const props = fullscreen => ({ view: choice.view, sessionId: 'game-1', data: { player: '你', card: { name: 'A' }, cast: [] }, beats, index: 0, fullscreen, onAdvance() {}, footer: 'controls' })
  let tree = stage.TavernStageSceneView(props(true))
  assert.equal(tree.type, 'Boundary')
  assert.equal(tree.props.fallback.type, 'Builtin')
  const body = tree.children[0]
  assert.equal(body.type(body.props), 'vn-scene')
  assert.equal(input.gameId, 'game-1')
  assert.equal(input.beat.speaker, '林曦')
  assert.equal(input.footer, 'controls')
  assert.deepEqual(input.stage.characters, [])
  tree = stage.TavernStageSceneView(props(false))
  assert.equal(tree.children[0].type(tree.children[0].props).type, 'Builtin', '返回 null 时用内置舞台')

  const options = stage.TavernStageViewSwitch({ choice }).children
  assert.deepEqual(options.map(option => option.props.value), ['dsh-tavern:builtin', 'dsh-tavern-galgame:vn'])
  choice.choose('dsh-tavern:builtin')
  choice = stage.useTavernStageView()
  assert.equal(choice.view, null)
  assert.equal(stage.TavernStageSceneView({ ...props(true), view: null }).type, 'Builtin')
  dispose()
  stored.clear()
  choice = stage.useTavernStageView()
  assert.equal(choice.view, null)
  assert.equal(stage.TavernStageViewSwitch({ choice }), null, '没有插件视图时不显示切换')
})
