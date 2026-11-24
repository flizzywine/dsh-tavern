// The identity settei (人物设定图) is drawn in some outfit, usually not the one being drawn: its clothes are a sample. An outfit
// settei or a 立绘 takes only the person from it and the clothes from the outfit's own settei or text, so an outfit
// described as a bikini is not drawn as the coat the identity settei wears. When the identity board is also this outfit's
// settei (a character settei registered on both) it stays this outfit's clothing authority.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetGeneration} from '../tavern-plugin/lib/domain/asset-generation.js'
import {ASSET_REFERENCE_ROLES as roles} from '../tavern-plugin/lib/domain/asset-production-contract.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import publication from '../tavern-plugin/shared/asset-image-publication.cjs'

async function fixture(t) {
  const base = fileURLToPath(new URL('../.preview/asset-gen-identity-tests/', import.meta.url)); await mkdir(base, {recursive:true})
  const root = await mkdtemp(base + 'case-'), store = createProfileDataStore({dataRoot:root + '/data'}), library = createAssetPackService({assetRoot:root + '/packs'})
  const provider = {label:'配图', status:async () => ({ready:true, model:'gpt-image', maxReferences:4}), generate:async () => { throw new Error('not drawn') }}
  const service = createAssetGeneration({store, getLibrary:() => library, imageProvider:() => provider})
  t.after(async () => { await service.dispose(); await library.dispose() })
  const pack = (await library.createPack({name:'Sample outfit', expectedRevision:null})).snapshot
  const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:'Harbour master', appearance:'sprite',
    emotions:[{id:'calm', label:'平和'}], outfits:[
      {key:'coat', label:'Coat', enabled:true, defaultEmotion:'calm', recall:{mode:'keyword', keywords:['大衣']}},
      {key:'beach', label:'Beach', enabled:false, defaultEmotion:'calm', recall:{mode:'keyword', keywords:['海滩']}}]}})
  // The identity board, registered on the figure and, as a character settei, on the coat outfit too.
  const bytes = encodeAssetRgba({width:16, height:9, data:new Uint8ClampedArray(16 * 9 * 4).fill(90)}), board = await publication.closure({bytes, descriptor:{ext:'png', mime:'image/png', size:bytes.length}})
  const snapshot = await library.getPackSnapshot({packId:pack.manifest.id}), figure = snapshot.figures[created.figureId]
  const identitySettei = {board:board.hash, version:'a'.repeat(64), palette:[]}
  await library.patchPack(publication.publish(snapshot, {blobs:{...board.blobs}, files:new Map([...board.files,
    ['figures/' + created.figureId + '.json', publication.jsonBytes({...figure, identitySettei, outfits:figure.outfits.map(o => o.key === 'coat' ? {...o, settei:board.hash, setteiParentVersion:identitySettei.version} : o)})]])}))
  const prepare = async (outfitKey, kind, extra = {}) => service.prepare({target:{packId:pack.manifest.id, figureId:created.figureId, outfitKey, kind, ...(kind === 'sprite' ? {emotionId:'calm'} : {})},
    expectedRevision:(await library.getPackSnapshot({packId:pack.manifest.id})).revision, preview:true, ...extra})
  return {prepare, board:board.hash}
}

test('another outfit takes only the person from the identity settei; its clothes come from the outfit text', async t => {
  const f = await fixture(t)
  for (const kind of ['settei', 'sprite']) {
    const plan = await f.prepare('beach', kind, {userPrompt:'black bikini briefs, barefoot'})
    assert.deepEqual(plan.references.map(r => [r.hash, r.role]), [[f.board, roles.identity]], kind)
    assert.match(plan.prompt, /The clothes it shows are a sample outfit, not this outfit/, kind)
    assert.match(plan.prompt, /black bikini briefs/, kind)
  }
  const settei = (await f.prepare('beach', 'settei', {userPrompt:'black bikini briefs, barefoot'})).prompt
  assert.match(settei, /Over a sample outfit, draw the clothes from the Outfit text and notes/)
  assert.doesNotMatch(settei, /Where text and images disagree, follow the images;/)
})

test('the outfit the identity settei is drawn in keeps its clothes from it', async t => {
  const f = await fixture(t)
  for (const kind of ['settei', 'sprite']) {
    const plan = await f.prepare('coat', kind, {userPrompt:'navy wool overcoat'})
    assert.deepEqual(plan.references.map(r => [r.hash, r.role]), [[f.board, roles.identityOutfit]], kind)
    assert.doesNotMatch(plan.prompt, /The clothes it shows are a sample outfit/, kind)
  }
})
