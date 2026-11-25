// 移动到…: items change packs keeping their ids; the stage finds them by kind and id in the packs a card can use.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { sealPack, jsonBytes } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { writeZip } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import { syntheticPack, PACK_ID, FIGURE_ID, OTHER_PACK_ID } from './fixtures/asset-packs/pack.mjs'

const performance = () => ({schema:'dsh.performance/1', id:'paper-show', label:'Paper show', license:{privateUse:false}, packs:{audio:OTHER_PACK_ID, mine:PACK_ID}, levels:{default:2,1:{},2:{},3:{}},
  bgm:{ref:'self:classroom',lock:true,restore:'previous'}, sfxMap:{bell:'audio:bell'},
  timeline:{entry:{events:[{at:0,do:'skin',ref:'self:paper'},{at:250,do:'sfx',ref:'audio:bell'},{at:500,do:'look',ref:'mine:dusk'}]}, exit:{events:[{at:0,do:'skin-off'},{at:0,do:'bgm-restore'}]}}})
const skin = () => ({schema:'dsh.skin/1',id:'paper',label:'Paper',textbox:{paint:{bg:'#ffffff',fg:'#111111'}},nameplate:{shape:'tag',paint:{bg:'#111111',fg:'#ffffff'}},font:{body:'neo-xihei-screen',name:'zhuque'},textFx:{reveal:'type'}})
async function fixture(t, {withPerformance = false, options = {}} = {}) {
  const root = await mkdtemp(join(tmpdir(),'asset-move-'))
  const service = createAssetPackService({assetRoot:join(root,'assets'), ...options})
  t.after(async () => { await service.dispose(); await rm(root,{recursive:true,force:true}) })
  const pack = await syntheticPack()
  if (withPerformance) for (const [kind,id,key,entry,body] of [['skins','paper','paper','skin.json',skin()], ['performances','paper-show','show','performance.json',performance()]]) {
    pack.manifest.assets.push({kind,id,name:id,...(kind==='skins'?{}:{enabled:true}),recall:{mode:'constant',keywords:[]},directorNote:'',bundleKey:key,entry})
    pack.manifest.bundles[key] = {kind:kind === 'skins' ? 'skin' : 'performance',entry,contentHash:'0'.repeat(64)}
    pack.files.set('bundles/'+key+'/'+entry,jsonBytes(body))
  }
  await sealPack(pack.manifest, pack.files)
  const file = join(root,'source.zip')
  await writeZip(file,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
  const preview = await service.inspectImport({bytes:await readFile(file)})
  await service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'install'})
  const created = (await service.createPack({name:'通用背景',expectedRevision:null})).snapshot
  const target = {packId:created.manifest.id,revision:created.revision}
  return {service, target}
}
const revision = async (service, packId) => (await service.getPackSnapshot({packId})).revision
const has = (pack, kind, id) => pack.manifest.assets.some(asset => asset.kind === kind && asset.id === id)

test('moveItems: the item keeps its id, leaves the source and takes media only it used', async t => {
  const {service, target} = await fixture(t)
  const before = await service.getPackSnapshot({packId:PACK_ID})
  const music = before.manifest.assets.find(asset => asset.kind === 'music' && asset.id === 'classroom')
  await assert.rejects(service.moveItems({sourcePackId:PACK_ID,sourceExpectedRevision:'stale',itemRefs:[{kind:'music',id:'classroom'}],target:{packId:target.packId,expectedRevision:target.revision}}),{code:'REVISION_CONFLICT'})
  const result = await service.moveItems({sourcePackId:PACK_ID,sourceExpectedRevision:before.revision,itemRefs:[{kind:'music',id:'classroom'}],target:{packId:target.packId,expectedRevision:target.revision}})
  assert.deepEqual(result.moved,[{kind:'music',id:'classroom'}])
  const source = await service.getPackSnapshot({packId:PACK_ID}), moved = await service.getPackSnapshot({packId:target.packId})
  assert.equal(source.revision,result.sourceRevision); assert.equal(moved.revision,result.revision)
  assert.ok(!has(source,'music','classroom') && has(moved,'music','classroom'))
  const copy = moved.manifest.assets.find(asset => asset.kind === 'music')
  assert.equal(copy.extensions?.dsh_tavern?.copiedFrom,undefined,'a moved item is no copy')
  assert.ok(moved.manifest.blobs[music.media],'its media goes along')
  const stillUsed = JSON.stringify(source.manifest.assets).includes(music.media)
  assert.equal(Boolean(source.manifest.blobs[music.media]),stillUsed,'the source keeps media only while something there uses it')
  // moved back: the source takes back the identity it retired
  const back = await service.moveItems({sourcePackId:target.packId,sourceExpectedRevision:moved.revision,itemRefs:[{kind:'music',id:'classroom'}],target:{packId:PACK_ID,expectedRevision:source.revision}})
  assert.ok(has(await service.getPackSnapshot({packId:PACK_ID}),'music','classroom'))
  assert.ok(!has(await service.getPackSnapshot({packId:target.packId}),'music','classroom'))
  assert.equal(back.moved.length,1)
})

test('moveItems: what stays may not name what leaves; a performance moves with its closure', async t => {
  const {service, target} = await fixture(t,{withPerformance:true})
  const write = async () => ({sourcePackId:PACK_ID,sourceExpectedRevision:await revision(service,PACK_ID),target:{packId:target.packId,expectedRevision:await revision(service,target.packId)}})
  await assert.rejects(service.moveItems({...await write(),itemRefs:[{kind:'music',id:'classroom'}]}),{code:'MOVE_REFERENCED',message:/paper-show/})
  const result = await service.moveItems({...await write(),itemRefs:[{kind:'performances',id:'paper-show'}]})
  assert.deepEqual(result.moved.map(item => item.kind + '/' + item.id).sort(),['looks/dusk','music/classroom','performances/paper-show','skins/paper'])
  const moved = await service.getPackSnapshot({packId:target.packId}), source = await service.getPackSnapshot({packId:PACK_ID})
  assert.deepEqual(moved.performances['paper-show'].bgm.ref,'self:classroom')
  assert.ok(!has(source,'performances','paper-show') && !source.manifest.bundles.show,'the bundle leaves with it')
})

test('moveItems: the same item already in the target is not a conflict; a different one is', async t => {
  const {service, target} = await fixture(t)
  await service.copyItems({sourcePackId:PACK_ID,itemRefs:[{kind:'music',id:'classroom'}],target:{packId:target.packId,expectedRevision:target.revision}})
  const result = await service.moveItems({sourcePackId:PACK_ID,sourceExpectedRevision:await revision(service,PACK_ID),itemRefs:[{kind:'music',id:'classroom'}],target:{packId:target.packId,expectedRevision:await revision(service,target.packId)}})
  assert.deepEqual(result.moved,[{kind:'music',id:'classroom'}])
  assert.ok(!has(await service.getPackSnapshot({packId:PACK_ID}),'music','classroom'))
  const made = (await service.createPack({name:'别的',expectedRevision:null})).snapshot, other = {packId:made.manifest.id,revision:made.revision}, copied = await service.copyItems({sourcePackId:target.packId,itemRefs:[{kind:'music',id:'classroom'}],target:{packId:other.packId,expectedRevision:other.revision}})
  const changed = (await service.getPackSnapshot({packId:other.packId})).manifest.assets.map(asset => ({...asset,name:'另一首'}))
  await service.patchPack({packId:other.packId,expectedRevision:copied.revision,patch:{assets:changed}})
  await assert.rejects(service.moveItems({sourcePackId:target.packId,sourceExpectedRevision:await revision(service,target.packId),itemRefs:[{kind:'music',id:'classroom'}],target:{packId:other.packId,expectedRevision:await revision(service,other.packId)}}),{code:'DUPLICATE_ID',message:/另一首/})
})

test('moveItems: a figure keeps its id, its name and its pictures; its 配图 record is relinked to the target', async t => {
  const moves = [], figureRecords = {read:async () => null, write:async ({figure}) => figure, release:async () => {}, move:async input => { moves.push(input) }}
  const {service, target} = await fixture(t,{options:{figureRecords}})
  const before = await service.getPackSnapshot({packId:PACK_ID}), figure = before.figures[FIGURE_ID]
  const result = await service.moveItems({sourcePackId:PACK_ID,sourceExpectedRevision:before.revision,itemRefs:[{kind:'figures',id:FIGURE_ID}],target:{packId:target.packId,expectedRevision:target.revision}})
  assert.ok(result.moved.some(item => item.kind === 'figures' && item.id === FIGURE_ID))
  const moved = await service.getPackSnapshot({packId:target.packId}), source = await service.getPackSnapshot({packId:PACK_ID})
  assert.ok(moved.manifest.figures.includes(FIGURE_ID) && !source.manifest.figures.includes(FIGURE_ID))
  assert.equal(moved.figures[FIGURE_ID].name, figure.name)
  assert.equal(moved.figures[FIGURE_ID].extensions?.dsh_tavern?.copiedFrom, undefined)
  assert.deepEqual(moved.figures[FIGURE_ID].outfits.map(outfit => outfit.key), figure.outfits.map(outfit => outfit.key))
  assert.deepEqual(moves, [{from:PACK_ID, to:target.packId, figureIds:[FIGURE_ID]}])
})
test('relocateStage: refs name where their items are now; nothing moved returns the same object', async () => {
  const {relocateStage, stageLocator} = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-relocate.js')
  const {figureActorKey} = await import('../tavern-plugin/lib/domain/figure-catalogue.js')
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', F = '33333333-3333-4333-8333-333333333333'
  const pack = (id, assets, figures = []) => ({manifest:{id, assets, figures}})
  const before = figureActorKey({packId:A, figureId:F})
  const state = {scene:{background:{packId:A, kind:'backgrounds', assetId:'gate'}}, cast:[before], actors:{[before]:{figure:{packId:A, figureId:F}, gaze:'viewer'}}, music:{packId:A, kind:'music', assetId:'theme'}}
  const still = stageLocator([A, B], [pack(A, [{kind:'backgrounds', id:'gate'}, {kind:'music', id:'theme'}], [F])], figureActorKey)
  assert.equal(relocateStage(state, still), state)
  // the gate and the figure went to B; the theme stays; the first usable pack holding an id is where it is
  const moved = stageLocator([A, B], [pack(A, [{kind:'music', id:'theme'}]), pack(B, [{kind:'backgrounds', id:'gate'}, {kind:'music', id:'theme'}], [F])], figureActorKey)
  const after = figureActorKey({packId:B, figureId:F}), next = relocateStage(state, moved)
  assert.deepEqual(next.scene.background, {packId:B, kind:'backgrounds', assetId:'gate'})
  assert.deepEqual(next.music, {packId:A, kind:'music', assetId:'theme'})
  assert.deepEqual(next.cast, [after]); assert.deepEqual(Object.keys(next.actors), [after]); assert.equal(next.actors[after].figure.packId, B)
  assert.equal(state.scene.background.packId, A, 'the stored value is not changed')
  // an item no usable pack holds keeps its ref (it shows as unavailable)
  assert.deepEqual(relocateStage({ref:{packId:A, kind:'sfx', assetId:'gone'}}, moved).ref.packId, A)
})
