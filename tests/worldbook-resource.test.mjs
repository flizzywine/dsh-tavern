import test from 'node:test'
import assert from 'node:assert/strict'
import { updateWorldBookDocument } from "../tavern-plugin/lib/domain/worldbook-resource.js"

test('人物卡内置世界书批量删除按原始 ref 处理，不受数组位移影响', () => {
  const source = { entries: [0, 1, 2].map(function (id) { return { id, keys: [], content: String(id), enabled: true, extensions: {} } }), extensions: {} }
  const changed = updateWorldBookDocument(source, { operations: [{ op: 'delete', ref: 'entry:0' }, { op: 'delete', ref: 'entry:2' }] })
  assert.deepEqual(changed.document.entries.map(function (entry) { return entry.id }), [1])
})
