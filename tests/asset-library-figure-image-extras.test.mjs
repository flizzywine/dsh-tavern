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

test('a copied figure carries its source\'s 配图 外貌 for the host to give it a record of its own', async t => {
  const {service} = await installed(t, ({figureIds}) => Object.fromEntries(figureIds.map(id => [id, look])))
  const target = await service.createPack({name:'副本', description:'', expectedRevision:null})
  const copied = await service.copyFigure({source:{packId:PACK_ID, figureId:FIGURE_ID}, target:{packId:target.snapshot.manifest.id, expectedRevision:target.snapshot.revision}})
  const figure = Object.values((await service.getPackSnapshot({packId:target.snapshot.manifest.id})).figures)[0]
  assert.ok(copied)
  assert.deepEqual(figure.extensions['dsh.image-character'], look)
})
