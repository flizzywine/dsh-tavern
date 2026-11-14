import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import { registerPromptPreset, listRegisteredPromptPresets } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
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