import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip, openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {FIGURE_RECORD_UNAVAILABLE} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/figure-records.js'
import {createFigureRecords} from '../tavern-plugin/lib/image-character-records.js'
import {sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {computeContentHash} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack, png, digest, FIGURE_ID, PACK_ID} from './fixtures/asset-packs/pack.mjs'

// ADR 0010: with the records switched on, a figure's name, 触发词 and outfit names live in its 配图 人物库 record only.
// The pack stores the figure without them, every read puts them back, an export carries them whole.

// A 配图 人物库 with one library (schema 4 record ops, as the host's pluginApi.imageCharacters gives them).
function imageLibrary() {
  const records = [], writes = []
  let available = true, next = 0
  const find = input => records.find(item => input.characterId ? item.id === input.characterId : item.figureId === input.figureId && item.figurePackId === input.figurePackId)
  const merge = (record, patch) => {
    const {outfits, traits, ...rest} = structuredClone(patch)
    Object.assign(record, rest)
    for (const key of ['figureId', 'figurePackId']) if (record[key] === null) delete record[key]
    if (traits) record.traits = {...record.traits, ...traits}
    if (outfits) record.outfits = [...record.outfits.map(outfit => ({...outfit, ...outfits.find(item => item.id === outfit.id)})), ...outfits.filter(item => !record.outfits.some(outfit => outfit.id === item.id))]
  }
  const api = {
    async imageCharacterLibraries() { return available ? [{providerId:'lib'}] : [] },
    async imageCharacters(op, input) {
      if (!available) throw Object.assign(new Error('off'), {code:'NOT_CONFIGURED'})
      if (op === 'getCharacter') {
        const record = find(input)
        if (!record) throw Object.assign(new Error('missing'), {code:'NOT_FOUND'})
        return {providerId:'lib', version:4, character:structuredClone(record)}
      }
      if (op === 'putReferenceImage') return {providerId:'lib', referenceImage:{id:'ref-' + input.data.length, name:input.name}}
      writes.push(op)
      if (op === 'createCharacter') {
        const record = {id:'c' + ++next, traits:{}, outfits:[]}
        merge(record, input.character); records.push(record)
        return {providerId:'lib', version:4, character:structuredClone(record)}
      }
      const record = find(input)
      assert.deepEqual(input.expected, record, 'records are written against the snapshot read')
      merge(record, input.patch)
      return {providerId:'lib', version:4, character:structuredClone(record)}
    },
  }
  return {api, records, writes, set available(value) { available = value }}
}

async function setup(t, {mode = 'registry', recordFile} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'figure-records-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const library = imageLibrary(), file = path.join(root, 'data', 'figure-records.json')
  if (mode) { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, JSON.stringify({version:1, mode})) }
  const records = createFigureRecords({api:library.api, file, ...(recordFile ? {recordFile:path.join(root, 'data', 'plugins', 'dsh-tavern-image', 'definitions.json')} : {})})
  const assetRoot = path.join(root, 'asset-packs')
  const service = createAssetPackService({assetRoot, figureRecords:records})
  t.after(() => service.dispose())
  const stored = async () => JSON.parse(await readFile(path.join(assetRoot, 'packs', PACK_ID, 'figures', FIGURE_ID + '.json'), 'utf8'))
  return {root, assetRoot, library, records, service, stored}
}

async function archiveOf(root, pack) {
  const file = path.join(root, 'input-' + Math.random().toString(36).slice(2) + '.zip')
  await writeZip(file, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([name, data]) => ({path:name, data}))])
  return file
}

async function install(service, file, decision = 'install', expectedRevision = null) {
  const preview = await service.inspectImportFile({file})
  return (await service.applyImport({inspectionId:preview.inspectionId, expectedRevision, decision, acceptScriptRisk:true})).snapshot
}

test('an old whole pack installs with its identity moved into a new record and reads back whole', async t => {
  const f = await setup(t), pack = await syntheticPack(), whole = JSON.parse(pack.files.get(`figures/${FIGURE_ID}.json`))
  const snapshot = await install(f.service, await archiveOf(f.root, pack))
  const figure = snapshot.figures[FIGURE_ID]
  assert.equal(figure.name, whole.name)
  assert.deepEqual([...figure.aliases].sort(), [...whole.aliases].sort())
  assert.deepEqual(figure.outfits.map(outfit => outfit.label), whole.outfits.map(outfit => outfit.label))
  const stored = await f.stored()
  assert.equal(stored.name, undefined)
  assert.deepEqual(stored.aliases, ['actor'], 'an actor key the record does not carry stays with the figure')
  assert.ok(stored.outfits.every(outfit => outfit.label === undefined))
  const [record] = f.library.records
  assert.equal(record.name, whole.name)
  assert.equal(record.match, 'Fixture, Speaker')
  assert.deepEqual(record.outfits.map(outfit => outfit.name), whole.outfits.map(outfit => outfit.label))
  // 触发词 come back in the record's order (its first readable Latin name first), actor keys last; the manifest names that
  const reread = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(reread.figures[FIGURE_ID].aliases, ['Fixture', 'Speaker', 'actor'])
  await f.service.figureRecordsChanged({packIds:[PACK_ID]})
  assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).manifest.contentHash, reread.manifest.contentHash)
})

test('a pack carrying a figure\'s 外貌 and 参考图 gives both to the new record and then drops the picture', async t => {
  const f = await setup(t), pack = await syntheticPack(), file = `figures/${FIGURE_ID}.json`
  const picture = png([90, 10, 200]), hash = digest(picture)
  pack.files.set(`media/${hash}.png`, picture)
  pack.manifest.blobs[hash] = {ext:'png', mime:'image/png', size:picture.length}
  const figure = JSON.parse(pack.files.get(file))
  figure.extensions = {...figure.extensions, 'dsh.image-character':{traits:{face:'银发绿瞳'}, referenceImage:{media:hash, name:'携带的参考图'}}}
  pack.files.set(file, jsonBytes(figure))
  await sealPack(pack.manifest, pack.files)
  pack.manifest.contentHash = await computeContentHash(pack.manifest)
  await install(f.service, await archiveOf(f.root, pack))
  const [record] = f.library.records
  assert.equal(record.traits.face, '银发绿瞳')
  assert.equal(record.referenceImage?.name, '携带的参考图')
  assert.equal((await f.stored()).extensions?.['dsh.image-character'], undefined)
  let blobs
  for (let i = 0; i < 40 && (blobs = (await f.service.getPackSnapshot({packId:PACK_ID})).manifest.blobs)[hash]; i++) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(blobs[hash], undefined, 'the picture now lives in the record only')
})

test('an edit of the name goes to the record; a record edit elsewhere is read on the next read', async t => {
  const f = await setup(t)
  let snapshot = await install(f.service, await archiveOf(f.root, await syntheticPack()))
  snapshot = (await f.service.patchFigure({packId:PACK_ID, expectedRevision:snapshot.revision, figureId:FIGURE_ID, patch:{name:'新名字'}})).snapshot
  assert.equal(snapshot.figures[FIGURE_ID].name, '新名字')
  assert.equal(f.library.records[0].name, '新名字')
  assert.equal((await f.stored()).name, undefined)
  // the 人物库 renames the person and an outfit (its page saves through the host, which tells the library)
  const record = f.library.records[0]
  record.name = '人物库里的名字'; record.outfits[0].name = '冬季制服'
  await f.service.figureRecordsChanged({packIds:[PACK_ID]})
  const reread = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(reread.figures[FIGURE_ID].name, '人物库里的名字')
  assert.equal(reread.figures[FIGURE_ID].outfits[0].label, '冬季制服')
  assert.notEqual(reread.manifest.contentHash, snapshot.manifest.contentHash, 'the manifest names the figure readers see')
  // a later write is made on what readers see, and keeps it
  const written = await f.service.patchFigure({packId:PACK_ID, expectedRevision:reread.revision, figureId:FIGURE_ID, patch:{description:'改了介绍'}})
  assert.equal(written.snapshot.figures[FIGURE_ID].name, '人物库里的名字')
  assert.equal(f.library.records[0].name, '人物库里的名字')
})

test('an exported pack carries the whole figure, and reads whole where no 配图 人物库 exists', async t => {
  const f = await setup(t)
  const snapshot = await install(f.service, await archiveOf(f.root, await syntheticPack()))
  f.library.records[0].name = '人物库里的名字'
  await f.service.figureRecordsChanged({packIds:[PACK_ID]})
  const archive = await f.service.exportPack({packId:PACK_ID, expectedRevision:(await f.service.getPackSnapshot({packId:PACK_ID})).revision})
  t.after(() => archive.dispose())
  const zip = await openZip(archive.file)
  const carried = JSON.parse((await zip.read(zip.entries.find(entry => entry.path === `figures/${FIGURE_ID}.json`))).toString('utf8'))
  assert.equal(carried.name, '人物库里的名字')
  assert.deepEqual([...carried.aliases].sort(), ['Fixture', 'Speaker', 'actor'])
  assert.ok(carried.outfits.every(outfit => outfit.label))
  // elsewhere: no records at all
  const other = await mkdtemp(path.join(tmpdir(), 'figure-records-plain-'))
  t.after(() => rm(other, {recursive:true, force:true}))
  const plain = createAssetPackService({assetRoot:other})
  t.after(() => plain.dispose())
  const imported = await install(plain, archive.file)
  assert.equal(imported.figures[FIGURE_ID].name, '人物库里的名字')
  assert.equal(JSON.parse(await readFile(path.join(other, 'packs', PACK_ID, 'figures', FIGURE_ID + '.json'), 'utf8')).name, '人物库里的名字')
  // and back into a library with records: a new record for a new install
  const g = await setup(t)
  const again = await install(g.service, archive.file)
  assert.equal(again.figures[FIGURE_ID].name, '人物库里的名字')
  assert.equal(g.library.records[0].name, '人物库里的名字')
  assert.equal((await g.stored()).name, undefined)
  assert.ok(snapshot)
})

test('with the 配图 plugin off its records are read from its file: figures show, edit and export; an identity edited meanwhile moves into the record when it is back', async t => {
  const f = await setup(t, {recordFile:true})
  await install(f.service, await archiveOf(f.root, await syntheticPack()))
  const definitions = path.join(f.root, 'data', 'plugins', 'dsh-tavern-image', 'definitions.json')
  await mkdir(path.dirname(definitions), {recursive:true})
  // what the plugin left on disk when it stopped
  await writeFile(definitions, JSON.stringify({characters:structuredClone(f.library.records)}))
  f.library.available = false
  await f.service.figureRecordsChanged({})
  let snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(snapshot.figures[FIGURE_ID].name, 'Synthetic figure')
  // an edit that leaves the identity alone keeps the pack free of it
  snapshot = (await f.service.patchFigure({packId:PACK_ID, expectedRevision:snapshot.revision, figureId:FIGURE_ID, patch:{description:'插件关着时改的'}})).snapshot
  assert.equal((await f.stored()).name, undefined)
  // a renamed figure is kept whole until the 人物库 can take the name
  snapshot = (await f.service.patchFigure({packId:PACK_ID, expectedRevision:snapshot.revision, figureId:FIGURE_ID, patch:{name:'关着时改的名字'}})).snapshot
  assert.equal(snapshot.figures[FIGURE_ID].name, '关着时改的名字')
  assert.equal((await f.stored()).name, '关着时改的名字')
  const archive = await f.service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision})
  t.after(() => archive.dispose())
  const zip = await openZip(archive.file)
  assert.equal(JSON.parse((await zip.read(zip.entries.find(entry => entry.path === `figures/${FIGURE_ID}.json`))).toString('utf8')).name, '关着时改的名字')
  assert.equal(f.library.records[0].name, 'Synthetic figure', 'nothing writes the 人物库 while its plugin is off')
  f.library.available = true
  await f.service.figureRecordsChanged({})
  assert.deepEqual(await f.records.foldWhole(f.service), [PACK_ID])
  assert.equal(f.library.records[0].name, '关着时改的名字')
  assert.equal((await f.stored()).name, undefined)
  assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].name, '关着时改的名字')
  assert.deepEqual(await f.records.foldWhole(f.service), [], 'once moved there is nothing left to fold')
})
test('without its record a stored figure reads as unavailable, cannot be written and cannot leave the library', async t => {
  const f = await setup(t)
  await install(f.service, await archiveOf(f.root, await syntheticPack()))
  f.library.available = false
  await f.service.figureRecordsChanged({packIds:[PACK_ID]})
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  const figure = snapshot.figures[FIGURE_ID]
  assert.equal(figure.name, '人物资料不可用')
  assert.equal(figure.extensions[FIGURE_RECORD_UNAVAILABLE], true)
  await assert.rejects(f.service.patchFigure({packId:PACK_ID, expectedRevision:snapshot.revision, figureId:FIGURE_ID, patch:{description:'x'}}), {code:'ASSET_UNAVAILABLE'})
  await assert.rejects(f.service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision}), {code:'ASSET_UNAVAILABLE'})
  assert.equal((await f.stored()).name, undefined, 'nothing was written over the stored figure')
  f.library.available = true
  await f.service.figureRecordsChanged({})
  assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].name, 'Synthetic figure')
})

test('switching back to the packs rewrites every figure whole; the records keep what they had', async t => {
  const f = await setup(t)
  const before = await install(f.service, await archiveOf(f.root, await syntheticPack()))
  await f.records.setMode('pack')
  await f.service.rewriteFigureDocuments({packIds:[PACK_ID]})
  const stored = await f.stored()
  assert.equal(stored.name, 'Synthetic figure')
  assert.ok(stored.outfits.every(outfit => outfit.label))
  assert.equal(f.library.records[0].name, 'Synthetic figure')
  const after = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(after.figures[FIGURE_ID].outfits.map(outfit => outfit.label), before.figures[FIGURE_ID].outfits.map(outfit => outfit.label))
  // and forward again
  await f.records.setMode('registry')
  await f.service.rewriteFigureDocuments({packIds:[PACK_ID]})
  assert.equal((await f.stored()).name, undefined)
})

test('a removed figure leaves its record as an ordinary one', async t => {
  const f = await setup(t)
  const snapshot = await install(f.service, await archiveOf(f.root, await syntheticPack()))
  await f.service.removeFigure({packId:PACK_ID, expectedRevision:snapshot.revision, figureId:FIGURE_ID})
  assert.equal(f.library.records[0].figureId, undefined)
  assert.equal(f.library.records[0].name, 'Synthetic figure')
})

test('auto-cast creates and renames figures through their records, its 外貌 goes to the record, and undo restores the name', async t => {
  const f = await setup(t)
  const {createCardBundleAdapter} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js')
  const {createCardPreparation} = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const preparation = createCardPreparation(), cardFile = path.join(f.root, 'card.json')
  await writeFile(cardFile, JSON.stringify(preparation.create({kind:'import', payload:{name:'测试卡'}})))
  const cards = createCardBundleAdapter({cardPreparation:preparation, authorizeTarget:async () => ({cardId:'card-test'}),
    readWorkspace:async () => JSON.parse(await readFile(cardFile, 'utf8')), writeWorkspace:async (_path, value) => writeFile(cardFile, JSON.stringify(value)), withCardLock:(_id, task) => task()})
  await f.service.dispose()
  const service = createAssetPackService({assetRoot:f.assetRoot, cardTransactions:cards, figureRecords:f.records})
  const caster = service.registerAutomaticWriter({writerId:'auto-cast', plan:({context}) => context.changes})
  t.after(async () => { caster.dispose(); await service.dispose() })
  let n = 0
  const write = async changes => {
    const context = await caster.readContext({path:'card'}), rows = await service.listPackSummaries()
    const input = {path:'card', expectedCardRevision:context.card.revision, target:context.target, requestId:'request-' + ++n, source:{kind:'test', occurrenceId:'occurrence-' + n},
      catalogueRevisions:(Array.isArray(rows) ? rows : rows.packs).map(row => ({packId:row.packId, revision:row.revision})), changes}
    return service.writeAutomaticItems(input, caster.authorize(input, {chatId:'c', branchId:'b', revision:1, turn:1, messageId:'m', paragraphIds:['p']}, {changes}))
  }
  const made = await write([{op:'create', kind:'figures', value:{name:'猫耳少女', aliases:['猫耳']}, looks:{face:'金发绿瞳'}}])
  const ref = made.refs[0], stored = async () => JSON.parse(await readFile(path.join(f.assetRoot, 'packs', ref.packId, 'figures', ref.figureId + '.json'), 'utf8'))
  const record = () => f.library.records.find(item => item.figureId === ref.figureId)
  assert.equal(record().name, '猫耳少女')
  assert.equal(record().traits.face, '金发绿瞳')
  assert.equal((await stored()).name, undefined)
  assert.equal((await stored()).identityAppearance, undefined, 'the 外貌 lives in the record only')
  const renamed = await write([{op:'patch', kind:'figures', ref:{packId:ref.packId, kind:'figures', figureId:ref.figureId}, patch:{name:'猫耳店员'}}])
  assert.equal(record().name, '猫耳店员')
  let pack = await service.getPackSnapshot({packId:ref.packId})
  assert.equal(pack.figures[ref.figureId].name, '猫耳店员')
  await service.undoAutomaticWrite({packId:ref.packId, expectedRevision:pack.revision, writeId:renamed.writeId})
  pack = await service.getPackSnapshot({packId:ref.packId})
  assert.equal(pack.figures[ref.figureId].name, '猫耳少女')
  assert.equal(record().name, '猫耳少女')
  assert.equal((await stored()).name, undefined)
})

test('in pack mode figures stay whole and no record is written', async t => {
  const f = await setup(t, {mode:null})
  await install(f.service, await archiveOf(f.root, await syntheticPack()))
  assert.equal((await f.stored()).name, 'Synthetic figure')
  assert.deepEqual(f.library.writes, [])
})
