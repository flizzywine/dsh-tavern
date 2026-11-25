import {readSmallArchive} from './fixtures/asset-packs/pack.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createCardZipTargets} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-zip-target.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {createFileResourceStore} from '../tavern-plugin/lib/domain/file-resources.js'
import {createCardStorage} from '../tavern-plugin/lib/card-storage.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'

import {Readable} from 'node:stream'

async function fixture(t, catalogueNetwork) {
  const root = await mkdtemp(path.join(tmpdir(), 'card-zip-new-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const resources = createFileResourceStore({dataRoot:root}), prep = createCardPreparation()
  let nextId = 'card-new', fault
  const targets = createCardZipTargets({id:() => nextId, listCards:() => resources.list('card'), readWorkspace:resources.readCard, importCard:resources.importCard})
  const adapter = createCardBundleAdapter({cardPreparation:prep, readCover:resources.readCardImage,
    authorizeTarget:async path => targets.get(path) || {cardId:(await resources.readCard(path)).meta.id},
    readWorkspace:resources.readCard, withCardLock:createCardStorage({dataRoot:root}).withCardLock,
    writeWorkspace:(path, workspace, cover) => targets.commit(path, workspace, cover)})
  const service = createAssetPackService({assetRoot:root+'/assets', cardTransactions:adapter, catalogueNetwork, fault:async point => {if (point === fault) throw new Error(point)}})
  t.after(() => service.dispose())
  const pack = (await service.createPack({name:'Bundle pack',expectedRevision:null})).snapshot
  const raw = {name:'Bundle source',description:'Preserved raw',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[pack.manifest.id]}}}}
  const source = prep.create({kind:'import',payload:raw}); source.meta.id = 'card-source'
  await resources.importCard({name:'source.json',text:JSON.stringify(raw)}, source)
  const snapshot = await adapter.snapshot({path:'cards/source.json'})
  const zip = await service.exportCardBundle({path:snapshot.path,expectedRevision:snapshot.revision,packIds:[pack.manifest.id]})
  await service.patchPack({packId:pack.manifest.id,expectedRevision:pack.revision,patch:{name:'Changed locally'}})
  async function preview() {const reserved = await targets.reserve(); return service.inspectCardBundle({path:reserved.path,bytes:(await readSmallArchive(zip))})}
  const apply = preview => service.applyCardBundle({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decisions:Object.fromEntries(preview.packs.map(pack => [pack.packId,'keep-both']))})
  return {root,resources,targets,adapter,service,raw,pack,zip,preview,apply,setId:id => {nextId=id},setFault:value => {fault=value}}
}

test('cancellation releases reservation without card or pack writes', async t => {
  const f = await fixture(t), before = await f.service.listPacks(), preview = await f.preview()
  assert.deepEqual(await f.service.applyCardBundle({inspectionId:preview.inspectionId,cancel:true}),{status:'cancelled'})
  f.targets.release(preview.path)
  assert.equal(f.targets.get(preview.path),null)
  assert.deepEqual(await f.resources.list('card'),['cards/source.json'])
  assert.deepEqual(await f.service.listPacks(),before)
  await assert.rejects(readFile(path.join(f.root,'originals',preview.path)),{code:'ENOENT'})
})
test('HTTPS URL card bundle uses validated inspection and the same atomic new-card publication', async t => {
  let f, requests=0
  f=await fixture(t,async url=>{requests++;assert.equal(url,'https://github.com/example/cards/releases/download/v1/card.zip');return {status:200,headers:{'content-length':String((f.zip).size)},body:Readable.from([(await readSmallArchive(f.zip))])}})
  const {path}=await f.targets.reserve()
  assert.throws(()=>f.service.inspectCardBundleUrl({path,url:'file:///card.zip'}))
  assert.throws(()=>f.service.inspectCardBundleUrl({path,url:'http://localhost/card.zip'}))
  assert.equal(requests,0)
  const preview=await f.service.inspectCardBundleUrl({path,url:'https://github.com/example/cards/releases/download/v1/card.zip'})
  assert.equal(await f.resources.readCard(path),undefined,'download/inspection alone cannot create a card')
  await f.apply(preview)
  assert.equal((await f.resources.readCard(path)).meta.id,'card-new')
  assert.equal(requests,1)
})

test('card URL downloads above 1 GiB reach the stream while the configured budget still applies', async t => {
  let declared = 1024 ** 3 + 1, started = false
  const f = await fixture(t, async () => ({
    status: 200,
    headers: { 'content-length': String(declared) },
    body: Readable.from((async function* () { started = true; throw new Error('fixture download interrupted') })())
  }))
  const { path } = await f.targets.reserve()
  const url = 'https://example.test/card.zip'
  await assert.rejects(f.service.inspectCardBundleUrl({ path, url }), { code: 'DOWNLOAD_FAILED' })
  assert.equal(started, true)
  declared = 3 * 1024 ** 3
  started = false
  await assert.rejects(f.service.inspectCardBundleUrl({ path, url }), { code: 'LIMIT_EXCEEDED' })
  assert.equal(started, false)
})

// 「导入示例卡：大肥鱼」 reads a GitHub releases/latest URL — a 302 to the objects host, then a
// ~206 MB body that takes minutes on a slow link. The real pinned-DNS network follows the redirect (resolve/request are
// injected; loopback stays refused) and the download is not cut at the old 3-minute deadline.
test('card URL download follows the GitHub release redirect and outlasts three minutes', async t => {
  const {createPublicNetwork} = await import('../tavern-plugin/packages/dsh-asset-library/src/pack-catalogue/network.js')
  const {EventEmitter} = await import('node:events'), {PassThrough} = await import('node:stream')
  const hosts = [], body = new PassThrough()
  const network = createPublicNetwork({resolve:async () => [{address:'140.82.112.3', family:4}], request(url, options, respond) {
    hosts.push(url.hostname)
    const response = url.hostname === 'github.com' ? Object.assign(new PassThrough(), {statusCode:302, headers:{location:'https://objects.githubusercontent.com/asset?sig=x'}}) : Object.assign(body, {statusCode:200, headers:{}})
    options.signal?.addEventListener('abort', () => response.destroy(new Error('aborted')))
    return Object.assign(new EventEmitter(), {setTimeout() {}, end() { queueMicrotask(() => respond(response)) }})
  }})
  const f = await fixture(t, network), {path} = await f.targets.reserve()
  t.mock.timers.enable({apis:['setTimeout']})
  const reading = f.service.inspectCardBundleUrl({path, url:'https://github.com/owner/repo/releases/latest/download/card.zip'})
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(4 * 60000)
  body.end((await readSmallArchive(f.zip)))
  t.mock.timers.reset()
  const preview = await reading
  assert.deepEqual(hosts, ['github.com', 'objects.githubusercontent.com'])
  assert.equal(preview.raw.name, 'Bundle source')
})
