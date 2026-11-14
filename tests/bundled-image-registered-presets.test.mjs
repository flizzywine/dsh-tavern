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
    assert.match(seen[1].positive, /anime/)
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
