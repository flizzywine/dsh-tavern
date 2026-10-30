import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateModManifest, validateModPack} from './manifest.js'
import {modSettingValue,modPresentationChanges} from './settings.js'
import {modScope, modVersionMatches} from './permissions.js'
import {registerModCommands,checkModCompatibility} from './commands.js'
import {validateModDefaults} from './import.js'
import {resolveModCapabilities,assertRequiredDependencyGraph,missingPolicy} from './capabilities.js'
const {modCheck:check, modFreeze, modShape:shape, modJson} = contract
const copy = structuredClone
export const displayName = manifest => manifest.i18n?.messages?.[manifest.i18n.defaultLocale]?.[manifest.name] || manifest.name
const empty = () => ({revision:'0',mods:{},global:{enabledModIds:[],mods:{}},cards:{},grants:{}})

// publish is the durable owner's atomic CAS. A rejected publication never changes readers.
export function createModRegistry({capabilities = [], coreCommands = [], initial = empty(), publish, assetAvailable = () => false, id = randomUUID} = {}) {
  let state=modFreeze(copy(initial)), pending=Promise.resolve(),authorityRevision=initial.revision
  const requireMod = (draft,modId) => {const row=Object.hasOwn(draft.mods,modId)?draft.mods[modId]:null;check(row,'$.modId','Mod is not installed','MOD_RESOURCE_UNAVAILABLE');return row}
  const scope = (draft,modId) => draft.global.enabledModIds.includes(modId)?'global':'off'
  const granted = (draft,modId) => draft.grants[modId] === draft.mods[modId]?.releaseRevision
  function reason(draft,modId,cardId,visiting = new Set()) {
    const row=draft.mods[modId]
    if (!row || scope(draft,modId,cardId)==='off') return 'MOD_DISABLED'
    if (!granted(draft,modId)) return 'MOD_PERMISSION_DENIED'
    if (visiting.has(modId)) return 'MOD_DEPENDENCY_MISSING'
    const chain=new Set([...visiting,modId]),deps=row.manifest.dependencies
    if (deps.capabilities.some(capability=>!capabilities.includes(capability))) return 'MOD_DEPENDENCY_MISSING'
    if (deps.assets?.some(asset=>!assetAvailable(asset,cardId))) return 'MOD_DEPENDENCY_MISSING'
    for (const dependency of deps.mods || []) {
      if (missingPolicy(dependency) !== 'error') continue
      const other=draft.mods[dependency.id]
      if (!other || !modVersionMatches(other.manifest.version,dependency.range) || reason(draft,dependency.id,cardId,chain)) return 'MOD_DEPENDENCY_MISSING'
    }
    return null
  }
  function checkCommands(draft) {
    const manifests=draft.global.enabledModIds.filter(id=>granted(draft,id)).map(id=>requireMod(draft,id).manifest)
    registerModCommands(manifests,coreCommands)
    checkModCompatibility(manifests,displayName)
  }
  function checkEnabled(draft) {
    for (const modId of draft.global.enabledModIds) {
      const why=reason(draft,modId)
      check(!why,'$.scope','Cannot enable '+modId+': '+why+'; disable dependents in the same change.',why)
    }
    checkCommands(draft)
  }
  function setScopes(input) {
    shape(input,['changes','expectedRevision'])
    check(Array.isArray(input.changes) && input.changes.length>0 && input.changes.length<=64,'$.changes')
    const changes=copy(input.changes),seen=new Set()
    for(const row of changes) {
      shape(row,['modId','scope'])
      check(typeof row.modId==='string' && !seen.has(row.modId),'$.changes','Use distinct installed IDs and global/off scopes')
      seen.add(row.modId)
    }
    return mutate(input.expectedRevision,draft=>{
      for(const row of changes) {requireMod(draft,row.modId);check(['global','off'].includes(row.scope),'$.scope')}
      const enabled=new Set(draft.global.enabledModIds)
      for(const {modId,scope} of changes)scope==='global'?enabled.add(modId):enabled.delete(modId)
      draft.global.enabledModIds=[...enabled].sort()
      checkEnabled(draft)
      return {changes:changes.map(row=>({...row,effectiveEnabled:!reason(draft,row.modId)})),affected:'all-cards'}
    })
  }
  function mutate(expectedRevision, change) {
    const task=pending.then(async()=>{
      check(expectedRevision === state.revision,'$.expectedRevision','Mod library changed','MOD_REVISION_CONFLICT')
      const next=copy(state),value=change(next)
      next.revision=id()
      const frozen=modFreeze(next)
      if (publish) check(await publish(frozen,state.revision)!==false,'$.expectedRevision','Durable mod state changed','MOD_REVISION_CONFLICT')
      if(!modPresentationChanges(state,frozen))authorityRevision=frozen.revision
      state=frozen
      return modFreeze({...value,revision:state.revision})
    })
    pending=task.catch(()=>{})
    return task
  }
  function card(draft,modId,cardId) {
    check(typeof cardId==='string' && cardId.length>0 && cardId.length<=256 && !['__proto__','constructor','prototype'].includes(cardId),'$.cardId','Card scope needs a card')
    draft.cards[cardId] ||= {version:1,mods:{}}
    return draft.cards[cardId].mods[modId] ||= {boundPackIds:[]}
  }
  const globalMod = (draft,modId) => draft.global.mods[modId] ||= {enabledPackIds:[],settings:{}}
  function setScope(draft,input,packId) {
    const {modId,cardId,scope:desired}=input
    check((packId?['global','card','off']:['global','off']).includes(desired),'$.scope')
    const row=requireMod(draft,modId)
    if (packId) check(row.packs[packId],'$.packId','Pack is not installed','MOD_RESOURCE_UNAVAILABLE')
    const globalIds=packId ? globalMod(draft,modId).enabledPackIds : draft.global.enabledModIds,target=packId || modId
    const wasGlobal=globalIds.includes(target),at=globalIds.indexOf(target)
    if (at>=0) globalIds.splice(at,1)
    if (desired==='global') globalIds.push(target)
    if (packId && (desired==='card' || cardId)) {
      const binding=card(draft,modId,cardId)
      binding.boundPackIds=[...binding.boundPackIds.filter(value=>value!==packId),...(desired==='card'?[packId]:[])]
    }
    if (!packId && desired!=='off') {
      const why=reason(draft,modId,desired==='global'?undefined:cardId)
      check(!why,'$.scope','Cannot enable mod: '+why,why)
    }
    checkCommands(draft)
    return {scope:desired,effectiveEnabled:(!packId || desired!=='off') && !reason(draft,modId,cardId),affected:!packId || wasGlobal || desired==='global'?'all-cards':'card'}
  }
  const settings = (draft,modId,cardId) => {
    const row=requireMod(draft,modId),shared=draft.global.mods[modId]?.settings,values={}
    for (const field of row.manifest.settingsSchema.fields) values[field.key]=copy(shared && Object.hasOwn(shared,field.key)?shared[field.key]:field.default)
    return {revision:draft.revision,values,storedValues:copy(shared||{}),diagnostics:[]}
  }
  function resolution(draft,admitted) {
    return resolveModCapabilities({manifests:Object.values(draft.mods).map(row=>row.manifest),enabled:draft.global.enabledModIds,
      authorized:Object.keys(draft.mods).filter(id=>granted(draft,id)),...(admitted?{admitted}:{})})
  }
  const notices = (draft,modId) => (resolution(draft)[modId] || []).filter(row=>!row.available && row.onMissing !== 'silent').map(row=>row.message)
  function readView(state,authorityRevision) {
    return Object.freeze({
      capabilities:(admitted)=>resolution(state,admitted),
      snapshot:()=>state,
      getMod({modId,cardId}) {const row=requireMod(state,modId);return modFreeze({manifest:row.manifest,revision:state.revision,modRevision:row.releaseRevision,scope:scope(state,modId,cardId),authorized:granted(state,modId),settings:settings(state,modId,cardId),packs:Object.values(row.packs),dependencyNotices:notices(state,modId),diagnostics:[reason(state,modId,cardId),...notices(state,modId)].filter(Boolean)})},
      listModPacks({modId,cardId}) {const row=requireMod(state,modId);return modFreeze({revision:state.revision,packs:Object.values(row.packs).map(pack=>({id:pack.id,modId,name:pack.name,revision:state.revision,scope:modScope(state.global.mods[modId]?.enabledPackIds.includes(pack.id),state.cards[cardId]?.mods[modId]?.boundPackIds.includes(pack.id)),entryCount:pack.entries.length}))})},
      active(cardId) {return modFreeze(Object.keys(state.mods).filter(modId=>!reason(state,modId,cardId)).map(modId=>state.mods[modId].manifest))},
      authority(modId,cardId) {return !reason(state,modId,cardId)?state.mods[modId].releaseRevision+':'+authorityRevision:null}
    })
  }
  return Object.freeze({
    readSnapshot:()=>readView(state,authorityRevision),
    snapshot:()=>state,
    listMods({cardId} = {}) {return modFreeze({revision:state.revision,mods:Object.entries(state.mods).map(([modId,row])=>({id:modId,name:displayName(row.manifest),version:row.manifest.version,apiVersion:row.manifest.apiVersion,scope:scope(state,modId,cardId),authorized:granted(state,modId),effectiveEnabled:!reason(state,modId,cardId),reason:reason(state,modId,cardId),dependencyNotices:notices(state,modId),revision:state.revision,modRevision:row.releaseRevision,permissions:row.manifest.permissions,pages:row.manifest.uiPages,packCount:Object.keys(row.packs).length,...(row.manifest.ui?.internal?{internal:true}:{})}))})},
    getMod:(input) => readView(state,authorityRevision).getMod(input),
    install({manifest,expectedRevision,replace=false,packs=[],defaults,origin,content}) {
      const validated=validateModManifest(manifest)
      const importedPacks=packs.map(pack=>validateModPack(pack,validated))
      const importedDefaults=defaults === undefined ? undefined : validateModDefaults(defaults,validated)
      check(new Set(importedPacks.map(pack=>pack.id)).size===importedPacks.length,'$.packs','Duplicate imported pack')
      for (const pack of importedPacks) check(modVersionMatches(validated.version,pack.requiresModVersion),'$.packs','Imported pack requires another release','MOD_DEPENDENCY_MISSING')
      return mutate(expectedRevision,draft=>{
        check(!draft.mods[validated.id] || replace,'$.modId','Mod is already installed','MOD_REVISION_CONFLICT')
        const old=draft.mods[validated.id]
        if (old) for(const pack of Object.values(old.packs).filter(pack=>!importedPacks.some(imported=>imported.id===pack.id))) {
          if (!equal(old.manifest,validated)) validateModPack(pack,validated)
          check(modVersionMatches(validated.version,pack.requiresModVersion),'$.version','Installed pack requires another mod version','MOD_DEPENDENCY_MISSING')
        }
        if (old) for(const [key,value] of Object.entries(draft.global.mods[validated.id]?.settings || {})) {
          const field=validated.settingsSchema.fields.find(field=>field.key===key)
          check(field && modSettingValue(field,value,validated.id),'$.settings.'+key,'Existing setting is incompatible with this release','MOD_REVISION_CONFLICT')
        }
        draft.mods[validated.id]={manifest:validated,releaseRevision:id(),packs:{...old?.packs,...Object.fromEntries(importedPacks.map(pack=>[pack.id,pack]))},
          ...(origin ? {origin:copy(origin)} : {}),...(content ? {content:{release:content.release,packs:{...old?.content?.packs,...content.packs}}} : {})}
        if (importedDefaults !== undefined) globalMod(draft,validated.id).settings=importedDefaults
        assertRequiredDependencyGraph(Object.values(draft.mods).map(row=>row.manifest))
        registerModCommands(Object.values(draft.mods).map(row=>row.manifest),coreCommands,{checkVerbs:false})
        delete draft.grants[validated.id]
        return {modId:validated.id,modRevision:draft.mods[validated.id].releaseRevision}
      })
    },
    replaceNativeSettings({expectedRevision,expectedValue,value}) {
      modJson(value,1024*1024);shape(value,['global','grants']);shape(value.global,['enabledModIds','mods'])
      check(Array.isArray(value.global.enabledModIds) && new Set(value.global.enabledModIds).size===value.global.enabledModIds.length,'$.global.enabledModIds')
      shape(value.global.mods,Object.keys(value.global.mods),[]);shape(value.grants,Object.keys(value.grants),[])
      return mutate(expectedRevision,draft=>{
        for(const id of new Set([...value.global.enabledModIds,...Object.keys(value.global.mods),...Object.keys(value.grants)]))requireMod(draft,id)
        check(equal({global:draft.global,grants:draft.grants},expectedValue),'$.expectedValue','Native settings changed','MOD_REVISION_CONFLICT')
        const changed=Object.keys(draft.mods).filter(id=>draft.global.enabledModIds.includes(id)!==value.global.enabledModIds.includes(id) || !equal(draft.global.mods[id],value.global.mods[id]) || draft.grants[id]!==value.grants[id])
        const newlyEnabled=value.global.enabledModIds.filter(id=>!draft.global.enabledModIds.includes(id))
        draft.global=copy(value.global);draft.grants=copy(value.grants)
        for(const id of newlyEnabled)check(granted(draft,id),'$.grants','Authorization required','MOD_PERMISSION_DENIED')
        for(const id of changed) {
          const row=requireMod(draft,id),settings=draft.global.mods[id]
          check(draft.grants[id]===undefined || draft.grants[id]===row.releaseRevision,'$.grants','Release authority differs','MOD_PERMISSION_DENIED')
          if(settings) {
            shape(settings,['enabledPackIds','settings'],['enabledPackIds']);check(Array.isArray(settings.enabledPackIds),'$.global.mods.enabledPackIds')
            check(settings.enabledPackIds.every(packId=>Object.hasOwn(row.packs,packId)),'$.global.mods','Unknown enabled pack','MOD_RESOURCE_UNAVAILABLE')
            for(const [key,value] of Object.entries(settings.settings || {})) {
              const field=row.manifest.settingsSchema.fields.find(field=>field.key===key)
              check(field && modSettingValue(field,value,id),'$.global.mods.settings','Invalid migrated setting')
            }
          }
          for(const cardId of [undefined,...Object.keys(draft.cards)])if(scope(draft,id,cardId)!=='off' && granted(draft,id)) {
            const why=reason(draft,id,cardId);check(!why,'$.scope','Cannot activate migrated settings: '+why,why)
          }
        }
        for(const id of draft.global.enabledModIds.filter(id=>granted(draft,id))) {const why=reason(draft,id);check(!why,'$.scope','Cannot disable a required dependency; disable dependents together.',why)}
        checkCommands(draft)
        return {updated:true}
      })
    },
    authorize({modId,expectedRevision,allowed}) {check(typeof allowed==='boolean','$.allowed');return mutate(expectedRevision,draft=>{const row=requireMod(draft,modId);if(allowed) {draft.grants[modId]=row.releaseRevision;if(scope(draft,modId)==='global') {const why=reason(draft,modId);check(!why,'$.scope','Cannot authorize active mod: '+why,why)}} else delete draft.grants[modId];checkCommands(draft);return {modId,authorized:allowed}})},
    setModScope(input) {
      shape(input,['modId','scope','expectedRevision'])
      return setScopes({changes:[{modId:input.modId,scope:input.scope}],expectedRevision:input.expectedRevision}).then(result=>({...result.changes[0],revision:result.revision,affected:result.affected}))
    },
    setModScopes:setScopes,
    setModPackScope(input) {check(typeof input.packId==='string' && input.packId.length>0,'$.packId');return mutate(input.expectedRevision,draft=>setScope(draft,input,input.packId))},
    listModPacks:(input) => readView(state,authorityRevision).listModPacks(input),
    // mediaVerified: the host media store confirmed every newly referenced file (mod-media.js); RPC input cannot set it.
    saveModPack({modId,pack,expectedRevision,contentRoot,mediaVerified=false}) {
      const validated=validateModPack(pack,requireMod(state,modId).manifest)
      return mutate(expectedRevision,draft=>{
        const row=requireMod(draft,modId)
        check(modVersionMatches(row.manifest.version,validated.requiresModVersion),'$.requiresModVersion','Pack requires another mod version','MOD_DEPENDENCY_MISSING')
        if (!contentRoot && mediaVerified!==true) check(equal(validated.files,row.packs[validated.id]?.files || []),'$.files','Media changes require an inspected archive','MOD_PERMISSION_DENIED')
        row.packs[validated.id]=validated
        if (contentRoot) {
          check(row.content,'$.content','Mod release files are not installed','MOD_RESOURCE_UNAVAILABLE')
          row.content.packs[validated.id]=contentRoot
        }
        return {pack:validated}
      })
    },
    importModPacks({modId,packs,contentRoots,expectedRevision,replace=false}) {
      const manifest=requireMod(state,modId).manifest,validated=packs.map(pack=>validateModPack(pack,manifest))
      check(new Set(validated.map(pack=>pack.id)).size===validated.length,'$.packs','Duplicate imported pack')
      for (const pack of validated) check(modVersionMatches(manifest.version,pack.requiresModVersion),'$.packs','Pack requires another release','MOD_DEPENDENCY_MISSING')
      return mutate(expectedRevision,draft=>{
        const row=requireMod(draft,modId)
        check(row.content,'$.content','Mod release files are not installed','MOD_RESOURCE_UNAVAILABLE')
        for (const pack of validated) {
          check(replace || !Object.hasOwn(row.packs,pack.id),'$.packs','Pack already exists','MOD_REVISION_CONFLICT')
          row.packs[pack.id]=pack;row.content.packs[pack.id]=contentRoots[pack.id]
        }
        return {modId,packIds:validated.map(pack=>pack.id)}
      })
    },
    saveModEntry({ref,entry,expectedRevision}) {modJson(ref);shape(ref,['modId','packId','kind','entryId']);return mutate(expectedRevision,draft=>{const row=requireMod(draft,ref.modId),pack=row.packs[ref.packId];check(pack,'$.ref','Pack is not installed','MOD_RESOURCE_UNAVAILABLE');check(entry.id===ref.entryId && entry.kind===ref.kind,'$.entry','Entry identity cannot change');const entries=[...pack.entries.filter(value=>value.id!==ref.entryId),copy(entry)];row.packs[ref.packId]=validateModPack({...pack,entries},row.manifest);return {entry:copy(entry)}})},
    deleteModPack({modId,packId,expectedRevision,confirmed}) {check(confirmed===true,'$.confirmed');return mutate(expectedRevision,draft=>{const row=requireMod(draft,modId);check(Object.hasOwn(row.packs,packId),'$.packId','Pack is not installed','MOD_RESOURCE_UNAVAILABLE');delete row.packs[packId];const global=draft.global.mods[modId];if(global)global.enabledPackIds=global.enabledPackIds.filter(value=>value!==packId);for(const binding of Object.values(draft.cards)){const own=binding.mods[modId];if(own){own.boundPackIds=own.boundPackIds.filter(value=>value!==packId);if(own.packSettings)delete own.packSettings[packId]}}return {deleted:true,notices:['Historical references retain their original identity.']}})},
    saveModSettings(input) {shape(input,['modId','values','expectedRevision']);const {modId,values,expectedRevision}=input;modJson(values);return mutate(expectedRevision,draft=>{
      const row=requireMod(draft,modId)
      shape(values,row.manifest.settingsSchema.fields.map(field=>field.key),[])
      for(const [key,value] of Object.entries(values)){
        const field=row.manifest.settingsSchema.fields.find(field=>field.key===key)
        check(modSettingValue(field,value,modId),'$.values.'+key)
      }
      globalMod(draft,modId).settings=copy(values)
      return settings(draft,modId)
    })},
    deleteMod({modId,expectedRevision,confirmed}) {check(confirmed===true,'$.confirmed');return mutate(expectedRevision,draft=>{requireMod(draft,modId);delete draft.mods[modId];delete draft.grants[modId];delete draft.global.mods[modId];draft.global.enabledModIds=draft.global.enabledModIds.filter(value=>value!==modId);for(const binding of Object.values(draft.cards))delete binding.mods[modId];return {deleted:true,notices:['Existing historical references are not rewritten.']}})},
    capabilities:(admitted)=>resolution(state,admitted),
    active:(cardId) => readView(state,authorityRevision).active(cardId),
    authority:(modId,cardId) => readView(state,authorityRevision).authority(modId,cardId),
  })
}
