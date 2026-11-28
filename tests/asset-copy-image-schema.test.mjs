// 复制到…: a figure goes only into a pack of its own image schema (1: one image per state, 2: state image pools). A pack of
// the other schema refuses it before anything is written, and the player reads which figure, which packs and what to do
// (the check's `reason`, carried by the real browser port); a new pack takes the source's schema, so the copy fits it.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAssetPackTransport} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/transport.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {jsonBytes, sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'

// Every state keeps its id and becomes a pool of the image it had (the identity migration to image pools).
function identityMapping({manifest, figures, sprites}) {
  const definitions = [], outfits = [], images = []
  for (const [figureId, figure] of Object.entries(figures)) {
    for (const row of figure.emotions) definitions.push({figureId, oldStateId:row.id, stateId:row.id, label:row.label, guidance:row.guidance || ''})
    for (const outfit of figure.outfits) if (outfit.sprite) {
      const manifestKey = outfit.sprite.manifestKey, imagePools = {}
      Object.keys(sprites[manifestKey].emotions).forEach((oldId, index) => {
        const imageId = 'im' + String(index + 1).padStart(3, '0')
        images.push({figureId, outfitKey:outfit.key, oldImageId:oldId, imageId})
        imagePools[oldId] = {imageIds:[imageId], defaultImageId:imageId}
      })
      outfits.push({figureId, outfitKey:outfit.key, manifestKey, defaultState:outfit.defaultEmotion, imagePools, fallbackTo:structuredClone(outfit.fallbackTo || {})})
    }
  }
  return {ready:true, pack:manifest.id, definitions, outfits, images}
}
import {syntheticPack, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/pack-transport.js', import.meta.url), 'utf8')
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'copy-schema-')), routes = new Map()
  const host = createAssetPackTransport({assetRoot:join(root, 'assets')}), stop = host.attach({fetch:{register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }}})
  const ctx = {AbortController, setTimeout, clearTimeout, URL, Blob, Uint8Array}
  vm.runInNewContext(source, ctx)
  const client = ctx.createPackTransport({interval:10, fetch:async (path, options) => {
    const route = routes.get(path.split('?')[0])
    return route.fetch(new Request('http://dsh.internal' + path, {...options, headers:{...options.headers, host:'localhost:123', origin:'http://localhost:123', 'sec-fetch-site':'same-origin'}}))
  }})
  t.after(async () => { client.dispose(); stop(); await host.service.dispose(); await rm(root, {recursive:true, force:true}) })
  // as tests/fixtures/pack-install-fixture.mjs: 'joy' has no image of its own (it falls back to calm), so it maps to a pool
  const pack = await syntheticPack(), zip = join(root, 'pack.zip'), outfit = pack.figures[FIGURE_ID].outfits[0]
  outfit.fallbackEmotions = ['joy']; outfit.fallbackTo = {joy:'calm'}; delete outfit.avatars.joy
  pack.files.set('figures/' + FIGURE_ID + '.json', jsonBytes(pack.figures[FIGURE_ID]))
  await sealPack(pack.manifest, pack.files)
  await writeZip(zip, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([path, data]) => ({path, data}))])
  const preview = await host.service.inspectImport({bytes:await readFile(zip)})
  const before = (await host.service.applyImport({inspectionId:preview.inspectionId, expectedRevision:null, decision:'install'})).snapshot
  const pooled = (await host.service.migrateStateImages({packId:PACK_ID, expectedRevision:before.revision, mapping:identityMapping(before)})).snapshot
  const plain = (await host.service.createPack({name:'自动素材', expectedRevision:null})).snapshot
  return {service:client.service, host:host.service, pooled, plain}
}

test('a pooled figure is refused by a one-image pack with the reason the player reads, and the pack stays as it was', async t => {
  const f = await fixture(t), name = f.pooled.figures[FIGURE_ID].name
  assert.equal(f.pooled.manifest.schemaVersion, 2); assert.equal(f.plain.manifest.schemaVersion, 1)
  const error = await f.service.copyItems({sourcePackId:PACK_ID, itemRefs:[{kind:'figures', id:FIGURE_ID}], target:{packId:f.plain.manifest.id, expectedRevision:f.plain.revision}}).then(() => null, e => e)
  assert.equal(error?.code, 'UNSUPPORTED_SCHEMA_VERSION')
  assert.equal(error.reason, '「' + name + '」用的是新版图片格式（每个表情可放多张图），「自动素材」用的是旧版图片格式（每个表情一张图），两种格式的人物不能放进同一个素材包。可以复制到新建素材包，或复制到同样是新版图片格式的素材包。')
  assert.equal((await f.host.getPackSnapshot({packId:f.plain.manifest.id})).revision, f.plain.revision, 'nothing written')
  // a move says to copy instead (a move into a new pack makes a one-image pack first)
  const moved = await f.service.moveItems({sourcePackId:PACK_ID, sourceExpectedRevision:f.pooled.revision, itemRefs:[{kind:'figures', id:FIGURE_ID}], target:{packId:f.plain.manifest.id, expectedRevision:f.plain.revision}}).then(() => null, e => e)
  assert.equal(moved?.code, 'UNSUPPORTED_SCHEMA_VERSION')
  assert.match(moved.reason, /可以改用「复制到…」复制到新建素材包/)
})

test('复制到 新建素材包: the new pack takes the pooled schema and holds the copied figure', async t => {
  const f = await fixture(t)
  const result = await f.service.copyItems({sourcePackId:PACK_ID, itemRefs:[{kind:'figures', id:FIGURE_ID}], target:{newPackName:'人物 副本'}})
  const copy = await f.host.getPackSnapshot({packId:result.packId}), [figureId] = copy.manifest.figures
  assert.equal(copy.manifest.schemaVersion, 2)
  assert.equal(copy.figures[figureId].schemaVersion, 2)
  assert.deepEqual(Object.keys(copy.figures[figureId].outfits[0].sprite.imagePools).sort(), Object.keys(f.pooled.figures[FIGURE_ID].outfits[0].sprite.imagePools).sort())
})
