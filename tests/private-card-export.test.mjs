import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {syntheticPack, PACK_ID, OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'

async function inventory(root, prefix = '') {
  const rows = []
  for (const entry of await fs.readdir(path.join(root, prefix), {withFileTypes:true})) {
    const name = prefix + entry.name
    if (entry.isDirectory()) rows.push(...await inventory(root, name + '/'))
    else { const stat = await fs.stat(path.join(root, name)); rows.push([name, stat.size, stat.mtimeMs]) }
  }
  return rows.sort(([a], [b]) => a.localeCompare(b))
}

test('private pack and card export is a constructor-only read-only capability; native card export remains public', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-card-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  const assetRoot = path.join(root, 'library'), pack = await syntheticPack()
  const performance = {schema:'dsh.performance/1', id:'show', label:'Fixture', license:{privateUse:true}, packs:{}, levels:{default:2,1:{},2:{},3:{}}, timeline:{entry:{events:[]},exit:{events:[]}}}
  pack.manifest.assets.push({kind:'performances',id:'show',name:'Fixture',enabled:false,recall:{mode:'keyword',keywords:[]},directorNote:'',bundleKey:'show',entry:'performance.json'})
  pack.manifest.bundles.show = {kind:'performance',entry:'performance.json',contentHash:'0'.repeat(64)}
  pack.files.set('bundles/show/performance.json', Buffer.from(JSON.stringify(performance)))
  await sealPack(pack.manifest, pack.files)
  for (const [name, bytes] of new Map([['manifest.json',Buffer.from(JSON.stringify(pack.manifest))], ...pack.files])) {
    const file = path.join(assetRoot, 'packs', PACK_ID, name)
    await fs.mkdir(path.dirname(file), {recursive:true}); await fs.writeFile(file, bytes)
  }
  await fs.mkdir(path.join(assetRoot, 'local'), {recursive:true})
  await fs.writeFile(path.join(assetRoot, 'local', PACK_ID + '.json'), JSON.stringify({revision:'fixture-revision',retired:[],installedAt:1,updatedAt:1}))
  const prep = createCardPreparation(), workspace = prep.create({kind:'import',payload:{name:'Private card',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]}}}}})
  const cardTransactions = createCardBundleAdapter({cardPreparation:prep,authorizeTarget:async () => ({cardId:'fixture'}),readWorkspace:async () => structuredClone(workspace),withCardLock:async (_, task) => task()})
  const normal = createAssetPackService({assetRoot,cardTransactions})
  const privateService = createAssetPackService({assetRoot,cardTransactions,privateExportFile:path.join(root,'private.dshcard')})
  t.after(async () => {await normal.dispose(); await privateService.dispose()})
  const input = {path:'cards/fixture.json',expectedRevision:(await cardTransactions.snapshot({path:'cards/fixture.json'})).revision}
  const denied = {code:'PRIVATE_ASSET_NOT_EXPORTABLE'}
  await assert.rejects(normal.withCardExport(input, () => {}), denied)
  await assert.rejects(normal.withCardExport({...input,private:true,privateExportFile:'ignored'}, () => {}), denied)
  const packInput = {packId:PACK_ID,expectedRevision:'fixture-revision'}
  await assert.rejects(normal.exportPack(packInput), denied)
  await assert.rejects(normal.exportPack({...packInput,private:true,privateExportFile:path.join(root,'ignored.zip')}), denied)
  const before = await inventory(assetRoot)
  const exported = await privateService.exportPack(packInput)
  assert.equal(exported.output, path.join(root,'private.dshcard'))
  assert.equal(exported.revision, packInput.expectedRevision)
  assert.equal(exported.contentHash, pack.manifest.contentHash)
  assert.equal(exported.filename, PACK_ID + '.zip')
  assert.ok((await fs.stat(exported.output)).size > 0)
  const result = await privateService.withCardExport(input, snapshot => ({revision:snapshot.revision,ids:snapshot.packs.map(pack => pack.manifest.id)}))
  assert.deepEqual(result, {revision:input.expectedRevision,ids:[PACK_ID]})
  assert.deepEqual(await inventory(assetRoot), before)
  await assert.rejects(privateService.exportCardBundle({...input,packIds:[PACK_ID]}), denied)
  await assert.rejects(privateService.exportCardBundle({...input,packIds:[OTHER_PACK_ID]}), {code:'UNBOUND_PACK'})
})
