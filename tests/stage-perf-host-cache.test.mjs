// The stage's per-request host reads that are kept per version instead of rebuilt: the managed mod installation state
// (one parse per state file version), the card's stage skin (without the whole bubble config) and the card extension
// read by switches (no copy).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createCardPlugins} from '../tavern-plugin/lib/domain/card-plugins.js'
import {modPackageIdentity} from '../tavern-plugin/lib/mod-system-distributions.js'
import {readCardAssetExtension, cardAssetExtensionView} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {createCardStage} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import skinContract from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'
import {freezeJson} from '../tavern-plugin/lib/domain/freeze-json.js'
import {fixture as directorFixture, answer} from './helpers/stage-director-harness.mjs'
import timer from '../tavern-plugin/mods/timer/mod.json' with {type:'json'}

function bundle(version) {
  const manifest={...structuredClone(timer),version},folder='timer'
  const entries=[['mod.json',JSON.stringify(manifest)],['package.json',JSON.stringify({name:manifest.packageName,version,type:'module',exports:{'.':'./plugin.mjs'}})],['plugin.mjs','export const name="'+manifest.packageName+'"; export function apply() {}']].map(([name,text])=>({path:'plugins/'+folder+'/'+name,data:Buffer.from(text)}))
  const files=entries.map(row=>({path:row.path.slice(('plugins/'+folder+'/').length),size:row.data.length,sha256:createHash('sha256').update(row.data).digest('hex')}))
  return {manifest,folder,entries,files,sha256:modPackageIdentity(files)}
}

test('the managed installation state is parsed once per file version and shared frozen; writes and file changes are read again', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-perf-host-')), dataRoot = path.join(root, 'data')
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  const bundles = [bundle('2.0.0')]
  const owner = createCardPlugins({dataRoot, pluginsDir:path.join(dataRoot, 'plugins')}).managed({distributions:async () => bundles})
  const first = await owner.readReleases()
  assert.equal(await owner.readReleases(), first, 'an unchanged state answers from the same frozen value')
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first[0].manifest))
  assert.throws(() => { first[0].active = true }, TypeError)
  assert.equal(first[0].installed, false)

  // This owner's own write is read at once.
  const old = await owner.read(), value = structuredClone(old.value)
  Object.assign(value.releases[0], {installed:true, active:true, authorized:true, globalRoot:true})
  await owner.compareAndSwap({expectedRevision:old.revision, expectedValue:old.value, value})
  const installed = await owner.readReleases()
  assert.notEqual(installed, first)
  assert.equal(installed[0].installed, true)
  assert.equal(await owner.readReleases(), installed)

  // Another writer's change shows as a new file version.
  const file = path.join(dataRoot, 'card-plugins', '.managed', 'state.json'), stored = JSON.parse(await fs.readFile(file, 'utf8'))
  stored.revision++; stored.value.releases[0].active = false
  await new Promise(resolve => setTimeout(resolve, 20))
  await fs.writeFile(file, JSON.stringify(stored) + '\n')
  const changed = await owner.readReleases()
  assert.equal(changed[0].active, false)
  assert.equal((await owner.read()).value.releases[0].active, false)
})

const packId = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222'
function skinPack(id, label) {
  const document = {...structuredClone(skinContract.BUILTIN_STAGE_SKINS.classic), id:'pack-skin', label}
  return {revision:'r-' + label, manifest:{id, figures:[], assets:[{kind:'skins', id:'s1', bundleKey:'b1', entry:'skin.json'}], bundles:{b1:{contentHash:'h-' + label}}, sprites:{}},
    figures:{}, sprites:{}, skins:{s1:document}}
}
const card = stage => ({spec:'chara_card_v2', data:{name:'c', extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[packId]}, ...(stage ? {stage} : {})}}}})

test('the stage skin is read without the bubble config, from its own pack only, and follows the card and the pack', async t => {
  const packs = new Map([[packId, skinPack(packId, 'one')], [otherId, skinPack(otherId, 'other')]]), reads = []
  let raw = card({defaultSkin:{packId, assetId:'s1'}})
  const cardStage = createCardStage({cardStorage:{readWorkspace:async () => ({raw})}, getEngine:() => defaultAssetEngineSettings(),
    getAssetLibrary:() => ({getPackSnapshot:async ({packId}) => { reads.push(packId); return packs.get(packId) }}), getGlobalEnabledPackIds:() => [otherId]})
  const skin = await cardStage.skin('cards/c.json')
  assert.deepEqual(reads, [packId], 'only the pack the skin names is read')
  assert.equal(skin.ref.packId, packId)
  assert.equal(skin.document.label, 'one')
  assert.equal(skin.resource.revision, 'r-one')
  assert.deepEqual(skin, (await cardStage.bubbles.read('cards/c.json')).stage.skin, 'the same skin the bubble config shows')

  // A new pack revision and a new card choice are read again.
  packs.set(packId, skinPack(packId, 'two'))
  assert.equal((await cardStage.skin('cards/c.json')).resource.revision, 'r-two')
  raw = card()
  const builtin = await cardStage.skin('cards/c.json')
  assert.equal(builtin.builtin, true)
  assert.deepEqual(builtin, (await cardStage.bubbles.read('cards/c.json')).stage.skin)
  // A pack that is neither bound nor globally enabled falls back.
  raw = card({defaultSkin:{packId:'33333333-3333-4333-8333-333333333333', assetId:'s1'}})
  assert.equal((await cardStage.skin('cards/c.json')).builtin, true)
})

test('a sealed round is observed once per frozen chat view; a new view, an unfrozen chat or an asset change reads it again', async t => {
  let bodies = 0
  const f = await directorFixture(request => request.onToolCall({name:'stage_update', arguments:answer}),
    {paragraphParts:async (_chat, source) => { bodies++; return [{kind:'markdown', text:source.source}] }})
  t.after(() => f.dispose())
  await f.director.get(f.read(), 1); await f.director.drain()
  const view = freezeJson(f.read())
  const first = await f.director.get(view, 1, null, {readOnly:true, includePredecessor:true})
  assert.equal(first.complete, true)
  const read = bodies
  const again = await f.director.get(view, 1, null, {readOnly:true, includePredecessor:true})
  assert.equal(bodies, read, 'the same view answers from its first observation')
  assert.deepEqual(again, first)
  assert.deepEqual(await f.director.get(view, 1, null, {readOnly:true, sinceRevision:first.revision}), {unchanged:true, revision:first.revision})
  await f.director.get(freezeJson(f.read()), 1, null, {readOnly:true})
  assert.equal(bodies, read + 1, 'a new view is read again')
  const open = f.read()
  await f.director.get(open, 1, null, {readOnly:true}); await f.director.get(open, 1, null, {readOnly:true})
  assert.equal(bodies, read + 3, 'a chat that can still change is never kept')
  f.changePack({reason:'pack-revision-observed'})
  await f.director.get(view, 1, null, {readOnly:true})
  assert.equal(bodies, read + 4, 'another asset revision is read again')
})

test('a switch reads the card extension itself; readCardAssetExtension still hands out a copy', () => {
  const raw = card({enabled:true})
  assert.equal(cardAssetExtensionView(raw), raw.data.extensions.dsh_tavern)
  const copy = readCardAssetExtension(raw)
  assert.notEqual(copy, raw.data.extensions.dsh_tavern)
  assert.deepEqual(copy, raw.data.extensions.dsh_tavern)
  assert.equal(cardAssetExtensionView({data:{}}), undefined)
  assert.equal(cardAssetExtensionView({data:{extensions:{}}}), undefined)
})
