import assert from 'node:assert/strict'
import test from 'node:test'

import { searchCardRaw } from '../tavern-plugin/lib/domain/card-reading.js'

const raw = {
  spec: 'chara_card_v3', name: '集市', description: '空间集市（根部镜像）',
  data: {
    description: '在空间集市里交易。',
    character_book: { entries: [
      { comment: '组织-空间集市', keys: ['空间集市'], content: '空间集市:\n  描述: 空间集市不断变化。' + '填充'.repeat(100) + '离开空间集市。' },
      { comment: '无关', keys: [], content: '没有命中' }
    ] },
    extensions: { regex_scripts: [{ scriptName: '面板', replaceString: '<b>空间集市</b>' }] }
  }
}

test('人物卡搜索支持正则与数量上限，空查询和坏正则报错', () => {
  const limited = searchCardRaw(raw, { query: '空间.市', regex: true, limit: 2 })
  assert.equal(limited.total, 5)
  assert.equal(limited.hits.length, 2)
  assert.equal(limited.truncated, true)
  assert.equal(searchCardRaw(raw, { query: '空间.市' }).total, 0)
  assert.throws(() => searchCardRaw(raw, { query: ' ' }), /不能为空/)
  assert.throws(() => searchCardRaw(raw, { query: '(', regex: true }), /正则无效/)
})
