import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createFigureRecords } from '../tavern-plugin/lib/image-character-records.js'
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

test('a record can be unlinked from its figure or deleted, both guarded by the snapshot', async t => {
  const { files, runtime, library } = await fixture(t, { definitions: { characters: [...definitions.characters, { id: 'd', name: '路人', traits: {}, outfits: [] }] } })
  const linked = (await library.patchCharacter({ characterId: 'c', expected: library.getCharacter({ characterId: 'c' }).character, patch: { figureId: 'figure', figurePackId: 'pack-a' } })).character
  await assert.rejects(library.patchCharacter({ characterId: 'c', expected: linked, patch: { figureId: null } }), { code: 'INVALID_ARGUMENT' })
  const unlinked = (await library.patchCharacter({ characterId: 'c', expected: linked, patch: { figureId: null, figurePackId: null } })).character
  assert.equal(Object.hasOwn(unlinked, 'figureId') || Object.hasOwn(unlinked, 'figurePackId'), false)
  assert.equal(unlinked.traits.face, '原来的外貌')
  assert.throws(() => library.getCharacter({ figureId: 'figure', figurePackId: 'pack-a' }), { code: 'NOT_FOUND' })
  await assert.rejects(library.deleteCharacter({ characterId: 'c', expected: linked }), { code: 'REVISION_CONFLICT' })
  assert.deepEqual(await library.deleteCharacter({ characterId: 'c', expected: unlinked }), { deleted: 'c' })
  await runtime.request('reload', {})
  assert.deepEqual((await files.read('definitions.json')).characters.map(c => c.id), ['d'])
  assert.throws(() => library.getCharacter({ characterId: 'c' }), { code: 'NOT_FOUND' })
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
  await assert.rejects(store.update(() => old, { failIfBusy: true }), { code: 'REVISION_CONFLICT' })
  const stale = store.update(() => old, { expectedRevision: old.revision, requireRevision: true })
  release()
  await first
  await assert.rejects(stale, { code: 'REVISION_CONFLICT' })
  assert.equal(current.characters[0].name, '新名字')
})

test('deleting linked records saves both packs together; a failed pack write leaves the records as they were', async t => {
  let failedPack, loseCommitMarker = false
  const root = await mkdtemp(join(tmpdir(), 'linked-figure-save-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const assetLibrary = createAssetPackService({ assetRoot: root, fault: async (phase, id) => {
    if (phase === 'batch-local-published' && id === failedPack) throw new Error('pack write failed')
    if (phase === 'batch-image-committed' && loseCommitMarker) throw new Error('lost commit marker')
  } })
  const seeds = []
  for (const name of ['杏子', '爱里']) {
    const pack = (await assetLibrary.createPack({ name, expectedRevision: null })).snapshot
    const figure = { schemaVersion: 1, name, aliases: ['Code Name', '隐藏词', 'actor_key'], appearance: 'avatar', outfits: [] }
    const saved = (await assetLibrary.createFigure({ packId: pack.manifest.id, expectedRevision: pack.revision, figure })).snapshot
    seeds.push({ packId: pack.manifest.id, figureId: saved.manifest.figures[0], name })
  }
  const records = createFigureRecords({ api: { imageCharacters: async () => assert.fail('no record writes here') } })
  const api = createTavernPluginApi({ cardScope: async () => new Map(), saveLinkedRecords: (changes, receipt, save) => records.saveLinked(assetLibrary, changes, receipt, save) })
  const tavern = Object.assign(Object.create(api.service), { ctx: { fiber: { name: 'dsh-tavern-image' }, effect: setup => setup() } })
  const files = await imagePluginFixture(t, { tavern, definitions: { characters: [...seeds.map((seed, i) => ({
    id: 'c' + i, name: seed.name, match: 'Code Name, 隐藏词', figurePackId: seed.packId, figureId: seed.figureId,
  })), { id: 'other', name: '别人' }] } })
  const runtime = await files.start()
  const current = (await runtime.request('state')).body.definitions
  const next = structuredClone(current)
  next.characters = next.characters.filter(character => !character.figureId)
  const figureOf = async seed => (await assetLibrary.getPackSnapshot({ packId: seed.packId })).figures[seed.figureId]

  failedPack = seeds[1].packId
  const failed = await runtime.request('definitions', { definitions: next })
  assert.equal(failed.status, 400)
  assert.equal(failed.body.code, 'FIGURE_EDIT_FAILED')
  assert.equal((await files.read('definitions.json')).characters.length, 3, 'the records stay')

  failedPack = undefined
  loseCommitMarker = true
  const saved = await runtime.request('definitions', { definitions: next })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal((await readdir(join(root, 'staging'))).length, 1, 'marker failure leaves the recovery journal')
  const unrelated = saved.body.state.definitions
  unrelated.characters[0].traits = { face: '短发' }
  assert.equal((await runtime.request('definitions', { definitions: unrelated })).status, 200)
  assert.equal((await readdir(join(root, 'staging'))).length, 1, 'regular image edits do not recover asset packs')
  for (const seed of seeds) assert.equal((await figureOf(seed)).name, seed.name)
  assert.deepEqual(await readdir(join(root, 'staging')), [], 'recovery keeps the committed identities and clears the journal')
  assert.deepEqual((await files.read('definitions.json')).characters.map(character => character.name), ['别人'])
})

test('the 人物库 page edits a figure\'s names in its record and a deleted record gives them back to the pack', async t => {
  const root = await mkdtemp(join(tmpdir(), 'figure-records-page-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let records
  const api = createTavernPluginApi({
    cardScope: async () => new Map(), runningUserPlugins: new Map([['dsh-tavern-image', { runtimeName: 'dsh-tavern-image', origin: 'global' }]]),
    saveLinkedRecords: (changes, receipt, save) => records.saveLinked(assetLibrary, changes, receipt, save),
  })
  records = createFigureRecords({ api })
  const assetLibrary = createAssetPackService({ assetRoot: join(root, 'asset-packs'), figureRecords: records })
  t.after(() => assetLibrary.dispose())
  const tavern = Object.assign(Object.create(api.service), { ctx: { fiber: { name: 'dsh-tavern-image' }, effect: setup => setup() } })
  const files = await imagePluginFixture(t, { tavern, definitions: { characters: [] } })
  const runtime = await files.start()
  for (let i = 0; i < 100 && !(await api.imageCharacterLibraries()).length; i++) await new Promise(resolve => setTimeout(resolve, 5))
  const pack = (await assetLibrary.createPack({ name: 'Pack', expectedRevision: null })).snapshot
  const figure = { schemaVersion: 1, name: 'Alice', aliases: ['Ally', 'wonder_key'], appearance: 'avatar', outfits: [{ key: 'core', label: 'Coat', enabled: true }] }
  const created = (await assetLibrary.createFigure({ packId: pack.manifest.id, expectedRevision: pack.revision, figure })).snapshot
  const figureId = created.manifest.figures[0], packId = pack.manifest.id
  const stored = async () => JSON.parse(await readFile(join(root, 'asset-packs', 'packs', packId, 'figures', figureId + '.json'), 'utf8'))
  const shown = async () => (await assetLibrary.getPackSnapshot({ packId })).figures[figureId]
  assert.equal((await stored()).name, undefined)
  assert.deepEqual((await files.read('definitions.json')).characters.map(item => [item.name, item.match, item.outfits.map(outfit => outfit.name)]), [['Alice', 'Ally', ['Coat']]])

  const next = structuredClone((await runtime.request('state')).body.definitions)
  next.characters[0].name = 'Alicia'
  next.characters[0].match = 'Ally, Lici'
  next.characters[0].outfits[0].name = 'Winter coat'
  const saved = await runtime.request('definitions', { definitions: next })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal((await shown()).name, 'Alicia')
  assert.deepEqual((await shown()).aliases, ['Ally', 'Lici', 'wonder_key'])
  assert.equal((await shown()).outfits[0].label, 'Winter coat')
  assert.equal((await stored()).name, undefined, 'the pack still keeps no copy')

  const removed = structuredClone(saved.body.state.definitions)
  removed.characters = []
  removed.outfits = removed.outfits || []
  const deleted = await runtime.request('definitions', { definitions: { ...removed, characters: [{ id: 'other', name: 'Bob', traits: {}, outfits: [] }] } })
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body))
  const whole = await stored()
  assert.equal(whole.name, 'Alicia', 'the figure takes its names back before its record goes')
  assert.equal(whole.outfits[0].label, 'Winter coat')
  assert.equal((await shown()).name, 'Alicia')
})
