import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'

const config = (extra = {}) => ({ imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [{ id: 'a', provider: 'openai', model: 'm' }],
  promptSystem: 'worldbook', activePromptPreset: 'anime-character', ...extra })

function capture(getConfig) {
  const seen = []
  const generator = createImageGenerator(getConfig, async (_channel, request) => { seen.push(request); return { bytes: new Uint8Array([1]), mediaType: 'image/png' } })
  return { generator, seen }
}

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
