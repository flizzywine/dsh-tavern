// The story read aloud (tavernUi.readingUnits): what a reply reads, by the stage's own reading (story-reading.cjs).
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
const reading = { rowUnits: core.readingRowUnits, units: core.readingUnits }
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
  const units = reading.rowUnits(row('turn:3', text))
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
  const units = reading.rowUnits(row('r', long))
  assert.ok(units.length > 1)
  assert.equal(units.map(u => u.text).join(''), long)
  assert.ok(units.every(u => u.para === 0), '同一段的几块共用 para：块之间不加停顿')
})

test('只读写完的回复，正在生成的不读', () => {
  const units = reading.units([row('a', '第一段。'), { key: 'u', role: 'user', text: '玩家' }, row('b', '写到一半', { streaming: true })])
  assert.deepEqual(plain(units.map(u => u.row)), ['a'])
})
