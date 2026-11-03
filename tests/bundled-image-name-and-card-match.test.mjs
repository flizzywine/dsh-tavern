import test from 'node:test'
import assert from 'node:assert/strict'
import { injectDefinitions, cardBindingMatches } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const xu = { id: 'x', name: '许静好', match: 'Xu Jinghao', enabled: true, traits: { face: '她是一位二十六岁的年轻女子，脸是干净的鹅蛋脸' } }

test('中文整句：match 只写了拼音，画面里写本名也能按名字补上外貌', () => {
  const raw = '第一人称视角，全身。许静好站在地板上，两只手插在腰上。画面里是一个人。'
  const { hits, text } = injectDefinitions(raw, { characters: [xu] }, {}, { style: 'natural', raw })
  assert.deepEqual(hits, ['许静好'])
  assert.match(text, /鹅蛋脸/)
})

test('单字本名不额外按名字认，免得「拂晓」「知晓」被当成人', () => {
  const xiao = { id: 'c', name: '晓', match: 'Xiao', enabled: true, traits: { face: '她是一位年轻女子' } }
  const raw = '拂晓时分，天边泛白，窗外没有人。'
  assert.deepEqual(injectDefinitions(raw, { characters: [xiao] }, {}, { style: 'natural', raw }).hits, [])
  assert.deepEqual(injectDefinitions(raw, { characters: [{ ...xiao, match: '' }] }, {}, { style: 'natural', raw }).hits, [])
})

test('同名的几种形态不靠去掉后缀的名字一起补进来', () => {
  const a = { id: 'a', name: '殷雪（人形）', match: 'Yin Xue', enabled: true, traits: { face: '她是一位年轻女子，黑发' } }
  const b = { id: 'b', name: '殷雪（显形）', match: 'Yin Xue fox form', enabled: true, traits: { face: '她是一位年轻女子，狐耳' } }
  const raw = '殷雪站在门口。画面里是一个人。'
  assert.deepEqual(injectDefinitions(raw, { characters: [a, b] }, {}, { style: 'natural', raw }).hits, [])
})

test('tag 写法照旧只认 match', () => {
  const raw = '1girl, 许静好, standing'
  assert.deepEqual(injectDefinitions(raw, { characters: [xu] }, {}, { raw }).hits, [])
})

test('卡绑定：完整路径精确匹配，旧绑定仍支持文件名和较长别名', () => {
  assert.equal(cardBindingMatches(['cards/假小子.json'], { path: 'cards/假小子.json', name: '反高潮' }), true)
  assert.equal(cardBindingMatches(['cards/某卡_MVU版本.json'], { path: 'cards/某卡.json', name: '某卡' }), false, '两个字的卡名不靠包含')
  assert.equal(cardBindingMatches(['cards/嫂子不可以 MVU版.json'], { path: 'cards/Ver_1.0 mvu版.json', name: '嫂子不可以' }), false)
  assert.equal(cardBindingMatches(['嫂子不可以 MVU版'], { path: 'cards/Ver_1.0 mvu版.json', name: '嫂子不可以' }), true)
  assert.equal(cardBindingMatches(['1.json'], { path: 'cards/1.json' }), true)
  assert.equal(cardBindingMatches(['cards/left/same.json'], { path: 'cards/right/same.json', name: 'same' }), false)
})

test('卡绑定：「1.json」这种短文件名不会被「v1.0 mvu版」「校园1」包含进去', () => {
  assert.equal(cardBindingMatches(['cards/v1.0 mvu版.json'], { path: 'cards/1.json', name: '骚话文风' }), false)
  assert.equal(cardBindingMatches(['cards/1.json'], { path: 'cards/校园1.json', name: '大蚌埠市' }), false)
  assert.equal(cardBindingMatches(['cards/1.json'], { path: 'cards/1.json', name: '骚话文风' }), true)
})
