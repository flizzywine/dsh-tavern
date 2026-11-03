import assert from 'node:assert/strict'
import test from 'node:test'
import { imageLibraryProvider, stageImageProvider } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-catalog.js'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

test('real plugin boot registers live catalogs and disposes registrations on unload', async t => {
  let library, provider, complete, disposed = 0
  const registered = new Promise(resolve => { complete = resolve })
  const fixture = await imagePluginFixture(t, { definitions: { characters: [{ id: 'a', name: 'A' }] }, tavern: {
    capabilities: { imageLibrary: 1 },
    attach() {}, promptSection() { return () => {} }, onTurnSettled() { return () => {} },
    imageProvider(value) { provider = value; return () => { disposed++ } },
    registerImageLibrary(value) { library = value; complete(); return () => { disposed++ } },
  } })
  const runtime = await fixture.start()
  await registered
  assert.equal(provider.models()[0].id, 'atlas')
  assert.equal(library.characters()[0].name, 'A')
  const saved = await runtime.request('definitions', { definitions: { characters: [{ id: 'a', name: '新版 A' }] } })
  assert.equal(saved.status, 200)
  assert.equal(library.characters()[0].name, '新版 A')
  runtime.close()
  assert.equal(disposed, 2)
})

test('configured models are discovered and selected without changing the active channel', async () => {
  const config = { imageBackend: 'comfyui', activeImageChannel: '', imageChannels: [
    { id: 'first', name: '模型一', provider: 'openai', model: 'm1', apiKey: 'secret', options: {} },
    { id: 'second', name: '模型二', provider: 'grok', model: 'm2', options: {} },
  ] }
  let seen
  const provider = stageImageProvider(() => config, async channel => { seen = channel; return { bytes: new Uint8Array([1]), mediaType: 'image/png' } })
  assert.equal(provider.status().ready, false)
  assert.deepEqual(provider.models().map(item => [item.id, item.model, item.maxReferences]), [['first', 'm1', 4], ['second', 'm2', 1]])
  assert.equal(JSON.stringify(provider.models()).includes('secret'), false)
  await provider.generate({ modelId: 'second', prompt: 'cat' })
  assert.equal(seen.id, 'second')
  seen.options.changed = true
  assert.deepEqual(config.imageChannels[1].options, {})
  assert.equal(config.imageBackend, 'comfyui')
  config.imageChannels.pop()
  await assert.rejects(provider.generate({ modelId: 'second' }), { requestMayHaveSucceeded: false })
})

test('library adapter respects card bindings, disabled characters and shared outfit references; reads live definitions', () => {
  let definitions = { characters: [
    { id: 'a', name: 'A', cards: ['cards/a.json'], traits: { face: 'eyes' }, outfits: [{ id: 'o', name: 'A常服' }], outfitRefs: ['shared'] },
    { id: 'b', name: 'B', outfits: [{ id: 'o', name: 'B常服' }] },
    { id: 'off', enabled: false, outfits: [{ id: 'o' }] },
  ], outfits: [{ id: 'shared', name: '制服' }, { id: 'other', name: '礼服' }] }
  const library = imageLibraryProvider(() => definitions)
  assert.deepEqual(library.characters().map(item => item.id), ['b'])
  const people = library.characters({ card: 'cards/a.json' })
  assert.equal(people.length, 2)
  const all = library.outfits({ card: 'cards/a.json' })
  assert.equal(new Set(all.map(item => item.id)).size, 4)
  const selected = library.outfits({ card: 'cards/a.json', characterId: 'a' })
  assert.deepEqual(selected.map(item => item.name), ['A常服', '制服'])
  assert.deepEqual(people[0].outfitIds, selected.map(item => item.id))
  assert.deepEqual(library.outfits({ card: 'cards/b.json', characterId: 'a' }), [])
  definitions = { characters: [{ id: 'new', name: '新版' }] }
  assert.equal(library.characters()[0].id, 'new')
})
