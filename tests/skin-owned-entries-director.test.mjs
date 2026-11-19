import test from 'node:test'
import assert from 'node:assert/strict'
import {skinOwnedFixture} from './helpers/skin-owned-fixture.mjs'
import {PACK_ID,cardExtension} from './fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { prepareAssetPackDirector, buildAssetPackRequest } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
const ref=(kind,assetId)=>({packId:PACK_ID,kind,assetId})
async function input() {
 const pack=await skinOwnedFixture(),ext=cardExtension();ext.assetBindings.boundPackIds=[];ext.stage={defaultSkin:ref('skins','trial')}
 const assetStatus=Object.fromEntries(pack.manifest.assets.map(a=>[assetRefKey(ref(a.kind,a.id)),{available:true}]))
 return {snapshots:[pack],assetStatus,globalEnabledPackIds:[PACK_ID],raw:{extensions:{dsh_tavern:ext}},engine:{},cardRevision:'card',target:{sourceKey:'reply',branchId:'branch',revision:1},units:['Test.']}
}
import {reducePerformanceCommand} from '../tavern-plugin/packages/dsh-presentation-protocol/src/performance-commands.cjs'
test('switching skin rejects stale starts but still permits off; schema stays identical and catalogue shrinks',async()=>{
 const base=await input(),unfiltered=structuredClone(base)
 unfiltered.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[PACK_ID]
 base.raw.extensions.dsh_tavern.assetBindings.boundPackIds=[PACK_ID]
 for(const a of unfiltered.snapshots[0].manifest.assets)delete a.skin
 const before=buildAssetPackRequest(prepareAssetPackDirector(unfiltered),true,undefined,'',true)
 base.raw.extensions.dsh_tavern.stage.defaultSkin=ref('skins','pop')
 const prepared=prepareAssetPackDirector(base),after=buildAssetPackRequest(prepared,true,undefined,'',true)
 const bytes=request=>Buffer.byteLength(JSON.stringify(request.tools))
 assert.equal(bytes(after),bytes(before))
 const sections=request=>Object.fromEntries(request.sections.filter(s=>s.key.startsWith('catalogue.')).map(s=>[s.key,Buffer.byteLength(s.text)]))
 const prior=sections(before),next=sections(after)
 for(const [key,size] of Object.entries(next))assert.ok(size<=prior[key])
 assert.ok(Object.keys(next).length<Object.keys(prior).length)
 const check=(ok,path,message,code)=>{if(!ok)throw Object.assign(new Error(message),{code})}
 const state={performance:{ref:ref('performances','trial-show')}}
 const boundary=(current,command)=>({...current,phase:command.off?'exit':'entry'})
 const choices=prepared.context.catalogue.candidates.performances,metadata={page:0,turn:1}
 assert.throws(()=>reducePerformanceCommand(state,'performance.start',{ref:ref('performances','trial-show')},metadata,null,choices,boundary,check),{code:'REF_UNAVAILABLE'})
 reducePerformanceCommand(state,'performance.off',{},metadata,null,choices,boundary,check)
 assert.equal(state.performance.phase,'exit')
 console.log(JSON.stringify({toolSchemaBytes:{before:bytes(before),after:bytes(after)},catalogueSectionBytes:{before:prior,after:next}}))
})
