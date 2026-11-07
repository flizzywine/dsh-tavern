import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createImageCharacterHandlers } from '../tavern-plugin/lib/rpc/image-characters.js'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')

// A 配图-like library: one store of records, CAS by the snapshot read, as the bundled plugin's character-library.js.
function imageLibrary() {
  const store = { characters: [{ id: 'c-7', name: '旧名', match: '', traits: { face: '已有的脸' }, outfits: [{ id: 'k-coat', name: '大衣', upper: '灰大衣' }] }], images: [] }
  const fail = (code, message) => Object.assign(new Error(message), { code })
  const find = ({ characterId, figureId, figurePackId }) => store.characters.find(c => characterId ? c.id === characterId : c.figureId === figureId && c.figurePackId === figurePackId) || (() => { throw fail('NOT_FOUND', 'none') })()
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
  // The bundled image plugin is a trusted global runtime identity.
  const runningUserPlugins = new Map([['dsh-tavern-image', { runtimeName: 'dsh-tavern-image', origin: 'global' }]])
  const api = createTavernPluginApi({ logger: { warn() {} }, cardScope: async () => new Map(), runningUserPlugins })
  const service = Object.create(api.service)
  service.ctx = { fiber: { name: 'dsh-tavern-image' }, effect(setup) { return setup() } }
  return { api, service }
}

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
  return { library, pack, figureId, api, service, handlers, images, root }
}

test('identical record IDs in separate libraries require explicit source selection', async t => {
  const f = await fixture(t), other = imageLibrary()
  other.registration.id = 'other'
  other.registration.label = '另一个人物库'
  f.service.registerImageLibrary(other.registration)
  const target = { packId: f.pack.manifest.id, figureId: f.figureId }
  const read = await f.handlers.getFigureImageCharacter(target)
  assert.equal(read.libraries.length, 2)
  assert.deepEqual(read.candidates.map(c => c.providerId), ['dsh-tavern-image/definitions', 'dsh-tavern-image/other'])
  await assert.rejects(f.handlers.linkFigureImageCharacter(target), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(f.handlers.linkFigureImageCharacter({ ...target, characterId: 'c-7' }), { code: 'INVALID_ARGUMENT' })
  const selected = await f.handlers.linkFigureImageCharacter({ ...target, providerId: 'dsh-tavern-image/other', characterId: 'c-7' })
  assert.equal(selected.providerId, 'dsh-tavern-image/other')
  assert.equal(f.images.store.characters[0].figureId, undefined)
  assert.equal((await f.handlers.getFigureImageCharacter(target)).providerId, selected.providerId)
  const edited = await f.handlers.patchImageCharacter({ ...target, providerId: selected.providerId, characterId: selected.character.id, expected: selected.character, patch: { traits: { face: '只改所选库' } } })
  assert.equal(edited.character.traits.face, '只改所选库')
  assert.equal(f.images.store.characters[0].traits.face, '已有的脸')
})

test('wrong figure, missing pack and stale associations cannot change a character or store reference bytes', async t => {
  const f = await fixture(t)
  const target = { packId: f.pack.manifest.id, figureId: f.figureId }
  const linked = await f.handlers.linkFigureImageCharacter(target)
  const args = { ...target, providerId: linked.providerId, characterId: linked.character.id, expected: linked.character }
  await assert.rejects(f.handlers.getFigureImageCharacter({ figureId: f.figureId }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(f.handlers.patchImageCharacter({ ...args, figureId: 'gone', patch: { name: 'wrong' } }), { code: 'NOT_FOUND' })
  await assert.rejects(f.handlers.patchImageCharacter({ ...args, patch: { figureId: 'different' } }), { code: 'INVALID_ARGUMENT' })
  f.images.store.characters.find(c => c.id === linked.character.id).figurePackId = 'other-pack'
  await assert.rejects(f.handlers.patchImageCharacter({ ...args, patch: { name: 'wrong' } }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(f.handlers.copyFigureSetteiToImageCharacter(args), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(f.images.store.images, [])
})

test('copied figure UUIDs in distinct packs do not share an appearance record', async t => {
  const f = await fixture(t)
  await f.handlers.linkFigureImageCharacter({ packId: f.pack.manifest.id, figureId: f.figureId })
  const { findFigureImageCharacter } = await import('../tavern-plugin/lib/domain/image-character-appearance.js')
  const other = await findFigureImageCharacter(f.api, { packId: 'different-pack', figureId: f.figureId })
  assert.equal(other.status, 'unlinked')
})

test('character and outfit sheets go to their own reference slots and stale copies are rejected before reading media', async () => {
  const { api, service } = host(), images = imageLibrary()
  const figure = { id: 'figure', name: '林月', identitySettei: { board: 'identity' }, outfits: [{ key: 'k', label: '白裙', settei: 'paired' }] }
  const character = { ...images.store.characters[0], figureId: 'figure', figurePackId: 'pack' }
  images.store.characters = [character]
  service.registerImageLibrary(images.registration)
  let reads = 0
  const library = { getPackSnapshot: async () => ({ revision: 'r1', figures: { figure } }), readMedia: async ({hash, expectedRevision}) => {
    assert.equal(expectedRevision, 'r1'); assert.ok(['identity', 'paired'].includes(hash)); reads++
    return { bytes: PNG, descriptor: { mime: 'image/png' } }
  } }
  const handlers = createImageCharacterHandlers({ ctx: { get: () => library }, pluginApi: api })
  const args = { packId: 'pack', figureId: 'figure', providerId: 'dsh-tavern-image/definitions', characterId: character.id }
  const own = await handlers.copyFigureSetteiToImageCharacter({ ...args, expected: structuredClone(character) })
  assert.ok(own.character.referenceImage)
  const paired = await handlers.copyFigureSetteiToImageCharacter({ ...args, expected: own.character, outfitKey: 'k' })
  assert.ok(paired.character.outfits.find(o => o.id === 'k').characterOutfitImage)
  assert.ok(paired.character.referenceImage)
  await assert.rejects(handlers.copyFigureSetteiToImageCharacter({ ...args, expected: own.character }), { code: 'REVISION_CONFLICT' })
  assert.equal(reads, 2)
  assert.equal(images.store.images.length, 2)
})
