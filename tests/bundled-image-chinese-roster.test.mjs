import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls, injectDefinitions, pickOutfitForScene } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { normalizePrompts } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { acceptsChinese, formatPromptForBackend, resolvePromptMode } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

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

test('MOSS 工作流自动用自然语言、保留中文', () => {
  assert.equal(acceptsChinese('MOSS-SFT-4step'), true)
  assert.equal(acceptsChinese('WAI-Illustrious-v17'), false)
  assert.equal(resolvePromptMode({ imageBackend: 'comfyui' }, 'comfyui MOSS-SFT-4step'), 'natural')
  assert.equal(formatPromptForBackend('……空气感。, 画面中的女子是许静好', 'comfyui', 'natural'), '……空气感。画面中的女子是许静好')
})

test('中文人物拼成通顺的中文句子：身份句带年龄，表情紧跟在后面，年龄不说第二遍', () => {
  const out = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw', expression: '挑着眉，咧嘴笑' }, '全身，她站在奶茶店门口。'), defs, 'natural', natural)
  assert.match(out, /画面中的女子是许静好，一位二十六岁的年轻女子。此刻她挑着眉，咧嘴笑。/)
  assert.equal(out.match(/二十六岁/g).length, 1)
  assert.match(out, /她上身穿着一件白色纯棉短袖T恤，下身是一条浅蓝色直筒牛仔裤，脚上穿着白色运动鞋/)
  assert.doesNotMatch(out, /is the woman|is wearing/)
})

test('近景、半身：不写腿型和鞋，下装照写', () => {
  const out = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'hidden' }, '第一人称视角，半身近景，平视。她举着奶茶。'), defs, 'natural', natural)
  assert.doesNotMatch(out, /运动鞋|双腿修长/)
  assert.match(out, /浅蓝色直筒牛仔裤/)
})

test('只拍腿脚（上身 hidden、下身可见）：不写脸和表情', () => {
  const out = expandRosterCalls(call({ upperBody: 'hidden', lowerBody: 'sfw', expression: '笑着' }, '特写，她的脚踩在台阶上。'), defs, 'natural', natural)
  assert.doesNotMatch(out, /鹅蛋脸|笑着|T恤/)
  assert.match(out, /双腿修长/)
})

test('画面自己写了镜头时，不再给每个人加「镜头正对着她」', () => {
  const own = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw' }, '旁观视角，全身，正面平视。她站着。'), defs, 'natural', natural)
  assert.doesNotMatch(own, /镜头正对着她/)
  const none = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw' }, '她站在门口。'), defs, 'natural', natural)
  assert.match(none, /镜头正对着她/)
})

test('头发散开、湿透时，招牌发型只留发色和长短', () => {
  const raw = '${"name":"Song Yuxuan","angle":"from front","upperBody":"sfw","lowerBody":"sfw"}$\n全身，她刚出浴，湿发披在肩上。'
  const out = expandRosterCalls(raw, defs, 'natural', natural)
  assert.doesNotMatch(out, /马尾/)
  assert.match(out, /乌黑的长发/)
})

test('宏里写的中文服装描述照样用', () => {
  const out = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw', outfit: '灰色连帽卫衣，深蓝色牛仔裤' }, '全身，她坐在桌边。'), defs, 'natural', natural)
  assert.match(out, /她穿着灰色连帽卫衣，深蓝色牛仔裤/)
  assert.doesNotMatch(out, /白色纯棉短袖T恤/)
})

test('部位标了 nsfw 时那个部位的衣服不写，整套总述也不写', () => {
  const out = expandRosterCalls(call({ upperBody: 'nsfw', lowerBody: 'sfw', outfit: '格子衬衫牛仔裤' }, '全身，她站在床边。'), defs, 'natural', natural)
  assert.doesNotMatch(out, /T恤|整体是/)
  assert.match(out, /牛仔裤/)
})

test('上下身分别标注 NSFW 时按部位选择外貌与衣物，不串用另一部位', () => {
  const adult = structuredClone(jing)
  adult.traits.bodyNSFW = '上身NSFW外貌'
  adult.traits.lowerNSFW = '下身NSFW外貌'
  const library = { characters: [adult] }
  const upperExposed = expandRosterCalls(call({ upperBody: 'nsfw', lowerBody: 'sfw', outfit: '格子衬衫牛仔裤' }, '全身，她站在床边。'), library, 'natural', natural)
  assert.match(upperExposed, /上身NSFW外貌/)
  assert.match(upperExposed, /她的双腿修长/)
  assert.doesNotMatch(upperExposed, /下身NSFW外貌|白色纯棉短袖T恤|整体是/)
  assert.match(upperExposed, /浅蓝色直筒牛仔裤/)

  const lowerExposed = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'nsfw', outfit: '格子衬衫牛仔裤' }, '全身，她站在床边。'), library, 'natural', natural)
  assert.match(lowerExposed, /鹅蛋脸/)
  assert.match(lowerExposed, /下身NSFW外貌/)
  assert.doesNotMatch(lowerExposed, /上身NSFW外貌|浅蓝色直筒牛仔裤|白色运动鞋|整体是/)
  assert.match(lowerExposed, /白色纯棉短袖T恤/)
})

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

test('已经展开过的中文人物，不会按名字再注入一遍', () => {
  const raw = call({ upperBody: 'sfw', lowerBody: 'sfw' }, '全身，许静好站在门口。')
  const expanded = expandRosterCalls(raw, defs, 'natural', natural)
  const { text } = injectDefinitions(expanded, defs, {}, { style: 'natural', raw })
  assert.equal(text.match(/画面中的女子是许静好/g).length, 1)
})

test('中文画面里换衣前后：按两字片段判断是哪一刻', () => {
  assert.equal(pickOutfitForScene('她还穿着那条吊带睡裙，站在窗边', '白色吊带睡裙', '黑色羽绒服，牛仔裤'), 'before')
  assert.equal(pickOutfitForScene('她拉上羽绒服的拉链出门', '白色吊带睡裙', '黑色羽绒服，牛仔裤'), 'after')
})

test('允许中文时，开头单独写的人物名去掉，画面描述的开头不动', () => {
  const opts = { backend: 'comfyui', style: 'natural', allowChinese: true }
  assert.equal(normalizePrompts('许静好, 画面中的女子是许静好。', defs, opts), '画面中的女子是许静好。')
  assert.equal(normalizePrompts('近景，她站在门口。', defs, opts), '近景，她站在门口。')
})

test('服装名后面的状态写着赤足、或画面写「光着两只脚」：不写鞋', () => {
  const state = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw', outfit: '格子衬衫牛仔裤（赤足）' }, '全身，她站在玄关。'), defs, 'natural', natural)
  assert.doesNotMatch(state, /运动鞋/)
  assert.match(state, /牛仔裤/)
  const scene = expandRosterCalls(call({ upperBody: 'sfw', lowerBody: 'sfw' }, '全身，她光着两只脚踩在地砖上。'), defs, 'natural', natural)
  assert.doesNotMatch(scene, /运动鞋/)
})
