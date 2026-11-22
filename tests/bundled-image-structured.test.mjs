import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_PROMPT_PRESETS, getPromptGuidance, composePresetText, promptPresetNegative } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import { generationTemplates, selectGenerationConfig } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/generation-selection.js'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'

const prose = '【人物】\n林月：黑发, 白衬衫。\n陈安：黑发, 白衬衫。\n\n【自定义构图】\n  - 参考图[1]：仅用于身份。\n  - 画幅 3:2，保留 (记号:1.2) 和 {字样}。\n\n【约束】\n不要删除上述两人共有的黑发, 白衬衫。'

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
