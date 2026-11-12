import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefinitionsStore } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/definitions-store.js'
import { createCharacterLibrary } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-library.js'
import { imagePluginFixture, IMAGE_PNG } from './fixtures/image-plugin-runtime.mjs'

const definitions = { characters: [{ id: 'c', name: '林月', traits: { face: '原来的外貌' }, outfits: [{ id: 'o', name: '白裙', upper: '白色衣裙' }] }] }

async function fixture(t, options = {}) {
  let library, ready
  const registered = new Promise(resolve => { ready = resolve })
  const files = await imagePluginFixture(t, { definitions, ...options, tavern: {
    capabilities: { imageLibrary: 1 }, attach() {}, promptSection() {}, onTurnSettled() {},
    registerImageLibrary(value) { library = value; ready(); return () => {} },
  } })
  const runtime = await files.start()
  await registered
  return { files, runtime, library }
}

test('a shared edit survives a stale full-page save; a current full save invalidates the old shared snapshot', async t => {
  const { files, runtime, library } = await fixture(t)
  const old = (await runtime.request('state')).body.definitions
  const before = library.getCharacter({ characterId: 'c' }).character
  const edited = await library.patchCharacter({ characterId: 'c', expected: before, patch: { traits: { face: '素材库改过的外貌' } } })
  old.characters[0].name = '旧页面改名'
  const stale = await runtime.request('definitions', { definitions: old })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'REVISION_CONFLICT')
  assert.equal((await files.read('definitions.json')).characters[0].traits.face, '素材库改过的外貌')
  assert.equal(library.getCharacter({ characterId: 'c' }).character.name, '林月')
  const current = (await runtime.request('state')).body.definitions
  current.characters[0].name = '新名字'
  assert.equal((await runtime.request('definitions', { definitions: current })).body.ok, true)
  await assert.rejects(library.patchCharacter({ characterId: 'c', expected: edited.character, patch: { match: '过期别名' } }), { code: 'REVISION_CONFLICT' })
  // An old client without a revision must reload instead of bypassing conflict protection.
  assert.equal((await runtime.request('definitions', { definitions: { ...current, revision: null } })).status, 409)
  await runtime.request('reload', {})
  assert.equal(library.getCharacter({ characterId: 'c' }).character.name, '新名字')
})

test('simultaneous edits use one gate and preserve fields outside the shared subset', async t => {
  const { runtime, library } = await fixture(t, { definitions: { characters: [{ ...definitions.characters[0], cards: ['cards/a.json'], inject: { special: 'keep' } }] } })
  const expected = library.getCharacter({ characterId: 'c' }).character
  const edits = await Promise.allSettled([
    library.patchCharacter({ characterId: 'c', expected, patch: { traits: { bodySFW: '纤细' } } }),
    library.patchCharacter({ characterId: 'c', expected, patch: { match: '不能覆盖' } }),
  ])
  assert.deepEqual(edits.map(result => result.status), ['fulfilled', 'rejected'])
  assert.equal(edits[1].reason.code, 'REVISION_CONFLICT')
  const value = (await runtime.request('state')).body.definitions.characters[0]
  assert.deepEqual(value.cards, ['cards/a.json'])
  assert.deepEqual(value.inject, { special: 'keep' })
  assert.equal(value.traits.face, '原来的外貌')
  assert.equal(value.traits.bodySFW, '纤细')
})

test('reference images and pack-scoped figure associations persist in the real plugin', async t => {
  const { files, runtime, library } = await fixture(t)
  const image = await library.putReferenceImage({ data: IMAGE_PNG, mediaType: 'image/png', name: '白裙设定图' })
  const expected = library.getCharacter({ characterId: 'c' }).character
  const next = await library.patchCharacter({ characterId: 'c', expected, patch: { figureId: 'figure', figurePackId: 'pack-a', outfits: [{ id: 'o', characterOutfitImage: image }] } })
  assert.equal(next.character.outfits[0].upper, '白色衣裙')
  await runtime.request('reload', {})
  assert.equal(library.getCharacter({ figureId: 'figure', figurePackId: 'pack-a' }).character.outfits[0].characterOutfitImage.id, image.id)
  const read = await library.readReferenceImage({ referenceImage: library.getCharacter({ characterId: 'c' }).character.outfits[0].characterOutfitImage })
  assert.equal(read.mediaType, 'image/png')
  assert.deepEqual(read.data, new Uint8Array(IMAGE_PNG))
  await assert.rejects(library.readReferenceImage({ referenceImage: { id: 'x' } }))
  assert.throws(() => library.getCharacter({ figureId: 'figure', figurePackId: 'pack-b' }), { code: 'NOT_FOUND' })
  assert.throws(() => library.getCharacter({ figureId: 'figure', characterId: 'c', figurePackId: 'pack-a' }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(library.patchCharacter({ characterId: 'c', expected: next.character, patch: { cards: [] } }), { code: 'INVALID_ARGUMENT' })
  assert.equal((await files.read('definitions.json')).version, 4)
})

test('failed and refused writes leave memory untouched and do not poison the next write', async () => {
  let current, failure = 'throw'
  const store = createDefinitionsStore({ initial: definitions, onCommit: value => { current = value },
    persist: async () => { if (failure === 'throw') throw new Error('disk full'); return failure !== 'refuse' } })
  const library = createCharacterLibrary({ getDefinitions: () => current, updateDefinitions: change => store.update(change), normalizeCharacter: value => value, traitKeys: ['face'] })
  const expected = library.getCharacter({ characterId: 'c' }).character
  const patch = { outfits: [{ id: 'o', upper: '不得留在内存' }] }
  await assert.rejects(library.patchCharacter({ characterId: 'c', expected, patch }), /disk full/)
  assert.deepEqual(library.getCharacter({ characterId: 'c' }).character, expected)
  failure = 'refuse'
  await assert.rejects(library.patchCharacter({ characterId: 'c', expected, patch }), { code: 'SAVE_REFUSED' })
  assert.deepEqual(library.getCharacter({ characterId: 'c' }).character, expected)
  failure = ''
  await library.patchCharacter({ characterId: 'c', expected, patch })
  assert.equal(current.characters[0].outfits[0].upper, patch.outfits[0].upper)
})

test('full-editor writes and shared writes stay serialized across a slow disk publication', async () => {
  let current, release, started
  const writing = new Promise(resolve => { started = resolve })
  const disk = new Promise(resolve => { release = resolve })
  let count = 0
  const store = createDefinitionsStore({ initial: definitions, onCommit: value => { current = value }, persist: async () => { if (++count === 1) { started(); await disk } } })
  const old = structuredClone(current)
  const first = store.update(value => ({ ...value, characters: [{ ...value.characters[0], name: '新名字' }] }))
  await writing
  assert.equal(current.characters[0].name, '林月')
  const stale = store.update(() => old, { expectedRevision: old.revision, requireRevision: true })
  release()
  await first
  await assert.rejects(stale, { code: 'REVISION_CONFLICT' })
  assert.equal(current.characters[0].name, '新名字')
})
