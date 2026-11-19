import {readSmallArchive} from './fixtures/asset-packs/pack.mjs'
// the 导入导出 section exports the card with the packs left on — bound (绿灯) and
// globally enabled (蓝灯) alike. A real pack service over a temporary asset root (a copy, never live data): three packs the
// card uses, two switched on, and the ZIP must hold exactly those two; a global pack that goes along is bound to the exported
// card. Also: the 人物 ＋ path for a card without a green pack (createPack named after the card → bind → createFigure)
// produces a valid figure (stage panel r8: the ＋ picks its pack by lamp, never by name).
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation, rawData} from '../tavern-plugin/lib/domain/card-preparation.js'
import {openZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
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
async function zipEntries(f, bytes) {
  const file = path.join(f.root, crypto.randomUUID() + '.zip'); await writeFile(file, bytes)
  const zip = await openZip(file), names = []
  try { for (const entry of zip.entries) names.push(entry.path) } finally { await zip.close?.() }
  return names
}
const packDirs = names => [...new Set(names.filter(n => n.startsWith('packs/')).map(n => n.split('/')[1]))].sort()

test('card export embeds exactly the switched-on packs, global ones bound to the exported card', async t => {
  const f = await fixture(t), a = await f.pack('本卡包 A'), b = await f.pack('本卡包 B'), g = await f.pack('全局包 G')
  f.card([a, b]); f.setGlobal([g])
  const snap = await f.adapter.snapshot({path:'source'})
  // 2 of 3 on: A (bound) and G (global); B (bound) off.
  const result = await f.service.exportCardBundle({path:'source', expectedRevision:snap.revision, packIds:[g, a]})
  assert.deepEqual(result.dependencies.map(d => [d.packId, d.embedded]), [[a, true], [b, false], [g, true]])
  const names = await zipEntries(f, (await readSmallArchive(result)))
  assert.deepEqual(packDirs(names), [a, g].sort())
  // The bundle imports back: the exported card binds G, and only A and G are offered for install.
  const inspection = await f.service.inspectCardBundle({bytes:(await readSmallArchive(result)), path:'target'})
  assert.deepEqual(inspection.packs.map(p => p.packId).sort(), [a, g].sort())
  assert.deepEqual(rawData(inspection.raw).extensions.dsh_tavern.assetBindings.boundPackIds, [a, b, g])
  // The source card is untouched.
  assert.equal((await f.adapter.snapshot({path:'source'})).revision, snap.revision)
  assert.deepEqual(rawData((await f.adapter.snapshot({path:'source'})).raw).extensions.dsh_tavern.assetBindings.boundPackIds, [a, b])
})
