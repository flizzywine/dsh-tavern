import {check} from '../asset-packs/common.js'

export const MOD_PRIVATE_PATH=/^mods\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)\/(config\.json|files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|webp|jpg|mp3|ogg|wav))$/
export const isModConfigPack=pack=>!!pack?.local?.modConfig || !!pack && !pack.manifest.assets.length && !pack.manifest.figures.length && pack.manifest.files.some(file=>file.path.startsWith('mods/'))
const mime={png:'image/png',jpg:'image/jpeg',webp:'image/webp',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav'}
export async function validateModPrivate({files,previous,validators,readDocument,inspectMedia,decodeMedia}) {
  let total=0,count=0
  for(const [name,bytes] of files)if(name.startsWith('mods/')) {
    total+=bytes.length;count++
    check(total<=16*1024**2 && count<=128,name,'Mod private area limit','LIMIT_EXCEEDED')
    const match=MOD_PRIVATE_PATH.exec(name),validate=match && validators?.get(match[1])
    check(validate,name,'Unknown mod private namespace','UNKNOWN_FIELD')
    if(match[2]==='config.json') {
      check(bytes.length<=128*1024,name,'Mod config size limit','LIMIT_EXCEEDED')
      const config=readDocument(bytes);validate(config)
      const pending=Object.values(config.values).map(value=>value.fixed)
      while(pending.length) {
        const value=pending.pop()
        if(!value || typeof value!=='object')continue
        if(typeof value.file==='string')check(files.has('mods/'+match[1]+'/'+value.file),name,'Uploaded file is missing','MISSING_DEPENDENCY')
        pending.push(...Object.values(value))
      }
    } else {
      if(previous?.files.get(name)===bytes)continue
      check(bytes.length<=512*1024,name,'Mod upload size limit','LIMIT_EXCEEDED')
      const ext=name.split('.').at(-1)
      await inspectMedia(bytes,{ext,mime:mime[ext],size:bytes.length},decodeMedia)
    }
  }
}

export function createModPrivateMethods({validators,run,metadata,storage,cas,edit,readDocument,jsonBytes,load,verify,sealPack,nextLocal,emit,cards,randomUUID,blankManifest,remapPack}) {
  function prefix(modId) {check(validators.has(modId),'$.modId','Unknown mod','UNKNOWN_FIELD');return 'mods/'+modId+'/'}
  function mutate(input,files) {
    const base=prefix(input.modId)
    if(Object.hasOwn(input,'config')) {
      if(input.config===null)for(const name of [...files.keys()]){if(name.startsWith(base))files.delete(name)}
      else files.set(base+'config.json',jsonBytes(input.config))
    }
    if(input.file) {
      check(MOD_PRIVATE_PATH.test(base+input.file.path) && input.file.path.startsWith('files/'),'$.file.path','Invalid private upload','UNKNOWN_FIELD')
      check(!files.has(base+input.file.path),'$.file.path','Upload already exists','REVISION_CONFLICT')
      files.set(base+input.file.path,Buffer.from(input.bytes))
    }
  }
  return {
    registerModPrivate({modId,validate}) {
      check(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(modId) && modId.length<=128 && typeof validate==='function','$.modId')
      validators.set(modId,validate)
    },
    readModPrivate({packId,modId,path='config.json'}) {
      const name=prefix(modId)+path;check(MOD_PRIVATE_PATH.test(name),'$.path','Invalid private path','UNKNOWN_FIELD')
      return run([packId],async()=>{
        const pack=await metadata(packId);check(pack,'$.packId','Pack unavailable','ASSET_UNAVAILABLE')
        const descriptor=pack.manifest.files.find(row=>row.path===name)
        const bytes=descriptor?await storage.read('packs/'+packId+'/'+name,descriptor.size):null
        return {revision:pack.local.revision,...(path==='config.json'?{config:bytes?readDocument(bytes):null}:{bytes})}
      })
    },
    writeModPrivate:input=>edit(input,(_manifest,files)=>mutate(input,files)),
    writeCardModPrivate(input) {
      prefix(input.modId)
      return run([],async()=>{
        check(cards?.withConfigPack,'$.card','Card transaction owner unavailable','ASSET_UNAVAILABLE')
        const card=await cards.snapshot({path:input.path}),identity=cards.inspectRaw(card.raw)
        check(card.revision===input.expectedCardRevision && (identity.modConfigPackId || null)===(input.packId || null),'$.card','Card changed','REVISION_CONFLICT')
        const before=input.packId?await load(input.packId):null
        cas(before,input.expectedRevision)
        check(!before || isModConfigPack(before),'$.packId','Ordinary bound packs are not card config storage','UNKNOWN_FIELD')
        const id=!before || input.copyOnWrite?randomUUID():input.packId
        let draft=before?{manifest:structuredClone(before.manifest),files:new Map(before.files)}:{manifest:blankManifest(id,identity.name),files:new Map()}
        if(before && input.copyOnWrite)draft={manifest:blankManifest(id,identity.name),files:new Map([...before.files].filter(([name])=>name.startsWith('mods/')))}
        mutate(input,draft.files)
        await sealPack(draft.manifest,draft.files,before)
        const pack=await verify(draft.manifest,draft.files,before,true),local=nextLocal(id===input.packId?before.local:undefined)
        local.modConfig=true
        const change={pack,local,before:id===input.packId?before:null}
        await cards.withConfigPack({path:input.path,expectedRevision:card.revision,packId:id},transaction=>storage.publishMany([change],transaction))
        emit({...pack,local},change.before)
        return {packId:id,revision:local.revision}
      })
    },
  }
}
