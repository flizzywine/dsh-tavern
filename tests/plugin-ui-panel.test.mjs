import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

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
  assert.equal(ui.service.apiVersion, 8)
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

test('人物卡旧视图注册 API 保持兼容，但不再接管统一宫格', () => {
  const ui = load()
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-grid' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const dispose = plugin.registerCardListView({ id: 'grid', label: '瀑布', render: () => { throw new Error('旧视图不应执行') } })
  assert.equal(typeof dispose, 'function')
  assert.throws(() => plugin.registerCardListView({ id: 'grid', label: '重复', render() {} }), /已注册/)
  assert.throws(() => plugin.registerCardListView({ id: 'Bad', label: 'x', render() {} }), /id/)
  assert.throws(() => plugin.registerCardListView({ id: 'x', label: '', render() {} }), /label/)
  dispose()
})

function loadCardGrid() {
  const start = source.indexOf('function tavernCardListViewCard(card)')
  const end = source.indexOf('\n\t\t}\n', source.indexOf('function TavernCardList(props)', start)) + 4
  assert.ok(start >= 0 && end > start)
  const stored = new Map()
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const List = vm.runInNewContext(source.slice(start, end) + '; TavernCardList', {
    React: { createElement: h, Fragment: 'Fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}] },
    Switch: 'Switch', EmptyState: 'EmptyState',
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } }
  })
  return { List, stored }
}

test('人物卡库、游玩和工作台始终使用同一宫格，旧列表偏好和插件偏好均不恢复列表', () => {
  const { List, stored } = loadCardGrid()
  const cards = [{ path: 'cards/甲.png', name: '甲', hasImage: true, script: { title: '剧本一' }, group: '常玩', starred: true }, { path: 'cards\\乙.json', name: '乙', readError: '坏了' }]
  const opened = [], toggled = []
  let managing = false
  const batch = { get managing() { return managing }, isSelected: path => path === cards[0].path, toggle: path => toggled.push(path) }
  const props = place => ({ place, cards, batch, open: card => opened.push(card.path), menu: card => 'menu:' + card.name, mention: card => '@' + card.name, builtin: () => { throw new Error('列表已移除') } })
  let gridType
  for (const preference of ['', 'dsh-tavern:grid', 'dsh-tavern-grid:grid']) {
    stored.set('dsh-tavern-card-list-view', preference)
    for (const place of ['library', 'play', 'workbench']) {
      const element = List(props(place))
      gridType ??= element.type
      assert.equal(element.type, gridType)
      assert.equal(element.type.name, 'TavernCardGrid')
      const input = element.props.input
      assert.equal(input.cards.length, 2)
      assert.equal(input.cards[0].fileName, '甲.png')
      assert.equal(input.cards[1].fileName, '乙.json')
      assert.equal(input.cards[0].imageUrl, '/api/dsh-tavern/card-image?path=' + encodeURIComponent(cards[0].path))
      assert.equal(input.cards[1].imageUrl, '')
      assert.equal(input.selecting, false)
      assert.equal(input.isSelected(cards[0].path), false)
      assert.equal(input.menu(cards[0].path), 'menu:甲')
      assert.equal(input.mention(cards[0].path), '@甲')
    }
  }
  let input = List(props('library')).props.input
  input.open(cards[0].path); input.open('missing')
  assert.deepEqual(opened, [cards[0].path])
  managing = true
  input = List(props('library')).props.input
  assert.equal(input.selecting, true)
  assert.equal(input.isSelected(cards[0].path), true)
  assert.equal(input.menu(cards[0].path), null)
  assert.equal(input.mention(cards[0].path), null)
  input.open(cards[0].path); input.toggle(cards[1].path); input.toggle('missing')
  assert.deepEqual(opened, [cards[0].path])
  assert.deepEqual(toggled, cards.map(card => card.path))
  input = List({ ...props('library'), busy: true }).props.input
  input.open(cards[0].path); input.toggle(cards[0].path)
  assert.equal(toggled.length, 2)
  managing = false
  input = List({ ...props('workbench'), batch: undefined }).props.input
  assert.equal(input.selecting, false)
  input.open(cards[1].path)
  assert.deepEqual(opened, cards.map(card => card.path))
})

test('人物卡宫格保留列数、封面、名称、动作、坏卡禁用及空结果', () => {
  const { List, stored } = loadCardGrid()
  const cards = [{ path: '甲.png', name: '甲', hasImage: true, script: { title: '剧本一' } }, { path: '乙.json', name: '乙', readError: '坏了' }]
  const props = place => ({ place, cards, open() {}, menu: card => 'menu:' + card.name, mention: card => '@' + card.name })
  const viewOf = (place, extra) => { const element = List({ ...props(place), ...extra }); return element.type(element.props) }
  let [toolbar, grid] = viewOf('library').children
  assert.equal(grid.props.className, 'dsh-tavern-card-grid')
  assert.equal(grid.props.style['--dsh-tavern-card-grid-cols'], '4')
  const columns = toolbar.children[1].children
  assert.deepEqual(columns.map(button => button.props['aria-pressed']), [false, false, true, false, false])
  assert.equal(toolbar.children[2].children[0], '2 张')
  const [first, second] = grid.children
  assert.equal(first.children[0].props.title, '甲\n文件：甲.png\n剧本：剧本一\n未分组')
  assert.equal(second.children[0].props.title, '坏了')
  assert.deepEqual(first.children[2].children, ['@甲', 'menu:甲'])
  columns[1].props.onClick()
  assert.equal(stored.get('dsh-tavern-card-grid-cols-library'), '3')
  ;[toolbar, grid] = viewOf('play').children
  assert.equal(grid.props.className, 'dsh-tavern-card-grid dense')
  assert.equal(grid.children[1].children[0].props.disabled, true)
  assert.equal(viewOf('workbench').children[1].children[1].children[0].props.disabled, false, '坏卡仍可进入工作台修复')
  stored.set('tavern-card-grid-cols-play', '5')
  assert.equal(viewOf('play').children[1].props.style['--dsh-tavern-card-grid-cols'], '5')
  for (const [saved, expected] of [['2.6', '3'], ['99', '6'], ['-1', '2'], ['invalid', '6']]) {
    stored.set('dsh-tavern-card-grid-cols-play', saved)
    assert.equal(viewOf('play').children[1].props.style['--dsh-tavern-card-grid-cols'], expected)
  }
  assert.ok(viewOf('library', { busy: true }).children[1].children.every(card => card.children[0].props.disabled))
  const empty = viewOf('library', { cards: [] })
  assert.equal(empty.children[0].children[2].children[0], '0 张')
  assert.equal(empty.children[1].props.text, '没有匹配的人物卡')
})

test('人物卡库的重名显示后缀不改变打开、菜单和提及操作的原始卡片', () => {
  const { List } = loadCardGrid()
  const card = { path: 'cards/a.json', name: '同名角色' }
  const seen = []
  const input = List({ place: 'library', cards: [card], displayName: item => item.name + ' · a.json',
    open: item => seen.push(item), menu: item => seen.push(item), mention: item => seen.push(item)
  }).props.input
  assert.equal(input.cards[0].name, '同名角色 · a.json')
  input.open(card.path); input.menu(card.path); input.mention(card.path)
  assert.equal(seen.length, 3)
  assert.ok(seen.every(item => item === card))
  assert.equal(card.name, '同名角色')
})

test('工作台修改、温和改写和 MVU 转换使用筛选后的共享宫格并保留各自操作', async () => {
  const sidebar = await readFile(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
  const library = await readFile(new URL('../tavern-plugin/src/client/features/card-library.js', import.meta.url), 'utf8')
  assert.doesNotMatch(sidebar + library, /TavernCardListContent|builtin: function|organization\.renderCards/)
  assert.match(library, /displayName: cardLibraryDisplayName/)
  const start = sidebar.indexOf('const workbenchCards =')
  const end = sidebar.indexOf('const chosenInitialResources', start)
  const selected = { path: 'selected.json', name: '选择的卡片' }
  const cards = [selected, { path: 'filtered-out.json' }]
  for (const [cardEntry, title] of [['edit', '修改人物卡'], ['gentle', '人物卡温和改写'], ['mvu', '把人物卡转成 MVU 版']]) {
    const calls = []
    const result = vm.runInNewContext(sidebar.slice(start, end) + '; workbenchCards', {
      h: (type, props, ...children) => ({ type, props, children }), React: { Fragment: 'Fragment' },
      cards, cardEntry, busy: false, TavernCardList: 'SharedGrid', EmptyState: 'EmptyState',
      workbenchOrganization: { toolbar: () => 'search-and-filter', visible: [selected] },
      newCardConversation: (...args) => calls.push(args)
    })
    assert.equal(result.children[0], 'search-and-filter')
    const grid = result.children[1]
    assert.equal(grid.type, 'SharedGrid')
    assert.equal(grid.props.place, 'workbench')
    assert.deepEqual(grid.props.cards, [selected])
    grid.props.open(selected)
    assert.deepEqual(calls, [[selected, cardEntry, title]])
  }
})

test('人物卡封面加载失败时保持宫格尺寸并显示名字首字，缺封面和未命名卡也可用', () => {
  const start = source.indexOf('function TavernCardGridCover(props)')
  const end = source.indexOf('function TavernCardGrid(props)', start)
  let failed = false
  const Cover = vm.runInNewContext(source.slice(start, end) + '; TavernCardGridCover', {
    React: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: () => [failed, value => { failed = value }]
    }
  })
  const card = { name: '✨甲', imageUrl: '/missing-cover.png' }
  let tree = Cover({ card })
  assert.equal(tree.type, 'img')
  assert.equal(tree.props.src, card.imageUrl)
  tree.props.onError()
  tree = Cover({ card })
  assert.equal(tree.type, 'span')
  assert.equal(tree.props.className, 'dsh-tavern-card-grid-cover placeholder')
  assert.equal(tree.children[0], '甲')
  assert.equal(Cover({ card: { name: '乙', imageUrl: '' } }).children[0], '乙')
  assert.equal(Cover({ card: { name: '', imageUrl: '' } }).children[0], '?')
})

 test('回合订阅忽略迟到的旧响应，卸载后不再通知', async () => {
  const requests = [], seen = []
  let signal, subscriptionOptions
  const ui = loadWith({
    rpc: () => new Promise(resolve => requests.push(resolve)),
    liveTavernView: { subscribe(_id, listener, _paths, options) { subscriptionOptions = options; signal = listener; listener(); return () => {} } }
  })
  const stop = ui.service.watchTurnState('g', state => seen.push(state))
  assert.equal(subscriptionOptions.deferLoad, true)
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
  const reported = [], warned = []
  const ui = loadWith({ rpc: async () => data, tavernStagePublicData: project, tavernErrorHub: { report: (_label, error) => reported.push(error.message) }, console: { warn: message => warned.push(message) } })
  const plugin = { ctx: { fiber: { name: 'dsh-tavern-galgame' } } }
  Object.setPrototypeOf(plugin, ui.service)
  const projected = JSON.parse(JSON.stringify(await plugin.getStage('game-1')))
  assert.deepEqual(projected, { enabled: true, player: '你', card: { name: 'A' }, background: '', characters: [{ name: '林曦' }], turns: [{ turn: 2, text: 't', lines: [] }] })
  assert.equal(Object.hasOwn(projected, 'music'), false)
  // The old stage's plugin views are retired: registering one is warned to the developer console once per
  // plugin, never thrown (a throw while a plugin applies fails the whole page's boot), raises no player
  // error, and nothing is registered.
  const dispose = plugin.registerStageView({ id: 'vn', label: '视觉小说', render: value => value })
  plugin.registerStageView({ id: 'vn2', label: '视觉小说', render: value => value })
  assert.equal(typeof dispose, 'function')
  assert.equal(warned.length, 1)
  assert.match(warned[0], /已停用的 registerStageView/)
  assert.deepEqual(reported, [])
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
