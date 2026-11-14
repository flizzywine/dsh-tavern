import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_PROMPT_PRESETS, getPromptGuidance, formatPromptForBackend, composePresetText, promptPresetNegative } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import { normalizePrompts, parseImagePlan, parsePromptsBlock, preserveCharacterMetadata, buildPlannerSystem } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'

const prose = '【人物】\n林月：黑发, 白衬衫。\n陈安：黑发, 白衬衫。\n\n【自定义构图】\n  - 参考图[1]：仅用于身份。\n  - 画幅 3:2，保留 (记号:1.2) 和 {字样}。\n\n【约束】\n不要删除上述两人共有的黑发, 白衬衫。'

test('structured normalization preserves Chinese, newlines, repeated traits, indentation and brackets on all backends', () => {
  for (const backend of ['atlascloud', 'comfyui', 'novelai', '']) {
    assert.equal(formatPromptForBackend('  ' + prose + '\n', backend, 'structured'), prose)
    assert.equal(normalizePrompts(prose, {}, { backend, style: 'structured' }), prose)
    assert.equal(normalizePrompts(prose, {}, { backend, promptMode: 'structured' }), prose)
  }
  assert.equal(normalizePrompts('【人物】\n${"name":"林月","angle":"from front"}$\n\n【动作】\n回头。', {}, { style: 'structured' }),
    '【人物】\n林月, from front\n\n【动作】\n回头。')
  assert.equal(normalizePrompts('blue eyes, blue eyes', {}, { backend: 'comfyui', style: 'tags' }), 'blue eyes')
  assert.equal(formatPromptForBackend('(blue eyes:1.2)', 'novelai', 'tags'), '1.2::blue eyes::')
})

test('built-in structured profiles and their guidance are Chinese and allow worldbook-defined sections', () => {
  for (const preset of BUILTIN_PROMPT_PRESETS.filter(item => !item.structure && !item.independent)) {
    const config = { promptMode: 'structured', activePromptPreset: preset.id }
    assert.ok(preset.structuredPositive && preset.structuredNegative)
    const guidance = getPromptGuidance(config, 'atlascloud')
    assert.match(guidance, /中文/)
    assert.match(guidance, /独立世界书可以调整标题、顺序、增减分节/)
    assert.doesNotMatch(guidance, /画面任务|Write positive|Apply the selected/)
    assert.equal(promptPresetNegative(config), preset.structuredNegative)
    const composed = composePresetText(prose, config, 'atlascloud')
    assert.ok(composed.startsWith(prose))
    assert.ok(composed.includes(preset.structuredPositive))
    assert.equal(composePresetText(composed, config, 'atlascloud'), composed)
    assert.equal(promptPresetNegative({ activePromptPreset: preset.id }), preset.negative)
  }
})

test('nested subjects are stripped from explicit scenes and character/revision paths without flattening prose', () => {
  const subjects = '<subjects>[{"characterId":"lin"}]</subjects>'
  const scene = '<scene_composition>' + prose + subjects + '</scene_composition>'
  const parsed = parseImagePlan('<image><prompts>' + scene + '</prompts></image>')[0]
  assert.equal(parsed.prompts, prose)
  assert.deepEqual(parsed.subjects, [{ characterId: 'lin' }])
  assert.equal(parsePromptsBlock(scene).scene, prose)
  const caption = '【身份】\n林月\n\n【动作】\n回头。'
  const characters = '<character_1><prompt>' + caption + subjects + '</prompt><centers>0.5,0.5</centers></character_1>'
  assert.equal(parsePromptsBlock(characters).characters[0].prompt, caption)
  const original = '<scene_composition>' + prose + '</scene_composition>' + characters
  const revised = preserveCharacterMetadata(original, '<scene_composition>【动作】\n举伞。</scene_composition>' + characters)
  assert.doesNotMatch(revised, /subjects|characterId/)
  assert.equal(parsePromptsBlock(revised).characters[0].prompt, caption)
  assert.equal(parsePromptsBlock(revised).characters[0].centers, '0.5,0.5')
  const plainRevision = preserveCharacterMetadata(original, '【动作】\n举伞。' + subjects)
  assert.doesNotMatch(plainRevision, /subjects|characterId/)
})

test('malformed, duplicate or incomplete subjects return explicit errors rather than a silent macro fallback', () => {
  for (const block of [
    '<subjects>{}</subjects>', '<subjects>[null]</subjects>', '<subjects>[{}]</subjects>',
    '<subjects>[{"characterId":3}]</subjects>', '<subjects>[{"characterId":"lin","outfitId":null}]</subjects>',
    '<subjects>not JSON</subjects>', '<subjects></subjects>',
    '<subjects>[]</subjects><subjects>[]</subjects>', '<subjects>[{"name":"林月"}]', '</subjects>',
  ]) {
    const image = parseImagePlan('<image><prompts>画面</prompts>' + block + '</image>')[0]
    assert.match(image.subjectsError, /主体清单无效/, block)
    assert.equal(Object.hasOwn(image, 'subjects'), false, block)
  }
})

test('structured planner permits custom sections and preserves outer XML and history ordering', () => {
  const system = buildPlannerSystem({ promptMode: 'structured', rules: '本书改用【场面】与【细节】两节。', count: 1, characterUpdates: true, smartSelection: true })
  assert.match(system, /本书改用【场面】与【细节】两节/)
  assert.match(system, /世界书可以调整标题、顺序、增减分节/)
  assert.match(system, /<images><image><regex>/)
  assert.match(system, /完整闭合的 image\/regex\/prompts 外层 XML 协议/)
  assert.match(system, /必须在 decision 与任何 image 块之前/)
  assert.doesNotMatch(system, /画面任务|转译成对应的 NSFW tag|自己描述时按逗号分成单个 tag/)
  assert.match(system, /英文描述仅供跨格式共用的内部历史记录/)
  const legacy = buildPlannerSystem({ count: 1 })
  assert.match(legacy, /NSFW tag/)
  assert.doesNotMatch(legacy, /结构化分节写在/)
})
