import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCardOpening } from '../tavern-plugin/lib/domain/card-openings.js'

const card = { first_mes: '默认开场', alternate_greetings: ['雨夜开场', '酒馆开场'] }

test('游玩固定使用人物卡默认开场白', () => {
  assert.equal(resolveCardOpening(card), '默认开场')
})

test('默认开场为空时使用第一条非空备选，避免空开场', () => {
  assert.equal(resolveCardOpening({ first_mes: '', alternate_greetings: ['唯一开场'] }), '唯一开场')
  assert.equal(resolveCardOpening({ first_mes: '', alternate_greetings: ['', '第二条'] }), '第二条')
  assert.equal(resolveCardOpening({ first_mes: '', alternate_greetings: [] }), '')
})
