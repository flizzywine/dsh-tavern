import test from 'node:test'
import assert from 'node:assert/strict'
import { followImageCharacters } from '../tavern-plugin/lib/image-character-follow.js'

// A fake asset library (listPacks + subscribe) and 配图 人物库 (one library, records keyed by figure).
function fixture({ libraries = [{ providerId: 'lib' }] } = {}) {
  const packs = new Map([
    ['p1', { id: 'p1', figures: { 'f-yuno': { id: 'f-yuno', name: '千石由乃', aliases: ['由乃', 'Yuno'] } } }],
    ['p2', { id: 'p2', figures: { 'f-nade': { id: 'f-nade', name: '千石抚子', aliases: ['抚子', 'Nadeko'] }, 'f-other': { id: 'f-other', name: '别人', aliases: ['路人'] } } }],
  ])
  const records = [
    { id: 'c-yuno', name: '千石由乃', figurePackId: 'p1', figureId: 'f-yuno', match: 'Yuno, 由乃', outfits: [] },
    { id: 'c-nade', name: '千石抚子', figurePackId: 'p2', figureId: 'f-nade', match: 'Nadeko, 抚子', outfits: [] },
    { id: 'c-other', name: '别人', figurePackId: 'p2', figureId: 'f-other', match: '路人', outfits: [] },
  ]
  const listeners = new Set(), writes = []
  const library = {
    async listPacks() { return [...packs.values()].map(pack => ({ manifest: { id: pack.id }, revision: 'r' + (pack.revision || 0),
      figures: Object.fromEntries(Object.entries(structuredClone(pack.figures)).map(([id, figure]) => [id, { outfits: [], ...figure }])) })) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async readMedia({ hash }) { return { bytes: Buffer.from(hash), descriptor: { mime: 'image/png' } } },
    async patchFigure({ packId, expectedRevision, figureId, patch }) {
      const pack = packs.get(packId)
      assert.equal(expectedRevision, 'r' + (pack.revision || 0))
      const figure = pack.figures[figureId]
      for (const [key, value] of Object.entries(patch)) if (value === null) delete figure[key]; else figure[key] = value
      pack.revision = (pack.revision || 0) + 1; writes.push(['patchFigure', figureId])
      for (const l of listeners) l({ packId })
      return { snapshot: { revision: 'r' + pack.revision } }
    },
  }
  const api = {
    async imageCharacterLibraries() { return libraries },
    async imageCharacters(op, input) {
      if (op === 'getCharacter') {
        const record = records.find(c => c.figureId === input.figureId && c.figurePackId === input.figurePackId)
        if (!record) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
        return { providerId: 'lib', character: structuredClone(record) }
      }
      if (op === 'putReferenceImage') { writes.push([op, input.name]); return { referenceImage: { id: Buffer.from(input.data).toString(), mediaType: input.mediaType, name: input.name } } }
      writes.push([op, input.characterId || input.character.name])
      if (op === 'createCharacter') { const made = { id: 'c-' + input.character.figureId, ...input.character }; records.push(made); return { providerId: 'lib', character: structuredClone(made) } }
      const record = records.find(c => c.id === input.characterId)
      assert.deepEqual(input.expected, record)
      const { outfits, traits, ...rest } = input.patch
      Object.assign(record, rest)
      if (traits) record.traits = { ...record.traits, ...traits }
      if (outfits) record.outfits = [...(record.outfits || []).map(o => ({ ...o, ...outfits.find(p => p.id === o.id) })), ...outfits.filter(p => !(record.outfits || []).some(o => o.id === p.id))]
      return { providerId: 'lib', character: structuredClone(record) }
    },
  }
  const write = (packId, edit) => { const pack = packs.get(packId) || { id: packId, figures: {} }; edit(pack.figures); packs.set(packId, pack); for (const l of listeners) l({ packId }) }
  const notify = packId => { for (const l of listeners) l({ packId }) }
  return { packs, records, writes, library, api, write, notify, record: id => records.find(c => c.id === id) }
}

test('the 参考图 an imported or copied figure carries become its new record’s, except where it has a 设定图; an update keeps the local ones unless adopted', async () => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  const carried = { referenceImage: { media: 'up1', name: '自传设定图' }, outfits: [{ id: 'school', name: '校服', upper: '水手服', characterOutfitImage: { media: 'up2' } }] }
  f.write('p3', figures => { figures['f-copy'] = { id: 'f-copy', name: '千石抚子', aliases: [], identitySettei: { board: 'h1' }, outfits: [{ key: 'school', label: '校服' }], extensions: { 'dsh.image-character': carried } } })
  await follow.settled()
  const copy = f.record('c-f-copy')
  assert.deepEqual(copy.referenceImage, { id: 'h1', mediaType: 'image/png', name: '千石抚子 设定图' }, 'the 人设图, not the carried picture')
  assert.deepEqual(copy.outfits, [{ id: 'school', name: '校服', characterOutfitImage: { id: 'up2', mediaType: 'image/png', name: '千石抚子／校服 参考图' }, upper: '水手服' }])
  assert.equal(f.packs.get('p3').figures['f-copy'].extensions, undefined)
  f.record('c-nade').referenceImage = { id: 'own' }
  f.write('p2', figures => { figures['f-nade'] = { ...figures['f-nade'], extensions: { 'dsh.image-character': { referenceImage: { media: 'up3' } } } } })
  await follow.settled()
  assert.deepEqual(f.record('c-nade').referenceImage, { id: 'own' }, 'an update keeps the local 参考图')
  follow.adopt({ packId: 'p2', figureIds: ['f-nade'] })
  f.write('p2', figures => { figures['f-nade'] = { ...figures['f-nade'], extensions: { 'dsh.image-character': { referenceImage: { media: 'up3' } } } } })
  await follow.settled()
  assert.equal(f.record('c-nade').referenceImage.id, 'up3', 'adopted: the imported one')
  follow.dispose()
})

test('a 设定图 registered on a figure, or replaced, becomes its record’s 参考图 by itself; one already shown is not written again', async () => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  f.record('c-yuno').referenceImage = { id: 'upload', name: '我的上传图' }
  f.record('c-yuno').outfits = [{ id: 'summer', name: '夏装', characterOutfitImage: { id: 'old-sheet', name: '千石由乃／夏装 设定图' } }]
  f.write('p1', figures => { figures['f-yuno'] = { ...figures['f-yuno'], identitySettei: { board: 'board-1' }, outfits: [{ key: 'summer', label: '夏装', settei: 'sheet-2' }, { key: 'winter', label: '冬装' }] } })
  await follow.settled()
  assert.deepEqual(f.record('c-yuno').referenceImage, { id: 'board-1', mediaType: 'image/png', name: '千石由乃 设定图' })
  assert.deepEqual(f.record('c-yuno').outfits, [{ id: 'summer', name: '夏装', characterOutfitImage: { id: 'sheet-2', mediaType: 'image/png', name: '千石由乃／夏装 设定图' } }])
  const writes = f.writes.length
  f.notify('p1')
  await follow.settled()
  assert.equal(f.writes.slice(writes).filter(([op]) => op === 'putReferenceImage').length, 0)
  follow.dispose()
})
