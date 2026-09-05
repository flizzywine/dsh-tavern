import assert from 'node:assert/strict'
import test from 'node:test'

import { orderCardsByNewestImport } from '../tavern-plugin/lib/domain/card-list-order.js'

test('人物卡按导入时间倒序排列且不修改原数组', () => {
  const cards = [
    { path: 'cards/旧卡.json', name: '旧卡', importedAt: 100 },
    { path: 'cards/新卡.json', name: '新卡', importedAt: 300 },
    { path: 'cards/中卡.json', name: '中卡', importedAt: 200 }
  ]

  assert.deepEqual(orderCardsByNewestImport(cards).map(card => card.name), ['新卡', '中卡', '旧卡'])
  assert.deepEqual(cards.map(card => card.name), ['旧卡', '新卡', '中卡'])
})

test('缺少导入时间或时间相同的人物卡使用名称稳定排序', () => {
  const cards = [
    { path: 'cards/乙.json', name: '乙' },
    { path: 'cards/甲.json', name: '甲', importedAt: 0 },
    { path: 'cards/新乙.json', name: '新乙', importedAt: 100 },
    { path: 'cards/新甲.json', name: '新甲', importedAt: 100 }
  ]

  assert.deepEqual(orderCardsByNewestImport(cards).map(card => card.name), ['新甲', '新乙', '甲', '乙'])
})
