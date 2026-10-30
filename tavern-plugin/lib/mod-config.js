import path from 'node:path'
import {readFile,mkdir,open,rename,unlink,stat,readdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {checkedAssetPath} from './card-storage.js'
import {decodeModMedia,MOD_MEDIA_MIME,MOD_MEDIA_LIMIT} from './mod-media.js'
import {createModConfigService,CONFIG_FILE_PATH} from './domain/mods/config.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}
const absent=error=>{if(error.code==='ENOENT')return null;throw error}
const queues=new Map()
function serial(key,task) {const next=(queues.get(key)||Promise.resolve()).then(task);const tail=next.catch(()=>{});queues.set(key,tail);tail.finally(()=>{if(queues.get(key)===tail)queues.delete(key)});return next}

const identify=({modId,layer,cardId})=>{
  if(!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(modId) || modId.length>128)fail('UNKNOWN_FIELD','Invalid mod id')
  if(layer!==undefined && !['global','card'].includes(layer))fail('UNKNOWN_FIELD','Unknown layer')
  if(layer==='card' && !cardId)fail('NOT_FOUND','Card required')
}
async function atomic(file,bytes) {
  await mkdir(path.dirname(file),{recursive:true})
  const temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx')
  try {await handle.writeFile(bytes);await handle.sync()}finally {await handle.close()}
  try {await rename(temp,file)}catch(error){await unlink(temp).catch(()=>{});throw error}
}

// the uploaded files of a mod's two config layers, whichever store holds the values — 全局 under
// root/<modId>/files/, 本卡 in the card's private config pack (cardPacks). read answers base64; put stores a new
// files/<uuid>.<ext> in that layer (the caller has already checked its config revision).
export function createModConfigFiles({root,cardPacks}) {
  root=path.resolve(root)
  const locate=(modId,name)=>checkedAssetPath(root,modId+'/'+name)
  return Object.freeze({locate,
    async readFile(args) {
      identify(args)
      if(!['global','card'].includes(args.layer) || typeof args.path!=='string' || !CONFIG_FILE_PATH.test(args.path))fail('UNKNOWN_FIELD','Expected a layer-local uploaded file path')
      let bytes
      if(args.layer==='card')bytes=await cardPacks.readFile(args)
      else {
        const target=await locate(args.modId,args.path),info=await stat(target).catch(absent)
        if(!info)fail('SOURCE_MISSING','Uploaded file does not exist in this layer')
        if(info.size>MOD_MEDIA_LIMIT)fail('CONFIG_TYPE','Uploaded file exceeds size limit')
        bytes=await readFile(target)
      }
      if(!bytes)fail('SOURCE_MISSING','Uploaded file does not exist in this layer')
      if(bytes.length>MOD_MEDIA_LIMIT)fail('CONFIG_TYPE','Uploaded file exceeds size limit')
      return {file:{path:args.path,mime:MOD_MEDIA_MIME[args.path.split('.').at(-1)],size:bytes.length},data:Buffer.from(bytes).toString('base64')}
    },
    async put(args,cardRevision) {
      identify(args);if(!['global','card'].includes(args.layer))fail('UNKNOWN_FIELD','Layer required')
      const {bytes,ext}=decodeModMedia(args),file={path:'files/'+randomUUID()+'.'+ext,mime:args.mime,size:bytes.length}
      if(args.layer==='card')await cardPacks.upload({...args,file,bytes,expectedRevision:cardRevision ?? (await cardPacks.read(args)).revision})
      else await atomic(await locate(args.modId,file.path),bytes)
      return file
    },
  })
}

// cardPacks is the asset owner, not a filesystem shortcut: it must use a card-owned
// pack, preserve opaque mods/ files on export/import, and serialize pack CAS.
export function createModConfigStore({root,cardPacks}) {
  const files=createModConfigFiles({root,cardPacks}),locate=files.locate
  async function global(modId) {
    const file=await locate(modId,'config.json'),info=await stat(file,{bigint:true}).catch(absent)
    return {revision:info?String(info.mtimeNs)+':'+String(info.size):'0',config:info?JSON.parse(await readFile(file,'utf8')):null}
  }
  async function snapshot(args) {
    identify(args)
    const g=await global(args.modId),c=args.cardId?await cardPacks.read(args):{revision:'0',config:null}
    return {revision:JSON.stringify([g.revision,c.revision]),global:g.config?.values || {},card:c.config?.values || {},owners:{global:g,card:c}}
  }
  const api={
    async read(args) {const {owners,...value}=await snapshot(args);return value},
    readFile:files.readFile,
    write(args) {return serial(root,async()=>{
      identify(args);if(!['global','card'].includes(args.layer))fail('UNKNOWN_FIELD','Layer required')
      const before=await snapshot(args)
      if(before.revision!==args.expectedRevision)fail('REVISION_CONFLICT','Config changed')
      const config=Object.keys(args.values).length?{version:1,values:args.values}:null
      for(const value of Object.values(args.values)) {
        if(CONFIG_FILE_PATH.test(value.fixed?.file))await api.readFile({...args,path:value.fixed.file})
        // An image set (phone wallpapers): every file belongs to this layer.
        if(Array.isArray(value.fixed))for(const row of value.fixed) {
          if(CONFIG_FILE_PATH.test(row?.file))await api.readFile({...args,path:row.file})
          if(CONFIG_FILE_PATH.test(row?.icon?.file))await api.readFile({...args,path:row.icon.file})
        }
      }
      if(args.layer==='card')await cardPacks.write({...args,config,expectedRevision:before.owners.card.revision})
      else {
        const file=await locate(args.modId,'config.json')
        if(config)await atomic(file,JSON.stringify(config)+'\n')
        else {
          await unlink(file).catch(absent)
          const folder=await locate(args.modId,'files')
          for(const name of await readdir(folder).catch(error=>absent(error) || [])) {
            if(/^[0-9a-f-]{36}\.(png|webp|jpg|mp3|ogg|wav)$/.test(name))await unlink(await locate(args.modId,'files/'+name)).catch(absent)
          }
        }
      }
      return api.read(args)
    })},
    upload(args) {return serial(root,async()=>{
      identify(args);if(!['global','card'].includes(args.layer))fail('UNKNOWN_FIELD','Layer required')
      const before=await snapshot(args)
      if(before.revision!==args.expectedRevision)fail('REVISION_CONFLICT','Config changed')
      const file=await files.put(args,before.owners.card.revision)
      return {revision:(await api.read(args)).revision,file}
    })},
  }
  return Object.freeze(api)
}

export const MOD_CONFIG_METHODS=Object.freeze(['getModConfig','resolveModConfig','setModConfig','clearModConfig','listModConfigSources','evaluateModConfigFormula','uploadModConfigFile','readModConfigFile','listModConfigAssets'])
const fields={
  getModConfig:['modId','cardId','sessionId'],resolveModConfig:['modId','key','cardId','sessionId'],
  setModConfig:['modId','key','layer','value','expectedRevision','cardId','sessionId'],clearModConfig:['modId','key','layer','expectedRevision','cardId','sessionId'],
  listModConfigSources:['cardId','sessionId'],evaluateModConfigFormula:['formula','cardId','sessionId'],uploadModConfigFile:['modId','layer','mime','data','expectedRevision','cardId','sessionId'],
  readModConfigFile:['modId','layer','cardId','sessionId','path'],listModConfigAssets:['modId','key','cardId','sessionId'],
}
// Mount under the existing authenticated dispatcher. Context is resolved by the
// host's card/session owner, never accepted as a client-provided source snapshot.
export function createModConfigRpc({schemas,store,sources,authorize,context,listAssets}) {
  const service=createModConfigService({schemas,store,sources})
  const routes={
    listModConfigAssets:args=>listAssets(args),
    getModConfig:args=>service.get(args),resolveModConfig:args=>service.resolve(args.modId,args.key,args),
    setModConfig:args=>service.set(args),clearModConfig:args=>service.clear(args),
    listModConfigSources:args=>service.listSources(args),evaluateModConfigFormula:args=>service.evaluate(args.formula,args),
    uploadModConfigFile:args=>{if(!Object.hasOwn(schemas,args.modId))fail('UNKNOWN_FIELD','Unknown mod');return store.upload(args)},
    readModConfigFile:args=>{if(!Object.hasOwn(schemas,args.modId))fail('UNKNOWN_FIELD','Unknown mod');return store.readFile(args)},
  }
  return Object.freeze(Object.fromEntries(Object.entries(routes).map(([method,run])=>[method,async(args={},caller)=>{
    if(await authorize({method,context:caller})!==true)fail('MOD_PERMISSION_DENIED','Mod management permission required')
    if(!args || typeof args!=='object' || Array.isArray(args) || Object.keys(args).some(key=>!fields[method].includes(key)))fail('UNKNOWN_FIELD','Unknown RPC field')
    const required=method==='listModConfigSources'?[]:method==='evaluateModConfigFormula'?['formula']:method==='getModConfig'?['modId']:['resolveModConfig','listModConfigAssets'].includes(method)?['modId','key']:method==='uploadModConfigFile'?['modId','layer','mime','data','expectedRevision']:method==='readModConfigFile'?['modId','layer','path']:['modId','key','layer','expectedRevision',...(method==='setModConfig'?['value']:[])]
    if(required.some(key=>!Object.hasOwn(args,key)))fail('UNKNOWN_FIELD','Missing RPC field')
    for(const key of ['modId','cardId','sessionId','key','expectedRevision'])if(args[key]!==undefined && (typeof args[key]!=='string' || !args[key].length || args[key].length>512))fail('UNKNOWN_FIELD','Invalid '+key)
    return run({...structuredClone(args),...await context(args)})
  }])))
}
