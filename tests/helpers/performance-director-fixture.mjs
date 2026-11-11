// verified metadata seam, no user packs or media installation.
import {readFileSync} from 'node:fs'
import {initialAssetPackStage} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-tools.js'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID,digest} from '../fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {prepareAssetPackDirector,createAssetPackTransaction} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
import {stagePageIndex} from '../../tavern-plugin/src/client/stage-page-index.cjs'
import {foldPerformanceAt} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/domain/performance-projection.js'
import {figureActorKey} from '../../tavern-plugin/lib/domain/figure-catalogue.js'
// Saved records name actors by their canonical figure key (figure-catalogue.js).
export const fixtureActor=figureActorKey({packId:PACK_ID,figureId:FIGURE_ID})
// protocol continuation tests start with the fixture figure on stage; new-chat tests stay lazy.
export async function historicalPerformanceFixture(count=1) {
  const f=await performanceFixture(count)
  f.input.baseline=initialAssetPackStage({[fixtureActor]:{figure:{packId:PACK_ID,figureId:FIGURE_ID},outfits:[]}})
  return f
}
export const performanceRef = (id='show') => ({packId:PACK_ID,kind:'performances',assetId:id})
export async function performanceFixture(count=1) {
  const pack = await syntheticPack()
  pack.revision='r1'; pack.performances={}
  // This fixture also goes through real ZIP import: a distinct identity needs actual media.
  const track={...structuredClone(pack.manifest.assets.find(a=>a.kind==='music')),id:'turn-track'}
  const blob=pack.manifest.blobs[track.media],bytes=Buffer.from(pack.files.get(`media/${track.media}.${blob.ext}`))
  bytes.writeInt16LE(1,44)
  track.media=digest(bytes)
  pack.manifest.blobs[track.media]={...blob}
  pack.files.set(`media/${track.media}.${blob.ext}`,bytes)
  pack.manifest.assets.push(track)
  for (let i=0;i<count;i++) {
    const id=i?'show-'+i:'show'
    pack.manifest.assets.push({kind:'performances',id,name:id,enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'Not the document note',bundleKey:id,entry:'performance.json'})
    pack.performances[id]={schema:'dsh.performance/1',id,label:'Do not repeat this label',license:{privateUse:true},packs:{},directorNote:'Use briefly.',levels:{default:2,1:{},2:{},3:{}},bgm:{ref:'self:classroom',lock:true,restore:'previous'},timeline:{
      entry:{events:[{at:0,do:'look',ref:'self:dusk'},{at:10,do:'sfx',ref:'self:bell'}]},
      turn:{events:[{at:600,do:'bgm',ref:'self:turn-track'}]},
      idle:{every:[3000,5000],events:[]},exit:{events:[{at:0,do:'sfx',ref:'self:bell'}]}}}
  }
  const assetStatus=Object.fromEntries(pack.manifest.assets.map(a=>[assetRefKey({packId:PACK_ID,kind:a.kind,assetId:a.id}),{available:true}]))
  const units=Array.from({length:8},(_,i)=>({kind:'narration',text:'Synthetic page '+i+'.'}))
  const input={raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'1',snapshots:[pack],assetStatus,engine:{},target:{turn:1,sourceKey:'s1',branchId:'b',revision:1},units,pageIndex:stagePageIndex(units)}
  const prepareInput=(extra={})=>({...input,...extra})
  const prepare=(extra={})=>prepareAssetPackDirector(prepareInput(extra))
  const transaction=prepared=>createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})
  const fold=(checked,prepared,index=0)=>foldPerformanceAt({checked,page:{index,para:index+1,offset:0,version:1},turn:prepared.binding.target.turn,predecessor:prepared.predecessor,resolveDocument:ref=>prepared.context.performanceDocuments[assetRefKey(ref)]})
  return {pack,input,prepareInput,prepare,transaction,fold}
}
// The director grammar is frozen per installed capability; only the core performance commands follow recall
// (stage-director-schema.js, bc85a25a2). Returns the frozen rest and the performance ops present.
export function performanceGrammarSplit(tools) {
  const tool=structuredClone(tools[0]), variants=tool.parameters.properties.beats.items.properties.ops.items.anyOf[0].oneOf
  const performance=variants.filter(row=>row.properties.op.const.startsWith('performance.')).map(row=>row.properties.op.const)
  tool.parameters.properties.beats.items.properties.ops.items.anyOf[0].oneOf=variants.filter(row=>!row.properties.op.const.startsWith('performance.'))
  return {fixed:[tool,...tools.slice(1)],performance}
}