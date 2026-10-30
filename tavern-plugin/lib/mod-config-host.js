import {createModConfigStore,createModConfigRpc} from './mod-config.js'
import {createModConfigCardPacks} from './mod-config-card-packs.js'
import {createModConfigService,validateConfigValue} from './domain/mods/config.js'
import {createConfigSourceRegistry} from './domain/mods/config-sources.js'
import {builtinConfigSchemas,stageConfigExports} from './domain/mods/config-builtins.js'
import {rawData} from './domain/card-preparation.js'
import {managedConfigSchemas} from './mod-system-execution.js'
import {assetContent} from '../packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {cardStageSkin,cardStageSkinPackIds} from './domain/card-stage-settings.js'
import {cardAssetWorkspaceRevision} from './card-asset-bindings.js'
import {readCardVariableSources} from './domain/card-variable-bindings.js'
import skinContract from '../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import {figureCatalogue,effectiveFigurePackIds,resolution} from './domain/figure-catalogue.js'
import {selectFigureAvatar} from './domain/pack-avatar.cjs'
import {stateSourceSchema,ledgerSource,ledgerConfigExports,resolveStateSource,ledgerInventoryBinding} from './domain/mods/state-source.js'
import {ASSET_PACK_RECORD_FIELD,readAssetPackRecord} from './domain/stage-asset-pack-director.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}

export function createModConfigStageReader({readChat,readRevision}) {
  return async (sessionId,revision)=>{
    let chat=await readChat(sessionId)
    // Background writes may advance the head while config reads its pinned variable window.
    if(chat && chat._storageRevision!==revision) {
      chat=await readRevision(chat.id,revision)
      if(!chat)fail('REVISION_CONFLICT','Stage read point unavailable')
    }
    if(chat && (chat._storageRevision!==revision || chat.sessionId!==sessionId))fail('REVISION_CONFLICT','Stage read point changed')
    const row=chat?.messages.findLast(message=>message.role==='assistant' && message[ASSET_PACK_RECORD_FIELD])
    if(!row)return null
    const record=readAssetPackRecord(row[ASSET_PACK_RECORD_FIELD])
    return record.entries.at(-1)?.state || record.baseline
  }
}

export function createModConfigHost({workbenchAuthority,root,store:managedStore,manifests,managedManifests,listCards,readCard,getAssetLibrary,readSession,readWindow,readRevision,getEngine,readStage=async()=>null,invalidate,getGlobalEnabledPackIds=()=>[],resolveOptionValues=async(_modId,_card,_chat,values)=>values,projectOptions=async value=>value}) {
  const schemas={...(managedManifests?managedConfigSchemas(managedManifests,manifests):builtinConfigSchemas(manifests)),'dsh.state':stateSourceSchema},registered=new WeakSet(),cache=new Map()
  function register(packs) {
    if(!packs || packs.apiVersion!==2 || typeof packs.registerModPrivate!=='function')fail('SOURCE_UNAVAILABLE','Native mod config pack owner unavailable')
    if(registered.has(packs))return packs
    for(const [modId,schema] of Object.entries(schemas).filter(([id])=>id!=='dsh.state'))packs.registerModPrivate({modId,validate:config=>{
      if(!config || config.version!==1 || Object.keys(config).some(key=>!['version','values'].includes(key)) || !config.values || typeof config.values!=='object' || Array.isArray(config.values))fail('CONFIG_TYPE','Invalid mod config document')
      for(const [key,value] of Object.entries(config.values)) {
        const field=schema.fields.find(row=>row.key===key)
        if(!field)fail('UNKNOWN_FIELD','Unknown config key: '+modId+':'+key)
        validateConfigValue(value,field)
      }
    }})
    registered.add(packs);return packs
  }
  const getPacks=async()=>register(getAssetLibrary())
  const cardPacks=createModConfigCardPacks({listCards,readCard,getPacks}),store=typeof managedStore==='function'?managedStore({cardPacks}):managedStore || createModConfigStore({root,cardPacks}),sources=createConfigSourceRegistry()
  for(const id of ['mvu','helper-chat'])sources.register({id,label:id==='mvu'?'MVU':'聊天变量',exports:[],read:ctx=>ctx.sources?.[id] || {available:false}})
  sources.register({id:'ledger',label:'游玩台账',exports:ledgerConfigExports,read:ctx=>ctx.sources?.ledger || {available:false}})
  sources.register({id:'stage',label:'舞台',exports:stageConfigExports,read:ctx=>ctx.sources?.stage || {available:false}})
  for(const [id,schema] of Object.entries(schemas).filter(([id])=>id!=='dsh.state'))sources.register({id:'mod:'+id,label:manifests.find(row=>row.id===id).name,exports:schema.fields.map(field=>({path:'/'+field.key,name:field.label || field.key,type:field.valueType,description:field.label || field.key,settingKey:field.key})),read:({settings})=>settings})
  const service=createModConfigService({schemas,store,sources})
  async function context(args,pinned) {
    const indexed=pinned?.chat || (args.sessionId?await readSession(args.sessionId):null)
    if(args.sessionId && !indexed)fail('NOT_FOUND','Session not found')
    let card=pinned?.card?{path:indexed?.cardPath,workspace:pinned.card}:args.cardId?await cardPacks.lookup(args.cardId):null
    if(indexed && !card){const workspace=await readCard(indexed.cardPath);if(!workspace)fail('NOT_FOUND','Session card unavailable');card={path:indexed.cardPath,workspace}}
    if(indexed && indexed.cardPath!==card.path)fail('NOT_FOUND','Session does not belong to card')
    if(!card)return {}
    const setting=await service.resolve('dsh.state','source'),preference=setting.value
    const engine=getEngine(),revision=JSON.stringify([cardAssetWorkspaceRevision(card.workspace),indexed?._storageRevision,engine.revision,engine.assetRevision,getGlobalEnabledPackIds(),preference,indexed?.timeline?.branchId,indexed?.ledger])
    const key=JSON.stringify([card.workspace.meta.id,args.sessionId,revision])
    if(cache.has(key))return cache.get(key)
    const source=indexed?await readCardVariableSources({path:card.path,indexed,readWindow,readRevision}):{},ext=rawData(card.workspace.raw).extensions?.dsh_tavern || {},stage={},labels={}
    const packs=await getPacks(),lead=ext.openings?.lead,state=args.sessionId?await readStage(args.sessionId,indexed?._storageRevision):null
    const snapshotsById=new Map()
    const snapshot=packId=>{
      if(!snapshotsById.has(packId))snapshotsById.set(packId,packs.getPackSnapshot({packId}))
      return snapshotsById.get(packId)
    }
    if(state) {
      if(state.scene?.background)stage.background=state.scene.background
      if(state.scene?.timeOfDay)stage.timeOfDay=state.scene.timeOfDay
      if(state.music)stage.bgm=state.music
      const actors=(state.cast || []).map(id=>({id,actor:state.actors?.[id]})).filter(row=>row.actor?.figure)
      const figures=actors.length?await packs.resolveFigures({refs:actors.map(row=>row.actor.figure)}):[]
      stage.characters=actors.map(({id,actor},i)=>({id,name:actor.name || id,figure:actor.figure,...(figures[i]?.value?.imageColor || figures[i]?.value?.autoColor?{color:figures[i].value.imageColor || figures[i].value.autoColor}:{})}))
      if(state.speaker)stage.speaker=state.speaker
    }
    if(lead) {
      const figure=(await packs.resolveFigures({refs:[lead]}))[0]?.value
      if(figure) {
        stage.mainCharacterColor=figure.imageColor ?? figure.autoColor
        if(stage.mainCharacterColor===undefined)delete stage.mainCharacterColor
        labels['/mainCharacterColor']=(figure.name || rawData(card.workspace.raw).name)+'形象色'
        if(!state)stage.characters=[{...lead,name:figure.name || rawData(card.workspace.raw).name,...(stage.mainCharacterColor?{color:stage.mainCharacterColor}:{})}]
      }
    }
    // the phone's contacts as the stage builds them (stage-asset-pack-director
    // phone.characters): the enabled figures of the card's packs through the one figure catalogue, keyed by actor key.
    if(ext.assetBindings) {
      const global=getGlobalEnabledPackIds(),ids=effectiveFigurePackIds(ext.assetBindings,global)
      const snapshots=(await Promise.all(ids.map(packId=>snapshot(packId).catch(()=>null)))).filter(Boolean)
      stage.contacts=figureCatalogue({snapshots,bindings:ext.assetBindings,globalEnabledPackIds:global,roster:state?.actors || {}}).filter(row=>row.enabled)
        .map(row=>({id:row.actorKey,name:row.name,figure:row.ref,...(row.figure.imageColor || row.figure.autoColor?{color:row.figure.imageColor || row.figure.autoColor}:{})}))
    }
    const skinRef=state?.skin?.ref || cardStageSkin(ext,engine.values,(await Promise.all(cardStageSkinPackIds(ext,engine.values,getGlobalEnabledPackIds()).map(packId=>snapshot(packId).catch(()=>null)))).map(pack=>pack?.manifest)).skin
    const skin=typeof skinRef==='string'?skinContract.BUILTIN_STAGE_SKINS[skinRef]:skinRef?(await snapshot(skinRef.packId))?.skins?.[skinRef.assetId]:null
    const appearance=skin && skinContract.stageSkinAppearance(skin,state?.skin?.level)
    if(appearance?.ui){stage.skin=Object.fromEntries(Object.entries({surface:appearance.ui.bg,line:appearance.ui.border,accent:appearance.ui.accent}).filter(([,value])=>value!==undefined));labels['/skin/surface']='舞台皮肤';labels['/skin/line']='舞台皮肤'}
    source.stage={available:true,value:stage,labels}
    source.ledger=ledgerSource(indexed)
    const stateSource=resolveStateSource({preference,raw:card.workspace.raw,chat:indexed,sources:source})
    const value={cardId:card.workspace.meta.id,sessionId:args.sessionId,raw:card.workspace.raw,revision,sources:source,stateSource}
    cache.set(key,value);if(cache.size>32)cache.delete(cache.keys().next().value)
    return value
  }
  async function listAssets({modId,key}) {
    const field=schemas[modId]?.fields.find(row=>row.key===key),media=field?.assetMedia || field?.recordAssetMedia
    if(!media)fail('UNKNOWN_FIELD','This field does not declare an asset reference')
    const owner=await getPacks(),packs=await owner.listPackSummaries(),assets=[]
    for(const row of packs.filter(row=>!row.privateConfig && !row.error)) {
      const pack=await owner.getPackSnapshot({packId:row.packId})
      for(const asset of pack.manifest.assets) {
        const hash=assetContent(asset).media
        if(hash && pack.manifest.blobs[hash]?.mime.startsWith(media+'/'))assets.push({label:pack.manifest.name+' / '+asset.name,ref:{packId:row.packId,kind:asset.kind,assetId:asset.id}})
      }
    }
    return {assets}
  }
  const rpc=createModConfigRpc({schemas,store,sources,context,listAssets,authorize:({context})=>typeof context?.origin==='string' || !!workbenchAuthority && context===workbenchAuthority})
  return Object.freeze({schemas,store,service,sources,cardPacks,context,register,async call(method,args,authority) {
    const value=await rpc[method](args,authority)
    if(['setModConfig','clearModConfig','uploadModConfigFile'].includes(method)){cache.clear();invalidate()}
    return value?.resolved?projectOptions(value,args,authority):value
  },async values(modId,card,chat) {return (await this.resolved(modId,card,chat)).values},
  async readDanmakuSettings(cardId) {
    const {card,global}=await store.read({modId:'dsh.danmaku',cardId}),values={}
    for(const key of ['commentsPerRequest','minIntervalSeconds','maxCallsPerMinute']) {
      const entry=card[key] ?? global[key]
      if(entry)values[key]=entry.fixed ?? schemas['dsh.danmaku'].fields.find(field=>field.key===key).default
    }
    return values
  },
  // the host's face set in the room's settings — an uploaded 主播头像图片,
  // else the card's 主播头像 figure. Without either, the stage gives the bar the face of the figure the host's name
  // (主播名称, or the player's name) resolves to, with the same card-figure lookup as the phone's contacts
  // (useCardFaces, every figure of the card's and global packs); otherwise the neutral face.
  async readStreamer(cardId) {
    const {card}=await store.read({modId:'dsh.danmaku',cardId})
    const identity={name:card.streamerName?.fixed ?? '',avatarRef:card.streamerAvatarRef?.fixed ?? null}
    let transient=false
    try {
      const image=card.streamerAvatarImage?.fixed
      if(image?.file) {
        const media=await store.readFile({modId:'dsh.danmaku',cardId,layer:'card',path:image.file})
        if(['image/png','image/jpeg','image/webp'].includes(media.file.mime))identity.avatar={src:'data:'+media.file.mime+';base64,'+media.data}
      } else if(identity.avatarRef) {
        const {workspace}=await cardPacks.lookup(cardId),bindings=rawData(workspace.raw).extensions?.dsh_tavern?.assetBindings || {}
        const global=getGlobalEnabledPackIds(),packs=await getPacks()
        const read=await Promise.all(effectiveFigurePackIds(bindings,global).map(packId=>packs.getPackSnapshot({packId}).catch(()=>null))),snapshots=read.filter(Boolean)
        // A pack that could not be read now (library still starting, a write in flight) is not an answer: read again later.
        if(snapshots.length<read.length)transient=true
        const rows=figureCatalogue({snapshots,bindings,globalEnabledPackIds:global}),resolved=resolution.resolveFigureName(rows,identity.avatarRef)
        if(resolved.status==='resolved') {
          const pack=snapshots.find(pack=>pack.manifest.id===resolved.ref.packId),avatar=selectFigureAvatar(resolved.row.figure,pack.sprites)
          if(avatar) {
            await packs.readMedia({packId:resolved.ref.packId,hash:avatar.hash,expectedRevision:pack.revision})
            identity.avatar={src:'/api/dsh-asset-library/v2/thumbnail?v=1&packId='+encodeURIComponent(resolved.ref.packId)+'&hash='+encodeURIComponent(avatar.hash),crop:avatar.crop}
          }
        }
      }
    } catch { transient=true /* Unavailable card media stays neutral for now; keep the stored reference intact. */ }
    // `transient`: the caller (fork-mod-events) re-reads instead of keeping a neutral face for the whole session.
    return transient?Object.defineProperty(identity,'transient',{value:true}):identity
  },
  // a reference or formula that cannot be read shows the declared default on stage (the
  // editor alone shows the ⚠); layers say which layer's files/ an uploaded image is read from.
  async resolved(modId,card,chat) {
    const result=await service.get({modId,...await context({cardId:card.meta.id,sessionId:chat?.sessionId},chat?{card,chat}:undefined)}),values={},layers={}
    for(const [key,row] of Object.entries(result.resolved)) {
      values[key]=row.error?structuredClone(schemas[modId].fields.find(field=>field.key===key).default):row.value
      layers[key]=row.error?'auto':row.layer
    }
    return {values:await resolveOptionValues(modId,card,chat,values),layers}
  },
  async stateSource(chat,raw) {
    const preference=(await service.resolve('dsh.state','source')).value
    const sources=await readCardVariableSources({path:chat.cardPath,indexed:chat,readWindow,readRevision})
    return resolveStateSource({preference,raw,chat,sources})
  },
  readFile:args=>store.readFile(args),async bindings(manifest,card,chat,overrideSources) {
    const ctx=overrideSources?{cardId:card.meta.id,raw:card.raw,sources:overrideSources}:await context({cardId:card.meta.id,sessionId:chat?.sessionId},chat?{card,chat}:undefined)
    if(overrideSources)ctx.stateSource=resolveStateSource({preference:(await service.resolve('dsh.state','source')).value,raw:card.raw,chat,sources:overrideSources})
    const data=await store.read({modId:manifest.id,cardId:card.meta.id}),result={}
    for(const read of manifest.permissions.variables?.reads || [])if(read.slot) {
      const entry=data.card[read.slot] ?? data.global[read.slot] ?? {auto:true}
      const slot=manifest.variableSlots.find(slot=>slot.id===read.slot)
      if(entry.ref && ['mvu','ledger'].includes(entry.ref.source))result[read.id]=entry.ref
      else if(entry.auto) {
        const resolved=await service.resolve(manifest.id,read.slot,ctx),field=schemas[manifest.id].fields.find(row=>row.key===read.slot),candidate=resolved.autoCandidates?.[0]
        if(!resolved.error && candidate?.variable.source===slot.source && candidate.score>=(field.guessHints?.threshold ?? 65))result[read.id]=candidate.variable
      }
    }
    return result
  }})
}
