import test from 'node:test'
import assert from 'node:assert/strict'
import {skinOwnedFixture} from './helpers/skin-owned-fixture.mjs'
import {validatePackManifest} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
test('skin ownership is optional, same-pack, short-id and not allowed on skins',async()=>{
 const {manifest}=await skinOwnedFixture()
 assert.doesNotThrow(()=>validatePackManifest(manifest))
 for(const [kind,skin,code] of [['skins','trial','UNKNOWN_FIELD'],['timers','missing','MISSING_DEPENDENCY'],['timers','not a short id',null]]) {
  const next=structuredClone(manifest);next.assets.find(a=>a.kind===kind).skin=skin
  assert.throws(()=>validatePackManifest(next),e=>!code||e.code===code)
 }
 const old=structuredClone(manifest);for(const a of old.assets)delete a.skin
 const before=JSON.stringify(old);validatePackManifest(old);assert.equal(JSON.stringify(old),before)
})
