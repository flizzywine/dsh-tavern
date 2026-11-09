import assert from 'node:assert/strict'
import test from 'node:test'

import { activeCardPersonaText, applyCardPersonaChange, presentCardPersonas } from '../tavern-plugin/lib/domain/card-personas.js'

const BUILTINS = [{ id: 'cat', label: '猫', text: '喵设定' }, { id: 'pro', label: '编辑', text: '编辑设定' }]
const change = (document, value) => applyCardPersonaChange(structuredClone(document), value, BUILTINS)
const view = document => presentCardPersonas(document, BUILTINS)

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
