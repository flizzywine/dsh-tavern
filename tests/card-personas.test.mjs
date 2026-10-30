import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { activeCardPersonaText, applyCardPersonaChange, presentCardPersonas } from '../tavern-plugin/lib/domain/card-personas.js'
import { cardPersonas } from '../tavern-plugin/lib/prompt-catalog.js'

const BUILTINS = [{ id: 'cat', label: '猫', text: '喵设定' }, { id: 'pro', label: '编辑', text: '编辑设定' }]
const change = (document, value) => applyCardPersonaChange(structuredClone(document), value, BUILTINS)
const view = document => presentCardPersonas(document, BUILTINS)

test('默认空白，内置性格都在库里，不注入任何文字', () => {
  assert.deepEqual(view({}).activeId, '')
  assert.deepEqual(view({}).items.map(item => [item.id, item.name, item.builtin, item.modified]), [['builtin:cat', '猫', true, false], ['builtin:pro', '编辑', true, false]])
  assert.equal(activeCardPersonaText({}, BUILTINS), '')
})

test('新建、复制、重命名、删除性格', () => {
  let document = change({}, { action: 'create', name: '我的' })
  const created = view(document).activeId
  assert.equal(view(document).items.find(item => item.id === created).text, '')
  document = change(document, { action: 'save', id: created, text: '我的设定' })
  document = change(document, { action: 'duplicate', id: created, name: '我的' })
  const copy = view(document).activeId
  assert.deepEqual(view(document).items.filter(item => !item.builtin).map(item => [item.name, item.text]), [['我的', '我的设定'], ['我的 (2)', '我的设定']])
  document = change(document, { action: 'rename', id: 'builtin:pro', name: '严肃编辑' })
  assert.equal(view(document).items[1].name, '严肃编辑')
  assert.equal(view(document).items[1].modified, true)
  document = change(document, { action: 'delete', id: copy })
  assert.equal(view(document).activeId, '')
  document = change(document, { action: 'delete', id: 'builtin:cat' })
  assert.deepEqual(view(document).items.map(item => item.name), ['严肃编辑', '我的'])
  assert.throws(() => change(document, { action: 'select', id: 'builtin:cat' }), /性格不存在/)
  assert.throws(() => change(document, { action: 'restore', id: created }), /只有内置性格/)
  assert.throws(() => change(document, { action: 'create', name: ' ' }), /性格名称/)
})

test('旧版保存在系统提示词方案里的卡片 Agent 系统指令迁移为自定义性格', () => {
  const old = {
    promptOverrides: { 'card-system': ' 旧设定 ', story: '正文' },
    promptSets: [{ id: 'default', name: '默认方案' }, { id: 'b', name: '方案二', promptOverrides: { 'card-system': '另一套' } }, { id: 'c', name: '方案三', promptOverrides: { 'card-system': '旧设定' } }]
  }
  const library = view(old)
  assert.deepEqual(library.items.filter(item => !item.builtin).map(item => [item.name, item.text]), [['我的性格', '旧设定'], ['方案二的性格', '另一套']])
  assert.equal(activeCardPersonaText(old, BUILTINS), '旧设定')
  // The first library write keeps the migrated entries.
  const saved = change(old, { action: 'select', id: 'builtin:pro' })
  assert.deepEqual(view(saved).items.filter(item => !item.builtin).map(item => item.name), ['我的性格', '方案二的性格'])
  assert.equal(view({ promptOverrides: { story: '正文' } }).items.length, 2)
})

test('性格面板：选中内置性格修改后保存，下拉框仍停在该性格', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('function CardPersonaTab()')
  const body = source.slice(start, source.indexOf('\n\t\tfunction ', start + 20))
  let state, initial = true
  const effects = []
  let document = { cardPersonas: { activeId: 'builtin:cat', custom: [], builtins: {} } }
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
    useState(init) { state ??= init; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useEffect(fn) { if (initial) effects.push(fn) }
  }
  const Component = vm.runInNewContext(body + '\n; CardPersonaTab', {
    // the panel uses the shared menu and draft text area.
    React, InlineField: 'InlineField', TextArea: 'TextArea', useTavernConfirm: () => async () => true, notifyTavernDataChanged() {},
    rpc: async (method, args) => {
      if (method === 'manageCardPersona') document = change(document, JSON.parse(JSON.stringify(args)))
      return { cardPersonas: view(document) }
    }
  })
  const find = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : (predicate(tree) ? [tree] : []).concat((tree.children || []).flatMap(node => find(node, predicate)))
  const render = () => { const tree = Component(); initial = false; return tree }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  render()
  effects[0]()
  await flush()
  find(render(), node => node.type === 'TextArea')[0].props.onChange('喵设定，改过')
  assert.equal(find(render(), node => node.type === 'InlineField')[0].props.value, 'builtin:cat')
  find(render(), node => node.type === 'button' && node.children[0] === '保存')[0].props.onClick()
  await flush()
  const select = find(render(), node => node.type === 'InlineField')[0]
  assert.equal(select.props.value, 'builtin:cat')
  assert.ok(select.props.options.find(option => option.value === 'builtin:cat').label.includes('已修改'))
  assert.equal(activeCardPersonaText(document, BUILTINS), '喵设定，改过')
})
