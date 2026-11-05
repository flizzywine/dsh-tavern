import test from 'node:test'
import assert from 'node:assert/strict'
import {skinOwnedFixture} from './helpers/skin-owned-fixture.mjs'
import {PACK_ID,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackPresentation} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/asset-pack-presentation.js'
test('history resolves a global skin pack performance and preserves bound pack behaviour',async t=>{
 const pack=await skinOwnedFixture(),ref={packId:PACK_ID,kind:'performances',assetId:'trial-show'}
 for(const global of [true,false]) {
  const ext=cardExtension();ext.assetBindings.boundPackIds=global?[]:[PACK_ID]
  const service={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>pack,resolveAssets:async({refs})=>refs.map(ref=>({ref,diagnostics:[],revision:pack.revision,value:pack.manifest.assets.find(a=>a.kind===ref.kind&&a.id===ref.assetId)}))}
  const consumer=createAssetPackPresentation({raw:{extensions:{dsh_tavern:ext}},getService:()=>service,...(global?{getAllowedPackIds:()=>[PACK_ID]}:{}),origin:'http://localhost',scope:'test'})
  t.after(()=>consumer.dispose())
  const result=await consumer.performance({ref,restore:{}},{snapshots:[pack],isCurrent:()=>true})
  assert.equal(result.unavailable,null)
  assert.ok(result.dependencies.some(d=>d.ref.assetId==='trial-show'))
 }
})
