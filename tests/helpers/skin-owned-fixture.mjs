import {syntheticPack, PACK_ID} from '../fixtures/asset-packs/pack.mjs'
import {sealPack,jsonBytes,verifyBytes} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import skinContract from '../../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'
export async function skinOwnedFixture() {
  const pack=await syntheticPack()
  const add=(kind,id,document,skin)=>{
    const entry=kind==='skins'?'skin.json':'performance.json'
    pack.manifest.assets.push({kind,id,name:id,...(kind==='skins'?{}:{enabled:true}),recall:{mode:'constant',keywords:[]},directorNote:'',bundleKey:id,entry,...(skin?{skin}:{})})
    pack.manifest.bundles[id]={kind:kind==='skins'?'skin':'performance',entry,contentHash:'0'.repeat(64)}
    pack.files.set(`bundles/${id}/${entry}`,jsonBytes(document))
  }
  for(const id of ['trial','pop']) add('skins',id,{...structuredClone(skinContract.BUILTIN_STAGE_SKINS.classic),id})
  for(const [id,skin,persistent] of [['trial-show','trial',true],['pop-show','pop',false],['standalone',null,false]]) {
    const phase={durationMs:1200,tracks:[]}
    add('performances',id,{schema:'dsh.performance/1',id,label:id,license:{privateUse:false},packs:{},timeline:{entry:{events:[]},exit:{events:[]}},keyframes:{playback:persistent?'persistent':'once',layers:[{id:'panel',kind:'solid',x:800,y:450,width:800,height:200,color:persistent?'#222222':'#cc0000'}],entry:phase,...(persistent?{exit:phase}:{})},...(persistent?{interop:[{use:'clock',target:{packId:PACK_ID,kind:'timers',assetId:'trial-clock'},release:'stop'}]}:{})},skin)
  }
  pack.manifest.assets.push({kind:'timers',id:'trial-clock',name:'Trial clock',skin:'trial',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',seconds:60,onTimeup:{packId:PACK_ID,kind:'performances',assetId:'trial-show'}})
  await sealPack(pack.manifest,pack.files)
  return {...await verifyBytes(pack.manifest,pack.files),revision:'skin-fixture'}
}
