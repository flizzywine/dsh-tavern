import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile, lstat, utimes } from 'node:fs/promises'
import { createAssetPackService } from '../src/pack-v2/service.js'
import { sealPack, jsonBytes } from '../src/pack-v2/validation.js'
import { isMetadataEdit } from '../src/pack-v2/metadata-edit.js'
import { writeZip } from '../src/zip.js'
import { syntheticPack, PACK_ID, FIGURE_ID, digest } from '../../../../tests/fixtures/asset-packs/pack.mjs'
async function fixture(t, fileCount = 0, figureCount = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-cache-')), assetRoot = path.join(root, 'assets')
  let decodes = 0, inspections = 0, authorizations = 0, unsafe = false
  const service = createAssetPackService({assetRoot, decodeMedia:async () => { decodes++; return {width:1,height:1} },
    inspectPath:async file => { inspections++; const info = await lstat(file); if (unsafe && file.endsWith('.webp')) info.isSymbolicLink = () => true; return info },
    authorizeLease:async () => { authorizations++; return true }})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true,force:true}) })
  const pack = await syntheticPack(), bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'), hash = digest(bytes)
  pack.manifest.blobs[hash] = {ext:'webp',mime:'image/webp',size:bytes.length}; pack.files.set(`media/${hash}.webp`, bytes)
  // installed images must be referenced, never loose staging blobs.
  pack.manifest.assets.push({...pack.manifest.assets[0],id:'cache-image',name:'Cache image',variants:{default:'webp',entries:[{id:'webp',name:'WebP',content:{media:hash}}]}})
  // exercise a realistic large pack without real user assets.
  while (pack.files.size < fileCount) {
    const name = `bundles/casual/fixture-${pack.files.size}.txt`
    pack.files.set(name, Buffer.from('fixture'))
  }
  for (let i = 1; i < figureCount; i++) {
    const id = randomUUID(), figure = {...pack.figures[FIGURE_ID], id, name:'Hydration figure ' + i}
    pack.manifest.figures.push(id)
    pack.files.set(`figures/${id}.json`, jsonBytes(figure))
  }
  await sealPack(pack.manifest,pack.files)
  const zip = path.join(root,'test.zip')
  await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const preview = await service.inspectImport({bytes:await readFile(zip)})
  await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
  return {service,assetRoot,hash, get decodes() {return decodes}, get inspections() {return inspections}, get authorizations() {return authorizations}, unsafe() {unsafe = true}}
}
test('concurrent snapshot readers share frozen documents without deep copies across publication', async t => {
  const f = await fixture(t, 0, 16)
  const read = () => f.service.getPackSnapshot({packId:PACK_ID})
  function assertFrozen(value) {
    if (!value || typeof value !== 'object') return
    assert.ok(Object.isFrozen(value))
    for (const child of Object.values(value)) assertFrozen(child)
  }
  async function concurrent() {
    const original = global.structuredClone
    let copies = 0
    global.structuredClone = (...args) => { copies++; return original(...args) }
    let values
    try { values = await Promise.all(Array.from({length:10}, read)) }
    finally { global.structuredClone = original }
    assert.equal(copies, 0, 'neither the gated read nor its callers deep-copy the pack')
    assert.ok(values.every(value => value === values[0]), 'one shared result for concurrent readers')
    assertFrozen(values[0])
    return values[0]
  }
  const before = await concurrent(), name = before.figures[FIGURE_ID].name
  assert.throws(() => { before.revision = 'caller revision' }, TypeError)
  assert.throws(() => { before.figures[FIGURE_ID].name = 'caller name' }, TypeError)
  assert.throws(() => { before.manifest.assets.push({id:'caller asset'}) }, TypeError)
  assert.throws(() => { delete before.sprites.school }, TypeError)
  const warm = await concurrent()
  assert.equal(warm.figures, before.figures, 'warm reads share the existing metadata graph')
  assert.equal(warm.manifest, before.manifest)
  assert.equal(warm.figures[FIGURE_ID].name, name)
  const published = await f.service.patchFigure({packId:PACK_ID,expectedRevision:before.revision,figureId:FIGURE_ID,patch:{name:'Published figure'}})
  const after = await concurrent()
  assert.equal(after.revision, published.snapshot.revision)
  assert.notEqual(after.revision, before.revision)
  assert.equal(after.figures[FIGURE_ID].name, 'Published figure')
  assert.equal(before.figures[FIGURE_ID].name, name, 'publication cannot change a held old snapshot')
  assert.throws(() => { published.snapshot.figures[FIGURE_ID].outfits.length = 0 }, TypeError)
  assertFrozen((await f.service.listPacks())[0])
  const preview = await f.service.migrateFigureVariants({packId:PACK_ID,expectedRevision:after.revision,dryRun:true})
  assertFrozen(preview.snapshot)
  const editable = structuredClone(after.figures[FIGURE_ID])
  editable.name = 'Local draft'
  assert.equal((await read()).figures[FIGURE_ID].name, 'Published figure')
})

test('metadata eligibility compares resources without serializing whole pack graphs', async () => {
  const before = await syntheticPack(), manifest = structuredClone(before.manifest), figures = structuredClone(before.figures)
  manifest.name = 'Renamed pack'
  figures[FIGURE_ID].remark = 'Author-only change'
  figures[FIGURE_ID].outfits.reverse()
  const background = manifest.assets.find(asset => asset.kind === 'backgrounds')
  background.variants.entries.reverse()
  background.variants.default = background.variants.entries[0].id
  const stringify = JSON.stringify
  let resourceSerializations = 0
  JSON.stringify = (value, ...args) => {
    if (value?.manifest?.files && value?.figures) resourceSerializations++
    return stringify(value, ...args)
  }
  try {
    assert.equal(isMetadataEdit(before, manifest, figures), true)
    background.variants.entries[0].content.media = 'f'.repeat(64)
    assert.equal(isMetadataEdit(before, manifest, figures), false, 'media changes still need the full validator')
  } finally { JSON.stringify = stringify }
  assert.equal(resourceSerializations, 0, 'eligibility must not allocate serialized copies of the entire resource graph')
})

test('warm catalogues reuse validated metadata, batch each pack once and never issue leases', async t => {
  const f = await fixture(t)
  await f.service.listPacks()
  const count = f.decodes
  const ref = {packId:PACK_ID,figureId:FIGURE_ID}
  let before = f.inspections
  await f.service.resolveFigures({refs:[ref]})
  const single = f.inspections - before
  before = f.inspections
  const resolved = await f.service.resolveFigures({refs:Array.from({length:100}, () => ref)})
  assert.equal(f.inspections - before,single)
  assert.equal(resolved.length,100)
  // resolved voices are pack-owned voiceSpec, not figure-inline presets.
  assert.ok(resolved[0].voiceSpec.sources.fish.references[1].text)
  await f.service.getPackSnapshot({packId:PACK_ID}); await f.service.listPacks()
  assert.equal(f.decodes,count)
  assert.equal(f.authorizations,0)
  resolved[0].value.name = 'caller mutation'
  assert.notEqual((await f.service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].name, 'caller mutation')
})
test('cold summary lists do not hydrate figure or sprite documents; details and revisions still hydrate', async t => {
  const f = await fixture(t), paths = []
  const service = createAssetPackService({assetRoot:f.assetRoot, inspectPath:async file => { paths.push(file.replaceAll('\\', '/')); return lstat(file) }})
  t.after(() => service.dispose())
  const expected = await f.service.listPackSummaries()
  assert.deepEqual(await service.listPackSummaries(), expected)
  assert.ok(!paths.some(file => /\/(figures|sprites)(\/|$)/.test(file)), 'summary reads must not scale with installed figure/outfit documents')
  const full = await service.getPackSnapshot({packId:PACK_ID})
  assert.ok(full.figures[FIGURE_ID])
  assert.ok(Object.keys(full.sprites).length)
  assert.ok(paths.some(file => file.endsWith(`/figures/${FIGURE_ID}.json`)))
  assert.deepEqual(await service.listPackSummaries(), expected)
  const changed = await f.service.patchPack({packId:PACK_ID,expectedRevision:full.revision,patch:{name:'Changed summary'}})
  paths.length = 0
  const rows = await service.listPackSummaries()
  assert.equal(rows[0].name, 'Changed summary')
  assert.equal(rows[0].revision, changed.snapshot.revision)
  assert.ok(!paths.some(file => /\/(figures|sprites)(\/|$)/.test(file)))
  assert.equal((await service.getPackSnapshot({packId:PACK_ID})).figures[FIGURE_ID].name, full.figures[FIGURE_ID].name)
})
test('summary I/O is bounded and overlapping, preserving order and corrupt-pack isolation', async t => {
  const f = await fixture(t)
  for (let i = 0; i < 10; i++) await f.service.createPack({name:'List ' + i,expectedRevision:null})
  const expected = (await f.service.listPackSummaries()).map(row => row.packId)
  await writeFile(path.join(f.assetRoot,'packs',PACK_ID,'manifest.json'), '{broken')
  let active = 0, peak = 0
  const service = createAssetPackService({assetRoot:f.assetRoot,inspectPath:async file => {
    active++; peak = Math.max(peak, active)
    try { return await lstat(file) } finally { active-- }
  }})
  t.after(() => service.dispose())
  const rows = await service.listPackSummaries()
  assert.deepEqual(rows.map(row => row.packId), expected)
  assert.ok(peak > 1 && peak <= 8, 'independent path checks must overlap with at most eight workers: ' + peak)
  assert.equal(rows.filter(row => row.error).length, 1)
  assert.equal(rows.find(row => row.error).packId, PACK_ID)
  rows.find(row => !row.error).name = 'caller mutation'
  assert.ok(!(await service.listPackSummaries()).some(row => row.name === 'caller mutation'))
})
// stored transcripts are trusted; reads never rehash previously installed data.
test('warm inline transcripts stay cached; fresh reads reject unparseable JSON', async t => {
  const f = await fixture(t); await f.service.listPacks()
  const file = path.join(f.assetRoot,'packs',PACK_ID,'figures',FIGURE_ID+'.json'), before = await lstat(file), bytes = await readFile(file) // cached figure binding
  bytes[0] ^= 1; await writeFile(file,bytes); await utimes(file,before.atime,before.mtime)
  const refs = [{packId:PACK_ID,figureId:FIGURE_ID}]
  assert.ok((await f.service.resolveFigures({refs}))[0].voiceSpec.sources.fish.references[1].text)
  const fresh = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1})})
  t.after(() => fresh.dispose())
  await assert.rejects(fresh.resolveFigures({refs}), {code:'INVALID_JSON'})
})
test('cache hits still reject reparse paths; lease reads only after validation and checks bytes', async t => {
  const f = await fixture(t); await f.service.listPacks()
  const count = f.decodes
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  const response = await f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  assert.equal(response.status,200); assert.ok((await response.arrayBuffer()).byteLength)
  assert.equal(f.decodes,count)
  f.unsafe()
  // b390d9864: the headers come from the stored size; every body chunk is read only after the path check.
  const unsafe = await f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  await assert.rejects(unsafe.arrayBuffer(), {code:'INVALID_PATH'})
})
test('list isolates a corrupt pack while reads and mutations remain fail-closed', async t => {
  const f = await fixture(t)
  const good = (await f.service.createPack({name:'Healthy',expectedRevision:null})).snapshot
  await writeFile(path.join(f.assetRoot,'packs',PACK_ID,'manifest.json'), '{broken')
  const entries = await f.service.listPacks()
  assert.equal(entries.length, 2)
  assert.equal(entries.find(p => p.manifest)?.manifest.id, good.manifest.id)
  const broken = entries.find(p => p.error)
  assert.equal(broken.packId, PACK_ID)
  assert.ok(broken.error.code && broken.error.message)
  await assert.rejects(f.service.getPackSnapshot({packId:PACK_ID}))
  await assert.rejects(f.service.createPack({name:'Must not bypass identity checks',expectedRevision:null}))
})
test('another service publication invalidates metadata; media leases follow content identity', async t => {
  const f = await fixture(t), second = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1})})
  t.after(() => second.dispose())
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  await second.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'New revision'}})
  assert.equal((await f.service.listPacks())[0].manifest.name,'New revision')
  // fe9e8fc1c: a label publication keeps the unchanged blob readable; removing the pack ends the lease.
  const respond = () => f.service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)})
  assert.ok((await (await respond()).arrayBuffer()).byteLength)
  const current = await second.getPackSnapshot({packId:PACK_ID})
  await second.removePack({packId:PACK_ID,expectedRevision:current.revision})
  await assert.rejects(respond(), {code:'ASSET_UNAVAILABLE'})
})

// a warm texture request must not scan 1,700 unrelated files.
test('1700-file pack warm Live2D reads stay under 100ms and follow the bundle content across a republish', async t => {
  const f = await fixture(t, 1700)
  const lease = await f.service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'test'})
  const read = () => f.service.respondLease({ticket:lease.ticket,resource:'textures/face.png',request:new Request(new URL('textures/face.png','http://localhost'+lease.url))})
  await read()
  const times = [], before = f.inspections
  for (let i = 0; i < 5; i++) {
    const start = performance.now(), response = await read()
    assert.equal(response.status,200); await response.arrayBuffer()
    times.push(performance.now() - start)
  }
  t.diagnostic(`warm Live2D lease ms: ${times.map(n => n.toFixed(2)).join(', ')}`)
  assert.ok(Math.max(...times) < 100, `warm reads: ${times}`)
  assert.ok(f.inspections - before < 1000, 'no whole-pack traversal')
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  await f.service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'Republished'}})
  // fe9e8fc1c: the bundle's contentHash is unchanged, so a mounting model keeps reading it.
  assert.equal((await read()).status,200)
  const current = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(current.manifest.name,'Republished')
  const fresh = await f.service.leaseBundle({packId:PACK_ID,bundleKey:'casual',origin:'http://localhost',scope:'test'})
  await f.service.removePack({packId:PACK_ID,expectedRevision:current.revision})
  // fe9e8fc1c: a removed pack is unavailable, not a content conflict.
  await assert.rejects(f.service.respondLease({ticket:fresh.ticket,resource:'model.model3.json',request:new Request('http://localhost'+fresh.url)}), {code:'ASSET_UNAVAILABLE'})
})

// delayed file I/O must not block unrelated metadata operations.
test('lease byte reads share the read gate with unrelated metadata', async t => {
  const f = await fixture(t)
  let delay = false, entered
  const waiting = new Promise(resolve => { entered = resolve })
  let release
  const gate = new Promise(resolve => { release = resolve })
  const service = createAssetPackService({assetRoot:f.assetRoot,decodeMedia:async () => ({width:1,height:1}),authorizeLease:async () => true,
    inspectPath:async file => { if (delay && file.endsWith('.webp')) { entered(); await gate } return lstat(file) }})
  t.after(() => service.dispose())
  const lease = await service.leaseMedia({packId:PACK_ID,hash:f.hash,origin:'http://localhost',scope:'test'})
  delay = true
  // b390d9864: the file is read when its body is pulled.
  const read = service.respondLease({ticket:lease.ticket,resource:'media',request:new Request('http://localhost'+lease.url)}).then(response => response.arrayBuffer())
  try {
    await waiting
    const result = await Promise.race([f.service.getPackSnapshot({packId:PACK_ID}),new Promise(resolve => setTimeout(() => resolve(null),1000))])
    assert.ok(result, 'metadata must finish while the lease file is blocked')
  } finally { release(); await read }
})

test('cold asset resolution reads manifest and widget projection without hydrating figures or sprites', async t => {
  const f = await fixture(t), paths = []
  const service = createAssetPackService({assetRoot:f.assetRoot, inspectPath:async file => {
    paths.push(file.replaceAll('\\', '/')); return lstat(file)
  }})
  t.after(() => service.dispose())
  const snapshot = await f.service.getPackSnapshot({packId:PACK_ID})
  const refs = snapshot.manifest.assets.map(a => ({packId:PACK_ID,kind:a.kind,assetId:a.id}))
  const resolved = await service.resolveAssets({refs})
  assert.deepEqual(resolved.map(r => r.value), snapshot.manifest.assets)
  assert.ok(resolved.every(r => r.revision === snapshot.revision))
  assert.ok(!paths.some(file => /\/(figures|sprites)(\/|$)/.test(file)))
  resolved[0].value.name = 'caller mutation'
  assert.deepEqual(await service.getPackSnapshot({packId:PACK_ID}), snapshot)
})

test('cold snapshot hydrates independent documents with at most eight workers and preserves document order', async t => {
  const f = await fixture(t, 0, 16)
  let active = 0, peak = 0
  const service = createAssetPackService({assetRoot:f.assetRoot, inspectPath:async file => {
    active++; peak = Math.max(peak,active)
    try { return await lstat(file) } finally { active-- }
  }})
  t.after(() => service.dispose())
  const expected = await f.service.getPackSnapshot({packId:PACK_ID})
  const actual = await service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(actual, expected)
  assert.deepEqual(Object.keys(actual.figures), actual.manifest.figures)
  assert.ok(peak > 1 && peak <= 8, 'bounded document hydration: ' + peak)
  assert.equal(active, 0)
})

test('failed hydration drains other readers before the publication gate is released', async t => {
  const f = await fixture(t, 0, 16)
  const good = (await f.service.createPack({name:'Other pack',expectedRevision:null})).snapshot
  let release, entered, failed
  const held = new Promise(resolve => {release=resolve}), waiting = new Promise(resolve => {entered=resolve})
  const failure = new Promise(resolve => {failed=resolve})
  const service = createAssetPackService({assetRoot:f.assetRoot, inspectPath:async file => {
    if (file.endsWith(FIGURE_ID+'.json')) { failed(); throw new Error('injected failed figure read') }
    if (/figures[\\/][^\\/]+\.json$/.test(file)) { entered(); await held }
    return lstat(file)
  }})
  t.after(() => service.dispose())
  const reading = service.getPackSnapshot({packId:PACK_ID})
  let settled = false
  const rejection = assert.rejects(reading, /injected failed figure read/).then(() => {settled=true})
  let otherDone = false
  const other = service.patchPack({packId:good.manifest.id,expectedRevision:good.revision,patch:{name:'After readers'}}).then(() => {otherDone=true})
  try {
    await Promise.all([waiting,failure])
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled,false,'failed worker must not release the gate while sibling I/O is active')
    assert.equal(otherDone,false,'publication must wait even after a sibling reader failed')
  } finally { release(); await rejection; await other }
  assert.equal(otherDone,true)
})
