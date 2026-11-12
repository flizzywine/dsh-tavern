// 素材原样 (image-asset-preset.js): from 3.15 the 配图 plugin adds the selected 画风预设 to a picture that names none, so
// Tavern's asset pictures name an empty registered one and their prompt goes out as written, as before 3.15.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSET_PROMPT_PRESET, assetPromptPreset } from '../tavern-plugin/lib/image-asset-preset.js'
import { createAssetGeneration } from '../tavern-plugin/lib/domain/asset-generation.js'
import { composePluginImagePrompt } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-assembly.js'
import { withPromptPreset } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

const packages = fileURLToPath(new URL('../tavern-plugin/packages/', import.meta.url))
const running = folder => new Map([['dsh-tavern-image', { folder }]])

test('the plugin folder’s ./modules export registers 素材原样 once: the prompt goes out unchanged under the owner’s 动漫角色 preset', async () => {
  const preset = assetPromptPreset({ pluginsDir: packages, running: running('dsh-tavern-image-bundled') })
  assert.equal(await preset(), ASSET_PROMPT_PRESET)
  assert.equal(await preset(), ASSET_PROMPT_PRESET, 'a second call does not register again')
  const config = { imageBackend: 'openai', activeImageChannel: 'c', activePromptPreset: 'anime-character',
    imageChannels: [{ id: 'c', provider: 'openai', model: 'gpt-image-2', baseUrl: 'https://example.test/v1', options: {} }] }
  const channel = config.imageChannels[0], request = { channel, prompt: 'CHARACTER SHEET', usage: 'stage' }
  assert.match(composePluginImagePrompt(config, request).positive, /^CHARACTER SHEET\. Render the character as a polished hand-drawn anime/)
  const plain = composePluginImagePrompt(withPromptPreset(config, ASSET_PROMPT_PRESET), request)
  assert.deepEqual([plain.positive, plain.negative], ['CHARACTER SHEET', ''])
})

test('without the image plugin, or with one that has no ./modules export (3.12), no preset is named', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'asset-preset-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'old'))
  await writeFile(path.join(root, 'old', 'package.json'), JSON.stringify({ name: 'dsh-tavern-image', version: '3.12.6', exports: { '.': './lib/index.js' } }))
  assert.equal(await assetPromptPreset({ pluginsDir: root, running: new Map() })(), undefined)
  assert.equal(await assetPromptPreset({ pluginsDir: root, running: running('old') })(), undefined)
})

test('every asset picture names the preset; without one the request is unchanged', async t => {
  const store = { readJson: async () => undefined, updateJson: async () => {}, readBytes: async () => undefined, writeBytes: async () => {}, remove: async () => {} }
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), seen = []
  const provider = { status: async () => ({ ready: true, model: 'gpt-image-2', maxReferences: 2 }), generate: async input => { seen.push(input.promptPreset); return { data: png, mediaType: 'image/png' } } }
  for (const promptPreset of [async () => ASSET_PROMPT_PRESET, undefined]) {
    const service = createAssetGeneration({ store, getLibrary: () => null, ...(promptPreset ? { promptPreset } : {}) })
    t.after(() => service.dispose())
    await service.image({ prompt: 'cat', width: 1024, height: 1024, quality: 'low' }, provider)
  }
  assert.deepEqual(seen, [ASSET_PROMPT_PRESET, undefined])
})
