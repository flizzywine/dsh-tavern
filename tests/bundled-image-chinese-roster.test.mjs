import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const jing = {
  id: 'j', name: '许静好', match: 'Xu Jinghao', enabled: true,
  traits: {
    face: '她是一位二十六岁的年轻女子，个子高挑；脸是鹅蛋脸，眉毛浓而自然；素着一张脸。深棕色的短发长到下巴',
    bodySFW: '她身高一米七，偏瘦，肩背有清楚的线条',
    lowerSFW: '她的双腿修长，小腿有运动出来的线条',
  },
  outfits: [{ id: 'o1', name: '格子衬衫牛仔裤', upper: '上身穿着一件白色纯棉短袖T恤', lower: '下身是一条浅蓝色直筒牛仔裤', shoes: '脚上穿着白色运动鞋', full: '整体是随性的休闲打扮', default: true }],
}
const yu = {
  id: 'y', name: '宋玉轩', match: 'Song Yuxuan', enabled: true,
  traits: { face: '她是一位十八岁出头的年轻女子，眉毛浓黑；乌黑的长发。乌黑的长发高高束成马尾' },
  outfits: [{ id: 'o2', name: '常服', upper: '上身穿着一件深蓝色交领窄袖衣', lower: '下身是一条深色直筒布裤', shoes: '脚上穿着黑色布靴', default: true }],
}
const defs = { characters: [jing, yu] }
const natural = { style: 'natural' }
const call = (fields, scene) => '${' + JSON.stringify({ name: 'Xu Jinghao', angle: 'from front', ...fields }).slice(1, -1) + '}$\n' + scene

test('中文上半身镜头把 hidden 表达成画外，不推断下装状态', () => {
  const hidden = { upperBody: 'nsfw', lowerBody: 'hidden' }
  const half = expandRosterCalls(call(hidden, '半身近景，她站在窗边。'), defs, 'natural', natural)
  assert.match(half, /下半身在画外/)
  assert.doesNotMatch(half, /什么都没穿|没有穿裤子|牛仔裤/)
  const full = expandRosterCalls(call(hidden, '全身，她站在窗边。'), defs, 'natural', natural)
  assert.doesNotMatch(full, /在画外|什么都没穿/)
  const dressed = expandRosterCalls(call({ ...hidden, outfit: '格子衬衫牛仔裤' }, '半身近景，她站在窗边。'), defs, 'natural', natural)
  assert.match(dressed, /牛仔裤/)
})
