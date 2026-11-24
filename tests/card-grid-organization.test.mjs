import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/card-organization.js', import.meta.url), 'utf8')

function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
}
const text = node => nodes(node).flatMap(item => item.children || []).filter(child => typeof child === 'string').join('')

// useCardOrganization rendered with stub hooks: every popup is open, so its rows are in the tree.
function harness(cards, { batch = {} } = {}) {
  const state = [], effects = [], calls = [], stored = new Map()
  let cursor = 0, first = true
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const useState = initial => {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  }
  const popup = () => ({ open: true, setOpen() {}, close() {}, root: {}, trigger: {}, keys() {}, layer: (props, ...children) => h('pop', props, ...children) })
  const context = {
    React: {
      createElement: h, Fragment: 'Fragment', useState, useDeferredValue: value => value,
      useRef: value => useState({ current: value })[0],
      useEffect: effect => { if (first) effects.push(effect) }
    },
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } },
    useTavernConfirm: () => async () => true,
    useTavernCardGridColumns: () => [4, () => {}],
    useInlinePopup: popup, inlineMenuKeys() {},
    askTavernText: async () => null,
    EmptyState: 'EmptyState', Segmented: 'Segmented',
    notifyTavernDataChanged() {},
    rpc: async (method, input) => { calls.push({ method, input }); return { tags: ['同人', '待玩'] } }
  }
  const { useCardOrganization, TavernCardTagChecklist } = vm.runInNewContext(source + '; ({ useCardOrganization, TavernCardTagChecklist })', context)
  const render = () => { cursor = 0; const result = useCardOrganization(cards, false, async () => {}, error => { throw Error(error) }, batch, 'library'); first = false; return result }
  return { render, calls, stored, effects, TavernCardTagChecklist, flush: async () => { if (first) render(); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)) } }
}

const cards = [
  { path: 'a.json', name: '甲', tags: ['同人'], starred: true, importedAt: 1, lastPlayedAt: 30 },
  { path: 'b.png', name: '乙', tags: ['同人', '待玩'], importedAt: 3, lastPlayedAt: 10 },
  { path: 'c.json', name: '丙', tags: [], importedAt: 2 }
]
const pick = (ui, label) => nodes(ui.toolbar()).find(node => node.type === 'button' && node.props.role && text(node).endsWith(label))

test('筛选可多选：收藏和标签要同时满足，未打标签和标签互斥，全部清空', async () => {
  const { render, flush } = harness(cards)
  await flush()
  let ui = render()
  pick(ui, '同人').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['a.json', 'b.png'])
  pick(ui, '待玩').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['b.png'])
  pick(ui, '收藏').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), [])
  pick(ui, '未打标签').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), [], '收藏 + 未打标签：丙没有收藏')
  pick(ui, '收藏').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['c.json'], '选未打标签时去掉了已选的标签')
  pick(ui, '全部').props.onClick(); ui = render()
  assert.equal(ui.visible.length, 3)
  assert.match(text(nodes(ui.toolbar()).find(node => node.props?.className === 'dsh-tavern-card-filter-label')), /^全部$/)
})

test('多个标签可以切换「标签全都有」和「有任一个」，并记住选择', async () => {
  const { render, stored, flush } = harness(cards)
  await flush()
  let ui = render()
  pick(ui, '同人').props.onClick(); ui = render()
  pick(ui, '待玩').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['b.png'])
  const mode = nodes(ui.toolbar()).find(node => node.type === 'Segmented')
  assert.equal(mode.props.value, 'all')
  mode.props.onChange('any'); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['a.json', 'b.png'])
  assert.match(text(nodes(ui.toolbar()).find(node => node.props?.className === 'dsh-tavern-card-filter-label')), /^同人 或 待玩$/)
  assert.equal(stored.get('dsh-tavern-card-tag-mode-library'), 'any')
})

test('排序：自动保持宿主顺序，最近游玩、名字、导入时间各自排，并记住选择', async () => {
  const { render, stored, flush } = harness(cards)
  await flush()
  let ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['a.json', 'b.png', 'c.json'])
  pick(ui, '导入时间').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['b.png', 'c.json', 'a.json'])
  pick(ui, '最近游玩').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.path), ['a.json', 'b.png', 'c.json'])
  pick(ui, '名字').props.onClick(); ui = render()
  assert.deepEqual(ui.visible.map(card => card.name), ['丙', '甲', '乙'].sort((x, y) => x.localeCompare(y, 'zh-CN')))
  assert.equal(stored.get('dsh-tavern-card-sort-library'), 'name')
})

test('多选的标签按所选卡显示全有、部分或没有，点一下给所选卡加上或去掉；收藏一起切换', async () => {
  const batch = { managing: true, paths: ['a.json', 'b.png'], toolbar: (visible, extra) => ({ type: 'bar', props: {}, children: [extra] }), begin() {}, reset() {} }
  const { render, calls, flush, TavernCardTagChecklist } = harness(cards, { batch })
  await flush()
  const ui = render()
  const checklist = nodes(ui.batchBar()).find(node => node.type === TavernCardTagChecklist)
  assert.equal(checklist.props.state('同人'), true)
  assert.equal(checklist.props.state('待玩'), 'mixed')
  checklist.props.onToggle('待玩', true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), { method: 'organizeCards', input: { action: 'cards', paths: ['a.json', 'b.png'], addTags: ['待玩'] } })
  const star = nodes(ui.batchBar()).find(node => node.type === 'button' && text(node) === '收藏')
  star.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).input)), { action: 'cards', paths: ['a.json', 'b.png'], starred: true })
})

test('卡片的标签清单：勾选去掉标签，新建的标签建好后直接打到这张卡上', async () => {
  const { render, calls, flush } = harness(cards)
  await flush()
  const ui = render()
  const list = ui.tagChecklist(cards[1])
  assert.equal(list.props.state('待玩'), true)
  list.props.onToggle('待玩', false)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).input)), { action: 'cards', paths: ['b.png'], removeTags: ['待玩'] })
  list.props.onCreate('长篇')
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(-2).map(call => call.input))), [
    { action: 'create', name: '长篇' }, { action: 'cards', paths: ['b.png'], addTags: ['长篇'] }
  ])
})
