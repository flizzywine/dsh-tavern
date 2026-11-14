import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip, openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {imageCharacterExtension} from '../tavern-plugin/lib/domain/image-character-appearance.js'
import {syntheticPack, png, digest, FIGURE_ID, PACK_ID} from './fixtures/asset-packs/pack.mjs'

// 方案甲 阶段 5: a figure's 外貌 lives in the host's 配图 人物库. A pack leaving the library takes it along as the figure
// extension dsh.image-character (the host answers figureImageExtras); the stored pack never holds it.
const look = {traits:{face:'红色马尾', bodySFW:'高挑'}, outfits:[{id:'core', name:'常服', upper:'灰大衣'}]}

async function installed(t, extras, media = () => assert.fail('the pack holds every picture'), options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'figure-image-extras-')), asked = []
  const service = createAssetPackService({...options, assetRoot:path.join(root, 'library'), figureImageExtras:async input => { asked.push(input); return extras(input) }, figureImageMedia:async input => media(input)})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const pack = await syntheticPack(), input = path.join(root, 'input.zip')
  await writeZip(input, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([name, data]) => ({path:name, data}))])
  const preview = await service.inspectImportFile({file:input})
  const {snapshot} = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})
  return {service, snapshot, asked}
}

async function exportedFigure(file) {
  const zip = await openZip(file)
  return JSON.parse((await zip.read(zip.entries.find(entry => entry.path === `figures/${FIGURE_ID}.json`))).toString('utf8'))
}

test('an exported pack carries each figure\'s 配图 外貌; the installed pack does not, and the export still installs', async t => {
  const {service, snapshot, asked} = await installed(t, ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, look])))
  const archive = await service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision})
  t.after(() => archive.dispose())
  assert.deepEqual(asked, [{packId:PACK_ID, figureIds:[FIGURE_ID]}])
  assert.deepEqual((await exportedFigure(archive.file)).extensions['dsh.image-character'], look)
  assert.equal((await service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].extensions?.['dsh.image-character'], undefined)
  await service.inspectImportFile({file:archive.file})
})

test('an exported pack carries the record\'s 参考图 as pack media: one the pack holds stays one blob, an uploaded one is read from the host', async t => {
  const upload = png([12, 34, 56]), uploaded = digest(upload), media = []
  let sprite
  const {service, snapshot} = await installed(t, ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, {...look, referenceImage:{media:uploaded, name:'自传设定图'},
    outfits:[{...look.outfits[0], characterOutfitImage:{media:sprite, name:'常服 立绘参考'}}]}])), input => { media.push(input); return {bytes:new Uint8Array(upload)} })
  const stored = await service.getPackSnapshot({packId:PACK_ID})
  sprite = Object.values(stored.figures[FIGURE_ID].outfits.find(outfit => outfit.sprite).sprite.assets)[0]
  const archive = await service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision})
  t.after(() => archive.dispose())
  assert.deepEqual(media, [{packId:PACK_ID, figureId:FIGURE_ID, media:uploaded}], 'only the picture the pack lacks is read')
  const zip = await openZip(archive.file), manifest = JSON.parse((await zip.read(zip.entries.find(entry => entry.path === 'manifest.json'))).toString('utf8'))
  assert.deepEqual(manifest.blobs[uploaded], {ext:'png', mime:'image/png', size:upload.length})
  assert.deepEqual((await zip.read(zip.entries.find(entry => entry.path === `media/${uploaded}.png`))), upload)
  assert.equal((await exportedFigure(archive.file)).extensions['dsh.image-character'].referenceImage.media, uploaded)
  assert.equal(Object.keys(stored.manifest.blobs).length + 1, Object.keys(manifest.blobs).length)
  await service.inspectImportFile({file:archive.file})
})

for (const route of ['withCardExport', 'exportCardBundle']) {
  test(`${route} carries a reference image held only by the figure library`, async t => {
    const upload = png([23, 45, 67]), uploaded = digest(upload), media = []
    const prep = createCardPreparation()
    const workspace = prep.create({kind:'import', payload:{name:'Reference card', extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[PACK_ID]}}}}})
    const cardTransactions = createCardBundleAdapter({cardPreparation:prep, authorizeTarget:async () => ({cardId:'fixture'}),
      readWorkspace:async () => structuredClone(workspace), withCardLock:async (_, task) => task()})
    const {service} = await installed(t, () => ({[FIGURE_ID]:{...look, referenceImage:{media:uploaded}}}),
      input => { media.push(input); return {bytes:new Uint8Array(upload)} }, {cardTransactions})
    const input = {path:'cards/fixture.json', expectedRevision:(await cardTransactions.snapshot({path:'cards/fixture.json'})).revision, packIds:[PACK_ID]}
    if (route === 'withCardExport') {
      await service.withCardExport(input, async ({packs}) => {
        assert.equal(packs[0].manifest.blobs[uploaded].size, upload.length)
        assert.deepEqual(packs[0].files.get(`media/${uploaded}.png`), upload)
        const figure = JSON.parse(packs[0].files.get(`figures/${FIGURE_ID}.json`).toString('utf8'))
        assert.equal(figure.extensions['dsh.image-character'].referenceImage.media, uploaded)
      })
    } else {
      const archive = await service.exportCardBundle(input)
      t.after(() => archive.dispose())
      const zip = await openZip(archive.file)
      assert.deepEqual(await zip.read(zip.entries.find(entry => entry.path === `packs/${PACK_ID}/media/${uploaded}.png`)), upload)
      const preview = await service.inspectCardBundle({path:input.path, bytes:new Uint8Array(await readFile(archive.file))})
      assert.equal(preview.packs[0].incoming.figures[FIGURE_ID].extensions['dsh.image-character'].referenceImage.media, uploaded)
    }
    assert.deepEqual(media, [{packId:PACK_ID, figureId:FIGURE_ID, media:uploaded}])
    assert.equal((await service.getPackSnapshot({packId:PACK_ID})).manifest.blobs[uploaded], undefined)
  })
}

test('a figure without a 配图 record exports as it is', async t => {
  const {service, snapshot} = await installed(t, () => ({}))
  const archive = await service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision})
  t.after(() => archive.dispose())
  assert.equal((await exportedFigure(archive.file)).extensions?.['dsh.image-character'], undefined)
})

test('a copied figure carries its source\'s 配图 外貌 for the host to give it a record of its own', async t => {
  const {service} = await installed(t, ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, look])))
  const target = await service.createPack({name:'副本', description:'', expectedRevision:null})
  const copied = await service.copyFigure({source:{packId:PACK_ID, figureId:FIGURE_ID}, target:{packId:target.snapshot.manifest.id, expectedRevision:target.snapshot.revision}})
  const figure = Object.values((await service.getPackSnapshot({packId:target.snapshot.manifest.id})).figures)[0]
  assert.ok(copied)
  assert.deepEqual(figure.extensions['dsh.image-character'], look)
})

test('a copy carries an uploaded 参考图 until the host moves the extension into a record; the picture then leaves the pack', async t => {
  const upload = png([65, 43, 21]), uploaded = digest(upload)
  const {service} = await installed(t, ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, {...look, referenceImage:{media:uploaded}}])), () => ({bytes:new Uint8Array(upload)}))
  const target = await service.createPack({name:'副本', description:'', expectedRevision:null}), packId = target.snapshot.manifest.id
  await service.copyFigure({source:{packId:PACK_ID, figureId:FIGURE_ID}, target:{packId, expectedRevision:target.snapshot.revision}})
  const copied = await service.getPackSnapshot({packId}), figureId = copied.manifest.figures[0]
  assert.equal(copied.figures[figureId].extensions['dsh.image-character'].referenceImage.media, uploaded)
  assert.ok(copied.manifest.blobs[uploaded])
  await service.patchFigure({packId, expectedRevision:copied.revision, figureId, patch:{extensions:null}})
  assert.equal((await service.getPackSnapshot({packId})).manifest.blobs[uploaded], undefined)
})

test('updating the same pack lists each figure whose imported 外貌 differs; the adopted ones reach the host before the write', async t => {
  let local = look
  const root = await mkdtemp(path.join(tmpdir(), 'figure-image-looks-')), adopted = [], events = []
  const service = createAssetPackService({assetRoot:path.join(root, 'library'),
    figureImageExtras:async ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, local])),
    adoptFigureImageLooks:async input => { adopted.push(input); events.push('adopt') }})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const pack = await syntheticPack(), input = path.join(root, 'input.zip')
  await writeZip(input, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([name, data]) => ({path:name, data}))])
  const first = await service.inspectImportFile({file:input})
  assert.deepEqual(first.figureLooks, [], 'a new install has nothing local to keep')
  const {snapshot} = await service.applyImport({inspectionId:first.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})
  const archive = await service.exportPack({packId:PACK_ID, expectedRevision:snapshot.revision})
  t.after(() => archive.dispose())
  // the same look locally: nothing to choose
  const same = await service.inspectImportFile({file:archive.file})
  assert.deepEqual(same.choices, ['update', 'keep-both', 'cancel'])
  assert.deepEqual(same.figureLooks, [])
  await service.applyImport({inspectionId:same.inspectionId, expectedRevision:same.expectedRevision, decision:'cancel'})
  local = {traits:{face:'黑色短发'}}
  const preview = await service.inspectImportFile({file:archive.file})
  assert.deepEqual(preview.figureLooks.map(({figureId, local, incoming}) => ({figureId, local, incoming})), [{figureId:FIGURE_ID, local, incoming:look}])
  await assert.rejects(service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'keep-both', adoptLooks:[FIGURE_ID]}), /Adopted looks/)
  await assert.rejects(service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'update', adoptLooks:['someone-else']}), /Adopted looks/)
  assert.deepEqual(adopted, [])
  service.subscribe(() => events.push('write'))
  await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'update', acceptScriptRisk:true, adoptLooks:[FIGURE_ID]})
  assert.deepEqual(adopted, [{packId:PACK_ID, figureIds:[FIGURE_ID]}])
  assert.equal(events[0], 'adopt', 'the host hears the choice before the write it follows')
  assert.ok(events.includes('write'))
  assert.deepEqual((await service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].extensions['dsh.image-character'], look, 'the host moves it into the record')
})

test('a record\'s extension is its non-empty views and outfit texts', () => {
  assert.deepEqual(imageCharacterExtension({traits:{face:' 红色马尾 ', bodySFW:'', feature:'虎牙'}, outfits:[{id:'core', name:'常服', upper:'灰大衣', lower:''}, {id:'empty', name:'空'},
    {id:'pic', name:'礼服', characterOutfitImage:{id:'y', mediaType:'image/png', byteLength:3}}], referenceImage:{id:'x', mediaType:'image/png', name:'设定图', byteLength:3}}),
    {traits:{face:'红色马尾', feature:'虎牙'}, referenceImage:{media:'x', name:'设定图'}, outfits:[{id:'core', name:'常服', upper:'灰大衣'}, {id:'pic', name:'礼服', characterOutfitImage:{media:'y'}}]})
  assert.equal(imageCharacterExtension({traits:{}, outfits:[{id:'core', name:'常服'}]}), null)
})
