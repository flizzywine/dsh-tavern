import test from 'node:test'
import assert from 'node:assert/strict'
import {skinOwnedFixture} from './helpers/skin-owned-fixture.mjs'
import { syntheticPack, OTHER_PACK_ID } from './fixtures/asset-packs/pack.mjs'
import {copyPackItems} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-items.js'
import {sealPack,verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
async function copy(source,refs,target) {
 const copied=copyPackItems(source,refs,target.manifest,target.files,new Set())
 await sealPack(target.manifest,target.files)
 return {copied,pack:await verifyBytes(target.manifest,target.files)}
}
async function emptyTarget(){const p=await syntheticPack();p.manifest.id=OTHER_PACK_ID;return p}
test('an owned entry does not pull its skin; a pop copy retains its unchanged performance digest',async()=>{
 const source=await skinOwnedFixture()
 await assert.rejects(copy(source,[{kind:'performances',id:'trial-show'}],await emptyTarget()),e=>e.code==='MISSING_DEPENDENCY')
 const {pack}=await copy(source,[{kind:'skins',id:'pop'}],await emptyTarget())
 assert.equal(pack.manifest.bundles['pop-show'].contentHash,source.manifest.bundles['pop-show'].contentHash)
})
