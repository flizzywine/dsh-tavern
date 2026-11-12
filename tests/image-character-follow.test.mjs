import test from 'node:test'
import assert from 'node:assert/strict'
import { followImageCharacters } from '../tavern-plugin/lib/image-character-follow.js'
import { identityPatchFromFigure } from '../tavern-plugin/lib/domain/image-character-appearance.js'

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
      if (op === 'putReferenceImage') { writes.push([op, input.name]); return { referenceImage: { id: 'ref-' + Buffer.from(input.data).toString(), mediaType: input.mediaType, name: input.name } } }
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

test('a renamed figure and a new 触发词 reach its record; a word another figure also has stays on both', async () => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  // 由乃 is renamed and takes 抚子 as a 触发词: both records keep it, and only p1's records are written
  f.write('p1', figures => { figures['f-yuno'] = { id: 'f-yuno', name: '千石由乃（春）', aliases: ['由乃', '抚子', 'Yuno'] } })
  await follow.settled()
  assert.deepEqual(f.record('c-yuno'), { id: 'c-yuno', name: '千石由乃（春）', figurePackId: 'p1', figureId: 'f-yuno', match: 'Yuno, 由乃, 抚子', outfits: [] })
  assert.equal(f.writes.some(([, id]) => id === 'c-nade' || id === 'c-other'), false)
  follow.dispose()
})

test('a figure a write adds gets its own record; figures that were there stay unlinked', async () => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  f.records.splice(f.records.findIndex(c => c.id === 'c-other'), 1)
  await follow.settled()
  f.write('p2', figures => { figures['f-new'] = { id: 'f-new', name: '新人', aliases: ['路人'], outfits: [] } })
  f.write('p3', figures => { figures['f-pack'] = { id: 'f-pack', name: '装包的人', aliases: [], outfits: [] } })
  await follow.settled()
  assert.deepEqual(f.writes.filter(([op]) => op === 'createCharacter'), [['createCharacter', '新人'], ['createCharacter', '装包的人']])
  // 路人 also names 别人: the new record keeps it
  assert.equal(f.record('c-f-new').match, '路人')
  assert.equal(f.records.some(c => c.figureId === 'f-other'), false)
  follow.dispose()
})

test('a removed figure leaves its record unlinked with its 外貌; an unreadable pack removes nothing', async t => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  const listPacks = f.library.listPacks
  f.library.listPacks = async () => (await listPacks()).map(pack => pack.manifest.id === 'p2' ? { packId: 'p2', error: { code: 'PACK_CORRUPT', message: 'x' } } : pack)
  f.write('p2', () => {})
  await follow.settled()
  assert.equal(f.record('c-nade').figureId, 'f-nade')
  f.library.listPacks = listPacks
  f.write('p2', figures => { delete figures['f-nade'] })
  await follow.settled()
  assert.equal(f.record('c-nade').figureId, null)
  assert.equal(f.record('c-nade').figurePackId, null)
  assert.equal(f.record('c-nade').match, 'Nadeko, 抚子')
  // uninstalling a pack releases every record it held
  f.packs.delete('p1'); f.notify('p1')
  await follow.settled()
  assert.equal(f.record('c-yuno').figureId, null)
  follow.dispose()
})

test('外貌 text a written pack carries moves into the record and out of the pack; the record\'s own text wins', async t => {
  const f = fixture(), logs = [], follow = followImageCharacters({ library: f.library, api: f.api, log: text => logs.push(text) })
  await follow.settled()
  f.record('c-nade').traits = { face: '黑色长刘海' }
  f.write('p2', figures => {
    figures['f-nade'] = { ...figures['f-nade'], identityAppearance: '黑发', outfits: [{ key: 'school', label: '校服', outfitAppearance: '水手服' }] }
    figures['f-new'] = { id: 'f-new', name: '新人', aliases: [], identityAppearance: '银发', outfits: [{ key: 'core', label: '常服', outfitAppearance: '白裙' }] }
  })
  await follow.settled()
  assert.deepEqual(f.record('c-nade').traits, { face: '黑色长刘海' })
  assert.deepEqual(f.record('c-nade').outfits, [{ id: 'school', name: '校服', upper: '水手服' }])
  assert.match(logs.join('\n'), /千石抚子.*黑发/)
  assert.deepEqual(f.record('c-f-new').traits, { face: '银发' })
  assert.equal(f.record('c-f-new').outfits[0].upper, '白裙')
  const pack = f.packs.get('p2').figures
  for (const id of ['f-nade', 'f-new']) {
    assert.equal(pack[id].identityAppearance, undefined)
    assert.equal(pack[id].outfits.some(o => 'outfitAppearance' in o), false)
  }
  follow.dispose()
})

test('an imported or copied figure brings its 配图 外貌 (dsh.image-character) into a record of its own; an update never overwrites the local one', async () => {
  const f = fixture(), logs = [], follow = followImageCharacters({ library: f.library, api: f.api, log: text => logs.push(text) })
  await follow.settled()
  f.record('c-nade').traits = { face: '黑色长刘海' }
  const carried = { traits: { face: '黑发', bodySFW: '娇小' }, outfits: [{ id: 'school', name: '校服', upper: '水手服', shoes: '乐福鞋' }] }
  f.write('p2', figures => {
    // the same pack updated: 抚子 already has a record
    figures['f-nade'] = { ...figures['f-nade'], outfits: [{ key: 'school', label: '校服' }], extensions: { 'dsh.image-character': carried, dsh_tavern: { copiedFrom: { packId: 'p0', figureId: 'f-0' } } } }
    // a copy of her with the same name: a record of its own, never hers
    figures['f-copy'] = { id: 'f-copy', name: '千石抚子', aliases: [], outfits: [{ key: 'school', label: '校服' }], extensions: { 'dsh.image-character': carried } }
  })
  await follow.settled()
  assert.deepEqual(f.record('c-nade').traits, { face: '黑色长刘海', bodySFW: '娇小' })
  assert.deepEqual(f.record('c-nade').outfits, [{ id: 'school', name: '校服', upper: '水手服', shoes: '乐福鞋' }])
  assert.match(logs.join('\n'), /千石抚子.*黑发/)
  assert.deepEqual(f.record('c-f-copy').traits, carried.traits)
  assert.deepEqual(f.record('c-f-copy').outfits, carried.outfits)
  // the extension leaves the stored pack; other extensions stay
  const pack = f.packs.get('p2').figures
  assert.deepEqual(pack['f-nade'].extensions, { dsh_tavern: { copiedFrom: { packId: 'p0', figureId: 'f-0' } } })
  assert.equal(pack['f-copy'].extensions, undefined)
  follow.dispose()
})

test('an update whose preview chose 「用导入的」 for a figure replaces its record 外貌; the other figure keeps its own', async () => {
  const f = fixture(), logs = [], follow = followImageCharacters({ library: f.library, api: f.api, log: text => logs.push(text) })
  await follow.settled()
  f.record('c-nade').traits = { face: '黑色长刘海', feature: '虎牙' }
  f.record('c-nade').outfits = [{ id: 'school', name: '校服', upper: '西装', lower: '百褯裙' }, { id: 'old', name: '旧衣', upper: '和服' }]
  f.record('c-other').traits = { face: '圆脸' }
  const carried = { traits: { face: '黑发', bodySFW: '娇小' }, outfits: [{ id: 'school', name: '校服', upper: '水手服' }] }
  follow.adopt({ packId: 'p2', figureIds: ['f-nade'] })
  f.write('p2', figures => {
    figures['f-nade'] = { ...figures['f-nade'], outfits: [{ key: 'school', label: '校服' }], extensions: { 'dsh.image-character': carried } }
    figures['f-other'] = { ...figures['f-other'], extensions: { 'dsh.image-character': { traits: { face: '方脸' } } } }
  })
  await follow.settled()
  assert.deepEqual(f.record('c-nade').traits, { face: '黑发', feature: '', bodySFW: '娇小' })
  assert.deepEqual(f.record('c-nade').outfits, [{ id: 'school', name: '校服', upper: '水手服', lower: '' }, { id: 'old', name: '旧衣', upper: '' }])
  assert.deepEqual(f.record('c-other').traits, { face: '圆脸' }, 'not adopted: the local 外貌 stays')
  assert.doesNotMatch(logs.join('\n'), /千石抚子/, 'an adopted figure drops nothing')
  assert.equal(f.packs.get('p2').figures['f-nade'].extensions, undefined)
  // the choice was used once: the next carried 外貌 fills gaps again
  f.write('p2', figures => { figures['f-nade'] = { ...figures['f-nade'], extensions: { 'dsh.image-character': { traits: { face: '金发' } } } } })
  await follow.settled()
  assert.equal(f.record('c-nade').traits.face, '黑发')
  follow.dispose()
})

// 11-11 三角机构: 自动素材's 入职主管 had a linked record with no 外貌 and no 参考图, so 场景配图 drew someone else.
test('a figure’s 人设图 becomes its record’s 参考图 once, 自动素材’s and the owner’s alike; a record with one keeps it', async () => {
  const f = fixture(), follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  const mark = { 'dsh.automatic-write': { writerId: 'auto-cast' } }, looks = { traits: { face: '齐肩深棕卷发', bodySFW: '米白西装套裙' } }
  f.write('p3', figures => { figures['f-boss'] = { id: 'f-boss', name: '入职主管', aliases: [], extensions: { ...mark, 'dsh.image-character': looks } } })
  await follow.settled()
  assert.deepEqual(f.record('c-f-boss').traits, looks.traits)
  assert.equal(f.record('c-f-boss').referenceImage, undefined, 'no 人设图 yet')
  f.write('p3', figures => { figures['f-boss'] = { ...figures['f-boss'], identitySettei: { board: 'h1' } } })
  await follow.settled()
  assert.deepEqual(f.record('c-f-boss').referenceImage, { id: 'ref-h1', mediaType: 'image/png', name: '入职主管 设定图' })
  f.write('p3', figures => { figures['f-boss'] = { ...figures['f-boss'], identitySettei: { board: 'h2' } } })
  f.write('p2', figures => { figures['f-nade'] = { ...figures['f-nade'], identitySettei: { board: 'h3' } } })
  await follow.settled()
  assert.equal(f.record('c-f-boss').referenceImage.id, 'ref-h1', 'a record with a 参考图 keeps it')
  assert.deepEqual(f.record('c-nade').referenceImage, { id: 'ref-h3', mediaType: 'image/png', name: '千石抚子 设定图' }, 'a figure the owner made, the same')
  assert.equal(f.record('c-other').referenceImage, undefined, 'a figure without 人设图 gets none')
  follow.dispose()
})

test('at start, a pack with a 人设图 drawn or installed before the follow set 参考图 is followed once', async () => {
  const f = fixture()
  f.packs.set('p4', { id: 'p4', figures: { 'f-old': { id: 'f-old', name: '入职主管', aliases: [], identitySettei: { board: 'h9' }, extensions: { 'dsh.automatic-write': { writerId: 'auto-cast' } } } } })
  f.records.push({ id: 'c-old', name: '入职主管', figurePackId: 'p4', figureId: 'f-old', match: '', outfits: [] })
  f.packs.get('p2').figures['f-nade'].identitySettei = { board: 'h8' }
  const follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  assert.equal(f.record('c-old').referenceImage.id, 'ref-h9')
  assert.equal(f.record('c-nade').referenceImage.id, 'ref-h8', 'the owner’s figure alike')
  assert.equal(f.record('c-yuno').referenceImage, undefined, 'a figure without 人设图 gets none')
  follow.dispose()
})
test('with two 人物库 or none the follow creates nothing and asks nothing of the library', async () => {
  for (const libraries of [[{ providerId: 'a' }, { providerId: 'b' }], []]) {
    const f = fixture({ libraries }), follow = followImageCharacters({ library: f.library, api: f.api })
    await follow.settled()
    f.write('p2', figures => { figures['f-new'] = { id: 'f-new', name: '新人', aliases: [], outfits: [] } })
    await follow.settled()
    assert.deepEqual(f.writes.filter(([op]) => op === 'createCharacter'), [])
    follow.dispose()
  }
})

test('the identity patch is the name and the alias projection, and null when both already match', () => {
  assert.deepEqual(identityPatchFromFigure({ name: 'しぐれうい', match: '羽衣' }, { name: '時雨羽衣', aliases: ['羽衣'] }), { name: '時雨羽衣' })
  assert.equal(identityPatchFromFigure({ name: '千石由乃', match: '由乃, 千石' }, { name: '千石由乃', aliases: ['由乃', '千石', 'yuno_c'] }), null)
})

test('each outfit’s 服装设定图 becomes that outfit’s 参考图 once (a new outfit takes its label); an outfit with one keeps it', async () => {
  const f = fixture()
  f.record('c-nade').outfits = [{ id: 'school', name: '校服', characterOutfitImage: { id: 'own-upload' } }]
  const follow = followImageCharacters({ library: f.library, api: f.api })
  await follow.settled()
  f.write('p2', figures => { figures['f-nade'] = { ...figures['f-nade'], outfits: [
    { key: 'school', label: '校服', settei: 'h4' }, { key: 'casual', label: '便服', settei: 'h5' }, { key: 'sleep', label: '睡衣' }] } })
  await follow.settled()
  const outfits = f.record('c-nade').outfits
  assert.deepEqual(outfits.find(o => o.id === 'school').characterOutfitImage, { id: 'own-upload' }, 'an outfit with a 参考图 keeps it')
  assert.deepEqual(outfits.find(o => o.id === 'casual'), { id: 'casual', name: '便服', characterOutfitImage: { id: 'ref-h5', mediaType: 'image/png', name: '千石抚子／便服 设定图' } })
  assert.equal(outfits.some(o => o.id === 'sleep'), false, 'an outfit without 设定图 gets none')
  assert.equal(f.record('c-nade').referenceImage, undefined, 'no 人设图, no person 参考图')
  f.notify('p2')
  await follow.settled()
  assert.equal(f.writes.filter(row => row[0] === 'putReferenceImage').length, 1, 'once')
  follow.dispose()
})