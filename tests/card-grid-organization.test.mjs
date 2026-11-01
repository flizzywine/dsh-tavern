import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/card-organization.js', import.meta.url), 'utf8')

function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flatMap(nodes)]
}

test('分组添加使用共享宫格，筛选保留选择，取消和重复打开重置选择', async () => {
  const state = [], effects = [], calls = []
  let cursor = 0, first = true
  const h = (type, props, ...children) => ({ type, props, children: children.flat() })
  const useState = initial => {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  }
  const useOrganization = vm.runInNewContext(source + '; useCardOrganization', {
    React: {
      createElement: h, Fragment: 'Fragment', useState, useDeferredValue: value => value,
      useRef: value => useState({ current: value })[0],
      useEffect: effect => { if (first) effects.push(effect) }
    },
    useTavernConfirm: () => async () => true,
    EmptyState: 'EmptyState', TavernCardList: 'SharedGrid',
    notifyTavernDataChanged() {},
    rpc: async (method, input) => { calls.push({ method, input }); return { groups: ['常玩'] } }
  })
  const cards = [{ path: 'a.json', name: '甲' }, { path: 'b.png', name: '乙' }, { path: 'c.json', name: '已归组', group: '常玩' }]
  let busy = false
  const render = () => { cursor = 0; const result = useOrganization(cards, busy, async () => {}, error => { throw Error(error) }); first = false; return result }
  let ui = render()
  effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  ui = render()
  nodes(ui.toolbar()).find(node => node.type === 'button' && node.children.includes('常玩')).props.onClick()
  ui = render()
  assert.deepEqual(Array.from(ui.visible, card => card.path), ['c.json'])
  const open = () => { ui = render(); ui.addCardsFooter().children[0].props.onClick(); ui = render() }
  const grid = () => nodes(ui.addCardsFooter()).find(node => node.type === 'SharedGrid')
  const search = value => { nodes(ui.addCardsFooter()).find(node => node.props?.['aria-label'] === '搜索可添加的人物卡').props.onChange({ target: { value } }); ui = render() }
  open()
  assert.equal(grid().props.place, 'group')
  assert.deepEqual(Array.from(grid().props.cards, card => card.path), ['a.json', 'b.png'])
  grid().props.batch.toggle('a.json'); ui = render()
  assert.equal(grid().props.batch.isSelected('a.json'), true)
  search('乙')
  assert.deepEqual(Array.from(grid().props.cards, card => card.path), ['b.png'])
  assert.equal(grid().props.batch.isSelected('a.json'), true)
  grid().props.batch.toggle('b.png'); ui = render()
  const add = nodes(ui.addCardsFooter()).find(node => node.type === 'button' && node.children.includes('添加（2）'))
  assert.equal(add.props.disabled, false)
  busy = true; ui = render()
  assert.equal(grid().props.busy, true)
  grid().props.batch.toggle('b.png'); busy = false; ui = render()
  assert.equal(grid().props.batch.isSelected('b.png'), true)
  nodes(ui.addCardsFooter()).find(node => node.type === 'button' && node.children.includes('取消')).props.onClick()
  ui = render()
  assert.equal(grid(), undefined)
  open()
  assert.equal(grid().props.batch.isSelected('a.json'), false)
  assert.equal(grid().props.batch.isSelected('b.png'), false)
  assert.equal(grid().props.cards.length, 2)
  grid().props.batch.toggle('b.png'); ui = render()
  await nodes(ui.addCardsFooter()).find(node => node.type === 'button' && node.children.includes('添加（1）')).props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.method === 'organizeCards').input)), { action: 'cards', paths: ['b.png'], group: '常玩' })
  ui = render()
  assert.equal(grid(), undefined)
})
