import assert from 'node:assert/strict'
import test from 'node:test'

import { cardOpeningChoices, resolveCardOpening } from '../tavern-plugin/lib/domain/card-openings.js'

const card = {
  first_mes: '默认开场',
  alternate_greetings: ['雨夜开场', '酒馆开场']
}

test('人物卡开场白按默认与备选顺序提供稳定选项', () => {
  assert.deepEqual(cardOpeningChoices(card), [
    { id: 'default', label: '默认开场白', text: '默认开场' },
    { id: 'alternate:0', label: '备选开场白 1', text: '雨夜开场' },
    { id: 'alternate:1', label: '备选开场白 2', text: '酒馆开场' }
  ])
})

test('服务端只按人物卡中的稳定编号解析开场白', () => {
  assert.equal(resolveCardOpening(card), '默认开场')
  assert.equal(resolveCardOpening(card, 'default'), '默认开场')
  assert.equal(resolveCardOpening(card, 'alternate:1'), '酒馆开场')
  assert.throws(() => resolveCardOpening(card, 'alternate:9'), /开场白选项不存在/)
  assert.throws(() => resolveCardOpening(card, '任意正文'), /开场白选项不存在/)
})

test('默认开场为空但只有一个备选时仍可直接使用该备选', () => {
  const onlyAlternate = { first_mes: '', alternate_greetings: ['唯一开场'] }
  assert.deepEqual(cardOpeningChoices(onlyAlternate), [
    { id: 'alternate:0', label: '备选开场白 1', text: '唯一开场' }
  ])
})
