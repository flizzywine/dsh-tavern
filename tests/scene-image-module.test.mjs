import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm, cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createImageGenerationModule, IMAGE_MODULE_CONFIGURATION } from '../tavern-plugin/packages/dsh-image-gen/src/module.js'
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

test('testing default is on without generation; an explicitly saved off state survives restart', async t => {
  const f = await fixture(t)
  const initial = await f.setup.settings()
  assert.equal(initial.enabled, true)
  assert.equal(initial.ready, false)
  assert.equal(f.requests.length, 0)
  await f.setup.configure({ enabled: false })
  assert.equal((await f.create().setup.settings()).enabled, false)
  assert.equal(f.requests.length, 0)
})

test('testing rollout enables existing disabled configurations, independent of readiness', async t => {
  const f = await fixture(t)
  for (const version of [2, 3]) {
    await f.store.writeJson('scene-images/settings.json', { version, provider: 'grok', enabled: false, providers: {} })
    const settings = await f.setup.settings()
    assert.equal(settings.enabled, true)
    assert.equal(settings.ready, false)
    await f.setup.configure({ enabled: false })
    assert.equal((await f.create().setup.settings()).enabled, false)
    await f.setup.configure({ enabled: true })
    assert.equal((await f.create().setup.settings()).enabled, true)
  }
  assert.equal(f.requests.length, 0)
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

test('legacy Tavern-only config migrates on save without losing key or calling an API', async t => {
  const f = await fixture(t)
  f.keys.set('DSH_TAVERN_IMAGE_GROK_API_KEY', 'old-tavern-key')
  await f.store.writeJson('scene-images/settings.json', { version: 2, provider: 'grok', enabled: true,
    providers: { grok: { baseURL: 'https://gateway.example/v1', model: 'custom-model', size: '2k', aspectRatio: '16:9' } } })
  const ui = await f.setup.settings()
  assert.equal(ui.hasKey, true)
  assert.equal(ui.migrationPending, true)
  assert.equal(ui.enabled, true)
  assert.equal(ui.ready, false)
  assert.equal((await f.setup.config()).enabled, true)
  await assert.rejects(f.setup.capture(), /迁移/)
  await f.setup.configure({ model: ui.model })
  const next = await f.create().setup.capture()
  assert.equal(next.apiKey, 'old-tavern-key')
  assert.equal(next.active.baseURL, ui.baseURL)
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
