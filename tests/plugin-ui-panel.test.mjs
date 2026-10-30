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
    tavernPluginBoundary: () => 'Boundary', tavernPluginAllowed: () => true, DshUi: { IconPuzzleOutlineRegular: 'PluginIcon' }
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
  assert.equal(ui.service.apiVersion, 7)
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
    tavernPluginBoundary: () => 'Boundary', tavernPluginAllowed: () => true, tavernErrorHub: { report() {} }, ...extra
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
    DshUi: { Switch: 'Switch' },
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
  assert.equal(tree.children[0].props.className, 'dsh-tavern-card-view-switch dsh-tavern-segmented')
  assert.equal(tree.children[1], 'builtin')

  // Tavern's own grid: covers and names; a broken card cannot start a game; corner holds @ and ⋯.
  stored.set('dsh-tavern-card-list-view', 'dsh-tavern:grid')
  managing = false
  // The grid view is a component: render it once more to get its toolbar and grid.
  const viewOf = place => { const body = List(props(place)).children[1].children[0]; const element = body.type(body.props); return element.type(element.props) }
  let view = viewOf('library')
  let [toolbar, grid] = view.children
  assert.equal(grid.props.className, 'dsh-tavern-card-grid', '人物卡库默认 4 列')
  assert.equal(grid.props.style['--dsh-tavern-card-grid-cols'], '4')
  const columns = toolbar.children[1].children
  assert.deepEqual(columns.map(button => button.props['aria-pressed']), [false, false, true, false, false])
  assert.equal(toolbar.children[2].children[0], '2 张')
  const [first, second] = grid.children
  const open = first.children[0]
  assert.equal(open.children[0].props.src, '/api/dsh-tavern/card-image?path=' + encodeURIComponent('cards/甲.png'))
  const copy = open.children[1].children
  assert.equal(copy.length, 1, '卡片上只显示名字')
  assert.equal(copy[0].children[0], '甲')
  assert.equal(open.props.title, '甲\n文件：甲.png\n剧本：剧本一', '文件名和剧本在悬停提示里')
  assert.equal(second.children[0].props.title, '坏了', '坏卡的提示是错误原因')
  assert.equal(second.children[0].children[0].children[0], '乙')
  assert.deepEqual(first.children[2].children, ['@甲', 'menu:甲'])
  open.props.onClick()
  assert.deepEqual(opened.slice(-1), ['cards/甲.png'])
  columns[1].props.onClick()
  assert.equal(stored.get('dsh-tavern-card-grid-cols-library'), '3', '列数按位置记住')
  view = viewOf('play')
  ;[toolbar, grid] = view.children
  assert.equal(grid.props.className, 'dsh-tavern-card-grid dense', '开始游玩默认 6 列，名字更紧凑')
  assert.equal(grid.children[1].children[0].props.disabled, true)
  assert.equal(grid.children[0].children[2], null)
  stored.set('tavern-card-grid-cols-play', '5')
  stored.delete('dsh-tavern-card-grid-cols-play')
  assert.equal(viewOf('play').children[1].props.style['--dsh-tavern-card-grid-cols'], '5', '沿用插件原来记住的列数')
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

test('舞台插件保留公开投影；舞台视图接口已停用，退休的内置舞台不接管插件音乐', async () => {
  const code = await readFile(new URL('../tavern-plugin/src/client/features/cast-stage.js', import.meta.url), 'utf8')
  const project = vm.runInNewContext(code + '; tavernStagePublicData')
  const data = { enabled: true, player: '你', card: { name: 'A' }, cast: [{ name: '林曦' }], turns: [{ turn: 2, text: 't', lines: [] }], musicOwned: true, music: 'old.mp3' }
  const reported = []
  const ui = loadWith({ rpc: async () => data, tavernStagePublicData: project, tavernErrorHub: { report: (_label, error) => reported.push(error.message) } })
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-galgame' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const projected = JSON.parse(JSON.stringify(await plugin.getStage('game-1')))
  assert.deepEqual(projected, { enabled: true, player: '你', card: { name: 'A' }, background: '', characters: [{ name: '林曦' }], turns: [{ turn: 2, text: 't', lines: [] }] })
  assert.equal(Object.hasOwn(projected, 'music'), false)
  // The old stage's plugin views are retired: registering one is reported, never thrown (a throw while
  // a plugin applies fails the whole page's boot), and nothing is registered.
  const dispose = plugin.registerStageView({ id: 'vn', label: '视觉小说', render: value => value })
  assert.equal(typeof dispose, 'function')
  assert.match(reported.join('\n'), /已停用的 registerStageView/)
  assert.equal(Object.hasOwn(ui, 'stageViews'), false)
})
test('背景音乐：同一首接着放、换曲淡入；玩家的开关记在浏览器里，关掉时不出声；插件经 playMusic 交给 Tavern', async () => {
  const code = await readFile(new URL('../tavern-plugin/src/client/features/music.js', import.meta.url), 'utf8')
  const stored = new Map(), created = []
  class Audio { constructor(url) { this.url = url; this.volume = 1; this.paused = true; created.push(this) } play() { this.paused = false; return Promise.resolve() } pause() { this.paused = true } }
  const music = vm.runInNewContext(code + '; tavernMusic', { Audio, forkStageAudio: { bind() {}, release() {}, level(element, value) { if (value !== undefined) element.volume = value; return element.volume } }, setTimeout: fn => fn(), window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } } })
  const flush = () => new Promise(resolve => setImmediate(resolve))
  music.play('a.mp3', { title: '主题' })
  music.play('a.mp3', { title: '主题' })
  await flush()
  assert.equal(created.length, 1, '同一首不重新开始')
  assert.equal(created[0].volume, 0.45)
  assert.equal(music.get().track.title, '主题')
  music.setEnabled(false)
  assert.equal(created[0].paused, true)
  assert.equal(stored.get('dsh-tavern-music-enabled'), 'off')
  music.play('b.mp3')
  assert.equal(created.length, 1, '关着时换曲也不出声')
  music.setEnabled(true)
  await flush()
  assert.equal(created[1].url, 'b.mp3')
  music.stop()
  assert.equal(created[1].paused, true)
  assert.equal(music.get().track, null)

  const calls = []
  const ui = loadWith({ tavernMusic: { play: (url, options) => calls.push([url, options]), stop: () => calls.push(['stop']) } })
  ui.service.playMusic({ url: 'c.mp3', title: '夜' })
  ui.service.playMusic('')
  ui.service.stopMusic()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['c.mp3', { title: '夜' }], ['', null], ['stop']])
})

test('watchState：订阅本插件发布的状态，发布后重新读取，内容没变不重复回调，卸载后停止', async () => {
  let wake = null, stopped = false, state = { scene: '酒馆' }
  const calls = []
  const ui = loadWith({
    rpc: async (name, args, gameId) => { calls.push([name, args, gameId]); return { data: state } },
    tavernSessionSignals: { subscribe(gameId, kind, listener) { calls.push(['subscribe', kind, gameId]); wake = listener; return () => { stopped = true } } }
  })
  const plugin = { ctx: { fiber: { name: 'director' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const seen = []
  const stop = plugin.watchState('game-1', 'stage', value => seen.push(value))
  assert.throws(() => plugin.watchState('game-1', 'Bad Name', () => {}), /name/)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls[0], ['subscribe', 'plugin-state:director:stage', 'game-1'])
  assert.equal(JSON.stringify(calls[1]), JSON.stringify(['pluginState', { plugin: 'director', name: 'stage' }, 'game-1']))
  wake()
  await new Promise(resolve => setTimeout(resolve, 0))
  state = { scene: '街道' }
  wake()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(JSON.stringify(seen), JSON.stringify([{ scene: '酒馆' }, { scene: '街道' }]))
  stop()
  assert.equal(stopped, true)
})

test('状态分节与正文视图：注册校验；正文视图拿到 Tavern 自己的渲染作 children，返回 null 时用内置；状态页列出插件分节和正文样式选择', () => {
  const ui = loadWith({})
  const plugin = { ctx: { fiber: { name: 'bubbles' } } }
  Object.setPrototypeOf(plugin, ui.service)
  let input = null
  plugin.registerTurnView({ id: 'bubble', label: '气泡', render: value => { input = value; return value.settled ? ['wrapped', value.children] : null } })
  plugin.registerStatusSection({ id: 'scene', title: '当前场景', render: ({ gameId }) => 'scene:' + gameId })
  assert.throws(() => plugin.registerTurnView({ id: 'bubble', label: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerStatusSection({ id: 'Bad', title: 'x', render() {} }), /id/)
  assert.throws(() => plugin.registerStatusSection({ id: 'x', title: '', render() {} }), /title/)

  const start = source.indexOf('const TAVERN_VIEW_BUILTIN')
  const code = source.slice(start, source.indexOf('function useTavernUiExtensions()', start))
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const stored = new Map()
  const view = vm.runInNewContext(code + '; ({ useTavernTurnView, tavernTurnViewElement, TavernPluginStatusSections })', {
    React: { createElement: h, Fragment: 'Fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}] },
    useTavernUiExtensions() {}, useTavernCardPluginScopes() { return {} }, tavernPluginAllowed: () => true, tavernUiExtensions: ui, tavernPluginBoundary: () => 'Boundary',
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } }
  })
  const choice = view.useTavernTurnView('game-1')
  assert.equal(choice.view.label, '气泡')
  const tree = view.tavernTurnViewElement(choice.view, { gameId: 'game-1', turn: 3, settled: true, streaming: false, text: 't', lines: [] }, 'tavern-body')
  assert.equal(tree.type, 'Boundary')
  const inner = tree.children[0]
  const result = inner.type(inner.props)
  assert.equal(result[0], 'wrapped')
  assert.equal(input.children.children[0], 'tavern-body', 'children 是 Tavern 自己的渲染')
  const streaming = view.tavernTurnViewElement(choice.view, { settled: false }, 'tavern-body')
  assert.equal(streaming.children[0].type(streaming.children[0].props).children[0], 'tavern-body', '返回 null 时用内置')
  assert.equal(view.tavernTurnViewElement(null, {}, 'tavern-body'), 'tavern-body')

  const page = view.TavernPluginStatusSections({ sessionId: 'game-1' })
  const [turnSwitch, section] = page.children
  assert.equal(turnSwitch.children[0].children[0], '正文样式')
  assert.equal(section.children[0].children[0], '当前场景')
  const content = section.children[1].children[0]
  assert.equal(content.type(content.props), 'scene:game-1')
})

test('消息按钮：when 拿得到这条消息的正文，可以只在合适的消息下显示', () => {
  const start = source.indexOf('function TavernPluginActionButtons(props)')
  const code = source.slice(start, source.indexOf('function TavernPluginComposerActions(', start))
  const seen = []
  const actions = [{ owner: 'card', id: 'accept', label: '接受剧情对战', when: context => { seen.push(context); return !/【进入本轮战斗】/.test(context.text) }, run() {} }]
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const view = vm.runInNewContext(code + '; ({ TavernPluginActionButtons, TavernPluginMessageActions })', {
    React: { createElement: h, useState: init => [init, () => {}] }, useTavernUiExtensions() {}, tavernPluginAllowed: () => true,
    tavernUiExtensions: { messageActions: () => actions }, tavernErrorHub: { report() {} }
  })
  const render = text => { const outer = view.TavernPluginMessageActions({ sessionId: 'game-1', turn: 2, settled: true, text }); return outer && outer.type(outer.props) }
  assert.equal(render('小茂向你发起挑战。\n【进入本轮战斗】'), null)
  assert.equal(render('小茂说：来比一场吧。').children[0].children[0], '接受剧情对战')
  assert.deepEqual(JSON.parse(JSON.stringify(seen.at(-1))), { gameId: 'game-1', turn: 2, settled: true, text: '小茂说：来比一场吧。' })
})
