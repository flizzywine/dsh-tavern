import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {png} from '../fixtures/asset-packs/pack.mjs'

export async function setupStageMedia(root,{audio=false}={}) {
  const service=createAssetPackService({assetRoot:join(root,'profile-data/tavern/asset-packs'),authorizeLease:async()=>true})
  try {
    const created=await service.createPack({name:'舞台故障验收',expectedRevision:null})
    const packId=created.snapshot.manifest.id,blobs={},files=new Map()
    const assets=(audio ? ['正常音乐','故障音乐'] : ['正常背景','故障背景']).map((name,index)=>{
      const bytes=audio ? tone(index ? 660 : 440) : png(index ? [160,60,40] : [40,100,160]),hash=createHash('sha256').update(bytes).digest('hex')
      const ext=audio?'wav':'png'
      blobs[hash]={ext,mime:audio?'audio/wav':'image/png',size:bytes.length}
      files.set(`media/${hash}.${ext}`,bytes)
      return {kind:audio?'music':'backgrounds',id:'scene-'+index,name,enabled:true,recall:{mode:'keyword',keywords:index ? ['故障','损坏','失败'] : ['教室','课桌','黑板']},directorNote:'',media:hash}
    })
    await service.patchPack({packId,expectedRevision:created.snapshot.revision,patch:{assets,blobs},fileUpdates:files})
    return {packId,healthyHash:assets[0].media,failedHash:assets[1].media}
  } finally {await service.dispose()}
}

function tone(hz) {
  const rate=8000,samples=rate*2,bytes=Buffer.alloc(44+samples*2)
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16)
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28)
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40)
  for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*hz/rate)*2000),44+i*2)
  return bytes
}
export function installStageAudioProbe() {
  let loopStarts=0
  const sources=new Set(),start=AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start=function(...args){
    const result=Reflect.apply(start,this,args);sources.add(this);if(this.loop)loopStarts++
    this.addEventListener('ended',()=>sources.delete(this),{once:true})
    return result
  }
  window.__stageAudioProbe=()=>({loopStarts,looping:[...sources].filter(node=>node.loop).length,audibleLooping:[...sources].filter(node=>node.loop&&node.context.state==='running').length})
}
