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

test('new card ZIP round trip creates both versions and packs with a new meta.id', async t => {
  const f = await fixture(t), preview = await f.preview()
  assert.equal(await f.resources.readCard(preview.path), undefined)
  const result = await f.apply(preview)
  assert.equal(result.path, preview.path)
  const working = await f.resources.readCard(result.path)
  assert.equal(working.meta.id, 'card-new')
  const original = JSON.parse(await readFile(path.join(f.root,'originals',result.path),'utf8'))
  assert.deepEqual(original,working.raw)
  const mapped = result.mappings[0].packId
  // the bound card left the bundle with its stage declared (card-stage-export.js), so even a fresh profile gives it
  // dialogue bubbles: the import adds only the managed bubble instructions.
  const {character_book:book,...authored} = working.raw
  assert.equal(book.entries.length,1)
  assert.deepEqual(authored,{...f.raw,extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[mapped]},stage:{enabled:true}}}})
  const importedPack = await f.service.getPackSnapshot({packId:mapped})
  assert.equal(importedPack.manifest.name,f.pack.manifest.name)
  assert.deepEqual(importedPack.manifest.assets,f.pack.manifest.assets)
  assert.equal(f.targets.get(result.path),null)
})
test('cancellation releases reservation without card or pack writes', async t => {
  const f = await fixture(t), before = await f.service.listPacks(), preview = await f.preview()
  assert.deepEqual(await f.service.applyCardBundle({inspectionId:preview.inspectionId,cancel:true}),{status:'cancelled'})
  f.targets.release(preview.path)
  assert.equal(f.targets.get(preview.path),null)
  assert.deepEqual(await f.resources.list('card'),['cards/source.json'])
  assert.deepEqual(await f.service.listPacks(),before)
  await assert.rejects(readFile(path.join(f.root,'originals',preview.path)),{code:'ENOENT'})
})
test('existing meta.id collision is explicit even under a different filename', async t => {
  const f = await fixture(t)
  f.setId('card-source')
  await assert.rejects(f.targets.reserve(),{code:'DUPLICATE_ID'})
  assert.deepEqual(await f.resources.list('card'),['cards/source.json'])
})
test('collision appearing after reservation rolls pack publication back', async t => {
  const f = await fixture(t), preview = await f.preview(), before = await f.service.listPacks()
  const duplicate = await f.resources.readCard('cards/source.json'); duplicate.meta.id = 'card-new'
  await f.resources.importCard({name:'collision.json',text:JSON.stringify(duplicate.raw)},duplicate)
  await assert.rejects(f.apply(preview),{code:'DUPLICATE_ID'})
  assert.equal(await f.resources.readCard(preview.path),undefined)
  assert.deepEqual(await f.service.listPacks(),before)
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
test('card URL download rejects oversized responses before reading the body', async t => {
  const f=await fixture(t,async()=>({status:200,headers:{'content-length':String(300*1024**2)},body:Readable.from([Buffer.from('not a zip')])}))
  const {path}=await f.targets.reserve()
  await assert.rejects(f.service.inspectCardBundleUrl({path,url:'https://example.com/large.zip'}),{code:'LIMIT_EXCEEDED'})
  assert.equal(await f.resources.readCard(path),undefined)
})
// the UI words a failed download from its reason, so the host keeps the HTTP status and turns
// raw socket errors into DOWNLOAD_FAILED (the transport only passes a message for that code).
test('card URL download failures carry the HTTP status or a network reason, never a raw socket error', async t => {
  for (const [respond, code, message] of [
    [async () => ({status:404,headers:{},body:Readable.from([])}), 'DOWNLOAD_FAILED', /\(HTTP 404\)$/],
    [async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), {code:'ENOTFOUND'}) }, 'DOWNLOAD_FAILED', /^Network request failed \(ENOTFOUND\)$/],
    [async () => { throw new Error('socket hang up') }, 'DOWNLOAD_FAILED', /^Network request failed$/]
  ]) {
    const f = await fixture(t, respond), {path} = await f.targets.reserve()
    await assert.rejects(f.service.inspectCardBundleUrl({path, url:'https://example.com/card.zip'}), error => error.code === code && message.test(error.message))
    assert.equal(await f.resources.readCard(path), undefined)
  }
})
test('publication failure leaves neither a new card nor its copied pack', async t => {
  const f = await fixture(t), preview = await f.preview(), before = await f.service.listPacks()
  f.setFault('batch-before-card')
  await assert.rejects(f.apply(preview),/batch-before-card/)
  assert.equal(await f.resources.readCard(preview.path),undefined)
  assert.deepEqual(await f.service.listPacks(),before)
})

test('bundle import restores the picker cover through original PNG storage', async t => {
  const f = await fixture(t)
  const png = (await import('./fixtures/asset-packs/pack.mjs')).png([120,80,40])
  const source = await f.resources.readCard('cards/source.json')
  await f.resources.writeCardImage('cards/source.json', png, source)
  const snapshot = await f.adapter.snapshot({path:'cards/source.json'})
  const archive = await f.service.exportCardBundle({path:snapshot.path, expectedRevision:snapshot.revision, packIds:[]})
  const reserved = await f.targets.reserve()
  const preview = await f.service.inspectCardBundle({path:reserved.path, bytes:(await readSmallArchive(archive))})
  await f.apply(preview)
  assert.equal(await f.resources.hasCardImage(reserved.path), true)
  assert.deepEqual(await (await f.resources.cardImagePreview(reserved.path)).read(), png)
  const original = await f.resources.originalCardPayload(reserved.path)
  assert.equal(original.kind, 'png')
  assert.deepEqual(JSON.parse(Buffer.from(original.b64, 'base64')), (await f.resources.readCard(reserved.path)).raw)
})
