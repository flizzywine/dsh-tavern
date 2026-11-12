import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import { registerPromptPreset, listRegisteredPromptPresets } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
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
