import assert from 'node:assert/strict'
import test from 'node:test'

import { cardFieldCatalog, readCardField } from '../tavern-plugin/lib/domain/card-reading.js'

test('人物卡目录只报告字段长度，不泄露字段正文', () => {
  const catalog = cardFieldCatalog({ name: '阿芙拉', description: '绝密人物设定', tags: ['佣兵'] })
  assert.deepEqual(catalog.find((item) => item.field === 'description'), { field: 'description', chars: 6, empty: false })
  assert.equal(JSON.stringify(catalog).includes('绝密人物设定'), false)
})

test('人物卡字段按字符窗口渐进读取', () => {
  const first = readCardField({ description: '一二三四五六七八' }, { field: 'description', limit: 3 })
  assert.deepEqual(first, { field: 'description', text: '一二三', totalChars: 8, from: 1, to: 3, done: false })
  const next = readCardField({ description: '一二三四五六七八' }, { field: 'description', offset: 4, limit: 3 })
  assert.deepEqual(next, { field: 'description', text: '四五六', totalChars: 8, from: 4, to: 6, done: false })
})

test('数组字段保留 JSON 结构供 Agent 阅读', () => {
  const result = readCardField({ tags: ['佣兵', '银发'] }, { field: 'tags' })
  assert.deepEqual(JSON.parse(result.text), ['佣兵', '银发'])
  assert.equal(result.done, true)
})
