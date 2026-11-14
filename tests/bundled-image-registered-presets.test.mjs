import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import { registerPromptPreset, listRegisteredPromptPresets, registerTemplateModule } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
import { selectGenerationConfig } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/generation-selection.js'
import { validPromptPresetId } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

const config = (extra = {}) => ({ imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [{ id: 'a', provider: 'openai', model: 'm' }],
  promptSystem: 'worldbook', activePromptPreset: 'anime-character', ...extra })

function capture(getConfig) {
  const seen = []
  const generator = createImageGenerator(getConfig, async (_channel, request) => { seen.push(request); return { bytes: new Uint8Array([1]), mediaType: 'image/png' } })
  return { generator, seen }
}

test('registered presets are listed, selectable per request and removed on dispose', async () => {
  const dispose = registerPromptPreset({ id: 'sheet.flat', name: 'Flat sheet', positive: 'flat character sheet', negative: 'busy background' })
  try {
    assert.deepEqual(listRegisteredPromptPresets().map(item => [item.id, item.source, item.registered]), [['sheet.flat', 'sheet', true]])
    assert.equal(validPromptPresetId(config(), 'sheet.flat'), 'sheet.flat')
    assert.throws(() => registerPromptPreset({ id: 'sheet.flat', name: 'again' }), /已注册/)
    assert.throws(() => registerPromptPreset({ id: 'anime-character', name: 'clash' }), /插件名/)

    const { generator, seen } = capture(() => config())
    await generator.generate({ prompt: 'a knight', promptPreset: 'sheet.flat' })
    assert.match(seen[0].positive, /flat character sheet/)
    assert.doesNotMatch(seen[0].positive, /anime/)
    assert.match(seen[0].negative, /busy background/)
    assert.doesNotMatch(seen[0].negative, /watermark|linework/)

    await generator.generate({ prompt: 'a knight' })
    assert.match(seen[1].positive, /anime|动画/)
    assert.match(seen[1].negative, /watermark/)

    const workbench = capture(() => config({ promptSystem: 'workbench' }))
    await workbench.generator.generate({ prompt: 'a knight', promptPreset: 'sheet.flat' })
    assert.match(workbench.seen[0].positive, /flat character sheet/)
  } finally { dispose() }

  assert.deepEqual(listRegisteredPromptPresets(), [])
  const { generator } = capture(() => config())
  await assert.rejects(generator.generate({ prompt: 'a knight', promptPreset: 'sheet.flat' }), /找不到画风预设：sheet\.flat/)
})

test('the built-in no-style preset sends the prompt as written', async () => {
  const { generator, seen } = capture(() => config({ stylePresets: [{ id: 'library-style', name: 'Library', artist: 'library artist', negative: 'library negative', enabled: true }],
    activePreset: 'library-style', promptManualPositive: 'manual addition', promptManualNegative: 'manual negative' }))
  await generator.generate({ prompt: 'a knight', promptPreset: 'no-style' })
  assert.equal(seen[0].positive, 'a knight')
  assert.equal(seen[0].negative ?? '', '')
})

test('a registered style template carries text per usage and a status, and generators list every nameable preset', async () => {
  assert.throws(() => registerPromptPreset({ id: 'sheet.broken', name: 'Broken', structure: { blocks: 'nope' } }), /结构无效/)
  const dispose = registerPromptPreset({ id: 'sheet.layered', name: 'Layered', independent: true, status: 'experimental',
    structure: { format: 'auto', blocks: [{ kind: 'scene', title: 'Scene' }, { kind: 'style', title: 'Look', text: 'shared look' },
      { kind: 'style', title: 'Figure', usage: 'figure', text: 'figure-only look' }, { kind: 'negative', title: 'Avoid', usage: 'background', text: 'people' }] } })
  try {
    const { generator, seen } = capture(() => config({ promptPresets: [{ id: 'mine', name: 'Mine', positive: 'my look' }] }))
    await generator.generate({ prompt: 'a knight', promptPreset: 'sheet.layered', usage: 'figure' })
    await generator.generate({ prompt: 'an empty hall', promptPreset: 'sheet.layered', usage: 'background' })
    assert.match(seen[0].positive, /shared look/)
    assert.match(seen[0].positive, /figure-only look/)
    assert.match(seen[1].positive, /shared look/)
    assert.doesNotMatch(seen[1].positive, /figure-only look/)
    assert.match(seen[1].negative, /people/)

    const listed = new Map(generator.presets().map(item => [item.id, item]))
    assert.deepEqual(listed.get('no-style'), { id: 'no-style', name: '不加画风', origin: 'builtin', status: 'stable', usages: [] })
    assert.deepEqual(listed.get('sheet.layered'), { id: 'sheet.layered', name: 'Layered', origin: 'registered', source: 'sheet', status: 'experimental', usages: ['figure', 'background'] })
    assert.equal(listed.get('mine').origin, 'saved')
  } finally { dispose() }
})

test('a registered preset selected in settings stays selected in workbench generation', async () => {
  const dispose = registerPromptPreset({ id: 'sheet.selected', name: 'Selected sheet', positive: 'flat sheet selected' })
  try {
    const selected = selectGenerationConfig(config({ promptSystem: 'workbench', activePromptPreset: 'sheet.selected',
      promptDefault: { structure: { blocks: [{ kind: 'scene' }] } } }), [])
    assert.equal(selected.config.activePromptPreset, 'sheet.selected')
    assert.equal(selected.template, null)
    const seen = []
    const generator = createImageGenerator(() => config({ promptSystem: 'workbench', activePromptPreset: 'sheet.selected' }),
      async (_channel, request) => { seen.push(request); return { bytes: new Uint8Array([1]), mediaType: 'image/png' } }, 'plugin', {
        templates: () => [{ id: 'template:__default__', templateId: '__default__', ready: true, maxReferences: 0 }],
        generateTemplate: async () => { throw new Error('selected preset was replaced by the default template') },
      })
    await generator.generate({ prompt: 'a knight' })
    assert.match(seen[0].positive, /flat sheet selected/)
  } finally { dispose() }
})

test('a preset named for one request is applied as named, without the user style library or manual additions', async () => {
  const user = { stylePresets: [{ id: 'library-style', name: 'Library', artist: 'library artist', negative: 'library negative', enabled: true }],
    activePreset: 'library-style', promptManualPositive: 'manual addition', promptManualNegative: 'manual negative',
    promptPresets: [{ id: 'saved-template', name: 'Saved', enabled: true, independent: true,
      structure: { format: 'auto', blocks: [{ kind: 'scene', title: 'Scene' }, { kind: 'style', title: 'Style', text: 'saved template style' }] } }] }
  for (const promptMode of ['auto', 'structured']) {
    const { generator, seen } = capture(() => config({ ...user, promptMode }))
    await generator.generate({ prompt: 'a knight' })
    assert.match(seen[0].positive, /library artist/)
    assert.match(seen[0].positive, /manual addition/)
    assert.match(seen[0].negative, /library negative/)

    await generator.generate({ prompt: 'a knight', promptPreset: 'anime-character' })
    assert.match(seen[1].positive, /anime|动画/)
    assert.doesNotMatch(seen[1].positive, /library artist|manual addition/)
    assert.doesNotMatch(seen[1].negative ?? '', /library negative|manual negative/)

    // The worldbook prompt system keeps its own selection rules, but does not drop a template named for this request.
    await generator.generate({ prompt: 'a knight', promptPreset: 'saved-template' })
    assert.match(seen[2].positive, /saved template style/)
    assert.doesNotMatch(seen[2].positive, /library artist|manual addition/)
  }
})

test('registered structured templates control the format for selected and explicit requests', async () => {
  const dispose = registerPromptPreset({ id: 'sheet.structured', name: 'Structured sheet', independent: true,
    structure: { format: 'structured', blocks: [{ kind: 'scene', title: 'Scene' }, { kind: 'style', title: 'Look', text: '整齐的线条，柔和的颜色。' }] } })
  try {
    for (const promptSystem of ['worldbook', 'workbench']) {
      const { generator, seen } = capture(() => config({ promptSystem, promptMode: 'natural', activePromptPreset: 'sheet.structured' }))
      for (const requested of [undefined, 'sheet.structured']) {
        await generator.generate({ prompt: '窗边的旅人。', promptPreset: requested })
        assert.equal(seen.at(-1).promptMode, 'structured')
        assert.match(seen.at(-1).positive, /【Look】\n整齐的线条，柔和的颜色。/)
      }
    }
  } finally { dispose() }
})

test('an independent plain plugin preset keeps its own text while omitting inherited style', async () => {
  const dispose = registerPromptPreset({ id: 'sheet.independent', name: 'Own style', independent: true,
    positive: 'crisp line art', structuredPositive: '清楚的线条', negative: 'blurred edges', structuredNegative: '模糊边缘' })
  try {
    for (const promptMode of ['natural', 'structured']) {
      const { generator, seen } = capture(() => config({ promptMode, activePromptPreset: 'sheet.independent',
        styleArtists: 'unwanted artist', styleNegative: 'unwanted negative', promptManualPositive: 'manual addition', promptManualNegative: 'manual negative' }))
      await generator.generate({ prompt: 'a traveler', negative: 'extra limbs' })
      assert.match(seen[0].positive, promptMode === 'structured' ? /清楚的线条/ : /crisp line art/)
      assert.match(seen[0].negative, promptMode === 'structured' ? /模糊边缘/ : /blurred edges/)
      assert.match(seen[0].negative, /extra limbs/)
      assert.doesNotMatch(JSON.stringify(seen[0]), /unwanted|manual addition|manual negative/)
    }
  } finally { dispose() }
})

test('a selected plugin template keeps resolved asynchronous modules under both prompt systems', async () => {
  const module = registerTemplateModule({ id: 'sheet.async', name: 'Async style', fields: [], async resolve() { return { positive: 'resolved amber light' } } })
  const preset = registerPromptPreset({ id: 'sheet.async-style', name: 'Async template', independent: true,
    structure: { format: 'structured', blocks: [{ kind: 'scene', title: 'Scene' }, { kind: 'extension', title: 'Light', moduleId: 'sheet.async' }] } })
  try {
    for (const promptSystem of ['worldbook', 'workbench']) {
      const { generator, seen } = capture(() => config({ promptSystem, activePromptPreset: 'sheet.async-style' }))
      await generator.generate({ prompt: 'a traveler' })
      assert.match(seen[0].positive, /resolved amber light/)
    }
  } finally { preset(); module() }
})

test('read-only catalog entries do not become a default when the user has no template selected', async () => {
  const seen = []
  const catalog = createImageGenerator(() => config({ promptSystem: 'workbench', activePromptPreset: '', promptDefault: null }),
    async (_channel, request) => { seen.push(request); return { bytes: new Uint8Array([1]), mediaType: 'image/png' } }, 'plugin', {
      templates: () => [{ id: 'template:galgame-clean', templateId: 'galgame-clean', ready: true, maxReferences: 0 }],
      generateTemplate: async () => { throw new Error('a read-only template replaced the empty selection') },
    })
  await catalog.generate({ prompt: 'a traveler' })
  assert.equal(seen[0].positive, 'a traveler')
})
