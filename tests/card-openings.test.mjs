import assert from 'node:assert/strict'
import test from 'node:test'

import { cardOpeningChoices, resolveCardOpening } from '../tavern-plugin/lib/domain/card-openings.js'

const card = {
  first_mes: '默认开场',
  alternate_greetings: ['雨夜开场', '酒馆开场']
}

test('游玩固定使用人物卡默认开场白', () => {
  assert.equal(resolveCardOpening(card), '默认开场')
})

test('开场白列表保留主开场与有效备选的原始顺序', () => {
  assert.deepEqual(cardOpeningChoices({ first_mes: '默认', alternate_greetings: ['', '雨夜', '酒馆'] }), [
    { id: 'primary', text: '默认' },
    { id: 'alternate:1', text: '雨夜' },
    { id: 'alternate:2', text: '酒馆' }
  ])
})

test('创建会话时按稳定编号解析用户选中的开场白', () => {
  assert.equal(resolveCardOpening(card, 'alternate:0'), '雨夜开场')
  assert.equal(resolveCardOpening(card, 'alternate:1'), '酒馆开场')
  assert.throws(() => resolveCardOpening(card, 'alternate:9'), /人物卡开场白不存在/)
})

test('默认开场为空时使用第一条非空备选，避免空开场', () => {
  const onlyAlternate = { first_mes: '', alternate_greetings: ['唯一开场'] }
  assert.equal(resolveCardOpening(onlyAlternate), '唯一开场')
  assert.equal(resolveCardOpening({ first_mes: '', alternate_greetings: ['', '第二条'] }), '第二条')
  assert.equal(resolveCardOpening({ first_mes: '', alternate_greetings: [] }), '')
})
