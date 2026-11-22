import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createImageCharacterHandlers } from '../tavern-plugin/lib/rpc/image-characters.js'
import { createFigurePictures } from '../tavern-plugin/lib/image-character-pictures.js'
import { appearanceFromImageCharacter, imageCharacterFromFigure } from '../tavern-plugin/lib/domain/image-character-appearance.js'
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

async function fixture(t, { deletes = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'image-characters-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const library = createAssetPackService({ assetRoot: join(root, 'packs') })
  let pack = (await library.createPack({ name: '测试包', expectedRevision: null })).snapshot
  const figure = { schemaVersion: 1, name: '杏子', aliases: ['Kyoko'], enabled: true, appearance: 'sprite', recall: { mode: 'keyword' }, identityAppearance: '红色马尾',
    outfits: [{ key: 'k-coat', label: '大衣', enabled: true, recall: { mode: 'keyword', keywords: ['大衣'] } }, { key: 'k-summer', label: '夏季私服', enabled: true, recall: { mode: 'keyword', keywords: ['私服'] }, outfitAppearance: '绿色帽衫' }] }
  pack = (await library.createFigure({ packId: pack.manifest.id, expectedRevision: pack.revision, figure })).snapshot
  const figureId = pack.manifest.figures[0].id ?? Object.keys(pack.figures)[0]
  const { api, service } = host(), images = imageLibrary()
  service.registerImageLibrary(deletes ? { ...images.registration, async deleteCharacter({ characterId, expected }) {
    const current = images.store.characters.find(c => c.id === characterId)
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw Object.assign(new Error('changed'), { code: 'REVISION_CONFLICT' })
    images.store.characters = images.store.characters.filter(c => c !== current); return { deleted: characterId } } } : images.registration)
  const handlers = createImageCharacterHandlers({ ctx: { get: name => name === 'assetLibrary' ? library : null }, pluginApi: api })
  return { library, pack, figureId, api, service, handlers, images, root }
}

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
  assert.deepEqual(f.images.store.images, [])
})

// ADR 0012: the pack is the one store of a figure's 设定图; 配图 asks the host for them by the record's link.
function pictureLibrary(figure) {
  const hash = letter => letter.repeat(64)
  const pack = { revision: 'r1', manifest: { blobs: Object.fromEntries(['a', 'b', 'c'].map(letter => [hash(letter), { mime: 'image/png', size: PNG.length, ext: 'png' }])) }, sprites: {}, figures: { figure } }
  const reads = []
  return { pack, reads, getPackSnapshot: async ({ packId }) => packId === 'pack' ? structuredClone(pack) : null,
    readMedia: async ({ hash: id, expectedRevision }) => { assert.equal(expectedRevision, 'r1'); reads.push(id); return { bytes: PNG, descriptor: { mime: 'image/png' } } } }
}

test('a figure\'s 设定图 are lent from the pack; a 设定图 the pack drops is gone from the next picture with nothing to sync', async () => {
  const figure = { id: 'figure', name: '总经理', identitySettei: { board: 'a'.repeat(64) }, outfits: [{ key: 'k', label: '西装', settei: 'b'.repeat(64) }, { key: 'm', label: '大衣' }] }
  const library = pictureLibrary(figure), pictures = createFigurePictures(() => library)
  const [row] = await pictures.list([{ packId: 'pack', figureId: 'figure' }, { packId: 'gone', figureId: 'figure' }])
  assert.deepEqual(row.identity, { id: 'a'.repeat(64), mediaType: 'image/png', byteLength: PNG.length, name: '总经理 人物设定图' })
  assert.deepEqual(row.outfits, { k: { picture: { id: 'b'.repeat(64), mediaType: 'image/png', byteLength: PNG.length, name: '总经理／西装 设定图' }, borrowed: false } })
  assert.deepEqual(await pictures.read({ packId: 'pack', figureId: 'figure', id: 'b'.repeat(64) }), { data: new Uint8Array(PNG), mediaType: 'image/png' })
  await assert.rejects(pictures.read({ packId: 'pack', figureId: 'figure', id: 'c'.repeat(64) }), { code: 'NOT_FOUND' }, 'only a picture the figure lends')
  // The 设定图 is unbound in the pack: the record holds no copy, so the next picture has none.
  delete library.pack.figures.figure.identitySettei
  delete library.pack.figures.figure.outfits[0].settei
  const [after] = await pictures.list([{ packId: 'pack', figureId: 'figure' }])
  assert.equal(after.identity, null)
  assert.deepEqual(after.outfits, {})
  await assert.rejects(pictures.read({ packId: 'pack', figureId: 'figure', id: 'a'.repeat(64) }), { code: 'NOT_FOUND' })
  assert.deepEqual(library.reads, ['b'.repeat(64)])
})
