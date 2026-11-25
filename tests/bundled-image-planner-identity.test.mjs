import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPlannerContext } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner-context.js'
import { buildPlannerSystem, characterRoster } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { structuredWorldbookDefaults } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/format-worldbooks.js'
import { bindReferenceAppearances, buildStructuredReferenceText, normalizeReferenceImage, referencePlannerGuidance, resolveImageReferences } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/reference-images.js'
import { IMAGE_PNG, imageJson, imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

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

test('prose planning separates pictured identity from history and preserves unknown wardrobe', () => {
  const outfits = Array.from({ length: 7 }, (_, i) => ({ id: 'o' + i, name: '包臀裙' + i, upper: '蓝色上衣' }))
  const definitions = { characters: [
    { id: 'a', name: '人物甲', traits: { face: '黑色齐耳发' }, imagePrompt: '资料中的黑发人物',
      referenceImage: { id: 'a'.repeat(64), mediaType: 'image/png', byteLength: 128 }, outfits, current: { outfit: 'unknown' } },
    { id: 'b', name: '人物乙', traits: { face: '短棕发' } },
  ] }
  const rosterOptions = { identityReferences: true, strictWardrobe: true, text: '人物甲换了衣服，人物乙穿着包臀裙。',
    hasIdentityReference: character => Boolean(normalizeReferenceImage(character.referenceImage)) }
  const roster = characterRoster(definitions, rosterOptions)
  assert.match(roster, /固定外貌由生图模型依据身份图处理/)
  assert.match(roster, /短棕发/)
  assert.match(roster, /人物库外貌（仅用于辨认人物与性别，不抄进画面；与正文称谓冲突时以此为准）：资料中的黑发人物/)
  assert.doesNotMatch(roster, /黑色齐耳发|选颜色、款式最接近的一套/)
  assert.match(roster, /已换衣，款式未明确/)
  assert.match(characterRoster(definitions), /资料中的黑发人物/)

  const worldbooks = structuredWorldbookDefaults()
  const rules = Object.values(worldbooks).flatMap(book => book.entries.map(entry => entry.content)).join('\n')
  const historyRoster = characterRoster(definitions, { ...rosterOptions, fullTraits: true })
  for (const promptMode of ['structured', 'natural']) {
    const system = buildPlannerSystem({ rules: promptMode === 'structured' ? rules : '', roster: historyRoster, promptMode,
      extra: referencePlannerGuidance(definitions, { structured: promptMode === 'structured', prose: true }), characterUpdates: true, count: 1, identityReferences: true })
    assert.match(system, /固定外貌旧值（仅用于 character_updates[^\n]+\n[^\n]+黑色齐耳发/)
    assert.match(system, /无身份图的角色依据清单和正文写可见外貌/)
    assert.match(system, /正文称谓或代词只用来定位人物，不能用来判断性别/)
    assert.match(system, /current\.outfit 写 "unknown"/)
    assert.match(system, /"outfit":"unknown"/)
    assert.doesNotMatch(system, /按这里的白描写外貌|从这个角色的服装库里挑一套|NSFW tag|按逗号分成单个 tag/)
  }
})

test('planned reference bindings carry the selected figures’ face and split body fields, not the narrator’s identity claims', () => {
  const image = { id: 'a'.repeat(64), mediaType: 'image/png', byteLength: 128 }
  const definitions = { characters: [
    { id: 'a', name: '小雨', referenceImage: image, traits: { face: '蜜橙长发', bodySFW: '少女，白色羽翼', lowerSFW: '纤细双腿' } },
    { id: 'b', name: '阿青', referenceImage: image, traits: { face: '年轻男子，黑发' }, outfits: [{ id: 'uniform', name: '制服', referenceImage: image }] },
    { id: 'c', name: '小安', referenceImage: image, traits: { face: '未入镜的人' } },
  ] }
  const selected = resolveImageReferences({ text: 'The young man Xiao Yu hugs Ah Qing.', definitions,
    subjects: [{ characterId: 'a' }, { characterId: 'b', outfitId: 'uniform' }, { name: '店员' }] })
  bindReferenceAppearances(selected, definitions)
  const prompt = buildStructuredReferenceText(selected.references)
  assert.match(prompt, /固定身份、性别和外貌以对应参考图和人物库外貌为准/)
  assert.match(prompt, /参考图1 → 小雨（身份参考）\n小雨的人物库外貌：蜜橙长发\n少女，白色羽翼\n纤细双腿/)
  assert.match(prompt, /阿青的人物库外貌：年轻男子，黑发/)
  assert.doesNotMatch(prompt, /未入镜的人|店员|young man Xiao Yu/)
  assert.equal(selected.subjects[1].outfitId, 'uniform')
})

test('the natural planner submits named actions with library appearance and separate outfit references', async t => {
  const calls = []
  const fixture = await imagePluginFixture(t, {
    config: { generationMode: 'reference', promptMode: 'natural' },
    llm: { stream: args => {
      assert.match(args.system, /正文称谓或代词只用来定位人物，不能用来判断性别/)
      assert.match(args.system, /人物库外貌[^\n]+蜜橙长发 \/ 少女，白色羽翼/)
      assert.match(args.system, /人物库外貌[^\n]+年轻男子，黑发/)
      return (async function* () {
        yield { type: 'text-delta', text: '<images><image><regex>他抱住了阿青。</regex><title_styled>拥抱</title_styled><subjects>[{"characterId":"a"},{"characterId":"b","outfitId":"uniform"}]</subjects><prompts>小雨拥抱阿青，阿青扶住小雨的肩膀。</prompts></image></images>' }
      })()
    } },
  })
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/uploadMedia')) return imageJson({ data: { download_url: 'https://images.example.test/ref.png' } })
    if (url.endsWith('/generateImage')) {
      calls.push(JSON.parse(init.body))
      return imageJson({ data: { id: 'test', status: 'completed', outputs: ['https://images.example.test/out.png'] } })
    }
    return new Response(IMAGE_PNG)
  }
  const runtime = await fixture.start()
  const upload = await runtime.request('reference-image', { data: IMAGE_PNG.toString('base64'), mediaType: 'image/png' })
  const referenceImage = upload.body.referenceImage
  const definitions = { characters: [
    { id: 'a', name: '小雨', referenceImage, traits: { face: '蜜橙长发', bodySFW: '少女，白色羽翼' } },
    { id: 'b', name: '阿青', referenceImage, traits: { face: '年轻男子，黑发' }, outfits: [{ id: 'uniform', name: '制服', referenceImage }] },
    { id: 'c', name: '小安', referenceImage, traits: { face: '未入镜的人' } },
  ] }
  assert.equal((await runtime.request('definitions', { definitions })).status, 200)
  const result = await runtime.request('plan', { text: '小雨走过去。他抱住了阿青。小安没有来。', manual: true })
  assert.equal(result.status, 200)
  assert.equal(result.body.plans.length, 1, JSON.stringify({ result: result.body, logs: fixture.logs }))
  const job = await runtime.terminal(result.body.plans[0].jobId)
  assert.equal(job.state, 'done')
  assert.equal(calls.length, 1)
  assert.match(calls[0].prompt, /小雨的人物库外貌：蜜橙长发\n少女，白色羽翼/)
  assert.match(calls[0].prompt, /阿青的人物库外貌：年轻男子，黑发/)
  assert.match(calls[0].prompt, /阿青／制服（服装参考）/)
  assert.match(calls[0].prompt, /小雨拥抱阿青/)
  assert.doesNotMatch(calls[0].prompt, /他抱住|小安|未入镜的人/)
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
