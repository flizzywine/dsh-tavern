import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectStageAssetRef } from '../tavern-plugin/lib/domain/plugin-stage-assets.js'
import { fixture } from './helpers/stage-director-harness.mjs'

const packId = '12345678-1234-4234-8234-123456789abc'
const figureId = '12345678-1234-4234-8234-123456789abd'
const ref = {packId, figureId}
const asset = {packId, kind:'backgrounds', assetId:'room'}
const pack = {revision:'r1', manifest:{id:packId, assets:[{kind:'backgrounds', id:'room', enabled:true}]}, figures:{[figureId]:{enabled:true, secret:'not returned'}}}
const inspect = (kind, ref, snapshots = [pack], current = () => true) => inspectStageAssetRef({kind, ref, snapshot:async () => ({snapshots, current})})

test('stage references expose availability and revision, never snapshot contents', async () => {
  assert.deepEqual(await inspect('figure', ref), {ref, status:'available', revision:'r1'})
  assert.equal((await inspect('asset', asset)).status, 'available')
  assert.equal((await inspect('figure', {...ref, figureId:'12345678-1234-4234-8234-123456789abe'})).status, 'figure-missing')
  assert.equal((await inspect('asset', {...asset, assetId:'missing'})).status, 'asset-missing')
  assert.equal((await inspect('figure', ref, [])).status, 'pack-unavailable')
  const disabled = structuredClone(pack); disabled.figures[figureId].enabled = false
  assert.equal((await inspect('figure', ref, [disabled])).status, 'figure-disabled')
  disabled.manifest.assets[0].enabled = false
  assert.equal((await inspect('asset', asset, [disabled])).status, 'asset-disabled')
  assert.deepEqual(await inspect('asset', asset, [pack], () => false), {ref:asset, status:'changed', revision:null})
  assert.equal((await inspectStageAssetRef({kind:'asset', ref:asset, snapshot:async () => null})).status, 'stage-unavailable')
  await assert.rejects(inspect('figure', {packId:'invalid', figureId}), {code:'INVALID_REF'})
})

test('missing asset library reports stage unavailable through the real stage snapshot', async () => {
  const f = await fixture(async () => {})
  try {
    f.services.delete('assetLibrary')
    const snapshot = await f.assets.snapshot('cards/a.json')
    assert.ok(snapshot)
    assert.deepEqual(snapshot.snapshots, [])
    assert.equal(snapshot.assetLibraryAvailable, false)
    const result = await inspectStageAssetRef({kind:'figure', ref, snapshot:() => f.assets.snapshot('cards/a.json')})
    assert.equal(result.status, 'stage-unavailable')
  } finally { await f.dispose() }
})
