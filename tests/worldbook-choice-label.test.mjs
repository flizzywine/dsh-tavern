import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('const boundWorldBooks =')
const end = source.indexOf('return h("aside"', start)
assert.ok(start >= 0 && end > start)
const render = source.slice(start, end) + '\nworldBookPanel'

function options(card) {
  const tree = vm.runInNewContext(render, {
    props: { view: { card } }, cardPath: 'cards/航空.json', worldBookBinding: null,
    availableWorldBooks: [], selectedWorldBook: '', worldBookBusy: false,
    worldBookCatalogLoading: false, worldBookError: '', worldBookCatalogWarning: '',
    worldBookChoiceValue: item => item.cardPath,
    bindSelectedWorldBook() {}, unbindWorldBook() {},
    h: (type, props, ...children) => ({ type, props, children: children.flat() })
  })
  const result = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'option') result.push({ label: node.children.join(''), value: node.props.value })
    node.children.forEach(visit)
  }
  visit(tree)
  return result
}

test('当前卡世界书选项展示名称，缺少或空白名称时使用人物卡名', () => {
  for (const [name, expected] of [['航空状态', '航空状态'], ['', '航空'], ['  ', '航空'], [undefined, '航空']]) {
    assert.deepEqual(options({ name: '航空', character_book: { name, entries: [] } }), [
      { label: '选择世界书', value: '' },
      { label: expected + '（当前人物卡）', value: 'cards/航空.json' }
    ])
  }
})

test('没有自带世界书时不添加当前卡选项', () => {
  assert.deepEqual(options({ name: '航空' }), [{ label: '选择世界书', value: '' }])
})

test('已绑定多书时仍可添加，逐本打开、解绑和排序，并显示一次冲突提示', () => {
  const sources = [{ kind: 'card', cardPath: 'cards/航空.json' }, { kind: 'standalone', path: 'worldbooks/附加.json' }]
  const calls = []
  const tree = vm.runInNewContext(render, {
    props: { view: { card: { name: '航空' } }, onOpenWorldBook: source => calls.push(['open', source]) },
    cardPath: 'cards/航空.json', worldBookBinding: { kind: 'multiple', books: sources.map((source, index) => ({ source, name: index ? '附加' : '航空状态', available: true })) },
    availableWorldBooks: [], selectedWorldBook: '', worldBookBusy: false,
    worldBookCatalogLoading: false, worldBookError: '', worldBookCatalogWarning: '',
    worldBookChoiceValue: item => item.cardPath || item.path,
    bindSelectedWorldBook() {}, unbindWorldBook: source => calls.push(['unbind', source]),
    moveWorldBook: (index, direction) => calls.push(['move', index, direction]),
    h: (type, props, ...children) => ({ type, props, children: children.flat() })
  })
  const nodes = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    nodes.push(node); node.children.forEach(visit)
  }
  visit(tree)
  assert.equal(nodes.filter(node => node.type === 'select').length, 1)
  assert.equal(nodes.filter(node => node.children.includes('多本世界书可能相互冲突，引发异常')).length, 1)
  const buttons = label => nodes.filter(node => node.type === 'button' && node.children.includes(label))
  assert.equal(buttons('添加绑定').length, 1)
  buttons('打开世界书')[1].props.onClick()
  buttons('解绑')[1].props.onClick()
  assert.equal(buttons('上移')[0].props.disabled, true)
  assert.equal(buttons('下移')[1].props.disabled, true)
  buttons('上移')[1].props.onClick()
  assert.deepEqual(calls, [['open', sources[1]], ['unbind', sources[1]], ['move', 1, -1]])
})
