import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_PROMPT_PRESETS, getPromptGuidance, formatPromptForBackend, composePresetText, promptPresetNegative } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import { normalizePrompts, parseImagePlan, parsePromptsBlock, preserveCharacterMetadata, buildPlannerSystem } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js'
import { generationTemplates, selectGenerationConfig } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/generation-selection.js'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'

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

test('built-in galgame styles add their shared look to every request and the text one usage needs only to that usage', async () => {
  const seen = []
  const generator = createImageGenerator(() => ({ imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [{ id: 'a', provider: 'openai', model: 'm' }],
    promptSystem: 'workbench', stylePresets: [{ id: 'library-style', name: 'Library', artist: 'library artist', enabled: true }], activePreset: 'library-style',
    promptManualPositive: 'manual addition' }), async (_channel, request) => { seen.push(request); return { bytes: new Uint8Array([1]), mediaType: 'image/png' } })
  for (const id of ['galgame-clean', 'galgame-anime', 'galgame-polished']) {
    const preset = BUILTIN_PROMPT_PRESETS.find(item => item.id === id)
    const text = usage => preset.structure.blocks.find(block => block.kind === 'style' && (block.usage ?? '') === usage).text
    const drawn = {}
    for (const usage of ['story', 'background', 'figure', 'sheet']) {
      await generator.generate({ prompt: 'a quiet classroom', promptPreset: id, usage })
      drawn[usage] = seen.at(-1).positive
      assert.ok(drawn[usage].startsWith('a quiet classroom'))
      assert.ok(drawn[usage].includes(text('')), id + ' ' + usage)
      assert.doesNotMatch(drawn[usage], /library artist|manual addition/)
    }
    for (const usage of ['background', 'figure', 'sheet']) {
      assert.ok(drawn[usage].includes(text(usage)))
      for (const other of ['story', 'background', 'figure', 'sheet'].filter(item => item !== usage)) assert.ok(!drawn[other].includes(text(usage)), id + ': ' + usage + ' text in ' + other)
    }
  }
})

test('Galgame templates can be selected and discovered without changing the existing random pool', () => {
  const cfg = { promptSystem: 'workbench', imageBackend: 'openai', activePromptPreset: 'galgame-clean',
    promptDefault: { name: 'My default', structure: { format: 'natural', blocks: [{ kind: 'scene', title: 'Scene' }] } },
    promptPresets: [{ id: 'saved', name: 'Saved', structure: { format: 'natural', blocks: [{ kind: 'scene', title: 'Scene' }] } }] }
  assert.ok(generationTemplates(cfg).some(item => item.id === 'galgame-clean'))
  assert.equal(selectGenerationConfig(cfg).config.activePromptPreset, 'galgame-clean')
  assert.equal(selectGenerationConfig(cfg, [], { templateId: 'galgame-anime' }).template.id, 'galgame-anime')
  assert.equal(selectGenerationConfig({ ...cfg, activePromptPreset: '' }).template.id, '__default__')
  assert.equal(selectGenerationConfig({ ...cfg, randomPromptTemplates: true }, [], { randomValue: () => 0.99 }).template.id, 'saved')
  assert.equal(selectGenerationConfig({ ...cfg, randomPromptTemplates: true, randomTemplateIds: ['galgame-anime'] }).template.id, 'galgame-anime')
})

test('a built-in Galgame default survives restart and reaches the real job engine and SDK', async t => {
  let provider
  const tavern = new Proxy({ imageProvider(value) { provider = value; return () => {} } }, { get: (target, key) => key in target ? target[key] : () => () => {} })
  const f = await imagePluginFixture(t, { tavern, config: { promptSystem: 'workbench', promptMode: 'natural', imageBackend: 'openai', activeImageChannel: 'online',
    imageChannels: [{ id: 'online', name: 'Online', provider: 'openai', model: 'm', baseUrl: 'https://image.test', authMode: 'none' }] } })
  let runtime = await f.start()
  const saved = await runtime.request('config', { config: { activePromptPreset: 'galgame-clean' } })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  runtime.close()
  runtime = await f.start()
  assert.equal((await runtime.request('state')).body.config.activePromptPreset, 'galgame-clean')
  const requests = []
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return imageJson({ data: [{ b64_json: IMAGE_PNG.toString('base64') }] }) }
  const started = await runtime.request('jobs', { tag: 'a quiet classroom', generationMode: 'text' })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  const job = await runtime.terminal(started.body.id || started.body.jobId)
  assert.equal(job.state, 'done', job.error)
  assert.match(requests[0].prompt, /Clean cel-shaded anime/)
  for (let i = 0; i < 100 && !provider; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(provider.models().some(item => item.id === 'template:galgame-clean'))
  await provider.generate({ prompt: 'a quiet classroom', usage: 'background' })
  assert.match(requests.at(-1).prompt, /Clean cel-shaded anime/)
  assert.match(requests.at(-1).prompt, /composition and colour very clean/)
})
