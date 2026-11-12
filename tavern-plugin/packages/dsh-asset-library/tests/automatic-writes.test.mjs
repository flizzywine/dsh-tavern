import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAssetPackService} from '../src/pack-v2/service.js'
import {createCardBundleAdapter} from '../../dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../../../lib/domain/card-preparation.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'automatic-writes-')), file = join(root,'card.json')
  const preparation = createCardPreparation()
  await writeFile(file, JSON.stringify(preparation.create({kind:'import',payload:{name:'Test card'}})))
  let tail = Promise.resolve(), faultPoint, cardWrites = 0, inside = false
  const lock = (_id, task) => {
    const next = tail.then(async () => { inside = true; try { return await task() } finally { inside = false } })
    tail = next.catch(() => {})
    return next
  }
  const cards = createCardBundleAdapter({cardPreparation:preparation, authorizeTarget:async () => ({cardId:'test-card'}),
    readWorkspace:async () => JSON.parse(await readFile(file,'utf8')),
    writeWorkspace:async (_path,value) => { assert.ok(inside); cardWrites++; await writeFile(file,JSON.stringify(value)) }, withCardLock:lock})
  const service = createAssetPackService({assetRoot:join(root,'assets'),cardTransactions:cards,fault:async point => {
    if (point === faultPoint) { assert.ok(inside, 'publication remains inside card fence'); throw Error('injected ' + point) }
  }})
  const source = {chatId:'test-chat',branchId:'branch-a',revision:1,turn:1,messageId:'message-a',paragraphIds:['p-a']}
  const writer = service.registerAutomaticWriter({writerId:'auto-figure',plan:({source}) => [{op:'create',kind:'figures',value:{name:source.name,aliases:[]}}]})
  async function request(name, requestId = name) {
    const card = await cards.snapshot({path:'test'}), packs = await service.listPackSummaries()
    const rows = Array.isArray(packs) ? packs : packs.packs
    const target = rows[0] ? {packId:rows[0].packId,expectedRevision:rows[0].revision} : null
    const input = {path:'test',expectedCardRevision:card.revision,target,catalogueRevisions:rows.map(row => ({packId:row.packId,revision:row.revision})),requestId,source:{kind:'story-speaker',occurrenceId:requestId},changes:[{op:'create',kind:'figures',value:{name,aliases:[]}}]}
    return {input,authority:writer.authorize(input,{...source,name})}
  }
  const write = async (name,id) => { const {input,authority} = await request(name,id); return service.writeAutomaticItems(input,authority) }
  t.after(async () => { writer.dispose(); await service.dispose(); await rm(root,{recursive:true,force:true}) })
  return {service,cards,write,request,writer,file,preparation,lock,setFault:point => {faultPoint=point},get cardWrites() {return cardWrites}}
}

test('automatic writes create and bind atomically, then preserve the card revision and local receipts', async t => {
  const f = await fixture(t), first = await f.write('First speaker'), card = await f.cards.snapshot({path:'test'})
  assert.equal(first.status,'committed'); assert.equal(first.cardRevision,card.revision)
  assert.deepEqual(f.cards.inspectRaw(card.raw).boundPackIds,[first.packId])
  const second = await f.write('Second speaker')
  assert.equal(second.packId,first.packId); assert.equal(second.cardRevision,first.cardRevision); assert.equal(f.cardWrites,1)
  const pack = await f.service.getPackSnapshot({packId:first.packId})
  assert.equal(pack.manifest.name,'Test card · 自动素材')
  assert.deepEqual(Object.values(pack.figures).map(row => row.name),['First speaker','Second speaker'])
  for (const row of Object.values(pack.figures)) { assert.equal(row.appearance,'avatar'); assert.equal(row.voice,undefined); assert.deepEqual(row.outfits,[]) }
  const history = await f.service.listAutomaticWrites({packId:first.packId})
  assert.equal(history.entries.length,2)
  const ordinary = await f.service.patchPack({packId:first.packId,expectedRevision:second.revision,patch:{name:'Renamed'}})
  assert.equal((await f.service.listAutomaticWrites({packId:first.packId})).entries.length,2)
  assert.notEqual(ordinary.snapshot.revision,second.revision)
  assert.equal((await f.write('Third speaker')).packId,first.packId)
})

for (const point of ['batch-prepared','batch-backed-up','batch-pack-published','batch-local-published','batch-before-card']) test('first automatic binding rolls back at ' + point, async t => {
  const f = await fixture(t), initial = await f.cards.snapshot({path:'test'})
  f.setFault(point)
  await assert.rejects(f.write('New speaker'), /injected/)
  f.setFault(undefined)
  assert.deepEqual(await f.service.listPackSummaries(),[])
  assert.equal((await f.cards.snapshot({path:'test'})).revision,initial.revision)
  assert.equal((await f.write('New speaker')).status,'committed')
})

for (const point of ['prepared','backed-up','pack-published','local-published']) test('existing automatic binding rolls back at ' + point, async t => {
  const f = await fixture(t), initial = await f.write('First speaker')
  f.setFault(point)
  await assert.rejects(f.write('Second speaker'), /injected/)
  f.setFault(undefined)
  const pack = await f.service.getPackSnapshot({packId:initial.packId})
  assert.equal(pack.revision,initial.revision)
  assert.deepEqual(Object.values(pack.figures).map(row => row.name),['First speaker'])
  assert.equal((await f.service.listAutomaticWrites({packId:initial.packId})).entries.length,1)
  assert.equal((await f.cards.snapshot({path:'test'})).revision,initial.cardRevision)
  assert.equal(f.cardWrites,1)
})

test('a lost first card acknowledgement keeps the committed pack and receipt', async t => {
  const f = await fixture(t)
  f.setFault('batch-card-committed')
  const result = await f.write('First speaker')
  assert.equal(result.status,'committed')
  assert.equal((await f.service.listAutomaticWrites({packId:result.packId})).entries.length,1)
})

// 11-12 验收: a card bound to a pack this library does not have (a card someone shared; a pack deleted) is exactly the
// card 自动素材 is for. The missing pack is no catalogue to plan against: the automatic pack is still written.
test('a card bound to a pack that is not installed still gets automatic writes; the missing pack is named in the context', async t => {
  const f = await fixture(t), missing = '9b9b9b9b-0000-4000-8000-000000000009'
  const workspace = JSON.parse(await readFile(f.file, 'utf8'))
  const data = workspace.raw.data || workspace.raw
  data.extensions = {...data.extensions, dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[missing]}}}
  await writeFile(f.file, JSON.stringify(workspace))
  const context = await f.writer.readContext({path:'test'})
  assert.deepEqual([context.packs, context.missingPackIds], [[], [missing]])
  const first = await f.write('First speaker')
  assert.equal(first.status, 'committed')
  assert.deepEqual(f.cards.inspectRaw((await f.cards.snapshot({path:'test'})).raw).boundPackIds, [missing, first.packId], 'the missing binding stays')
  assert.equal((await f.write('Second speaker')).status, 'committed')
})

test('automatic authority is not JSON forgeable and stale catalogue CAS has one winner', async t => {
  const f = await fixture(t), a = await f.request('First'), b = await f.request('Second')
  assert.throws(() => f.service.writeAutomaticItems(a.input,{}), {code:'NOT_AUTHORIZED_WRITER'})
  const settled = await Promise.allSettled([a,b].map(row => f.service.writeAutomaticItems(row.input,row.authority)))
  assert.equal(settled.filter(row => row.status === 'fulfilled').length,1)
  assert.equal(settled.find(row => row.status === 'rejected').reason.code,'REVISION_CONFLICT')
  const created = settled.find(row => row.status === 'fulfilled').value
  const c = await f.request('Third'), d = await f.request('Fourth')
  const existing = await Promise.allSettled([c,d].map(row => f.service.writeAutomaticItems(row.input,row.authority)))
  assert.equal(existing.filter(row => row.status === 'fulfilled').length,1)
  assert.equal(existing.find(row => row.status === 'rejected').reason.code,'REVISION_CONFLICT')
  assert.equal((await f.cards.snapshot({path:'test'})).revision,created.cardRevision)
})

test('review and undo retain request dedupe and protect subsequent manual voice edits', async t => {
  const f = await fixture(t), first = await f.write('First speaker')
  assert.equal((await f.write('First speaker')).status,'noop')
  const reviewed = await f.service.reviewAutomaticWrite({packId:first.packId,expectedRevision:first.revision,writeId:first.writeId})
  assert.equal(reviewed.status,'reviewed')
  const undone = await f.service.undoAutomaticWrite({packId:first.packId,expectedRevision:reviewed.revision,writeId:first.writeId})
  assert.equal(undone.status,'undone')
  assert.equal((await f.write('First speaker')).status,'noop')
  const second = await f.write('Second speaker')
  const edited = await f.service.patchFigure({packId:second.packId,expectedRevision:second.revision,figureId:second.refs[0].figureId,patch:{name:'Manual name'}})
  await assert.rejects(f.service.undoAutomaticWrite({packId:second.packId,expectedRevision:edited.snapshot.revision,writeId:second.writeId}), {code:'AUTOMATIC_WRITE_CHANGED'})
})

test('detached automatic packs stay detached and the card fence rejects an unbound target', async t => {
  const f = await fixture(t), first = await f.write('First')
  await f.lock('test-card', async () => {
    await writeFile(f.file,JSON.stringify(f.preparation.create({kind:'import',payload:{name:'Renamed card'}})))
  })
  const card = await f.cards.snapshot({path:'test'})
  await assert.rejects(f.cards.withExistingBoundPack({path:'test',expectedRevision:card.revision,packId:first.packId}, () => assert.fail('must not publish')), {code:'ASSET_UNAVAILABLE'})
  assert.equal((await f.write('Second')).status,'noop')
  assert.deepEqual(f.cards.inspectRaw((await f.cards.snapshot({path:'test'})).raw).boundPackIds,[])
})

test('field-level patch undo preserves unrelated voice edits and restores absence', async () => {
  const {mutateAutomaticFigure,undoAutomaticDelta} = await import('../src/pack-v2/automatic-writes.js')
  const figure = {id:'figure-id',schemaVersion:1,name:'Before',enabled:true,appearance:'avatar',outfits:[]}
  const manifest = {id:'pack-id',figures:[figure.id]}, files = new Map([['figures/figure-id.json',Buffer.from(JSON.stringify(figure))]])
  const delta = mutateAutomaticFigure({manifest,files,change:{op:'patch',ref:{packId:manifest.id,kind:'figures',figureId:figure.id},patch:{name:'After',description:'Automatic note'}}})
  assert.deepEqual(delta.before,{name:'Before'})
  const current = {...JSON.parse(files.get('figures/figure-id.json')),voice:{voice:'manual-voice',source:null}}
  const restored = undoAutomaticDelta(current,delta)
  assert.equal(restored.name,'Before');assert.equal(Object.hasOwn(restored,'description'),false)
  assert.deepEqual(restored.voice,current.voice)
  assert.throws(() => undoAutomaticDelta({...current,name:'Manual name'},delta),{code:'AUTOMATIC_WRITE_CHANGED'})
})

test('a real voice binding prevents undo of an automatically created figure', async t => {
  const f = await fixture(t), first = await f.write('Speaker')
  const result = await f.service.createAndAssignPackVoice({packId:first.packId,expectedRevision:first.revision,figureId:first.refs[0].figureId,
    voiceSpec:{name:'Reader',language:'zh',defaultSource:'browser',sources:{browser:{kind:'preset',provider:'browser',voiceName:'test-voice'}}}})
  await assert.rejects(f.service.undoAutomaticWrite({packId:first.packId,expectedRevision:result.snapshot.revision,writeId:first.writeId}),{code:'AUTOMATIC_WRITE_CHANGED'})
})

test('export omits local source coordinates, routing and undo capability', async t => {
  const {readSmallArchive} = await import('../../../../tests/fixtures/asset-packs/pack.mjs')
  const f = await fixture(t), first = await f.write('Exported speaker')
  const bytes = await readSmallArchive(await f.service.exportPack({packId:first.packId,expectedRevision:first.revision}))
  const otherRoot = await mkdtemp(join(tmpdir(),'automatic-import-'))
  const other = createAssetPackService({assetRoot:otherRoot})
  t.after(async () => {await other.dispose();await rm(otherRoot,{recursive:true,force:true})})
  const preview = await other.inspectImport({bytes})
  const installed = await other.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install'})
  assert.equal(installed.snapshot.automatic,undefined)
  assert.deepEqual((await other.listAutomaticWrites({packId:first.packId})).entries,[])
  const serialized = JSON.stringify(installed.snapshot)
  assert.equal(serialized.includes('test-chat'),false);assert.equal(serialized.includes('branch-a'),false)
  assert.equal(Object.values(installed.snapshot.figures)[0].extensions['dsh.automatic-write'].writerId,'auto-figure')
})
test('renaming the card preserves automatic routing and its existing pack name', async t => {
  const f = await fixture(t), first = await f.write('First')
  const name = (await f.service.getPackSnapshot({packId:first.packId})).manifest.name
  await f.lock('test-card',async () => {
    const card = JSON.parse(await readFile(f.file,'utf8'))
    const changed = f.preparation.update({kind:'card',card,patch:{name:'Changed title'}})
    await writeFile(f.file,JSON.stringify(changed.card))
  })
  const second = await f.write('Second')
  assert.equal(second.packId,first.packId)
  assert.equal((await f.service.getPackSnapshot({packId:first.packId})).manifest.name,name)
})

// 场景生图's CG (scene-cg.js) goes to the same pack as the figures: cardAutomaticPack is that one rule for writers outside the receipts.
test('cardAutomaticPack: the card’s 自动素材 pack, made empty and bound once; the figures’ first write then uses it; null while detached', async t => {
  const f = await fixture(t)
  assert.equal(await f.service.cardAutomaticPack({path:'test'}), null, 'nothing is made without create')
  assert.deepEqual(await f.service.listPackSummaries(), [])
  const [made, again] = await Promise.all([f.service.cardAutomaticPack({path:'test', create:true}), f.service.cardAutomaticPack({path:'test', create:true})])
  assert.equal(again.packId, made.packId)
  const pack = await f.service.getPackSnapshot({packId:made.packId})
  assert.equal(pack.manifest.name, 'Test card · 自动素材'); assert.equal(pack.automatic, true)
  assert.deepEqual(f.cards.inspectRaw((await f.cards.snapshot({path:'test'})).raw).boundPackIds, [made.packId])
  assert.equal((await f.write('First speaker')).packId, made.packId)
  await f.lock('test-card', async () => {
    await writeFile(f.file, JSON.stringify(f.preparation.create({kind:'import', payload:{name:'Test card'}})))
  })
  assert.equal(await f.service.cardAutomaticPack({path:'test', create:true}), null, 'an unbound automatic pack is not used, and no second one is made')
  assert.equal((await f.service.listPackSummaries()).length, 1)
})