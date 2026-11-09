import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROMPT_FORMATS, BUILTIN_PROMPT_PRESETS, resolvePromptMode, normalizePromptPresets,
  getPromptGuidance, formatPromptForBackend, composePresetText, promptPresetNegative, promptBackendContext,
  appendStructuredSection, composeStructuredPrompt, combineStructuredPrompt,
} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import {
  normalizePrompts, parseImagePlan, parsePromptsBlock, preserveCharacterMetadata, buildPlannerSystem, characterRoster,
} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { selectPlannerContext } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner-context.js'

const prose = '【人物】\n林月：黑发, 白衬衫。\n陈安：黑发, 白衬衫。\n\n【自定义构图】\n  - 参考图[1]：仅用于身份。\n  - 画幅 3:2，保留 (记号:1.2) 和 {字样}。\n\n【约束】\n不要删除上述两人共有的黑发, 白衬衫。'

test('structured is explicit fourth format; automatic choices remain backwards compatible', () => {
  assert.deepEqual(PROMPT_FORMATS, ['tags', 'natural', 'mixed', 'structured'])
  for (const backend of ['atlascloud', 'comfyui', 'novelai', 'openai']) assert.equal(resolvePromptMode({ promptMode: 'structured' }, backend), 'structured')
  assert.equal(resolvePromptMode({}, 'atlascloud'), 'natural')
  assert.equal(resolvePromptMode({}, 'comfyui'), 'tags')
  assert.equal(resolvePromptMode({}, 'comfyui flux'), 'natural')
  assert.equal(resolvePromptMode({}, 'comfyui anima'), 'mixed')
})

test('custom prompt, weight and worldbook contexts follow the selected allowlisted protocol', () => {
  const config = { imageBackend: 'custom', activeImageChannel: 'custom-image', imageChannels: [
    { id: 'custom-image', provider: 'custom', options: { apiProtocol: 'qwen' } },
  ] }
  const backend = promptBackendContext(config)
  assert.equal(backend, 'qwen')
  assert.equal(resolvePromptMode({}, backend), 'natural')
  assert.equal(formatPromptForBackend('(blue eyes:1.2)', backend, 'natural'), 'blue eyes')
  const context = selectPlannerContext({ backend, entries: [
    { index: 0, content: 'Qwen guidance', enabled: true, backends: ['qwen'] },
    { index: 1, content: 'Atlas guidance', enabled: true, backends: ['atlascloud'] },
  ] })
  assert.match(context.staticRules, /Qwen guidance/)
  assert.doesNotMatch(context.staticRules, /Atlas guidance/)

  config.imageChannels[0].options.apiProtocol = 'novelai'
  const novelai = promptBackendContext(config)
  assert.equal(novelai, 'novelai')
  assert.equal(formatPromptForBackend('(blue eyes:1.2)', novelai, 'tags'), '1.2::blue eyes::')
  assert.equal(resolvePromptMode({}, novelai), 'tags')
  const roleRules = selectPlannerContext({ backend: novelai, backendAliases: ['custom'], entries: [
    { index: 2, content: 'custom NAI rule', enabled: true, backends: ['custom'] },
    { index: 3, content: 'NAI role rule', enabled: true, backends: ['novelai'] },
    { index: 4, content: 'Atlas-only rule', enabled: true, backends: ['atlascloud'] },
  ] })
  assert.match(roleRules.staticRules, /custom NAI rule/)
  assert.match(roleRules.staticRules, /NAI role rule/)
  assert.doesNotMatch(roleRules.staticRules, /Atlas-only rule/)
})

test('retired Comfy simple settings no longer affect full-workflow prompt detection', () => {
  const config = { imageBackend: 'comfyui', comfyMode: 'simple', comfySimple: { template: 'anima' } }
  assert.equal(promptBackendContext(config), 'comfyui')
  assert.equal(resolvePromptMode(config, promptBackendContext(config)), 'tags')
  assert.equal(promptBackendContext(config, { summary: { model: 'flux-dev' } }), 'comfyui flux-dev')
  assert.equal(resolvePromptMode(config, promptBackendContext(config, { summary: { model: 'flux-dev' } })), 'natural')
})

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
  for (const preset of BUILTIN_PROMPT_PRESETS) {
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

test('结构化规划约束单张定格、事实来源、空间与情绪，不再要求重复参考图分节', () => {
  const system = buildPlannerSystem({ promptMode: 'structured', count: 1 })
  assert.match(system, /人物与表情、服装、动作、环境、镜头与光线、风格、约束/)
  assert.doesNotMatch(getPromptGuidance({ promptMode: 'structured' }), /人物及参考图对应/)
  for (const rule of [
    /绑定及用途说明由插件统一追加一次/,
    /一个可同时成立的定格姿态/,
    /视线落点/,
    /主导情绪和可见面部变化/,
    /不为填满分节猜测衣物颜色、家具清单或物品位置/,
    /覆盖范围、窗扇状态和入光路径/,
    /不为解释光线新增窗帘、开口、掀布或光源/,
    /不擅自改设画风/,
    /约束只保留本张需要且可执行的限制/,
    /示例不输出到画面提示词/,
  ]) assert.match(system, rule)
  assert.doesNotMatch(buildPlannerSystem({ promptMode: 'tags' }), /一个可同时成立的定格姿态/)
})

test('custom structured profile fields survive normalization without translating user-authored text', () => {
  const [preset] = normalizePromptPresets([{ id: 'custom-look', name: '木刻', positive: 'fallback', negative: 'fallback negative', structuredPositive: '保留木纹。\n克制留白。', structuredNegative: '不添加[背景文字]。' }])
  assert.equal(preset.structuredPositive, '保留木纹。\n克制留白。')
  assert.equal(preset.structuredNegative, '不添加[背景文字]。')
  const config = { promptMode: 'structured', activePromptPreset: preset.id, promptPresets: [preset] }
  assert.match(getPromptGuidance(config), /保留木纹。\n克制留白。/)
  assert.equal(promptPresetNegative(config), '不添加[背景文字]。')
  assert.equal(composePresetText('【自定义】\n长文' + '甲'.repeat(12500), config).includes('甲'.repeat(12500)), true, 'no silent 12000-char truncation')
})

test('final structured composition keeps custom sections and adds style/manual/reference/negative as intact blocks', () => {
  const result = composeStructuredPrompt({
    text: prose, artist: '水彩\n纸张肌理', artistPosition: 'suffix',
    positive: '两人各拿一把伞, 两人各拿一把伞。', negative: '甲不戴帽子。\n乙不戴帽子。',
    referenceText: '图1 → 林月身份；图2 → 白衬衫。',
    config: { promptMode: 'structured', activePromptPreset: 'story-cinematic', promptManualPositive: '【用户自定义标题】\n雨后，不下雨。', promptManualNegative: '不要文字, 不要水印。' },
  })
  assert.ok(result.positive.startsWith('【参考图对应与一致性】\n图1 → 林月身份；图2 → 白衬衫。\n\n' + prose))
  assert.match(result.positive, /【风格补充】\n水彩\n纸张肌理/)
  assert.match(result.positive, /【用户自定义标题】\n雨后，不下雨。/)
  assert.match(result.positive, /两人各拿一把伞, 两人各拿一把伞。/)
  assert.match(result.positive, /图1 → 林月身份；图2 → 白衬衫。/)
  assert.match(result.negative, /甲不戴帽子。\n乙不戴帽子。/)
  assert.match(result.negative, /不要文字, 不要水印。/)
  assert.equal(result.combined, combineStructuredPrompt(result.positive, result.negative))
  assert.match(result.combined, /【约束补充】\n/)
  assert.doesNotMatch(result.combined, /Avoid:/)
  assert.equal(combineStructuredPrompt(result.combined, result.negative), result.combined)
  assert.equal(composeStructuredPrompt({ text: result.positive, referenceText: '图1 → 林月身份；图2 → 白衬衫。' }).positive, result.positive)
  assert.ok(composeStructuredPrompt({ text: prose, artist: '油画' }).positive.startsWith('【风格补充】\n油画\n\n' + prose))
  assert.equal(appendStructuredSection(prose, '空内容', ''), prose)
})

test('XML prompt extraction retains paragraph structure and only submits complete streamed images', () => {
  const start = '<images><image><regex>林月回头。</regex><title_styled>回头</title_styled><prompts>' + prose + '</prompts>'
  assert.deepEqual(parseImagePlan(start), [])
  const [image] = parseImagePlan(start + '</image></images>')
  assert.equal(image.prompts, prose)
  assert.equal(image.mount, '林月回头。')
  assert.deepEqual(image.characters, [])
  assert.deepEqual(parsePromptsBlock(prose), { scene: prose, characters: [] })
  const withCharacters = parsePromptsBlock(prose + '\n<character_1><prompt>【身份】\n林月\n\n【动作】\n回头</prompt></character_1>')
  assert.equal(withCharacters.scene, prose)
  assert.equal(withCharacters.characters[0].prompt, '【身份】\n林月\n\n【动作】\n回头')
})

test('subjects is optional metadata: omitted and empty lists remain distinct without changing legacy shapes', () => {
  const old = parseImagePlan('<image><prompts>old prompt</prompts></image>')[0]
  assert.deepEqual(old, { mount: '', title: '', think: '', size: '', prompts: 'old prompt', characters: [] })
  const make = subjects => parseImagePlan('<image><prompts>' + prose + '</prompts>' + subjects + '</image>')[0]
  assert.deepEqual(make('<subjects>[]</subjects>').subjects, [])
  const withSubjects = make('<subjects>[{"characterId":"lin","outfitId":"shirt"},{"name":"陌生旅人"}]</subjects>')
  assert.deepEqual(withSubjects.subjects, [{ characterId: 'lin', outfitId: 'shirt' }, { name: '陌生旅人' }])
  assert.equal(withSubjects.prompts, prose)
  assert.equal(Object.hasOwn(withSubjects, 'subjectsError'), false)
  const nested = parseImagePlan('<image><prompts>' + prose + '<subjects>[{"name":"旅人"}]</subjects></prompts></image>')[0]
  assert.equal(nested.prompts, prose)
  assert.deepEqual(nested.subjects, [{ name: '旅人' }])
})

test('subjects-only prompts do not turn metadata into an image scene, while opaque model tokens survive', () => {
  const subjects = '<subjects>[{"characterId":"lin"}]</subjects>'
  for (const prompt of [subjects, '<scene_composition>' + subjects + '</scene_composition>']) {
    assert.deepEqual(parsePromptsBlock(prompt), { scene: '', characters: [] })
    assert.deepEqual(parseImagePlan('<image><regex>林月回头。</regex><prompts>' + prompt + '</prompts></image>'), [])
  }
  const token = '<lora:visual-detail:0.8>'
  assert.equal(parsePromptsBlock(token + subjects).scene, token, 'legacy standalone model tokens still use the cleaned fallback')
  const character = '<character_1><prompt>【人物】\n林月回头。</prompt></character_1>'
  const image = parseImagePlan('<image><prompts>' + subjects + character + '</prompts></image>')[0]
  assert.equal(image.prompts, '')
  assert.equal(image.characters[0].prompt, '【人物】\n林月回头。', 'a real per-character prompt remains sufficient without a scene block')
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

test('structured activation is a format filter, not a backend name, and enabled stays authoritative', () => {
  const result = selectPlannerContext({ backend: 'atlascloud', promptMode: 'structured', entries: [
    { index: 0, comment: '结构化', content: '中文规则', enabled: true, backends: ['structured'] },
    { index: 1, comment: '混合', content: '混合规则', enabled: true, backends: ['mixed'] },
    { index: 2, comment: '禁用', content: '关闭规则', enabled: false, backends: ['structured'] },
    { index: 3, comment: '双条件', content: '动态中文', enabled: true, backends: ['atlascloud', 'structured'], activation: 'keywords', keywords: ['窗'] },
  ], text: '林月站在窗前。' })
  assert.match(result.staticRules, /中文规则/)
  assert.doesNotMatch(result.staticRules, /混合规则|关闭规则/)
  assert.match(result.dynamicRules, /动态中文/)
  assert.equal(result.diagnostics.omittedEntries.find(e => e.index === 1).reason, 'prompt-mode-mismatch')
  assert.equal(result.diagnostics.omittedEntries.find(e => e.index === 2).reason, 'disabled')
})

test('roster exposes outfit IDs/reference availability/consistency only, never image bytes', () => {
  const referenceImage = { data: 'SECRET_IMAGE_BYTES', path: '/private/image.png' }
  const roster = characterRoster({ characters: [{ id: 'lin', name: '林月', referenceImage, consistencyText: '保留眼下的痣。', outfits: [
    { id: 'white-shirt', name: '白衬衫', upper: 'white blouse', referenceImage, consistencyText: '保留领口刺绣。', default: true },
    { id: 'disabled', name: '不可选', enabled: false, referenceImage },
  ] }] })
  assert.match(roster, /有身份参考图/)
  assert.match(roster, /保留眼下的痣/)
  assert.match(roster, /白衬衫 = white blouse/)
  assert.match(roster, /服装标识：白衬衫 \[outfit_id=white-shirt\]；有服装参考图/)
  assert.match(roster, /保留领口刺绣/)
  assert.doesNotMatch(roster, /SECRET_IMAGE_BYTES|\/private|不可选/)
})

test('importance ordering never makes a frame inherit the previously emitted frame state', () => {
  for (const promptMode of ['structured', 'natural', 'tags']) for (const smartSelection of [true, false]) {
    const system = buildPlannerSystem({ promptMode, smartSelection, count: 3 })
    assert.match(system, /按重要性排序/)
    assert.match(system, /该画面正文时点之前最后明确的状态/)
    assert.match(system, /不能按输出前一张继承状态/)
    assert.doesNotMatch(system, /才延续前一张状态/)
  }
})
