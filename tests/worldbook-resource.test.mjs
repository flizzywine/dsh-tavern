import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorldBookDocument, prepareWorldBookImport, updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

test('读取独立 SillyTavern 世界书并保留未知字段', () => {
  const source = {
    name: '王都设定', extensions: { vendor: true }, unknownTop: 7,
    entries: {
      '12': {
        uid: 12, comment: '王都', key: ['王都'], keysecondary: ['城门'], content: '王都正文', disable: false,
        constant: false, order: 88, position: 4, depth: 2, extensions: { custom: 'keep' }, unknownEntry: 9,
      },
    },
  }
  const view = inspectWorldBookDocument(source)
  assert.equal(view.format, 'sillytavern-worldbook')
  assert.equal(view.entries[0].ref, 'entry:12')
  assert.deepEqual(view.entries[0].primaryKeys, ['王都'])
  const changed = updateWorldBookDocument(source, { operations: [{ op: 'update', ref: 'entry:12', patch: { content: '新正文', enabled: false } }] })
  assert.equal(changed.document.entries['12'].content, '新正文')
  assert.equal(changed.document.entries['12'].disable, true)
  assert.equal(changed.document.entries['12'].unknownEntry, 9)
  assert.deepEqual(changed.document.extensions, { vendor: true })
  assert.equal(changed.document.unknownTop, 7)
})

test('人物卡内嵌世界书与独立世界书共用统一投影但写回原字段', () => {
  const card = {
    data: {
      character_book: {
        name: '内置设定', extensions: { book: 'keep' },
        entries: [{
          id: 3, keys: ['学院'], secondary_keys: [], comment: '学院', content: '旧内容', enabled: true,
          insertion_order: 42, position: 'after_char', extensions: { depth: 5, custom: 'keep' },
        }],
      },
    },
  }
  const view = inspectWorldBookDocument(card)
  assert.equal(view.format, 'card-embedded')
  assert.equal(view.entries[0].order, 42)
  assert.equal(view.entries[0].depth, 5)
  const changed = updateWorldBookDocument(card, { operations: [{ op: 'update', ref: 'entry:0', patch: { primaryKeys: ['新学院'], order: 66, depth: 8 } }] })
  const entry = changed.document.data.character_book.entries[0]
  assert.deepEqual(entry.keys, ['新学院'])
  assert.equal(entry.insertion_order, 66)
  assert.equal(entry.extensions.depth, 8)
  assert.equal(entry.extensions.custom, 'keep')
})

test('导入完整人物卡时只提取 character_book 作为工作版并保留原始文本', () => {
  const text = JSON.stringify({ spec: 'chara_card_v3', data: { name: '角色', character_book: { name: '卡内设定', entries: [], extensions: { x: 1 } } } })
  const prepared = prepareWorldBookImport({ name: '角色.json', text })
  assert.equal(prepared.originalText, text)
  assert.equal(prepared.working.name, '卡内设定')
  assert.deepEqual(prepared.working.extensions, { x: 1 })
  assert.equal(prepared.view.format, 'character-book')
})

test('条目新增与删除保持来源格式', () => {
  const standalone = updateWorldBookDocument({ entries: {} }, { operations: [{ op: 'add', entry: { comment: '新增', primaryKeys: ['a'] } }] })
  assert.deepEqual(standalone.document.entries['0'].key, ['a'])
  const embedded = updateWorldBookDocument({ entries: [], extensions: {} }, { operations: [{ op: 'add', entry: { comment: '新增', primaryKeys: ['b'] } }] })
  assert.deepEqual(embedded.document.entries[0].keys, ['b'])
  const removed = updateWorldBookDocument(embedded.document, { operations: [{ op: 'delete', ref: 'entry:0' }] })
  assert.equal(removed.document.entries.length, 0)
})

test('人物卡内置世界书批量删除按原始 ref 处理，不受数组位移影响', () => {
  const source = { entries: [0, 1, 2].map(function (id) { return { id, keys: [], content: String(id), enabled: true, extensions: {} } }), extensions: {} }
  const changed = updateWorldBookDocument(source, { operations: [{ op: 'delete', ref: 'entry:0' }, { op: 'delete', ref: 'entry:2' }] })
  assert.deepEqual(changed.document.entries.map(function (entry) { return entry.id }), [1])
})
