import test from 'node:test'
import assert from 'node:assert/strict'
import { chatImportMergedPreview } from '../tavern-plugin/lib/domain/chat-import-batch.js'

const entry = (fileName, preview) => ({ fileName, preview })

test('多份记录合并为一次确认：条数相加，不兼容与 MVU 任一命中即生效', () => {
  const merged = chatImportMergedPreview([
    entry('a.jsonl', { count: 3, warnings: [], userName: '', lastMessage: '甲' }),
    entry('b.jsonl', { count: 4, warnings: ['缺少快照'], hasMvu: true, incompatible: true, userName: '阿九', lastMessage: '乙' })
  ])
  assert.equal(merged.count, 7)
  assert.equal(merged.hasMvu, true)
  assert.equal(merged.incompatible, true)
  // 称呼不同：留空，导入时每份沿用自己的称呼
  assert.equal(merged.userName, '')
  assert.equal(chatImportMergedPreview([entry('a.jsonl', { userName: '阿九' }), entry('b.jsonl', { userName: '阿九' })]).userName, '阿九')
  assert.equal(merged.lastMessage, '')
  assert.deepEqual(merged.warnings, ['b.jsonl：缺少快照'])
})
