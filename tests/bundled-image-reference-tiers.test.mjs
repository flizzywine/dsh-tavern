import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  resolveImageReferences, buildReferenceText, buildStructuredReferenceText, referencePlannerGuidance, referenceScopedDefinitions,
} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/reference-images.js'
import { createCharacterLibrary, CHARACTER_LIBRARY_VERSION } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-library.js'
import { imageLibraryProvider } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-catalog.js'

const image = name => ({ id: createHash('sha256').update(name).digest('hex'), mediaType: 'image/png', name, byteLength: 10 })
// ids differ from names and aliases on purpose
function library() {
  return { characters: [
    { id: 'c-01', name: '杏子', match: '佐仓杏子, 杏', referenceImage: image('杏子设定'), consistencyText: '红色马尾', traits: { face: 'red ponytail' }, outfits: [
      { id: 'o-summer', name: '夏季私服', upper: 'hoodie', characterOutfitImage: image('杏子穿夏季私服'), referenceImage: image('夏季私服单衣'), consistencyText: '帽衫绿色' },
      { id: 'o-coat', name: '大衣', upper: 'long coat', referenceImage: image('大衣单衣') },
      { id: 'o-text', name: '睡衣', upper: 'pajamas' },
    ], outfitRefs: ['g-uniform'] },
    { id: 'c-02', name: '沙耶香', match: '美树', traits: { face: 'blue short hair' }, outfits: [
      { id: 'o-sheet-only', name: '校服', characterOutfitImage: image('沙耶香穿校服') },
    ], outfitRefs: ['g-uniform'] },
  ], outfits: [{ id: 'g-uniform', name: '见泷原制服', body: 'school uniform', referenceImage: image('通用制服') }], settings: [], props: [] }
}
const kinds = result => result.references.map(ref => [ref.kind, ref.characterId || '', ref.outfitId || '', ref.image.name])

test('tier 1: a character×outfit sheet stands alone for identity and clothing', () => {
  const result = resolveImageReferences({ definitions: library(), subjects: [{ characterId: 'c-01', outfitId: 'o-summer' }] })
  assert.deepEqual(kinds(result), [['character-outfit', 'c-01', 'o-summer', '杏子穿夏季私服']])
  assert.equal(result.references[0].label, '杏子／夏季私服')
  // the character's own consistency text still applies alongside the outfit's
  assert.equal(result.references[0].consistencyText, '红色马尾\n帽衫绿色')
  assert.match(buildReferenceText(result.references), /参考图1 → 杏子／夏季私服（characterId=c-01，outfitId=o-summer）：角色×服装设定图，同时用于该角色身份与该套服装的一致性/)
  assert.match(buildStructuredReferenceText(result.references), /参考图1 → 杏子／夏季私服：角色×服装参考。/)
})

test('tier 2: without a sheet, the character image joins the outfit image (own or shared)', () => {
  const own = resolveImageReferences({ definitions: library(), subjects: [{ characterId: 'c-01', outfitId: 'o-coat' }] })
  assert.deepEqual(kinds(own), [['character', 'c-01', '', '杏子设定'], ['outfit', 'c-01', 'o-coat', '大衣单衣']])
  const shared = resolveImageReferences({ definitions: library(), subjects: [{ characterId: 'c-01', outfitId: 'g-uniform' }] })
  assert.deepEqual(kinds(shared), [['character', 'c-01', '', '杏子设定'], ['outfit', '', 'g-uniform', '通用制服']])
})

test('tier 3: an outfit without any image keeps its text next to the character image', () => {
  const definitions = library()
  const result = resolveImageReferences({ definitions, subjects: [{ characterId: 'c-01', outfitId: 'o-text' }] })
  assert.deepEqual(kinds(result), [['character', 'c-01', '', '杏子设定']])
  const scoped = referenceScopedDefinitions(definitions, result.references, { subjects: [{ characterId: 'c-01', outfitId: 'o-text' }] })
  assert.equal(scoped.characters[0].outfits[0].upper, 'pajamas')
})

test('a sheet works without a character image and trims both identity and outfit text', () => {
  const definitions = library()
  const subjects = [{ characterId: 'c-02', outfitId: 'o-sheet-only' }, { characterId: 'c-01', outfitId: 'o-coat' }]
  const result = resolveImageReferences({ definitions, subjects })
  assert.deepEqual(kinds(result).map(row => row[0]), ['character-outfit', 'character', 'outfit'])
  const scoped = referenceScopedDefinitions(definitions, result.references, { subjects, markers: false })
  const sayaka = scoped.characters.find(item => item.id === 'c-02')
  assert.equal(sayaka.promptLabel, '沙耶香')
  assert.equal(sayaka.traits.face, undefined)
  assert.equal(sayaka.outfits[0].upper, undefined)
})

test('the planner list marks which outfits carry a character×outfit sheet', () => {
  const text = referencePlannerGuidance(library())
  assert.match(text, /"outfitId":"o-summer".*"referenceImage":"有图","characterOutfitImage":"有图"/)
  assert.doesNotMatch(text, /"outfitId":"o-coat"[^\n]*characterOutfitImage/)
})

function records(initial = library()) {
  const state = { definitions: initial, saves: 0 }
  const normalizeCharacter = raw => structuredClone(raw)
  const lib = createCharacterLibrary({
    getDefinitions: () => state.definitions, normalizeCharacter, traitKeys: ['face', 'faceBack', 'bodySFW', 'lowerSFW', 'negative'],
    putImage: async input => ({ ...image(input.name), byteLength: Buffer.from(input.data, 'base64').length }),
    async saveCharacters(characters) { state.saves += 1; state.definitions = { ...state.definitions, characters } },
  })
  return { state, lib }
}

test('the record API reads by id or by asset-library figure, and writes only the shared subset', async () => {
  const { state, lib } = records()
  const { version, character } = lib.getCharacter({ characterId: 'c-01' })
  assert.equal(version, CHARACTER_LIBRARY_VERSION)
  const linked = await lib.patchCharacter({ characterId: 'c-01', expected: character,
    patch: { figureId: 'fig-uuid-1', match: '佐仓杏子, 杏, 杏子酱', traits: { lowerSFW: 'short shorts' }, outfits: [{ id: 'o-coat', lower: 'jeans' }, { id: 'o-new', name: '泳装' }] } })
  assert.equal(lib.getCharacter({ figureId: 'fig-uuid-1' }).character.id, 'c-01')
  assert.deepEqual(linked.character.traits, { face: 'red ponytail', lowerSFW: 'short shorts' })
  assert.deepEqual(linked.character.outfits.map(o => o.id), ['o-summer', 'o-coat', 'o-text', 'o-new'])
  assert.equal(linked.character.outfits[1].upper, 'long coat')
  assert.equal(linked.character.outfits[1].lower, 'jeans')
  assert.deepEqual(linked.character.outfitRefs, ['g-uniform'])
  assert.equal(state.saves, 1)
  // image-plugin-only fields and unknown traits are refused, not silently dropped
  await assert.rejects(() => lib.patchCharacter({ characterId: 'c-01', expected: linked.character, patch: { cards: [] } }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(() => lib.patchCharacter({ characterId: 'c-01', expected: linked.character, patch: { traits: { fullSFW: 'x' } } }), { code: 'INVALID_ARGUMENT' })
  // a stale snapshot never overwrites another editor's change
  await assert.rejects(() => lib.patchCharacter({ characterId: 'c-01', expected: character, patch: { name: '杏' } }), { code: 'REVISION_CONFLICT' })
  assert.equal(state.saves, 1)
})

test('null removes an image; a figure links to at most one record; create appends a record', async () => {
  const { state, lib } = records()
  const sheet = await lib.putReferenceImage({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: '新设定' })
  assert.equal(sheet.byteLength, 3)
  const before = lib.getCharacter({ characterId: 'c-02' }).character
  const after = await lib.patchCharacter({ characterId: 'c-02', expected: before, patch: { referenceImage: sheet, outfits: [{ id: 'o-sheet-only', characterOutfitImage: null }] } })
  assert.equal(after.character.referenceImage.name, '新设定')
  assert.equal(Object.hasOwn(after.character.outfits[0], 'characterOutfitImage'), false)
  const created = await lib.createCharacter({ character: { name: '麻美', figureId: 'fig-uuid-9', traits: { face: 'blonde drills' } } })
  assert.match(created.character.id, /^character-/)
  assert.equal(state.definitions.characters.length, 3)
  await assert.rejects(() => lib.createCharacter({ character: { name: '麻美2', figureId: 'fig-uuid-9' } }), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => lib.getCharacter({ figureId: 'nobody' }), { code: 'NOT_FOUND' })
})

test('the registered image library carries the record API and its schema version', () => {
  const { lib, state } = records()
  const provider = imageLibraryProvider(() => state.definitions, lib)
  assert.equal(provider.schemaVersion, CHARACTER_LIBRARY_VERSION)
  for (const name of ['getCharacter', 'patchCharacter', 'createCharacter', 'putReferenceImage']) assert.equal(typeof provider[name], 'function')
  assert.equal(imageLibraryProvider(() => state.definitions).getCharacter, undefined)
})
