import test from 'node:test'
import assert from 'node:assert/strict'
import {skinOwnedFixture} from './helpers/skin-owned-fixture.mjs'
import {syntheticPack,OTHER_PACK_ID,PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {copyPackItems} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-items.js'
import {sealPack,verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
async function copy(source,refs,target) {
 const copied=copyPackItems(source,refs,target.manifest,target.files,new Set())
 await sealPack(target.manifest,target.files)
 return {copied,pack:await verifyBytes(target.manifest,target.files)}
}
async function emptyTarget(){const p=await syntheticPack();p.manifest.id=OTHER_PACK_ID;return p}
test('copying a skin carries only its owned entries, rewrites both-end refs and preserves media and untouched bundles',async()=>{
 const source=await skinOwnedFixture(),before=JSON.stringify(source.manifest)
 const {pack,copied}=await copy(source,[{kind:'skins',id:'trial'}],await emptyTarget())
 assert.deepEqual(copied.map(r=>r.fromId),['trial','trial-show','trial-clock'])
 assert.equal(pack.performances['trial-show'].interop[0].target.packId,OTHER_PACK_ID)
 assert.equal(pack.manifest.assets.find(a=>a.id==='trial-clock').onTimeup.packId,OTHER_PACK_ID)
 assert.equal(pack.manifest.bundles.trial.contentHash,source.manifest.bundles.trial.contentHash)
 assert.notEqual(pack.manifest.bundles['trial-show'].contentHash,source.manifest.bundles['trial-show'].contentHash)
 assert.ok(Object.keys(pack.manifest.blobs).every(hash=>hash in source.manifest.blobs))
 assert.equal(JSON.stringify(source.manifest),before)
})
test('collision renames owner and document; a one-ended copy leaves its external reference alone',async()=>{
 const source=await skinOwnedFixture(),target=structuredClone(source);target.manifest.id=OTHER_PACK_ID
 const {pack}=await copy(source,[{kind:'skins',id:'trial'}],target)
 assert.equal(pack.manifest.assets.find(a=>a.id==='trial-show-2').skin,'trial-2')
 assert.equal(pack.skins['trial-2'].id,'trial-2')
 assert.notEqual(pack.manifest.bundles['trial-2'].contentHash,source.manifest.bundles.trial.contentHash)
 const single=structuredClone(source);single.manifest.id=OTHER_PACK_ID
 const result=await copy(source,[{kind:'performances',id:'trial-show'}],single)
 assert.equal(result.pack.performances['trial-show-2'].interop[0].target.packId,PACK_ID)
})
test('an owned entry does not pull its skin; a pop copy retains its unchanged performance digest',async()=>{
 const source=await skinOwnedFixture()
 await assert.rejects(copy(source,[{kind:'performances',id:'trial-show'}],await emptyTarget()),e=>e.code==='MISSING_DEPENDENCY')
 const {pack}=await copy(source,[{kind:'skins',id:'pop'}],await emptyTarget())
 assert.equal(pack.manifest.bundles['pop-show'].contentHash,source.manifest.bundles['pop-show'].contentHash)
})
