import {createManagedModManager,MANAGED_MOD_METHODS} from './domain/mod-system-manager.js'
import {createManagedModCardOwner} from './domain/mod-system-choices.js'
import {createManagedModSettingsOwner} from './mod-system-settings.js'
import {firstPartyDistributions} from './mod-system-distributions.js'
import {modError,emptyCardMods} from './domain/mod-system-contract.js'
import {resolveMods,resolveConfig} from './domain/mod-system.js'
import {rawData} from './domain/card-preparation.js'
import {freezeForegroundModPrompts} from './domain/mod-system-prompts.js'
import {createManagedConfigAssetValidator,createManagedConfigAssetReader} from './domain/mod-system-config-assets.js'
import {createManagedModHost} from './domain/mod-system-host.js'
import {validateSkinModOptions} from './domain/mod-system-options.js'

export {MANAGED_MOD_METHODS}

// The authenticated application dispatch and the existing card/settings/plugin owners are the
// only entry points. This is management, not a second plugin loader or runtime registry.
export function createManagedModProduction({ctx,cardPlugins,cardPreparation,listPaths,readWorkspace,writeWorkspace,withCardLock,validateReferences=createManagedConfigAssetValidator({getAssetLibrary:()=>ctx.get('assetLibrary')}),onChange,readSkin=async()=>null,readSession=async()=>null,resolveOptionConfig,distributions=firstPartyDistributions}) {
  let bundles
  const localDistributions=()=>bundles ||= distributions()
  const settings=createManagedModSettingsOwner(ctx)
  const cards=createManagedModCardOwner({cardPreparation,listPaths,readWorkspace,writeWorkspace,withCardLock})
  const installations=cardPlugins.managed({retiredIds:['dsh.performance'],distributions:localDistributions,cardRoots:async()=>(await cards.list()).map(row=>({cardId:row.cardId,revision:row.revision,mods:[...new Set([...Object.keys(row.value.mods),...Object.keys(row.value.config)])].sort()}))})
  const modHost=createManagedModHost()
  async function authorize() {const current=await installations.read();modHost.authorize(current.value.releases.filter(row=>row.active && row.installed && row.authorized).map(row=>row.manifest.id))}
  const ready=authorize()
  let tail=Promise.resolve(),active=true
  async function contextFor({cardId,sessionId}={}) {
    if(sessionId) {
      const chat=await readSession(sessionId),workspace=chat && await readWorkspace(chat.cardPath)
      if(!workspace || cardId && workspace.meta.id!==cardId)throw modError('MOD_PERMISSION_DENIED','Session does not belong to this card')
      return {cardId:workspace.meta.id,cardPath:chat.cardPath,sessionId}
    }
    if(cardId) {
      const {path}=await cards.lookup(cardId)
      return {cardId,cardPath:path}
    }
    return {}
  }
  const skinFor=async args=>{const context=await contextFor(args);return readSkin(context.cardPath,context)}
  const manager=createManagedModManager({cards,settings,installations,validateReferences,readSkin:skinFor,resolveOptionConfig,
    async readOptionMedia(skin,keys) {
      if(!skin?.ref)return {}
      const owner=ctx.get('assetLibrary'),media={}
      for(const assetKey of new Set(keys)) {
        try {
          const {bytes,mime}=await owner.readSkinAsset({ref:skin.ref,assetKey,expectedRevision:skin.resource.revision})
          media[assetKey]='data:'+mime+';base64,'+Buffer.from(bytes).toString('base64')
        } catch(error) {if(!['ASSET_UNAVAILABLE','ENOENT'].includes(error.code))throw error}
      }
      return media
    },
    async onChange(action) {
      if(action==='switch' || action==='config') {
        const current=await installations.read()
        await installations.compareAndSwap({expectedRevision:current.revision,expectedValue:current.value,value:current.value})
      }
      await authorize()
      await onChange?.(action)
    },
    withLock(fn){const task=tail.then(fn);tail=task.catch(()=>{});return task},
    async authorize({args,authority}) {
      if(!active || typeof authority?.origin!=='string' || !authority.origin)return null
      if(args.cardId!==undefined) {
        if(typeof args.cardId!=='string' || !args.cardId)throw modError('MOD_INVALID','Choose a native card ID')
        await cards.list()
        await cards.read({cardId:args.cardId})
      }
      return authority.origin
    },
  })
  async function selection(cardPath,{sessionId}={}) {
    const global=settings.read().value,workspace=cardPath?await readWorkspace(cardPath):null
    const card=workspace?rawData(workspace.raw).extensions?.dsh_tavern?.modSystem || emptyCardMods():emptyCardMods()
    const current=await installations.read(),releases=current.value.releases.filter(row=>row.active && row.installed)
    const manifests=releases.map(row=>row.manifest),authorized=releases.filter(row=>row.authorized).map(row=>row.manifest.id)
    const skin=await readSkin(cardPath,{cardId:workspace?.meta.id,sessionId})
    return {global,card,skin:skin?.document,manifests,resolution:resolveMods({manifests,authorized,global,card,skin:skin?.document})}
  }
  ctx.provide('tavernSkinOptions',{async normalize(mods,assets) {
    const installation=await installations.read(),manifests=installation.value.releases.filter(row=>row.active && row.installed).map(row=>row.manifest)
    return validateSkinModOptions(mods,{manifests,assets}).mods
  }})
  ctx.effect(()=>()=>{active=false;manager.dispose();modHost.dispose()})
  return Object.freeze({cards,settings,installations,modHost,ready,selection,skinFor,validateReferences,
    async optionValues(modId,workspace,chat,resolvedValues) {
      const context=await contextFor({cardId:workspace.meta.id,sessionId:chat?.sessionId})
      const state=await selection(context.cardPath,{sessionId:chat?.sessionId}),manifest=state.manifests.find(row=>row.id===modId)
      if(!manifest)return resolvedValues
      const card=rawData(workspace.raw).extensions?.dsh_tavern?.modSystem || emptyCardMods(),skin=await skinFor({cardId:workspace.meta.id,sessionId:chat?.sessionId})
      return resolveConfig(manifest,state.global,card,{resolvedValues,skin:state.resolution.enabled.includes(modId)?skin?.document?.mods?.[modId]:undefined,assetAvailable:key=>Object.hasOwn(skin?.document?.assets || {},key)}).values
    },
    assetReader:input=>createManagedConfigAssetReader({...input,getAssetLibrary:()=>ctx.get('assetLibrary')}),
    async request(chat,options) {
      const {global,card,skin}=await selection(chat.cardPath,{sessionId:chat.sessionId})
      return modHost.beginConfiguredRequest(modHost.beginSession(),{...options,choices:{global,card,skin}})
    },
    async enabled({modId,cardPath}) {return (await selection(cardPath)).resolution.enabled.includes(modId)},
    async foreground(chat,{previous,nativeSession}) {
      // Opening snapshots precede publication: only a persisted chat has session stage overrides.
      const sessionId=chat._storageRevision>0 ? chat.sessionId : undefined
      const state=await selection(chat.cardPath,{sessionId}),config=Object.fromEntries(state.manifests.filter(row=>state.resolution.enabled.includes(row.id) && row.prompts?.some(fragment=>fragment.model==='foreground')).map(row=>[row.id,resolveConfig(row,state.global,state.card,{skin:state.skin?.mods?.[row.id],assetAvailable:key=>Object.hasOwn(state.skin?.assets || {},key)})]))
      return freezeForegroundModPrompts({previous,nativeSession,sessionId:chat.sessionId,manifests:state.manifests,snapshot:{resolution:state.resolution,config}})
    },
    async installBuiltins() {
      const bundles=await localDistributions(),current=await installations.read(),value=structuredClone(current.value)
      for(const bundle of bundles) {
        for(const row of value.releases.filter(row=>row.manifest.id===bundle.manifest.id)) {
          row.active=row.digest===bundle.sha256
          if(row.active)Object.assign(row,{installed:true,authorized:true,globalRoot:true})
        }
      }
      await installations.compareAndSwap({expectedRevision:current.revision,expectedValue:current.value,value})
      await authorize()
    },
    async call(method,args={},authority,{serverTemplate=false}={}) {
      if(serverTemplate || !active || !authority?.origin)throw modError('MOD_PERMISSION_DENIED','Authenticated application access is required')
      const context=args.sessionId?await contextFor(args):{}
      return manager.call(method,{...args,...(context.cardId?{cardId:context.cardId}:{})},authority)
    },
  })
}
