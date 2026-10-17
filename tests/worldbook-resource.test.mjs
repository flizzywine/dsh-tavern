import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareWorldBookImport, updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

test('导入完整人物卡时只提取 character_book 作为工作版并保留原始文本', () => {
  const text = JSON.stringify({ spec: 'chara_card_v3', data: { name: '角色', character_book: { name: '卡内设定', entries: [], extensions: { x: 1 } } } })
  const prepared = prepareWorldBookImport({ name: '角色.json', text })
  assert.equal(prepared.originalText, text)
  assert.equal(prepared.working.name, '卡内设定')
  assert.deepEqual(prepared.working.extensions, { x: 1 })
  assert.equal(prepared.view.format, 'character-book')
})

test('人物卡内置世界书批量删除按原始 ref 处理，不受数组位移影响', () => {
  const source = { entries: [0, 1, 2].map(function (id) { return { id, keys: [], content: String(id), enabled: true, extensions: {} } }), extensions: {} }
  const changed = updateWorldBookDocument(source, { operations: [{ op: 'delete', ref: 'entry:0' }, { op: 'delete', ref: 'entry:2' }] })
  assert.deepEqual(changed.document.entries.map(function (entry) { return entry.id }), [1])
})
