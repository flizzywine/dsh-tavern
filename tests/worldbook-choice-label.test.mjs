import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('const hasWorldBookBinding =')
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
