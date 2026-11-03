// The DSH card export (core card-files.js exportCardFile): the asset library's host-only withCardExport hands the card and
// the packs to embed to the one dsh.json writer (dsh-card-export.js); a chosen pack list binds the exported card to it
// alone, excluded figures leave with the media only they use, and the stage declaration travels without the card switches.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {exportDshCardSnapshot, writeDshCard} from '../tavern-plugin/lib/domain/dsh-card-export.js'
import {openZipFile} from '../tavern-plugin/lib/domain/zip-file.js'
import {readCardArchive} from '../tavern-plugin/lib/domain/card-archive.js'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation, rawData} from '../tavern-plugin/lib/domain/card-preparation.js'
import {cardExtension} from './fixtures/asset-packs/pack.mjs'
const clone = v => structuredClone(v)
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'card-export-r7-')), prep = createCardPreparation(), cards = new Map()
  let global = []
  const adapter = createCardBundleAdapter({cardPreparation:prep, authorizeTarget:async key => ({cardId:'card-' + key}),
    readWorkspace:async key => clone(cards.get(key)), writeWorkspace:async (key, value) => { cards.set(key, clone(value)) }, withCardLock:async (_, task) => task()})
  const service = createAssetPackService({assetRoot:path.join(root, 'assets'), cardTransactions:adapter, globalEnabledPackIds:() => global})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const pack = async name => {
    const made = await service.createPack({name, expectedRevision:null}), packId = made.snapshot.manifest.id
    await service.createFigure({packId, expectedRevision:made.snapshot.revision, figure:{schemaVersion:1, name:name + ' 人物', enabled:true, appearance:'sprite', recall:{mode:'keyword'}, outfits:[{key:'default', label:'默认', enabled:true, recall:{mode:'keyword',keywords:['私服']}}]}})
    return packId
  }
  const card = boundPackIds => { const ext = cardExtension(); ext.assetBindings = {...ext.assetBindings, boundPackIds}; delete ext.openings; cards.set('source', prep.create({kind:'import', payload:{name:'R7 卡', extensions:{dsh_tavern:ext}}})) }
  return {root, service, adapter, cards, pack, card, setGlobal:ids => { global = ids }}
}
test('host-only DSH export snapshots all bound packs and omits a figure without publishing', async t => {
  const f = await fixture(t), id = await f.pack('Portable')
  f.card([id])
  const before = await f.service.getPackSnapshot({packId:id, readOnly:true}), figureId = before.manifest.figures[0]
  const file = path.join(f.root,'portable.dshcard')
  await f.service.withCardExport({path:'source'}, ({raw,packs}) => exportDshCardSnapshot({file,card:raw,packs,excludeFigures:[figureId]}))
  const zip = await openZipFile(file)
  try {
    const archive = await readCardArchive(zip)
    assert.equal(archive.kind,'dshcard')
    assert.equal(archive.packs.length,1)
    const manifest = JSON.parse(await zip.readBuffer(zip.entries.get('assets/'+id+'/manifest.json')))
    assert.deepEqual(manifest.figures,[])
    assert.ok(!zip.entries.has('assets/'+id+'/figures/'+figureId+'.json'))
  } finally {await zip.close()}
  assert.equal((await f.service.getPackSnapshot({packId:id, readOnly:true})).revision,before.revision)
})

// The player chooses which packs travel with a DSH card (its own pack, not a shared background pack): the chosen
// list is embedded and the exported card stays bound to it alone; the source card keeps every binding.
test('DSH export with a chosen pack list embeds and binds only those packs', async t => {
  const f = await fixture(t), own = await f.pack('本卡包'), generic = await f.pack('通用背景')
  f.card([own, generic])
  const before = (await f.adapter.snapshot({path:'source'})).revision
  const read = async (name, input) => {
    const file = path.join(f.root, name)
    await f.service.withCardExport({path:'source', ...input}, ({raw,packs}) => exportDshCardSnapshot({file,card:raw,packs}))
    const zip = await openZipFile(file)
    try { const archive = await readCardArchive(zip); return {packs:archive.packs.map(p => p.id), bound:rawData(archive.card).extensions.dsh_tavern.assetBindings.boundPackIds} }
    finally { await zip.close() }
  }
  assert.deepEqual(await read('all.dshcard', {}), {packs:[own, generic], bound:[own, generic]})
  assert.deepEqual(await read('own.dshcard', {packIds:[own]}), {packs:[own], bound:[own]})
  assert.deepEqual(await read('none.dshcard', {packIds:[]}), {packs:[], bound:[]})
  const source = await f.adapter.snapshot({path:'source'})
  assert.equal(source.revision, before)
  assert.deepEqual(rawData(source.raw).extensions.dsh_tavern.assetBindings.boundPackIds, [own, generic])
})

// The asset library reaches the Tavern card adapter only through its plugin's method list (pack-v2/plugin.js); a method the
// service calls but the list lacks fails in the running app only (retainRaw did, on the first chosen-pack DSH export).
test('the asset library plugin forwards every card adapter method the pack service calls', async () => {
  const {readFile, readdir} = await import('node:fs/promises')
  const dir = new URL('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/', import.meta.url)
  const plugin = await readFile(new URL('plugin.js', dir), 'utf8')
  const forwarded = new Set(JSON.parse(plugin.match(/const cards = Object\.fromEntries\((\[[^\]]+\])/)[1].replaceAll("'", '"')))
  const called = new Set()
  for (const name of await readdir(dir)) if (name.endsWith('.js')) for (const match of (await readFile(new URL(name, dir), 'utf8')).matchAll(/adapter\(\)\.(\w+)\(/g)) called.add(match[1])
  assert.ok(called.has('retainRaw'))
  assert.deepEqual([...called].filter(method => !forwarded.has(method)), [])
  const adapter = createCardBundleAdapter({cardPreparation:createCardPreparation()})
  assert.deepEqual([...forwarded].filter(method => typeof adapter[method] !== 'function'), [])
})

// A card leaves with its stage declaration only: an older dialogue / stage pair becomes stage.enabled with dsh.json
// defaults.stage, and the card layer of the other switches (stage.switches) stays with this install.
test('DSH export writes the stage declaration and leaves the card switches home', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'card-export-stage-')), file = path.join(root, 'stage.dshcard')
  t.after(() => rm(root, {recursive:true, force:true}))
  const card = {spec:'chara_card_v3', data:{name:'月见', extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[]},
    stage:{dialogue:true, stage:true, switches:{music:'off', autoChoices:'on'}, widgets:true}}}}}
  const written = await writeDshCard({file, card, defaults:{settings:{statusBarPlacement:'body'}}})
  assert.deepEqual(written.card.data.extensions.dsh_tavern.stage, {widgets:true, enabled:true})
  assert.deepEqual(written.manifest.defaults, {settings:{statusBarPlacement:'body'}, stage:true})
  assert.deepEqual(card.data.extensions.dsh_tavern.stage.switches, {music:'off', autoChoices:'on'}, 'the source card is untouched')
  const off = await writeDshCard({file:path.join(root, 'off.dshcard'), card:{data:{name:'B', extensions:{dsh_tavern:{stage:{enabled:false}}}}}})
  assert.deepEqual([off.card.data.extensions.dsh_tavern.stage, off.manifest.defaults], [{enabled:false}, undefined])
  // a bound card that leaves its stage to the global switch declares it, so the stage comes on wherever it is imported
  // (examples/dafeiyu-card relies on it); an unbound card declares nothing.
  const bound = await writeDshCard({file:path.join(root, 'bound.dshcard'), card:{data:{name:'C', extensions:{dsh_tavern:{assetBindings:{boundPackIds:['p']}, stage:{widgets:false}}}}}})
  assert.deepEqual([bound.card.data.extensions.dsh_tavern.stage, bound.manifest.defaults], [{widgets:false, enabled:true}, {stage:true}])
  const plain = await writeDshCard({file:path.join(root, 'plain.dshcard'), card:{data:{name:'D', extensions:{dsh_tavern:{assetBindings:{boundPackIds:[]}}}}}})
  assert.deepEqual([plain.card.data.extensions.dsh_tavern.stage, plain.manifest.defaults], [undefined, undefined])
  // the card bundle ZIP carries the same declaration (card-bundle.js exportRaw).
  const adapter = createCardBundleAdapter({cardPreparation:createCardPreparation()})
  const raw = adapter.exportRaw({spec:'chara_card_v3', data:{name:'E', extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:['8eb406da-b0af-4070-9e67-8e056c5e9b2e']}, stage:{switches:{music:'off'}}}}}})
  assert.deepEqual(raw.data.extensions.dsh_tavern.stage, {enabled:true})
})