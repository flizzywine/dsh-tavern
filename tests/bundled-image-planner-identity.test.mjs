import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPlannerContext } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner-context.js'
import { characterRoster } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

const people = () => [
  { id: 'p', name: '裴婉宁', match: '婉宁', enabled: true, traits: { face: 'short hair' } },
  { id: 's', name: '苏小雨', match: '小雨', enabled: true, traits: { face: 'long hair' } },
  { id: 'q', name: '晴夏', enabled: true, traits: { face: 'bun' } },
]
const previous = '厨房的灯亮着。裴婉宁弓着背站在水池前，白背心在腰上堆了一道褶，牛仔短裤的裤边翘着。我走过去，贴上去。「干什么。」她说，「我在忙。」她低头看着那只不停渗水的龙头。'
const reply = '不让她转身。「你疯了。」她低着嗓子，「这是在厨房，小雨在屋里。」'

test('a passing mention does not push the woman on screen out of the character list', () => {
  const definitions = { characters: people() }
  assert.deepEqual(selectPlannerContext({ entries: [], text: reply, definitions }).definitions.characters.map(c => c.id), ['s'])
  const context = selectPlannerContext({ entries: [], text: reply, definitions, recentText: previous })
  assert.deepEqual(context.definitions.characters.map(c => c.id).sort(), ['p', 's'])
  assert.equal(context.diagnostics.includedCharacters.find(c => c.stable_id === 'p').reason, 'previous-reply')
})

test('a reply that names nobody still gets everyone', () => {
  const context = selectPlannerContext({ entries: [], text: '她低着嗓子说话。', definitions: { characters: people() }, recentText: previous })
  assert.equal(context.definitions.characters.length, 3)
})

test('the roster says a recorded outfit may be wrong and a matching garment is not an identity cue', () => {
  const outfits = Array.from({ length: 12 }, (_, i) => ({ id: 'o' + i, name: i === 0 ? '白T恤配牛仔短裤' : '衣服' + i, upper: '上衣' + i, enabled: true }))
  const roster = characterRoster({ characters: [{ id: 's', name: '苏小雨', enabled: true, traits: {}, outfits, current: { outfit: '白色背心' } }] }, { text: '淌到脚踝边那团牛仔短裤上' })
  assert.match(roster, /当前穿着（插件之前的记录，可能记错/)
  assert.match(roster, /不说明画面里的人是她/)
})

test('draw-turn hands the planner the end of the previous reply', async t => {
  const calls = []
  const texts = { 3: previous, 4: '裴婉宁在水池前挽起袖子。', 5: reply }
  const tavern = {
    apiVersion: 5, attach: async () => ({}), list: async () => [],
    getTurn: async ({ turn }) => (texts[turn] ? { text: texts[turn], textVersion: 'v' + turn, card: { id: 'card-1', name: '测试卡' } } : null),
    promptSection: () => () => {}, onTurnSettled: () => () => {},
    readTurnData: async () => null, saveTurnData: async () => {},
  }
  const fixture = await imagePluginFixture(t, {
    tavern, definitions: { characters: people() },
    llm: { stream: args => { calls.push(args); return (async function* () { yield { type: 'text-delta', text: '<reason>x</reason>\n<images></images>' } })() } },
  })
  const runtime = await fixture.start()
  assert.equal((await runtime.request('draw-turn', { gameId: 'game-1', turn: 5 })).status, 200)
  assert.match(calls[0].messages[0].content[0].text, /上一轮正文摘录.*裴婉宁在水池前挽起袖子/)
  assert.doesNotMatch(calls[0].system, /裴婉宁在水池前挽起袖子/)
  assert.match(calls[0].system, /认人按这个顺序/)
})
