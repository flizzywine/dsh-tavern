import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const xu = { id: 'x', name: '许静好', enabled: true,
  traits: { face: '她是一位二十六岁的年轻女子，脸是干净的鹅蛋脸', bodySFW: '她身高一米七，偏瘦', bodyNSFW: '她的胸部很小，皮肤白' },
  outfits: [{ id: 'o', name: '黑色透纱吊带睡裙', upper: '穿着一件黑色半透明的细肩带吊带短睡裙', lower: '黑色透纱睡裙，裙摆下是一条黑色蕾丝内裤', shoes: '光着脚', enabled: true }] }
const defs = { characters: [xu] }
const call = fields => '第一人称视角，半身近景。\n${' + JSON.stringify({ name: '许静好', angle: 'from front', ...fields }).slice(1, -1) + '}$\n许静好跨坐着。'

test('上身 nsfw、下身 hidden、没有衣服：补一句身上什么都没穿，免得模型补出裤子', () => {
  const text = expandRosterCalls(call({ upperBody: 'nsfw', lowerBody: 'hidden' }), defs, 'auto', { style: 'natural' })
  assert.match(text, /许静好身上什么都没穿，没有穿裤子，也没有穿裙子。/)
})

test('写了衣服、或者下身不是 hidden 时不补', () => {
  const dressed = expandRosterCalls(call({ upperBody: 'nsfw', lowerBody: 'hidden', outfit: '黑色透纱吊带睡裙' }), defs, 'auto', { style: 'natural' })
  assert.doesNotMatch(dressed, /什么都没穿/)
  assert.match(dressed, /黑色蕾丝内裤/)
  const sfw = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'hidden' }), defs, 'auto', { style: 'natural' })
  assert.doesNotMatch(sfw, /什么都没穿/)
  const both = expandRosterCalls(call({ upperBody: 'nsfw', lowerBody: 'nsfw' }), defs, 'auto', { style: 'natural' })
  assert.doesNotMatch(both, /什么都没穿/)
})
