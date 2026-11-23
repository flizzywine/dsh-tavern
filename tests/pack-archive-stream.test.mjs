import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, stat, copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Readable, Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetPackTransport, PACK_CONTROL_PATH, PACK_DOWNLOAD_PATH} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
import {createCatalogueManager} from '../tavern-plugin/packages/dsh-asset-library/src/pack-catalogue/manager.js'
import {PACK_LIMITS, jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {PACK_BUDGET} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/budget.js'
import {writeZip, openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-archive-stream-'))
  const preparation = createCardPreparation(), cards = new Map([['source', preparation.create({kind:'import', payload:{name:'Archive fixture', extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]}}}}})]])
  const adapter = createCardBundleAdapter({cardPreparation:preparation, authorizeTarget:async () => ({cardId:'test'}), readWorkspace:async name => cards.get(name), writeWorkspace:async (name, card) => cards.set(name, card), withCardLock:async (_id, task) => task()})
  const services = []
  // node:test after hooks run in registration order, not as a cleanup stack.
  t.after(async () => {
    for (const service of services) await service.dispose()
    await rm(root, {recursive:true,force:true})
  })
  const pack = await syntheticPack(), input = path.join(root,'input.zip')
  await writeZip(input, [{path:'manifest.json',data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path,data]) => ({path,data}))])
  return {root, input, adapter, own:service => services.push(service)}
}
test('fixture teardown drains a slow thumbnail reader before removing pack files', async t => {
  const errors = []
  let finished = false
  await t.test('in-flight thumbnail', async child => {
    const f = await fixture(child)
    const started = Promise.withResolvers()
    const transport = createAssetPackTransport({assetRoot:path.join(f.root,'packs'), thumbnails:{
      delayMs:1, startupMs:1,
      onError:error => errors.push(error),
      async encodeImage(bytes) {
        started.resolve()
        await new Promise(resolve => setTimeout(resolve,100))
        await stat(path.join(f.root,'packs','local',PACK_ID+'.json'))
        finished = true
        return bytes
      }
    }})
    f.own(transport.service)
    await install(transport.service,f.input)
    await started.promise
  })
  assert.equal(finished,true,'the background reader must finish while the pack still exists')
  assert.deepEqual(errors,[],'shutdown must not produce RECOVERY_REQUIRED or missing-file errors')
})

async function install(service, file) {
  const preview = await service.inspectImportFile({file})
  return (await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})).snapshot
}

test('standalone and card exports own disk archives, round trip by file, and dispose removes them', async t => {
  const f = await fixture(t), service = createAssetPackService({assetRoot:path.join(f.root,'packs'),cardTransactions:f.adapter})
  f.own(service)
  const snapshot = await install(service, f.input)
  const archive = await service.exportPack({packId:PACK_ID,expectedRevision:snapshot.revision})
  assert.equal(archive.bytes, undefined)
  assert.equal((await stat(archive.file)).size, archive.size)
  // the archive lies on disk; the spool counts what is held in memory
  assert.equal(service.spoolUsage(),0)
  const zip = await openZip(archive.file)
  assert.ok(zip.entries.some(entry => entry.path === 'manifest.json'))
  const saved = path.join(f.root,'saved.zip')
  await copyFile(archive.file, saved)
  await archive.dispose()
  await assert.rejects(stat(archive.file), {code:'ENOENT'})
  assert.ok((await service.inspectImportFile({file:saved})).choices.includes('noop'))
  const card = await f.adapter.snapshot({path:'source'})
  const bundled = await service.exportCardBundle({path:'source',expectedRevision:card.revision,packIds:[PACK_ID]})
  assert.equal(bundled.bytes, undefined)
  const preview = await service.inspectCardBundleFile({file:bundled.file,path:'target'})
  assert.equal(preview.packs[0].packId,PACK_ID)
  await service.dispose()
  await assert.rejects(stat(bundled.file), {code:'ENOENT'})
})

test('card HTTP export returns a ticket and streams the archive without exposing host file input', async t => {
  const f = await fixture(t), routes = new Map(), transport = createAssetPackTransport({assetRoot:path.join(f.root,'packs'),cardTransactions:f.adapter})
  const detach = transport.attach({fetch:{register(route) { routes.set(route.path,route); return () => routes.delete(route.path) }}})
  f.own(transport.service)
  await install(transport.service,f.input)
  const card = await f.adapter.snapshot({path:'source'})
  const request = (url, init) => new Request('http://dsh.internal'+url, {...init,headers:{host:'host.test',origin:'https://host.test','content-type':'application/json'}})
  const response = await routes.get(PACK_CONTROL_PATH).fetch(request(PACK_CONTROL_PATH,{method:'POST',body:JSON.stringify({method:'exportCardBundle',args:{path:'source',expectedRevision:card.revision,packIds:[PACK_ID]}})}))
  const result = await response.json()
  assert.equal(result.bytes, undefined)
  assert.equal(result.file, undefined)
  assert.ok(result.download.ticket)
  const download = await routes.get(PACK_DOWNLOAD_PATH).fetch(request(result.download.url))
  let size = 0
  await pipeline(Readable.fromWeb(download.body), new Writable({write(chunk,_encoding,done) { size += chunk.length; done() }}))
  assert.equal(size, Number(download.headers.get('Content-Length')))
  assert.ok(size > 0)
  const denied = await routes.get(PACK_CONTROL_PATH).fetch(request(PACK_CONTROL_PATH,{method:'POST',body:JSON.stringify({method:'inspectImportFile',args:{file:f.input}})}))
  assert.notEqual(denied.status,200)
  detach()
})

for (const carrier of [false,true]) test(`${carrier?'HTTP':'standalone'} export archives lie on disk: their retention is bounded by count, not the memory spool, and expiry removes them`, async t => {
  const root=await mkdtemp(path.join(tmpdir(),'archive-quota-'))
  let now=0
  const options={assetRoot:root,now:()=>now,limits:{previews:3,spoolBytes:1,previewTtlMs:10}}
  const service=carrier?createAssetPackTransport(options).service:createAssetPackService(options)
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true})})
  const snapshot=(await service.createPack({name:'Quota fixture',expectedRevision:null})).snapshot
  const input={packId:snapshot.manifest.id,expectedRevision:snapshot.revision}, retained=[]
  for(let i=0;i<3;i++) retained.push(await service.exportPack(input))
  await assert.rejects(service.exportPack(input),{code:'LIMIT_EXCEEDED'})
  assert.equal(service.spoolUsage(),0)
  now=11
  const fresh=await service.exportPack(input)
  for(const archive of retained)await assert.rejects(stat(archive.file),{code:'ENOENT'})
  await fresh.dispose()
  await assert.rejects(stat(fresh.file),{code:'ENOENT'})
  await (await service.exportPack(input)).dispose()
})

test('catalogue accepts declared archives above 2 GiB, but enforces the shared budget before reading', async t => {
  const root = await mkdtemp(path.join(tmpdir(),'catalogue-cap-'))

  let declared = 2 * 1024 ** 3 + 1, read = false
  const manager = createCatalogueManager({assetRoot:root,limits:PACK_LIMITS,network:async () => ({status:200,headers:{'content-length':String(declared)},body:Readable.from((async function* () {read = true; throw Error('fixture-stream-started')})())}),inspectFile:async () => {throw Error('Incomplete download must not be inspected')},discardInspection:async () => {},listInstalled:async () => []})
  t.after(async () => { await manager.dispose(); await rm(root,{recursive:true,force:true}) })
  async function run() {
    const {jobId} = await manager.methods.startPackDownload({url:'https://example.test/pack.zip'})
    for (let i=0;i<500;i++) {
      const job = await manager.methods.getPackDownload({jobId})
      if (job.state === 'failed') return job
      await new Promise(resolve => setTimeout(resolve,10))
    }
    throw Error('download did not settle')
  }
  assert.match((await run()).error.message,/fixture-stream-started/)
  assert.equal(read,true)
  read = false; declared = PACK_BUDGET.totalSize + 1
  assert.equal((await run()).error.code,'LIMIT_EXCEEDED')
  assert.equal(read,false)
})
