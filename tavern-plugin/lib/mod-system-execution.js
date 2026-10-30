import {isDeepStrictEqual as equal} from 'node:util'
import {createHash} from 'node:crypto'
import {resolveMods,resolveConfig} from './domain/mod-system.js'
import {validateUserModOptions} from './domain/mod-system-options.js'
import {validateManagedConfigValues} from './domain/mod-system-config.js'
import {resolveModCapabilities} from './domain/mods/capabilities.js'
import {performanceInteropUse} from './domain/mods/interop.js'
import {emptyCardMods,modError,assertSchema} from './domain/mod-system-contract.js'
import {managedConfigFields} from './domain/mod-system-config.js'
import {builtinConfigSchemas} from './domain/mods/config-builtins.js'
import {stateSourceSchema} from './domain/mods/state-source.js'
import {validateConfigValue} from './domain/mods/config.js'

export function managedConfigSchemas(manifests,resources) {
  const labels=builtinConfigSchemas(resources)
  return Object.fromEntries(manifests.map(manifest=>{
    const fields=managedConfigFields(manifest).fields.map(field=>{
      const schema=manifest.config.schema.properties[field.key],label=labels[manifest.id]?.fields.find(row=>row.key===field.key)
      const choices=field.options?.map(row=>({value:row.value,label:label?.ui?.choices?.find(item=>item.value===row.value)?.label || row.label}))
      const valueType=['text','select'].includes(field.type)?'string':field.type
      return {key:field.key,label:label?.label || schema.title || field.key,valueType,default:field.default,nullable:field.nullable,userAdjustable:schema.userAdjustable!==false,scope:'default+card',min:field.min,max:field.max,maxLength:field.maxLength,
        bindable:!choices && ['string','number'].includes(valueType),...(choices?{choices:choices.map(row=>row.value)}:{}),...(schema['x-tavern-asset']?{assetMedia:schema['x-tavern-asset'].media}:{}),...(schema.additionalProperties?.properties?.avatarRef?.['x-tavern-asset']?{recordAssetMedia:schema.additionalProperties.properties.avatarRef['x-tavern-asset'].media}:{}),
        ui:choices?{control:'choice',choices}:schema['x-tavern-asset']?{control:'asset'}:['image','images'].includes(label?.ui?.control)?label.ui:valueType==='number'?{integer:schema.type==='integer',...(label?.ui?.unit?{unit:label.ui.unit}:{})}:valueType==='string'?{control:label?.ui?.control==='colour'?'colour':label?.ui?.control==='time'?'time':'text'}:{}}
    })
    for(const [key,schema] of Object.entries(manifest.preferences.schema.properties || {})) {
      const label=labels[manifest.id]?.fields.find(row=>row.key===key),choices=schema.enum?.map(value=>({value,label:label?.ui?.choices?.find(row=>row.value===value)?.label || value}))
      fields.push({key,label:label?.label || schema.title || key,valueType:schema.enum?'string':schema.type==='integer'?'number':schema.type,default:manifest.preferences.defaults[key],scope:'global',fixedOnly:true,min:schema.minimum,max:schema.maximum,
        ...(schema.enum?{choices:schema.enum}:{}),ui:choices?{control:'choice',choices}:schema.type==='integer'?{integer:true}:{}})
    }
    return [manifest.id,{fields}]
  }))
}

// Immutable director views are derived from the managed owners. They own no registry,
// installation, grants or persistence, and never consult the retired settings/card fields.
export async function managedExecutionView({management,builtins}) {
  await management.ready
  const [installed,initialSettings,cards]=await Promise.all([management.installations.read(),management.settings.read(),management.cards.list()])
  const firstParty=new Set(builtins.catalogue().map(row=>row.id))
  const releases=installed.value.releases.filter(row=>row.active && row.installed && firstParty.has(row.manifest.id))
  const manifests=releases.map(row=>row.manifest),authorized=releases.filter(row=>row.authorized).map(row=>row.manifest.id)
  let settings=initialSettings,global=settings.value
  const choices=new Map(cards.map(row=>[row.cardId,row.value]))
  const skins=new Map(await Promise.all(cards.map(async row=>[row.cardId,(await management.skinFor?.({cardId:row.cardId}))?.document])))
  // The revision is an identity that every director record binds; digest the skin documents instead of embedding them.
  const version=()=>createHash('sha256').update(JSON.stringify([installed.revision,settings.revision,cards.map(row=>[row.cardId,row.revision]),[...skins]])).digest('hex')
  let revision=version()
  const authorityRevision=revision
  const resolve=cardId=>resolveMods({manifests,authorized,global,card:choices.get(cardId) || emptyCardMods(),skin:skins.get(cardId)})
  const enabled=resolve().enabled
  const mods=Object.fromEntries(releases.map(row=>[row.manifest.id,{name:row.manifest.name,manifest:builtins.manifest(row.manifest.id),releaseRevision:row.digest,packs:Object.fromEntries(builtins.manifest(row.manifest.id).defaultPacks.map(name=>{const pack=JSON.parse(builtins.file(row.manifest.id,name));return [pack.id,pack]}))}]))
  const state={revision,mods,global:{enabledModIds:enabled},cards:Object.fromEntries(choices)}
  const requireMod=id=>{if(!mods[id])throw modError('MOD_MISSING','Mod is not installed',{id});return mods[id]}
  const active=cardId=>resolve(cardId).enabled.map(id=>mods[id].manifest)
  const settingsFor=(id,cardId)=>{
    const manifest=manifests.find(row=>row.id===id),card=choices.get(cardId) || emptyCardMods()
    const bindings={...global.config[id]?.values,...card.config[id]?.values}
    // Variable bindings are resolved against the pinned source frame by the request owner.
    const resolvedValues={...manifest.config.defaults,...Object.fromEntries(Object.entries(bindings).map(([key,binding])=>[key,Object.hasOwn(binding,'fixed')?binding.fixed:manifest.config.defaults[key]]))}
    const projected=resolveConfig(manifest,global,card,{resolvedValues,skin:skins.get(cardId)?.mods?.[id],assetAvailable:key=>Object.hasOwn(skins.get(cardId)?.assets || {},key)})
    const storedValues=Object.fromEntries(Object.entries(bindings).filter(([,binding])=>Object.hasOwn(binding,'fixed')).map(([key,binding])=>[key,binding.fixed]))
    return {revision,values:projected.values,options:projected.options,storedValues,diagnostics:[]}
  }
  const view={snapshot:()=>state,readSnapshot:()=>view,active,
    authority:(id,cardId)=>resolve(cardId).enabled.includes(id)?requireMod(id).releaseRevision+':'+authorityRevision:null,
    presentationChanged(next) {
      const fields=Object.fromEntries(Object.entries(mods).map(([id,row])=>[id,row.manifest.settingsSchema.fields.filter(field=>field.presentation)]))
      const execution=value=>{
        const copy=structuredClone(value)
        for(const [id,rows] of Object.entries(fields)) {
          for(const row of rows)if(copy.config[id])delete copy.config[id].values[row.key]
        }
        return copy
      }
      if(!equal(execution(global),execution(next.value)))return null
      const changes={}
      for(const [id,rows] of Object.entries(fields))for(const field of rows) {
        const before=global.config[id]?.values?.[field.key]?.fixed ?? field.default,after=next.value.config[id]?.values?.[field.key]?.fixed ?? field.default
        if(!equal(before,after))(changes[id] ||= {})[field.key]=after
      }
      settings=next;global=next.value;revision=version();state.revision=revision
      return changes
    },
    capabilities:(admitted,cardId)=>resolveModCapabilities({manifests:Object.values(mods).map(row=>row.manifest),enabled:resolve(cardId).enabled,authorized,admitted,coreUses:[performanceInteropUse()]}),
    getMod({modId,cardId}) {const row=requireMod(modId);return {manifest:row.manifest,revision,modRevision:row.releaseRevision,scope:global.mods[modId]?'global':'off',authorized:authorized.includes(modId),settings:settingsFor(modId,cardId),packs:Object.values(row.packs),dependencyNotices:resolve(cardId).notices.filter(row=>row.consumer===modId),diagnostics:[]}},
    async saveModSettings({modId,values,expectedRevision}) {
      if(expectedRevision!==revision)throw modError('MOD_REVISION_CONFLICT','Mod settings changed')
      const manifest=manifests.find(row=>row.id===modId),next=structuredClone(global)
      validateUserModOptions(manifest,values)
      const skin=await management.skinFor?.({}),locked=skin?.document?.mods?.[modId]?.locks || []
      if(Object.keys(values).some(key=>locked.includes(key)))throw modError('MOD_INVALID','This option is controlled by the skin')
      next.config[modId]={version:manifest.config.version,values:{...next.config[modId]?.values,...Object.fromEntries(Object.entries(values).map(([key,fixed])=>[key,{fixed}]))}}
      await management.settings.compareAndSwap({expectedRevision:settings.revision,expectedValue:global,value:next})
      return (await managedExecutionView({management,builtins})).getMod({modId}).settings
    },
    listMods({cardId}={}) {return {revision,mods:releases.map(row=>({id:row.manifest.id,name:row.manifest.name,version:row.manifest.version,scope:global.mods[row.manifest.id]?'global':'off',effectiveEnabled:resolve(cardId).enabled.includes(row.manifest.id),authorized:row.authorized,modRevision:row.digest,revision,pages:mods[row.manifest.id].manifest.uiPages,packCount:Object.keys(mods[row.manifest.id].packs).length}))}},
    listModPacks({modId,cardId}) {const local=choices.get(cardId)||emptyCardMods();return {revision,packs:Object.values(requireMod(modId).packs).map(pack=>({id:pack.id,modId,name:pack.name,revision,scope:local.packs[pack.id]==='off'?'off':global.packs[pack.id]?'global':local.packs[pack.id]==='on'?'card':'off',entryCount:pack.entries.length}))}},
  }
  return Object.freeze(view)
}

// `files` (createModConfigFiles) holds a layer's uploaded pictures (the phone's Photos library and
// wallpaper); without it uploads stay with the asset library.
export function managedConfigStore({management,readCard,listCards,files}) {
  async function cardOwner(cardId) {await management.cards.list();return management.cards.read({cardId})}
  return Object.freeze({
    async read({modId,cardId,sessionId}) {
      const global=management.settings.read(),card=cardId?await cardOwner(cardId):null
      const installed=await management.installations.read(),manifest=installed.value.releases.find(row=>row.active && row.installed && row.manifest.id===modId)?.manifest
      const preferences=Object.fromEntries(Object.entries(global.value.preferences[modId] || {}).filter(([key])=>Object.hasOwn(manifest?.preferences.schema.properties || {},key)).map(([key,fixed])=>[key,{fixed}]))
      const skin=await management.skinFor?.({cardId,sessionId})
      return {revision:createHash('sha256').update(JSON.stringify([global.revision,card?.revision || '0',skin?.resource?.identity || skin?.document?.id || null,skin?.document?.mods || null])).digest('hex'),global:{...global.value.config[modId]?.values,...preferences},card:card?.value.config[modId]?.values || {}}
    },
    async write({modId,cardId,sessionId,layer,values,expectedRevision}) {
      const before=await this.read({modId,cardId,sessionId})
      if(before.revision!==expectedRevision)throw modError('MOD_REVISION_CONFLICT','Configuration changed')
      const owner=layer==='card'?management.cards:management.settings,current=layer==='card'?await cardOwner(cardId):owner.read(),next=structuredClone(current.value)
      const installed=await management.installations.read(),manifest=installed.value.releases.find(row=>row.active && row.manifest.id===modId)?.manifest
      if(!manifest && modId!=='dsh.state')throw modError('MOD_MISSING','Configuration owner is not installed')
      const config={}
      if(layer==='global' && manifest)next.preferences[modId]={}
      for(const [key,value] of Object.entries(values)) {
        if(Object.hasOwn(manifest?.preferences.schema.properties || {},key)) {
          if(layer!=='global')throw modError('MOD_INVALID','Preferences are global values')
          if(value.auto===true)continue
          if(!Object.hasOwn(value,'fixed'))throw modError('MOD_INVALID','Preferences are fixed values')
          next.preferences[modId][key]=value.fixed
        } else config[key]=value
      }
      if(manifest) {
        const skin=await management.skinFor?.({cardId,sessionId}),locked=skin?.document?.mods?.[modId]?.locks || []
        for(const key of new Set([...Object.keys(before[layer] || {}),...Object.keys(values)])) {
          if(equal(before[layer]?.[key],values[key]))continue
          if(manifest.config.schema.properties[key]?.userAdjustable===false || locked.includes(key))throw modError('MOD_INVALID','This option is controlled by the skin',{key})
        }
        validateManagedConfigValues(manifest,config)
        for(const [key,value] of Object.entries(config))if(Object.hasOwn(value,'fixed'))assertSchema(manifest.config.schema.properties[key],value.fixed)
        await management.validateReferences({manifest,values:config,cardId,scope:layer})
        if(layer==='global')assertSchema(manifest.preferences.schema,{...manifest.preferences.defaults,...next.preferences[modId]})
      } else {
        if(layer!=='global')throw modError('MOD_INVALID','State source is a global core preference')
        for(const [key,value] of Object.entries(config)) {
          const field=stateSourceSchema.fields.find(row=>row.key===key)
          if(!field)throw modError('MOD_INVALID','Unknown state preference')
          validateConfigValue(value,field)
        }
      }
      next.config[modId]={version:manifest?.config.version || 1,values:config}
      if(!equal(current.value,next))await owner.compareAndSwap({...(layer==='card'?{cardId}:{}),expectedRevision:current.revision,expectedValue:current.value,value:next})
      return this.read({modId,cardId,sessionId})
    },
    async lookup(cardId) {
      const rows=await listCards(),row=rows.find(row=>row.workspace?.meta.id===cardId)
      if(!row)throw modError('MOD_MISSING','Card is not available',{cardId})
      return {path:row.path,workspace:await readCard(row.path)}
    },
    async readFile(args){if(!files)throw modError('MOD_MISSING','Use a managed asset reference');return files.readFile(args)},
    async upload(args) {
      if(!files)throw modError('MOD_INVALID','Use the asset library to upload media')
      if((await this.read(args)).revision!==args.expectedRevision)throw modError('MOD_REVISION_CONFLICT','Configuration changed')
      const file=await files.put(args)
      return {revision:(await this.read(args)).revision,file}
    },
  })
}
