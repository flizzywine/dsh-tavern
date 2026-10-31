import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {png} from '../fixtures/asset-packs/pack.mjs'

export async function setupStageMedia(root) {
  const service=createAssetPackService({assetRoot:join(root,'profile-data/tavern/asset-packs'),authorizeLease:async()=>true})
  try {
    const created=await service.createPack({name:'舞台故障验收',expectedRevision:null})
    const packId=created.snapshot.manifest.id,blobs={},files=new Map()
    const assets=['正常背景','故障背景'].map((name,index)=>{
      const bytes=png(index ? [160,60,40] : [40,100,160]),hash=createHash('sha256').update(bytes).digest('hex')
      blobs[hash]={ext:'png',mime:'image/png',size:bytes.length}
      files.set(`media/${hash}.png`,bytes)
      return {kind:'backgrounds',id:'scene-'+index,name,enabled:true,recall:{mode:'keyword',keywords:index ? ['故障','损坏','失败'] : ['教室','课桌','黑板']},directorNote:'',media:hash}
    })
    await service.patchPack({packId,expectedRevision:created.snapshot.revision,patch:{assets,blobs},fileUpdates:files})
    return {packId,healthyHash:assets[0].media,failedHash:assets[1].media}
  } finally {await service.dispose()}
}
