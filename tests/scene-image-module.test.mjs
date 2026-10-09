import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm, cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createImageGenerationModule, IMAGE_MODULE_CONFIGURATION } from '../tavern-plugin/packages/dsh-image-gen/src/module.js'
import { createSceneImageHostLogger } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { legacyImageConfigurationReader } from '../tavern-plugin/lib/domain/image-generation-host.js'
import { createModuleSceneImageSettings } from '../tavern-plugin/lib/domain/scene-image-module-settings.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0l8AAAAASUVORK5CYII=', 'base64')
test('clean runtime imports module without node_modules, Cordis or plugin registration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'image-module-clean-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  const source = new URL('../tavern-plugin/packages/dsh-image-gen/src/', import.meta.url)
  for (const file of ['module.js', 'configuration.js', 'tavern']) await cp(new URL(file, source), join(root, 'src', file), { recursive: true })
  const { createImageGenerationModule: create } = await import(pathToFileURL(join(root, 'src/module.js')))
  const module = create({ store: { readJson: async () => undefined }, credentials: () => ({ resolve: async () => undefined }) })
  assert.equal((await module.inspect('grok')).provider, 'grok')
  assert.equal(module.serial, undefined)
})
async function fixture(t, legacy = {}) {
  const root = await mkdtemp(join(tmpdir(), 'image-module-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root }), keys = new Map(), requests = []
  const credentials = () => ({ resolve: async ref => keys.has(ref) ? { value: keys.get(ref) } : undefined,
    set: async (ref, key) => { keys.set(ref, key) } })
  const oldFile = join(root, 'settings.yaml')
  await writeFile(oldFile, JSON.stringify({ 'image-generation': legacy, unrelated: { preserve: true } }))
  const create = () => {
    const imageModule = createImageGenerationModule({ store, credentials,
      readLegacyConfiguration: legacyImageConfigurationReader(oldFile),
      fetchImpl: async (url, init) => { requests.push({ url, init }); return Response.json({ data: [{ b64_json: png.toString('base64') }] }) } })
    return { imageModule, setup: createModuleSceneImageSettings({ store, credentials, imageModule }) }
  }
  return { ...create(), create, store, keys, requests, oldFile }
}

test('Tavern image module forwards read-only connection diagnostics to the Host logger', async () => {
  const lines = [], requests = []
  const logger = { info: (_format, text) => lines.push(text), warn: (_format, text) => lines.push(text) }
  const imageModule = createImageGenerationModule({
    store: { readJson: async () => ({}), updateJson: () => assert.fail('test must not save') },
    credentials: () => ({ resolve: async () => ({ value: 'private-key' }) }),
    onDiagnostic: createSceneImageHostLogger(logger),
    fetchImpl: async (url, init) => { requests.push({ url, method: init.method }); return new Response(null, { status: 403 }) }
  })
  const result = await imageModule.test({ provider: 'novelai' })
  assert.equal(result.status, 'auth_failed')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'HEAD')
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0])
  assert.equal(entry.component, 'dsh-tavern.scene-image')
  assert.equal(entry.httpStatus, 403)
  assert.equal(entry.runtime.platform, process.platform)
  assert.doesNotMatch(lines[0], /private-key/)
})

test('no plugin registration: config, credentials, generate bytes; Tavern alone owns image saving', async t => {
  const f = await fixture(t)
  await f.setup.configure({ provider: 'grok', apiKey: 'fake-key' })
  await f.setup.configure({ enabled: true })
  const ui = await f.setup.settings()
  assert.equal(ui.channels.length, 9)
  assert.ok(!ui.channels.some(channel => channel.id === 'dsh-image-gen'))
  const { active, apiKey } = await f.setup.capture()
  const result = await f.imageModule.generate({ ...active, apiKey, prompt: 'A lake', signal: new AbortController().signal })
  assert.deepEqual(result.data, png)
  assert.equal(result.attachment, undefined)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, 'https://api.x.ai/v1/images/generations')
  assert.equal(f.requests[0].init.headers.authorization, 'Bearer fake-key')
  assert.equal((await f.create().setup.settings()).enabled, true)
  assert.ok(!JSON.stringify(await f.store.readJson(IMAGE_MODULE_CONFIGURATION)).includes('fake-key'))
})

test('plugin settings and original credential references survive migration and later restarts', async t => {
  const f = await fixture(t, { provider: 'grok', grokBaseURL: 'https://old.example/v1', grokModel: 'old-model',
    tavernChannels: JSON.stringify({ grok: { size: '2k', aspectRatio: '16:9' } }), apiKey: 'never-copy-this' })
  f.keys.set('XAI_API_KEY', 'legacy-key')
  await f.store.writeJson('scene-images/settings.json', { version: 3, provider: 'grok', enabled: true, providers: {} })
  const original = await readFile(f.oldFile, 'utf8')
  const ui = await f.setup.settings()
  assert.equal(ui.enabled, true)
  assert.equal(ui.hasKey, true)
  assert.equal(ui.model, 'old-model')
  assert.equal(ui.size, '2k')
  assert.equal(await f.store.readJson(IMAGE_MODULE_CONFIGURATION), undefined, 'view is read-only')
  await f.setup.configure({ model: 'new-model' })
  assert.equal(await readFile(f.oldFile, 'utf8'), original)
  await writeFile(f.oldFile, 'invalid: [')
  const next = await f.create().setup.capture()
  assert.equal(next.active.model, 'new-model')
  assert.equal(next.active.baseURL, 'https://old.example/v1')
  assert.equal(next.apiKey, 'legacy-key')
  assert.ok(!JSON.stringify(await f.store.readJson(IMAGE_MODULE_CONFIGURATION)).includes('never-copy-this'))
  assert.equal(f.requests.length, 0)
})

test('failed migration write preserves original config and does not change credentials', async t => {
  const f = await fixture(t, { provider: 'grok', grokModel: 'old-model' })
  f.keys.set('XAI_API_KEY', 'old-key')
  const imageModule = createImageGenerationModule({ store: { ...f.store, updateJson: async () => { throw new Error('disk full') } },
    credentials: () => ({ resolve: async () => ({ value: 'old-key' }), set: async () => assert.fail('must not write key') }),
    readLegacyConfiguration: legacyImageConfigurationReader(f.oldFile) })
  await assert.rejects(imageModule.configure({ provider: 'grok', model: 'new-model', apiKey: 'new-key' }), /disk full/)
  assert.equal((await f.imageModule.inspect('grok')).model, 'old-model')
  assert.equal(await f.store.readJson(IMAGE_MODULE_CONFIGURATION), undefined)
})

test('NovelAI prompt controls persist through settings and restarts', async t => {
  const f = await fixture(t)
  const controls = { qualityTags: 'masterpiece', sectionWeights: '1.5,1,1,1', seed: '42', qualityPreset: 'standard', ucPreset: 'light',
    sampler: 'k_dpmpp_2m', noiseSchedule: 'exponential', cfgRescale: '0.2', varietyBoost: 'true', activeArtist: 'a' }
  const artists = [{ id: 'a', name: '水彩', prompt: 'artist:wlop', quality: '', negative: '', preview: '' }]
  await f.setup.configure({ provider: 'novelai', apiKey: 'nai-key', model: 'nai-diffusion-4-5-full', size: '832x1216', ...controls, artists })
  const ui = await f.create().setup.settings()
  for (const [field, value] of Object.entries(controls)) assert.equal(ui[field], value, field)
  assert.deepEqual(ui.artists, artists)
  const { active } = await f.create().setup.capture()
  for (const [field, value] of Object.entries(controls)) assert.equal(active[field], value, field)
  await assert.rejects(f.setup.configure({ sectionWeights: '0' }), /正数/)
})

test('NovelAI endpoints keep separate keys; switching sends only the selected endpoint key to its own address', async t => {
  const f = await fixture(t)
  const official = { id: 'default', name: '官方', baseURL: 'https://image.novelai.net' }
  await f.setup.configure({ provider: 'novelai', apiKey: 'official-key', model: 'nai-diffusion-4-5-full', size: '832x1216', endpoint: 'default', endpoints: [official] })
  const relay = { id: 'relay1', name: '自定义渠道', baseURL: 'https://relay.example' }
  // A new endpoint needs its own key; the official key is never reused for it.
  let ui = await f.setup.configure({ provider: 'novelai', endpoint: 'relay1', baseURL: relay.baseURL, endpoints: [official, relay] })
  assert.equal(ui.hasKey, false)
  ui = await f.setup.configure({ provider: 'novelai', endpoint: 'relay1', baseURL: relay.baseURL, endpoints: [official, relay], apiKey: 'relay-key' })
  assert.equal(ui.endpoint, 'relay1')
  assert.deepEqual(ui.endpoints.map(entry => [entry.id, entry.baseURL, entry.hasKey]), [['default', 'https://image.novelai.net', true], ['relay1', 'https://relay.example', true]])
  let snapshot = await f.create().setup.capture()
  assert.equal(snapshot.active.baseURL, 'https://relay.example')
  assert.equal(snapshot.apiKey, 'relay-key')
  // Switching back restores the official address and key without retyping it.
  ui = await f.setup.configure({ provider: 'novelai', endpoint: 'default', baseURL: official.baseURL, endpoints: ui.endpoints })
  snapshot = await f.create().setup.capture()
  assert.equal(snapshot.active.baseURL, 'https://image.novelai.net')
  assert.equal(snapshot.apiKey, 'official-key')
  // A connection test of the inactive relay uses the relay's own key and address.
  f.requests.length = 0
  await f.setup.testConnection({ provider: 'novelai', endpoint: 'relay1', baseURL: relay.baseURL }).catch(() => {})
  assert.ok(f.requests.length > 0)
  for (const request of f.requests) {
    assert.equal(new URL(request.url).origin, 'https://relay.example')
    assert.equal(request.init.headers.authorization, 'Bearer relay-key')
  }
  // Editing an endpoint's address still requires its key again.
  await assert.rejects(f.setup.configure({ provider: 'novelai', endpoint: 'relay1', baseURL: 'https://other.example', endpoints: ui.endpoints }), /重新填写 API Key/)
})

test('older single-endpoint NovelAI settings read as one default endpoint with the original key', async t => {
  const f = await fixture(t)
  await f.setup.configure({ provider: 'novelai', apiKey: 'nai-key', model: 'nai-diffusion-4-5-full', size: '832x1216' })
  const ui = await f.create().setup.settings()
  assert.equal(ui.endpoint, 'default')
  assert.deepEqual(ui.endpoints, [{ id: 'default', name: '默认', baseURL: 'https://image.novelai.net', protocol: 'native', hasKey: true }])
  assert.ok(f.keys.has('DSH_TAVERN_IMAGE_NOVELAI_API_KEY'))
})

test('NovelAI artist previews are stored beside the settings, versioned, replaced and removed with their entry', async t => {
  const f = await fixture(t)
  const base = { provider: 'novelai', apiKey: 'nai-key', model: 'nai-diffusion-4-5-full', size: '832x1216' }
  let ui = await f.setup.configure({ ...base, artists: [{ id: 'a', name: '水彩', prompt: 'artist:wlop', previewData: 'data:image/png;base64,' + png.toString('base64') }, { id: 'b', name: '无图', prompt: 'x' }] })
  const first = ui.artists[0].preview
  assert.match(first, /^[a-f0-9]{12}$/)
  assert.equal(ui.artists[1].preview, '')
  assert.ok(!JSON.stringify(await f.store.readJson(IMAGE_MODULE_CONFIGURATION)).includes(png.toString('base64')), 'image bytes stay out of the settings file')
  assert.deepEqual((await f.create().setup.readArtistPreview('a')).data, png)
  // Saving again without new data keeps the image and its revision.
  ui = await f.setup.configure({ ...base, apiKey: undefined, artists: ui.artists })
  assert.equal(ui.artists[0].preview, first)
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16])
  ui = await f.setup.configure({ ...base, apiKey: undefined, artists: [{ ...ui.artists[0], previewData: jpeg.toString('base64') }, ui.artists[1]] })
  assert.notEqual(ui.artists[0].preview, first)
  assert.equal((await f.setup.readArtistPreview('a')).mediaType, 'image/jpeg')
  await assert.rejects(f.setup.configure({ ...base, apiKey: undefined, artists: [{ ...ui.artists[0], previewData: Buffer.from('<svg/>').toString('base64') }] }), /预览图/)
  // Removing the entry removes its image.
  await f.setup.configure({ ...base, apiKey: undefined, artists: [ui.artists[1]] })
  await assert.rejects(f.setup.readArtistPreview('a'), /不存在/)
  await assert.rejects(f.setup.readArtistPreview('../x'), /不存在/)
})
