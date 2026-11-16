// The story read aloud: what a reply reads (story-reading.cjs, the stage's own reading, owner 11-16) and where 有声书's
// 播放 starts (the dsh-tavern-audiobook plugin's reader).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'acorn'
import bubbles from '../tavern-plugin/src/client/bubble-line.cjs'

const src = file => readFile(new URL('../tavern-plugin/src/client/' + file, import.meta.url), 'utf8')
async function functions(file, names) {
  const source = await src(file)
  return parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
    .map(node => source.slice(node.start, node.end)).join('\n')
}
const context = vm.createContext({ parseBubbles: bubbles.parseBubbles, module: { exports: {} } })
vm.runInContext(await functions('stage-page-index.cjs', ['stagePagePlain']) + '\n' + await functions('gal-stage-helpers.cjs', ['galPlain', 'galBlocks', 'galParagraphs']) + '\n'
  + (await src('features/prose-layout.js')).replace(/^const /gm, 'var ').replace(/^let /gm, 'var ') + '\n'
  + (await src('story-reading.cjs')).replace(/^const /gm, 'var ').replace("typeof window === 'undefined'", 'true'), context)
const core = context.module.exports
// the plugin's pure helpers, from its built client as Tavern's module loader runs it
const pluginContext = vm.createContext({ window: { __ModuleLoader__: { load({ factory }) { pluginContext.plugin = factory(() => ({ createElement() {}, Fragment: 'f' })) } } }, CSS: {} })
vm.runInContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-audiobook/client.js', import.meta.url), 'utf8'), pluginContext)
const ab = { ...pluginContext.plugin.__test, audiobookRowUnits: core.readingRowUnits, audiobookUnits: core.readingUnits }
ab.audiobookPause = ab.abPause; ab.audiobookPlace = ab.abPlace; ab.audiobookStartIndex = ab.abStartIndex; ab.audiobookPlaceIndex = ab.abPlaceIndex; ab.audiobookFlat = ab.abFlat; ab.audiobookFind = ab.abFind
// values made in the test's context compare as plain data
const plain = value => JSON.parse(JSON.stringify(value))
const row = (key, text, extra = {}) => ({ key, role: 'assistant', floorNo: 1, text, streaming: false, ...extra })

test('一条回复按舞台的读法分成单位：旁白段落、@bubble 台词；HTML 块、注释、分隔线不读', () => {
  const text = [
    '<initvar>\nstats: 1\n</initvar>',
    '水上殿阁的茶屋里，五个人围坐在矮桌旁。',
    '@bubble:hana|小花|喜悦|[这个这个！你画我猜！]|[これこれ！おえかきクイズ！]',
    '<!--机密：任务档案-->',
    '---',
    '@bubble:ashi|芦花|平和|[*要不要告诉她呢*]',
    '**彩P**看了看游戏说明。'
  ].join('\n\n')
  const units = ab.audiobookRowUnits(row('turn:3', text))
  assert.deepEqual(plain(units.map(u => [u.kind, u.text])), [
    ['narration', '水上殿阁的茶屋里，五个人围坐在矮桌旁。'],
    ['line', '这个这个！你画我猜！'],
    ['line', '（要不要告诉她呢）'],
    ['narration', '彩P看了看游戏说明。']])
  assert.equal(units[1].segment.speech, 'これこれ！おえかきクイズ！', '台词带着配音文本，按角色读时由舞台的 segmentSpeechInput 选')
  assert.deepEqual(plain(units.map(u => u.n)), [0, 1, 2, 3])
  assert.equal(units[0].key, JSON.stringify(['turn:3', 0]))
})

test('长旁白在句末切开，短句并回，首句不用等整段', () => {
  const long = '她直接冲向了神社正殿，然后一脚踩中了陷阱，地板突然翻转，整个人掉进了下面的水池里面。'.repeat(3) + '几秒钟后，她从水池里冒出头。兔耳朵湿漉漉地垂在脑袋两边。'
  const units = ab.audiobookRowUnits(row('r', long))
  assert.ok(units.length > 1)
  assert.equal(units.map(u => u.text).join(''), long)
  assert.ok(units.every(u => u.para === 0), '同一段的几块共用 para：块之间不加停顿')
  assert.equal(ab.audiobookPause(units[0], units[1]), 0)
})

test('只读写完的回复，正在生成的不读', () => {
  const units = ab.audiobookUnits([row('a', '第一段。'), { key: 'u', role: 'user', text: '玩家' }, row('b', '写到一半', { streaming: true })])
  assert.deepEqual(plain(units.map(u => u.row)), ['a'])
})

test('播放：没动过就接着上次那句，动过就从这一屏第一句；都找不到时读最新一条', () => {
  const units = ab.audiobookUnits([row('a', '一。\n\n二。'), row('b', '三。\n\n四。')])
  const place = ab.audiobookPlace(units[1])
  let asked = 0
  const screen = () => { asked++; return 2 }
  assert.equal(ab.audiobookStartIndex({ units, place, moved: false, screen }), 1)
  assert.equal(asked, 0, '没动过时不看屏幕')
  assert.equal(ab.audiobookStartIndex({ units, place, moved: true, screen }), 2)
  assert.equal(ab.audiobookStartIndex({ units, place: null, moved: false, screen }), 2, '没有记录时从这一屏开始')
  assert.equal(ab.audiobookStartIndex({ units, place: null, moved: true, screen: () => -1 }), 2, '屏幕上没有正文：最新一条的第一句')
})

test('改过的回复：记录的那句不在了就从那一楼开头读', () => {
  const before = ab.audiobookUnits([row('a', '一。\n\n二。\n\n三。')])
  const place = ab.audiobookPlace(before[2])
  const after = ab.audiobookUnits([row('a', '全新的开头。\n\n另一句。')])
  assert.equal(ab.audiobookPlaceIndex(after, place), 0)
})

test('在页面文字里找到这一句：不看空白，从上一句之后往后找；改写过的正文按开头几个字找', () => {
  const nodes = [{ nodeValue: '小花 ' }, { nodeValue: '喜悦' }, { nodeValue: '这个这个！\n你画我猜！' }, { nodeValue: '这个这个！你画我猜！' }]
  const flat = ab.audiobookFlat(nodes)
  assert.equal(flat.text, '小花喜悦这个这个！你画我猜！这个这个！你画我猜！')
  assert.deepEqual(plain(ab.audiobookFind(flat.text, '这个这个！你画我猜！')), [4, 14])
  assert.deepEqual(plain(ab.audiobookFind(flat.text, '这个这个！你画我猜！', 14)), [14, 24])
  assert.equal(flat.at[4][0], nodes[2]); assert.equal(flat.at[4][1], 0)
  assert.deepEqual(plain(ab.audiobookFind('前面的字她一边说一边挥舞着手里的虚拟团子（改写）', '她一边说，一边挥舞着手里的虚拟团子。')), null, '标点不同就不是同一句')
  assert.deepEqual(plain(ab.audiobookFind('她一边说，一边挥舞着手里——改写了', '她一边说，一边挥舞着手里的虚拟团子。')), [0, 12])
})
