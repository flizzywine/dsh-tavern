import {readSmallArchive} from '../../../../tests/fixtures/asset-packs/pack.mjs'
// P1 exercises only synthetic profiles and inert media/code fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, lstat, utimes } from 'node:fs/promises'
import { createAssetPackService } from '../src/pack-v2/service.js'
import { createAssetPackService as createBuiltAssetPackService } from '../lib/pack-v2/service.js'
import { checkedPath } from '../src/pack-v2/storage.js'
import { sealPack, jsonBytes } from '../src/pack-v2/validation.js'
import { writeZip } from '../src/zip.js'
import { syntheticPack, png, digest, PACK_ID, FIGURE_ID, OTHER_PACK_ID } from '../../../../tests/fixtures/asset-packs/pack.mjs'

async function fixture(t, options = {}, createService = createAssetPackService) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-v2-')), assetRoot = path.join(root,'assets')
  const service = createService({assetRoot, authorizeLease:async () => true, ...options})
  t.after(async () => { await service.dispose(); await rm(root,{recursive:true,force:true}) })
  return {service, root, assetRoot}
}
async function zip(root, pack, entries) {
  const file = path.join(root, 'archive-' + crypto.randomUUID() + '.zip')
  await writeZip(file, entries || [{path:'manifest.json',data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path,data]) => ({path,data}))])
  return readFile(file)
}
async function install(service, root, pack) {
  pack ||= await syntheticPack()
  const preview = await service.inspectImport({bytes:await zip(root,pack)})
  return service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:preview.choices.includes('install') ? 'install' : 'update'})
}
const rejected = code => error => { assert.equal(error.code,code); return true }
const snap = result => result.snapshot

test('v2 is path-free, exports a complete byte-verified pack and preserves sprite state trees', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack()
  const result = await install(service,root,pack), current = snap(result)
  assert.equal(service.apiVersion,2)
  // inert HTML has no import script risk; persistent widget grants were retired.
  assert.equal('widgetRisks' in result,false)
  assert.equal('inspectWidgetPermissions' in service,false)
  assert.deepEqual(current.figures,pack.figures)
  assert.deepEqual(current.sprites,pack.sprites)
  assert.equal(JSON.stringify(current).includes(root),false)
  const exported = await service.exportPack({packId:PACK_ID,expectedRevision:current.revision})
  const preview = await service.inspectImport({bytes:(await readSmallArchive(exported))})
  assert.deepEqual(preview.choices,['noop','cancel'])
  assert.deepEqual(preview.scriptRisk,[]) // inspection owns import consent
  const reused = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision,decision:'noop'})
  assert.equal(reused.status,'noop'); assert.equal(reused.snapshot.revision,current.revision)
  assert.equal(reused.snapshot.manifest.contentHash,current.manifest.contentHash)
  assert.deepEqual((await readdir(path.join(root,'assets','staging'))),[])
})

test('music loop seconds survive CAS, noop and a ZIP installation on another service', async t => {
  const {service,root} = await fixture(t), initial = snap(await install(service,root))
  const assets = structuredClone(initial.manifest.assets), music = assets.find(asset => asset.kind === 'music')
  const points = {loopStart:0.11609977324263039,loopEnd:90.13986394557823}
  Object.assign(music,points)
  const saved = await service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{assets}})
  const current = await service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(current.manifest.assets,assets)
  assert.equal(saved.snapshot.revision,current.revision)
  assert.equal((await service.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{assets}})).status,'noop')
  await assert.rejects(service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{assets}}),rejected('REVISION_CONFLICT'))
  const target = await fixture(t), exported = await service.exportPack({packId:PACK_ID,expectedRevision:current.revision})
  const preview = await target.service.inspectImport({bytes:(await readSmallArchive(exported))})
  const imported = await target.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
  assert.deepEqual(imported.snapshot.manifest.assets,assets)
  const badAssets = structuredClone(assets); delete badAssets.find(asset => asset.kind === 'music').loopEnd
  await assert.rejects(service.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{assets:badAssets}}))
  assert.equal((await service.getPackSnapshot({packId:PACK_ID})).revision,current.revision)
})

test('same pack CAS has exactly one winner across independent service handles', async t => {
  const {service,root,assetRoot} = await fixture(t), second = createAssetPackService({assetRoot})
  t.after(() => second.dispose())
  const current = snap(await install(service,root))
  const results = await Promise.allSettled([service,second].map((s,i) => s.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{name:'edit ' + i}})))
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1)
  const failure = results.find(r => r.status === 'rejected').reason
  assert.equal(failure.code,'REVISION_CONFLICT'); assert.ok(failure.revision); assert.ok(failure.diff)
  await assert.rejects(service.patchPack({packId:PACK_ID,patch:{name:'no token'}}),rejected('REVISION_CONFLICT'))
})

test('inspect/update freezes CAS and requires an explicit decision; changed bytes cannot replace the preview', async t => {
  const {service,root} = await fixture(t), initial = snap(await install(service,root)), pack = await syntheticPack()
  pack.manifest.name = 'Updated'; await sealPack(pack.manifest,pack.files)
  const bytes = await zip(root,pack), preview = await service.inspectImport({bytes})
  bytes.fill(0)
  assert.equal(preview.diff.metadataChanged,true); assert.deepEqual(preview.diff.affectedCards,{status:'unknown'})
  await assert.rejects(service.applyImport({inspectionId:preview.inspectionId,expectedRevision:initial.revision}),rejected('INVALID_ASSET_PACK'))
  const saved = await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:initial.revision,decision:'update'})
  assert.equal(saved.snapshot.manifest.name,'Updated'); assert.equal(saved.snapshot.manifest.id,PACK_ID)
  assert.deepEqual(saved.snapshot.manifest.figures,[FIGURE_ID]); assert.equal('widgetRisks' in saved,false) // mutations do not mint grants
  const stale = await service.inspectImport({bytes:await zip(root,await syntheticPack())})
  await service.patchPack({packId:PACK_ID,expectedRevision:saved.snapshot.revision,patch:{name:'local edit'}})
  await assert.rejects(service.applyImport({inspectionId:stale.inspectionId,expectedRevision:stale.expectedRevision,decision:'update'}),rejected('REVISION_CONFLICT'))
})

test('keep-both remaps pack, every figure and internal complete refs without touching the original', async t => {
  const {service,root} = await fixture(t), original = snap(await install(service,root)), pack = await syntheticPack()
  pack.manifest.name = 'Other'; await sealPack(pack.manifest,pack.files)
  const preview = await service.inspectImport({bytes:await zip(root,pack)})
  const result = await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:original.revision,decision:'keep-both'})
  const kept = result.snapshot
  assert.notEqual(kept.manifest.id,PACK_ID); assert.notEqual(kept.manifest.figures[0],FIGURE_ID)
  assert.equal(kept.figures[kept.manifest.figures[0]].id,kept.manifest.figures[0])
  // backgrounds no longer carry soundscape refs; figure voice bindings remain pack-local.
  assert.ok(kept.manifest.voiceLibrary.voices[kept.figures[kept.manifest.figures[0]].voice.voice])
  assert.equal(kept.manifest.assets[0].id,'classroom')
  // keep-both remaps the actual widget, not a removed grant record.
  assert.deepEqual(preview.scriptRisk,[])
  assert.deepEqual(kept.widgets.clock,original.widgets.clock)
  assert.equal('widgetRisks' in result,false)
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),original)
  assert.deepEqual(result.mapping,preview.mapping)
})

test('foreign packs cannot install duplicate global figure UUIDs; keep-both repairs the import', async t => {
  const {service,root} = await fixture(t); await install(service,root)
  // director ambience is no longer authored on background soundscapes.
  const pack = await syntheticPack(); pack.manifest.id = OTHER_PACK_ID
  await sealPack(pack.manifest,pack.files)
  const preview = await service.inspectImport({bytes:await zip(root,pack)})
  assert.deepEqual(preview.choices,['keep-both','cancel']); assert.deepEqual(preview.conflictFigures,[FIGURE_ID])
  await assert.rejects(service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'}))
  assert.equal((await service.listPacks()).length,1)
  const kept = await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'keep-both'})
  assert.notEqual(kept.snapshot.manifest.figures[0],FIGURE_ID)
})

test('figure CRUD is CAS protected, voice-only works, and retired outfit/asset IDs cannot be recycled', async t => {
  const {service,root} = await fixture(t); let current = snap(await install(service,root))
  const created = await service.createFigure({packId:PACK_ID,expectedRevision:current.revision,figure:{schemaVersion:1,name:'Voice only',aliases:[],enabled:true,outfits:[]}})
  current = created.snapshot
  assert.equal(current.figures[created.figureId].heightCm,undefined)
  current = snap(await service.patchFigure({packId:PACK_ID,figureId:created.figureId,expectedRevision:current.revision,patch:{name:'Renamed'}}))
  current = snap(await service.removeFigure({packId:PACK_ID,figureId:created.figureId,expectedRevision:current.revision}))
  assert.equal(current.figures[created.figureId],undefined)
  const assets = current.manifest.assets.filter(a => a.id !== 'bell')
  current = snap(await service.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{assets}}))
  const old = await syntheticPack()
  // Bypass keyword authoring lint so this rejected write reaches the retired-identity boundary.
  await assert.rejects(service.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{assets:old.manifest.assets},force:true}),rejected('DUPLICATE_ID'))
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),current)
})

for (const [implementation, createService] of [['source',createAssetPackService],['runtime',createBuiltAssetPackService]]) test('patchFigure outfit removal trims only exclusive sprite/media and replays noop (' + implementation + ')', async t => {
  const {service,root,assetRoot} = await fixture(t,{},createService), pack = await syntheticPack()
  const figure = pack.figures[FIGURE_ID], [school] = figure.outfits
  const addImage = color => {
    const bytes = png(color), hash = digest(bytes)
    pack.manifest.blobs[hash] = {ext:'png',mime:'image/png',size:bytes.length}
    pack.files.set('media/'+hash+'.png',bytes)
    return hash
  }
  const body = addImage([31,61,91]), avatar = addImage([92,62,32])
  pack.manifest.sprites['archive-art'] = 'sprites/archive-art/manifest.json'
  pack.files.set(pack.manifest.sprites['archive-art'],jsonBytes({kind:'static-sprites',version:1,emotions:{calm:{src:'archive/body.png'}}}))
  figure.outfits.push(
    {key:'private-art',label:'Archived stills',enabled:true,sprite:{manifestKey:'archive-art',assets:{'archive/body.png':body}},avatars:{calm:avatar}},
    {key:'shared-art',label:'Shared school art',enabled:true,sprite:structuredClone(school.sprite)}
  )
  pack.files.set('figures/'+FIGURE_ID+'.json',jsonBytes(figure))
  await sealPack(pack.manifest,pack.files)
  const before = snap(await install(service,root,pack)), original = before.figures[FIGURE_ID]
  const patch = {outfits:original.outfits.filter(o => !['private-art','shared-art'].includes(o.key))}
  const result = await service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:before.revision,patch})
  assert.equal(result.status,'updated')
  const after = await service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(after.figures[FIGURE_ID],{...original,...patch})
  assert.deepEqual(after.manifest.sprites,{school:before.manifest.sprites.school,casual:before.manifest.sprites.casual})
  assert.deepEqual(after.manifest.bundles,before.manifest.bundles)
  assert.deepEqual(after.manifest.voiceLibrary,before.manifest.voiceLibrary)
  assert.deepEqual(after.manifest.assets,before.manifest.assets)
  assert.deepEqual(after.sprites.school,before.sprites.school)
  for (const hash of [body,avatar]) {
    assert.equal(after.manifest.blobs[hash],undefined)
    await assert.rejects(readFile(path.join(assetRoot,'packs',PACK_ID,'media',hash+'.png')),{code:'ENOENT'})
  }
  await assert.rejects(readFile(path.join(assetRoot,'packs',PACK_ID,'sprites/archive-art/manifest.json')),{code:'ENOENT'})
  for (const [hash,descriptor] of Object.entries(before.manifest.blobs)) if (![body,avatar].includes(hash)) {
    assert.deepEqual(after.manifest.blobs[hash],descriptor)
    assert.deepEqual(await readFile(path.join(assetRoot,'packs',PACK_ID,'media',hash+'.'+descriptor.ext)),pack.files.get('media/'+hash+'.'+descriptor.ext))
  }
  const replay = await service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:after.revision,patch})
  assert.equal(replay.status,'noop'); assert.equal(replay.snapshot.revision,after.revision)
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),after)
})

test('blob store deduplicates by actual hash, rejects MIME lies and referenced removals', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack(), initial = snap(await install(service,root,pack))
  // standalone images are rejected; audio still exercises deduplication.
  const [imageHash,imageDescriptor] = Object.entries(pack.manifest.blobs).find(([,d]) => d.mime.startsWith('image/'))
  assert.throws(() => service.putBlob({packId:PACK_ID,expectedRevision:initial.revision,bytes:pack.files.get(`media/${imageHash}.${imageDescriptor.ext}`),descriptor:imageDescriptor}),rejected('INVALID_ASSET_PACK'))
  const [hash,descriptor] = Object.entries(pack.manifest.blobs).find(([,d]) => d.mime.startsWith('audio/')), bytes = pack.files.get(`media/${hash}.${descriptor.ext}`)
  const same = await service.putBlob({packId:PACK_ID,expectedRevision:initial.revision,bytes,descriptor})
  assert.equal(same.status,'noop'); assert.equal(same.hash,hash); assert.equal(same.snapshot.revision,initial.revision)
  await assert.rejects(service.putBlob({packId:PACK_ID,expectedRevision:initial.revision,bytes,descriptor:{...descriptor,ext:'mp3',mime:'audio/mpeg'}}))
  await assert.rejects(service.removeBlob({packId:PACK_ID,expectedRevision:initial.revision,hash}))
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),initial)
})

test('model bundle updates preserve nested relative trees and reject missing, remote or escaping dependencies', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack(), initial = snap(await install(service,root,pack))
  for (const moc of ['../outside.moc3','https://evil.invalid/model.moc3','missing.moc3']) {
    const files = new Map([...pack.files].filter(([n]) => n.startsWith('bundles/casual/')).map(([n,b]) => [n.slice('bundles/casual/'.length),b]))
    const model = JSON.parse(files.get('model.model3.json')); model.FileReferences.Moc = moc
    files.set('model.model3.json',jsonBytes(model))
    await assert.rejects(service.putBundle({packId:PACK_ID,expectedRevision:initial.revision,bundleKey:'casual',descriptor:{kind:'live2d',entry:'model.model3.json'},files}))
  }
  const oldLease = await service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'session'})
  const files = new Map([...pack.files].filter(([n]) => n.startsWith('bundles/casual/')).map(([n,b]) => ['nested/' + n.slice('bundles/casual/'.length),b]))
  const updated = await service.putBundle({packId:PACK_ID,expectedRevision:initial.revision,bundleKey:'casual',descriptor:{kind:'live2d',entry:'nested/model.model3.json'},files})
  assert.equal(updated.snapshot.manifest.bundles.casual.entry,'nested/model.model3.json')
  await assert.rejects(service.respondLease({ticket:oldLease.ticket,resource:'model.model3.json',request:new Request('http://localhost'+oldLease.url)}),rejected('REVISION_CONFLICT'))
  const lease = await service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'session'})
  assert.ok(lease.url.endsWith('/nested/model.model3.json'))
  const texture = new URL('textures/face.png','http://localhost' + lease.url)
  assert.equal((await service.respondLease({ticket:lease.ticket,resource:'nested/textures/face.png',request:new Request(texture)})).status,200)
})

// consent belongs to import inspection; local authoring does not create grants.
test('widget script changes require import consent, while local edits keep host-only lease authority', async t => {
  const {service,root} = await fixture(t), initial = snap(await install(service,root))
  const metadata = await service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Label only'}})
  assert.equal('widgetRisks' in metadata,false)
  const code = await service.patchPack({packId:PACK_ID,expectedRevision:metadata.snapshot.revision,fileUpdates:new Map([['bundles/widget/index.html',Buffer.from('<script>void 0</script>')]])})
  assert.equal('widgetRisks' in code,false)
  const exported = await service.exportPack({packId:PACK_ID,expectedRevision:code.snapshot.revision})
  const changed = await service.patchPack({packId:PACK_ID,expectedRevision:code.snapshot.revision,patch:{name:'After export'}})
  const preview = await service.inspectImport({bytes:(await readSmallArchive(exported))})
  assert.deepEqual(preview.scriptRisk,[{packId:PACK_ID,packName:'Label only',path:'bundles/widget/index.html',widgetId:'clock',widgetName:code.snapshot.manifest.assets.find(a=>a.id==='clock').name}])
  assert.ok(preview.choices.includes('keep-both'))
  const input = {inspectionId:preview.inspectionId,expectedRevision:changed.snapshot.revision,decision:'keep-both'}
  await assert.rejects(service.applyImport(input),rejected('SCRIPT_CONFIRMATION_REQUIRED'))
  assert.equal((await service.listPacks()).length,1)
  const copied = await service.applyImport({...input,acceptScriptRisk:true})
  assert.notEqual(copied.snapshot.manifest.id,PACK_ID)
  assert.equal('widgetRisks' in copied,false)
  await assert.rejects(service.leaseBundle({packId:PACK_ID,bundleKey:'widget',origin:'http://localhost',scope:'session'}),rejected('WIDGET_UNAUTHORIZED'))
})

// all packs use the same import/removal path, with no startup defaults.
test('pack import is explicit, editable and removable, and never reinstalls on read', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack()
  assert.deepEqual(await service.listPacks(),[])
  const preview = await service.inspectImport({bytes:await zip(root,pack)})
  const result = await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
  assert.deepEqual(preview.scriptRisk,[]) // inert imports need no script confirmation
  assert.equal(result.status,'installed')
  const changed = await service.patchPack({packId:PACK_ID,expectedRevision:result.snapshot.revision,patch:{name:'Editable pack'}})
  await service.removePack({packId:PACK_ID,expectedRevision:changed.snapshot.revision})
  assert.deepEqual(await service.listPacks(),[])
})

for (const point of ['prepared','backed-up','pack-published','local-published']) test('publication failure at ' + point + ' rolls back byte-for-byte without half packs', async t => {
  let failing = false
  const {service,root,assetRoot} = await fixture(t,{fault:async stage => { if (failing && stage === point) throw new Error('injected ' + point) }})
  const initial = snap(await install(service,root)); failing = true
  await assert.rejects(service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Failed'}}),/injected/)
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),initial)
  assert.deepEqual(await readdir(path.join(assetRoot,'staging')),[])
  await assert.rejects(service.createPack({name:'Failed new',expectedRevision:null}),/injected/)
  assert.equal((await service.listPacks()).length,1)
})

test('startup recovery rolls back a crash after pack publication before local publication', async t => {
  const {service,root,assetRoot} = await fixture(t), initial = snap(await install(service,root))
  const tx = path.join(assetRoot,'staging',crypto.randomUUID())
  await mkdir(tx,{recursive:true})
  const {rename} = await import('node:fs/promises')
  await writeFile(path.join(tx,'journal.json'),jsonBytes({version:1,id:PACK_ID,hadPack:true,hadLocal:true}))
  await rename(path.join(assetRoot,'packs',PACK_ID),path.join(tx,'old-pack'))
  await rename(path.join(assetRoot,'local',PACK_ID + '.json'),path.join(tx,'old-local.json'))
  await mkdir(path.join(assetRoot,'packs',PACK_ID))
  await writeFile(path.join(assetRoot,'packs',PACK_ID,'manifest.json'),Buffer.from('{}'))
  // legacy ownerless crash fixtures must exceed the grace period.
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(tx, stale, stale)
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}),initial)
  assert.deepEqual(await readdir(path.join(assetRoot,'staging')),[])
})

test('unrecoverable journals close the publication gate with RECOVERY_REQUIRED', async t => {
  const {service,assetRoot} = await fixture(t), tx = path.join(assetRoot,'staging',crypto.randomUUID())
  await mkdir(tx,{recursive:true}); await writeFile(path.join(tx,'journal.json'),Buffer.from('{}'))
  // recovery does not inspect fresh ownerless staging.
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(tx, stale, stale)
  await assert.rejects(service.listPacks(),rejected('RECOVERY_REQUIRED'))
  await rm(tx,{recursive:true})
  assert.deepEqual(await service.listPacks(),[])
})

test('leases enforce origin, authenticated scope, exact tree, Range/ETag/HEAD, expiry and revocation', async t => {
  let clock = 0, permitted = true
  const {service,root} = await fixture(t,{now:() => clock,leaseTtlMs:100,authorizeLease:async ({scope}) => permitted && scope === 'session'})
  const pack = await syntheticPack(); await install(service,root,pack)
  const hash = Object.keys(pack.manifest.blobs)[0]
  const lease = await service.leaseMedia({packId:PACK_ID,hash,origin:'http://localhost',scope:'session'})
  const req = (options = {}) => new Request('http://localhost' + lease.url,options)
  const response = options => service.respondLease({ticket:lease.ticket,resource:'media',request:req(options)})
  const full = await response(); assert.equal(full.status,200); assert.equal(full.headers.get('content-type'),'image/png')
  const range = await response({headers:{range:'bytes=0-3'}}); assert.equal(range.status,206); assert.equal((await range.arrayBuffer()).byteLength,4)
  const head = await response({method:'HEAD'}); assert.equal((await head.arrayBuffer()).byteLength,0)
  assert.equal((await response({headers:{'if-none-match':full.headers.get('etag')}})).status,304)
  await assert.rejects(response({headers:{origin:'https://evil.invalid'}}))
  await assert.rejects(response({headers:{'sec-fetch-site':'cross-site'}}))
  await assert.rejects(service.respondLease({ticket:lease.ticket,resource:'../media',request:req()}))
  permitted = false; await assert.rejects(response()); permitted = true
  clock = 101; await assert.rejects(response(),rejected('ASSET_UNAVAILABLE'))
  const next = await service.leaseMedia({packId:PACK_ID,hash,origin:'http://localhost',scope:'session'})
  assert.equal(service.releaseLease(next.ticket),true)
  await assert.rejects(service.respondLease({ticket:next.ticket,resource:'media',request:new Request('http://localhost' + next.url)}))
})

test('inert leases survive metadata edits; disposal and absence of an authorizer fail closed', async t => {
  const {service,root,assetRoot} = await fixture(t), initial = snap(await install(service,root))
  const hash = Object.keys(initial.manifest.blobs)[0], input = {packId:PACK_ID,hash,origin:'http://localhost',scope:'session'}
  const lease = await service.leaseMedia(input)
  await service.patchPack({packId:PACK_ID,expectedRevision:initial.revision,patch:{name:'Changed'}})
  assert.equal((await service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost' + lease.url)})).status,200)
  const writer = createAssetPackService({assetRoot}); t.after(() => writer.dispose())
  const current = await writer.getPackSnapshot({packId:PACK_ID})
  await writer.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{name:'Another publisher'}})
  assert.equal((await service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost' + lease.url)})).status,200)
  await assert.rejects(writer.leaseMedia(input),rejected('ASSET_UNAVAILABLE'))
  await service.dispose(); await assert.rejects(service.leaseMedia(input),rejected('ASSET_UNAVAILABLE'))
})

test('preview expiry and aggregate retained-spool budgets are bounded', async t => {
  let clock = 0
  const {service,root} = await fixture(t,{now:() => clock,limits:{previewTtlMs:10,previews:1}})
  const bytes = await zip(root,await syntheticPack()), first = await service.inspectImport({bytes})
  await assert.rejects(service.inspectImport({bytes}),rejected('LIMIT_EXCEEDED'))
  clock = 11
  await assert.rejects(service.applyImport({inspectionId:first.inspectionId,expectedRevision:null,decision:'install'}),rejected('ASSET_UNAVAILABLE'))
  assert.ok(await service.inspectImport({bytes}))
})

test('byte closure validation rejects bad hashes, image CRC, sprite dimensions and undeclared files', async t => {
  const {service,root} = await fixture(t)
  for (const mutate of [
    async p => { p.files.set('credits/license.txt',Buffer.from('tampered')) },
    async p => { p.files.set('credits/extra.txt',Buffer.from('undeclared')) },
    async p => { const hash = Object.keys(p.manifest.blobs)[0]; const bytes = Buffer.from(p.files.get(`media/${hash}.png`)); bytes[40] ^= 1; p.files.set(`media/${hash}.png`,bytes); await sealPack(p.manifest,p.files) },
    // canonical sprite emotions replaced ordered state arrays.
    async p => { const sprite = p.sprites.school; sprite.emotions.calm.stage.width = 9; p.files.set('sprites/school/manifest.json',jsonBytes(sprite)); await sealPack(p.manifest,p.files) }
  ]) {
    const pack = await syntheticPack(); await mutate(pack)
    await assert.rejects(service.inspectImport({bytes:await zip(root,pack)}))
    assert.deepEqual(await service.listPacks(),[])
  }
})

// ZIP mutations alter both headers where necessary; no filesystem links are created.
function central(bytes) { return bytes.readUInt32LE(bytes.length - 6) }
function replaceName(bytes, from, to) { assert.equal(from.length,to.length); let offset = 0; while ((offset = bytes.indexOf(Buffer.from(from),offset)) >= 0) { bytes.write(to,offset); offset += to.length } }
for (const kind of ['traversal','case','crc','reparse','symlink','encrypted','zip64','budget']) test('ZIP security rejects ' + kind + ' before installation', async t => {
  const {service,root} = await fixture(t,kind === 'budget' ? {limits:{totalSize:8}} : {})
  const pack = await syntheticPack(), bytes = await zip(root,pack), cd = central(bytes)
  if (kind === 'traversal') replaceName(bytes,'credits/license.txt','../evil/license.txt')
  if (kind === 'case') replaceName(bytes,'credits/license.txt','CREDITS/license.txt')
  if (kind === 'crc') { bytes.writeUInt32LE(0,14); bytes.writeUInt32LE(0,cd + 16) }
  if (kind === 'reparse') bytes.writeUInt32LE(0x400,cd + 38)
  if (kind === 'symlink') bytes.writeUInt32LE(0xa0000000,cd + 38)
  if (kind === 'encrypted') bytes.writeUInt16LE(0x801,cd + 8)
  if (kind === 'zip64') bytes.writeUInt32LE(0xffffffff,cd + 20)
  await assert.rejects(service.inspectImport({bytes}))
  assert.deepEqual(await service.listPacks(),[])
})

test('filesystem reparse checks cover what lies beneath the root and reject before any read/write', async t => {
  const {assetRoot} = await fixture(t)
  await assert.rejects(checkedPath(assetRoot,'packs/' + PACK_ID,async target => {
    if (target === path.join(assetRoot,'packs')) return {isSymbolicLink:() => true}
    return lstat(target)
  }),rejected('INVALID_PATH'))
  // The configured root may sit beneath a link (macOS /var, Android /data/user/0): its ancestors are not checked.
  const inspected = []
  assert.equal(await checkedPath(assetRoot,'packs/' + PACK_ID,async target => {
    inspected.push(target)
    return target === path.dirname(assetRoot) ? {isSymbolicLink:() => true} : lstat(target).catch(() => undefined)
  }),path.join(assetRoot,'packs',PACK_ID))
  assert.ok(inspected.every(target => target.startsWith(assetRoot + path.sep)))
})

test('resolution keeps full refs, missing/disabled diagnostics and change events, without implicit binding', async t => {
  const {service,root} = await fixture(t), events = [], off = service.subscribe(event => events.push(event))
  const initial = snap(await install(service,root))
  const refs = [{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'},{packId:PACK_ID,kind:'music',assetId:'classroom'},{packId:OTHER_PACK_ID,kind:'music',assetId:'classroom'}]
  const resolved = await service.resolveAssets({refs})
  assert.deepEqual(resolved.map(r => r.ref),refs)
  assert.equal(resolved[0].value.kind,'backgrounds'); assert.equal(resolved[1].value.kind,'music')
  assert.deepEqual(resolved[2].diagnostics,['asset-missing'])
  const figures = await service.resolveFigures({refs:[{packId:PACK_ID,figureId:FIGURE_ID},{packId:OTHER_PACK_ID,figureId:FIGURE_ID}]})
  assert.ok(figures[0].value); assert.deepEqual(figures[1].diagnostics,['figure-missing'])
  await service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:initial.revision,patch:{enabled:false}})
  assert.deepEqual((await service.resolveFigures({refs:[{packId:PACK_ID,figureId:FIGURE_ID}]}))[0].diagnostics,['figure-disabled'])
  assert.equal(events.length,2); assert.ok(events[1].figures.includes(FIGURE_ID)); assert.ok(events[1].revision)
  off()
})

test('ZIP count, entry, expansion ratio and total spool limits are enforced independently', async t => {
  const {root} = await fixture(t), bytes = await zip(root,await syntheticPack())
  for (const limits of [{entries:2},{entrySize:8},{ratio:1},{spoolBytes:bytes.length + 1}]) {
    const service = createAssetPackService({assetRoot:path.join(root,crypto.randomUUID()),limits})
    try { await assert.rejects(service.inspectImport({bytes})); assert.deepEqual(await service.listPacks(),[]) }
    finally { await service.dispose() }
  }
})

test('compressed media requires a trusted decoder and rejects inconsistent decoded dimensions', async t => {
  const {inspectMedia} = await import('../src/pack-v2/validation.js')
  // A real tiny WebP bitstream; this test exercises the decoder port, not a GPU.
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')
  const descriptor = {ext:'webp',mime:'image/webp',size:bytes.length}
  await assert.rejects(inspectMedia(bytes,descriptor),rejected('ASSET_UNAVAILABLE'))
  assert.deepEqual(await inspectMedia(bytes,descriptor,async () => ({width:1,height:1})),{width:1,height:1})
  await assert.rejects(inspectMedia(bytes,descriptor,async () => ({width:2,height:1})))
  await assert.rejects(inspectMedia(bytes,descriptor,async () => { throw new Error('decode failed') }),/decode failed/)
})

test('built v2 entry works with no source, sibling protocol, DSH or live composition', async t => {
  const {root} = await fixture(t), {cp,access} = await import('node:fs/promises'), {pathToFileURL} = await import('node:url')
  await cp(new URL('../lib/',import.meta.url),path.join(root,'lib'),{recursive:true})
  await writeFile(path.join(root,'package.json'),'{"type":"module"}')
  const {createAssetPackService:create} = await import(pathToFileURL(path.join(root,'lib/pack-v2/service.js')))
  const service = create({assetRoot:path.join(root,'isolated-profile')})
  try {
    assert.deepEqual(await service.listPacks(),[])
    await assert.rejects(access(path.join(root,'isolated-profile')),{code:'ENOENT'})
    assert.equal((await service.createPack({name:'Standalone',expectedRevision:null})).status,'installed')
  } finally { await service.dispose() }
  const entry = await readFile(new URL('../src/index.js',import.meta.url),'utf8')
  assert.match(entry,/pack-v2\/plugin\.js/)
})

test('deleted-pack tombstone CAS prevents absence ABA between inspect and apply', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack(), bytes = await zip(root,pack)
  const original = snap(await install(service,root,pack))
  await service.removePack({packId:PACK_ID,expectedRevision:original.revision})
  const stale = await service.inspectImport({bytes})
  assert.equal(typeof stale.expectedRevision,'string')
  const fresh = await service.inspectImport({bytes})
  const restored = await service.applyImport({inspectionId:fresh.inspectionId,expectedRevision:fresh.expectedRevision,decision:'install'})
  await service.removePack({packId:PACK_ID,expectedRevision:restored.snapshot.revision})
  await assert.rejects(service.applyImport({inspectionId:stale.inspectionId,expectedRevision:stale.expectedRevision,decision:'install'}),rejected('REVISION_CONFLICT'))
  assert.deepEqual(await service.listPacks(),[])
})

// pack-owned voice transcripts retain revision caching; no textFile compatibility reader.
test('pack voice transcripts use verified revision bytes without changing authored snapshots', async t => {
  const {service,root,assetRoot} = await fixture(t), pack = await syntheticPack()
  const saved = snap(await install(service,root,pack)), ref = {packId:PACK_ID,figureId:FIGURE_ID}
  const [resolved] = await service.resolveFigures({refs:[ref]})
  assert.equal(resolved.revision,saved.revision)
  // reference transcripts moved from figure presets to the pack voice library.
  const voiceId = pack.figures[FIGURE_ID].voice.voice
  assert.equal(resolved.voiceSpec.sources.fish.references[1].text,pack.manifest.voiceLibrary.voices[voiceId].sources.fish.references[1].text)
  assert.deepEqual((await service.getPackSnapshot({packId:PACK_ID})).figures,saved.figures)
  const voiceSpec=structuredClone(resolved.voiceSpec);voiceSpec.sources.fish.references[1].text='Changed reference transcript'
  const next = await service.savePackVoice({packId:PACK_ID,figureId:FIGURE_ID,voiceId,expectedRevision:saved.revision,voiceSpec})
  const [changed] = await service.resolveFigures({refs:[ref]})
  assert.equal(changed.revision,next.snapshot.revision)
  assert.notEqual(changed.revision,resolved.revision)
  assert.equal(changed.voiceSpec.sources.fish.references[1].text,'Changed reference transcript')
  await writeFile(path.join(assetRoot,'packs',PACK_ID,'figures',FIGURE_ID+'.json'),'tampered')
  assert.equal((await service.resolveFigures({refs:[ref]}))[0].voiceSpec.sources.fish.references[1].text,'Changed reference transcript')
})

test('pack voice transcripts preserve long text and reject invalid publication without truncation', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack()
  // validate transcripts through the pack-owned voice authoring API.
  let saved=snap(await install(service,root,pack))
  const voiceId=saved.figures[FIGURE_ID].voice.voice, voiceSpec=structuredClone(saved.manifest.voiceLibrary.voices[voiceId])
  // voice v4 has no invented transcript cap; provider limits belong to synthesis.
  for(const length of [1501,65537]) {
    voiceSpec.sources.fish.references[1].text='x'.repeat(length)
    saved=snap(await service.savePackVoice({packId:PACK_ID,figureId:FIGURE_ID,voiceId,expectedRevision:saved.revision,voiceSpec}))
    assert.equal(saved.manifest.voiceLibrary.voices[voiceId].sources.fish.references[1].text,voiceSpec.sources.fish.references[1].text)
  }
  voiceSpec.sources.fish.references[1].text='invalid\0text'
  await assert.rejects(service.savePackVoice({packId:PACK_ID,figureId:FIGURE_ID,voiceId,expectedRevision:saved.revision,voiceSpec}))
  assert.equal((await service.getPackSnapshot({packId:PACK_ID})).revision,saved.revision)
})

test('removeFigure atomically retires owned sprites and models, preserving shared resources and CAS', async t => {
  const {service,root} = await fixture(t), pack = await syntheticPack()
  const otherId = '44444444-4444-4444-8444-444444444444'
  const other = structuredClone(pack.figures[FIGURE_ID])
  other.id = otherId; other.name = 'Other figure'; other.outfits = [other.outfits[1]]
  pack.manifest.figures.push(otherId)
  pack.files.set(`figures/${otherId}.json`,jsonBytes(other))
  await sealPack(pack.manifest,pack.files)
  const current = snap(await install(service,root,pack))
  const lease = await service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'session'})
  const next = snap(await service.removeFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:current.revision}))
  assert.deepEqual(next.manifest.figures,[otherId])
  assert.deepEqual(Object.keys(next.sprites),['casual'])
  assert.ok(next.manifest.bundles.casual)
  assert.deepEqual(next.figures[otherId],other)
  await assert.rejects(service.removeFigure({packId:PACK_ID,figureId:otherId,expectedRevision:current.revision}),rejected('REVISION_CONFLICT'))
  const readLease = () => service.respondLease({ticket:lease.ticket,resource:'model.model3.json',request:new Request('http://localhost'+lease.url)})
  assert.equal((await readLease()).status,200,'the remaining figure still owns the same bundle')
  const last = snap(await service.removeFigure({packId:PACK_ID,figureId:otherId,expectedRevision:next.revision}))
  await assert.rejects(readLease(),rejected('REVISION_CONFLICT'))
  assert.deepEqual(last.manifest.figures,[]); assert.deepEqual(last.sprites,{})
  assert.deepEqual(Object.keys(last.manifest.bundles),['widget'])
  assert.deepEqual(last.manifest.assets,current.manifest.assets)
  const exported = await service.exportPack({packId:PACK_ID,expectedRevision:last.revision})
  assert.deepEqual((await service.inspectImport({bytes:(await readSmallArchive(exported))})).choices,['noop','cancel'])
})
test('owner remarks round-trip metadata CAS and ZIP for assets, figures and outfits',async t=>{
  const {service,root}=await fixture(t), target=await fixture(t)
  const before=snap(await install(service,root)), remark='Source id: 123\nTODO: usage notes'
  const assets=before.manifest.assets.map(asset=>({...asset,remark}))
  const figure=structuredClone(before.figures[FIGURE_ID]);figure.remark=remark
  for(const outfit of figure.outfits)outfit.remark=remark
  const input={packId:PACK_ID,expectedRevision:before.revision,patch:{assets},fileUpdates:new Map([[`figures/${FIGURE_ID}.json`,jsonBytes(figure)]])}
  const {isMetadataEdit}=await import('../src/pack-v2/metadata-edit.js')
  assert.equal(isMetadataEdit(before,{...before.manifest,assets},{...before.figures,[FIGURE_ID]:figure}),true)
  const current=snap(await service.patchPack(input))
  assert.ok(current.manifest.assets.every(asset=>asset.remark===remark))
  assert.deepEqual(current.figures[FIGURE_ID],figure)
  await assert.rejects(service.patchPack(input),rejected('REVISION_CONFLICT'))
  await assert.rejects(service.patchPack({packId:PACK_ID,expectedRevision:current.revision,patch:{assets:assets.map(asset=>({...asset,remark:42}))}}))
  const exported=await service.exportPack({packId:PACK_ID,expectedRevision:current.revision})
  const preview=await target.service.inspectImport({bytes:(await readSmallArchive(exported))})
  const imported=snap(await target.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install'}))
  assert.deepEqual(imported.manifest.assets,current.manifest.assets)
  assert.deepEqual(imported.figures,current.figures)
})

test('all native entry kinds accept optional free-text remarks, never variant content',async()=>{
  const {validateAsset}=await import('../src/asset-packs/manifest.js')
  const {ASSET_CONTENT_FIELDS}=await import('../src/shared/asset-variant-content.js')
  const {entranceDoc}=await import('../../../../tests/fixtures/stage-entrance.mjs')
  const content={videos:{bundleKey:'video',entry:'clip.webm',poster:'poster.png',durationMs:1000,size:[16,16]},entrances:{entrance:entranceDoc()},audience:{content:{persona:'Viewer',tone:'Warm',catchphrases:[],examples:[]}},directions:{text:'Quiet.'},looks:{layer:'mood',params:{}},timers:{look:'default',seconds:60,mode:'story'}}
  for(const kind of Object.keys(ASSET_CONTENT_FIELDS)){
    const payload=content[kind] || (['widgets','skins','performances'].includes(kind)?{bundleKey:'entry',entry:'entry.json'}:{media:'a'.repeat(64)})
    const base={kind,id:'entry',name:'Entry',...(kind==='skins'?{}:{enabled:true}),recall:{mode:'constant',keywords:[]},directorNote:'',...payload}
    validateAsset(base)
    const remarked={...base,remark:'Source\nTODO '.repeat(1000)}
    assert.equal(validateAsset(remarked).remark,remarked.remark)
    assert.throws(()=>validateAsset({...base,remark:42}))
    const {enabled,...identity}=base
    const variantContent=kind==='audience'?payload.content:payload
    const variant={kind,id:identity.id,name:identity.name,...(kind==='skins'?{}:{enabled}),recall:identity.recall,directorNote:'',variants:{default:'main',entries:[{id:'main',name:'Main',content:{...variantContent,remark:'not content'}}]}}
    assert.throws(()=>validateAsset(variant))
  }
})
