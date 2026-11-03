import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createImageCharacterHandlers } from '../tavern-plugin/lib/rpc/image-characters.js'
import { appearanceFromImageCharacter, imageCharacterFromFigure } from '../tavern-plugin/lib/domain/image-character-appearance.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createAssetGeneration } from '../tavern-plugin/lib/domain/asset-generation.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')

// A 配图-like library: one store of records, CAS by the snapshot read, as the bundled plugin's character-library.js.
function imageLibrary() {
  const store = { characters: [{ id: 'c-7', name: '旧名', match: '', traits: { face: '已有的脸' }, outfits: [{ id: 'k-coat', name: '大衣', upper: '灰大衣' }] }], images: [] }
  const fail = (code, message) => Object.assign(new Error(message), { code })
  const find = ({ characterId, figureId }) => store.characters.find(c => characterId ? c.id === characterId : c.figureId === figureId) || (() => { throw fail('NOT_FOUND', 'none') })()
  const merge = (c, patch) => ({ ...c, ...patch, traits: { ...c.traits, ...patch.traits },
    outfits: patch.outfits ? [...c.outfits.map(o => ({ ...o, ...patch.outfits.find(p => p.id === o.id) })), ...patch.outfits.filter(p => !c.outfits.some(o => o.id === p.id))] : c.outfits })
  return { store, registration: {
    id: 'definitions', label: '配图人物与服装', schemaVersion: 4,
    characters: () => store.characters.map(c => ({ id: c.id, name: c.name })),
    getCharacter: input => ({ version: 4, character: structuredClone(find(input)) }),
    async patchCharacter({ characterId, expected, patch }) {
      const current = find({ characterId })
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw fail('REVISION_CONFLICT', 'changed')
      const next = merge(current, patch); store.characters = store.characters.map(c => c === current ? next : c)
      return { version: 4, character: structuredClone(next) }
    },
    async createCharacter({ character }) {
      const next = merge({ id: 'c-' + (store.characters.length + 1), traits: {}, outfits: [] }, character); store.characters.push(next)
      return { version: 4, character: structuredClone(next) }
    },
    async putReferenceImage({ data, mediaType, name }) { store.images.push({ bytes: data.length, mediaType, name }); return { id: 'f'.repeat(64), mediaType, name, byteLength: data.length } },
  } }
}

function host() {
  const api = createTavernPluginApi({ logger: { warn() {} }, cardScope: async () => new Map() })
  const service = Object.create(api.service)
  service.ctx = { fiber: { name: 'dsh-tavern-image' }, effect(setup) { return setup() } }
  return { api, service }
}

test('the host reaches 人物库 records only through a library that registered schema 4', async () => {
  const { api, service } = host()
  await assert.rejects(api.imageCharacters('getCharacter', { characterId: 'c-7' }), { code: 'NOT_CONFIGURED' })
  // a read-only library (the 31e4fb4a1 shape) still registers, but offers no records
  service.registerImageLibrary({ id: 'read-only', label: '只读', characters: () => [] })
  await assert.rejects(api.imageCharacters('getCharacter', { characterId: 'c-7' }), { code: 'NOT_CONFIGURED' })
  assert.throws(() => service.registerImageLibrary({ id: 'half', label: '半套', characters: () => [], schemaVersion: 4, getCharacter() {} }), TypeError)
  const library = imageLibrary(), off = service.registerImageLibrary(library.registration)
  const read = await api.imageCharacters('getCharacter', { characterId: 'c-7' })
  assert.equal(read.providerId, 'dsh-tavern-image/definitions')
  assert.equal(read.character.traits.face, '已有的脸')
  // the library's own errors reach the caller unchanged
  await assert.rejects(api.imageCharacters('patchCharacter', { characterId: 'c-7', expected: { id: 'c-7' }, patch: {} }), { code: 'REVISION_CONFLICT' })
  off()
  await assert.rejects(api.imageCharacters('getCharacter', { characterId: 'c-7' }), { code: 'NOT_CONFIGURED' })
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'image-characters-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const library = createAssetPackService({ assetRoot: join(root, 'packs') })
  let pack = (await library.createPack({ name: '测试包', expectedRevision: null })).snapshot
  const figure = { schemaVersion: 1, name: '杏子', aliases: ['Kyoko'], enabled: true, appearance: 'sprite', recall: { mode: 'keyword' }, identityAppearance: '红色马尾',
    outfits: [{ key: 'k-coat', label: '大衣', enabled: true, recall: { mode: 'keyword', keywords: ['大衣'] } }, { key: 'k-summer', label: '夏季私服', enabled: true, recall: { mode: 'keyword', keywords: ['私服'] }, outfitAppearance: '绿色帽衫' }] }
  pack = (await library.createFigure({ packId: pack.manifest.id, expectedRevision: pack.revision, figure })).snapshot
  const figureId = pack.manifest.figures[0].id ?? Object.keys(pack.figures)[0]
  const { api, service } = host(), images = imageLibrary()
  service.registerImageLibrary(images.registration)
  const handlers = createImageCharacterHandlers({ ctx: { get: name => name === 'assetLibrary' ? library : null }, pluginApi: api })
  return { library, pack, figureId, api, handlers, images, root }
}

test('a figure links to a new 人物库 record seeded from its names and text, then edits it in place', async t => {
  const f = await fixture(t)
  const before = await f.handlers.getFigureImageCharacter({ figureId: f.figureId })
  assert.equal(before.status, 'unlinked')
  assert.deepEqual(before.candidates.map(c => c.name), ['旧名'])
  const linked = await f.handlers.linkFigureImageCharacter({ packId: f.pack.manifest.id, figureId: f.figureId })
  assert.equal(linked.character.figureId, f.figureId)
  assert.equal(linked.character.match, 'Kyoko')
  assert.equal(linked.character.traits.face, '红色马尾')
  assert.deepEqual(linked.character.outfits.map(o => [o.id, o.name, o.upper || '']), [['k-coat', '大衣', ''], ['k-summer', '夏季私服', '绿色帽衫']])
  const edited = await f.handlers.patchImageCharacter({ characterId: linked.character.id, expected: linked.character, patch: { traits: { lowerSFW: '短裤' } } })
  assert.equal(f.images.store.characters.find(c => c.figureId === f.figureId).traits.lowerSFW, '短裤')
  assert.equal((await f.handlers.getFigureImageCharacter({ figureId: f.figureId })).character.traits.lowerSFW, edited.character.traits.lowerSFW)
  // the pack itself is not written: the 人物库 is the one store
  assert.equal((await f.library.getPackSnapshot({ packId: f.pack.manifest.id })).revision, f.pack.revision)
})

test('linking an existing record keeps its own text and adds only what it lacks', async t => {
  const f = await fixture(t)
  const linked = await f.handlers.linkFigureImageCharacter({ packId: f.pack.manifest.id, figureId: f.figureId, characterId: 'c-7' })
  assert.equal(linked.character.figureId, f.figureId)
  assert.equal(linked.character.traits.face, '已有的脸')
  assert.deepEqual(linked.character.outfits.map(o => [o.id, o.upper || '']), [['k-coat', '灰大衣'], ['k-summer', '绿色帽衫']])
})

test('asset generation draws a linked figure\'s 外貌 from the 人物库 record', async t => {
  const f = await fixture(t)
  const { character } = await f.handlers.linkFigureImageCharacter({ packId: f.pack.manifest.id, figureId: f.figureId })
  await f.handlers.patchImageCharacter({ characterId: character.id, expected: character, patch: { traits: { face: '人物库里的红发', bodySFW: '纤细' } } })
  const store = createProfileDataStore({ dataRoot: join(f.root, 'data') })
  const generation = createAssetGeneration({ store, getLibrary: () => f.library,
    linkedAppearance: async ({ figureId, outfitKey }) => appearanceFromImageCharacter((await f.api.imageCharacters('getCharacter', { figureId })).character, outfitKey) })
  const preview = await generation.prepare({ target: { packId: f.pack.manifest.id, figureId: f.figureId, outfitKey: 'k-summer', kind: 'settei' }, expectedRevision: f.pack.revision, preview: true })
  const text = JSON.stringify(preview)
  assert.match(text, /人物库里的红发；纤细/)
  assert.match(text, /绿色帽衫/)
  assert.doesNotMatch(text, /红色马尾/)
})

test('the record seed and the generation text use the fixed schema keys', () => {
  assert.deepEqual(appearanceFromImageCharacter({ traits: { face: 'a', faceBack: 'x', bodySFW: 'b', lowerSFW: 'c', bodyNSFW: 'y' }, outfits: [{ id: 'k', upper: 'u', shoes: 's', back: 'z' }] }, 'k'),
    { identityAppearance: 'a；b；c', outfitAppearance: 'u；s' })
  assert.deepEqual(imageCharacterFromFigure({ id: 'f', name: 'n', outfits: [] }), { name: 'n', match: '', figureId: 'f', outfits: [] })
})
