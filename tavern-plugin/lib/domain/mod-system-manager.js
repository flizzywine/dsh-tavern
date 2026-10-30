import {randomUUID} from 'node:crypto'
import {emptyCardMods,modError,assertSchema,MOD_HOST_API} from './mod-system-contract.js'
import {resolveMods,resolveSwitch,resolveConfig,validateDependencyGraph,modDependencyReason} from './mod-system.js'
import {validateUserModOptions} from './mod-system-options.js'
import {modVersionMatches} from './mod-system-semver.js'
import {planCardModChoices} from './mod-system-choices.js'
import {validateManagedConfigValues} from './mod-system-config.js'

export const MANAGED_MOD_METHODS=Object.freeze(['managedModsList','managedModDetail','managedModPlan','managedModApply','managedModSwitches','managedModSwitchPlan','managedModConfig','managedModConfigWrite','managedModInspect','managedModOptions','managedModOptionsWrite','getStageModOptions'])
const clone=structuredClone
const fail=(code,message,details)=>{throw modError(code,message,details)}
const object=value=>value && typeof value==='object' && !Array.isArray(value)
const fieldRows=section=>Object.entries(section.schema.properties || {}).map(([key,schema])=>({key,label:schema.title || key,schema:clone(schema),default:clone(section.defaults[key]),userAdjustable:schema.userAdjustable!==false}))
const option=(id,label)=>({id,label})

// The original installation/card/settings owners retain persistence and CAS authority.
// Installation owner: read() => {revision,releases,locks}; compareAndSwap({expectedRevision,expectedValue,value}).
export function createManagedModManager({installations,cards,settings,authorize,withLock,validateReferences=async()=>{},readOptionMedia=async()=>({}),readSkin=async()=>null,resolveOptionConfig=(manifest,f)=>resolveConfig(manifest,f.choices.global,f.choices.card,{skin:f.skin?.document?.mods?.[manifest.id],assetAvailable:key=>Object.hasOwn(f.skin?.document?.assets || {},key)}),onChange=()=>{}}) {
  const plans=new Map()
  async function frame(cardId,sessionId) {
    const [installation,global,card,skin]=await Promise.all([installations.read(),settings.read(),cardId?cards.read({cardId}):null,readSkin({cardId,sessionId})])
    const manifests=installation.value.releases.filter(row=>row.active && row.installed).map(row=>row.manifest)
    const authorized=installation.value.releases.filter(row=>row.active && row.installed && row.authorized).map(row=>row.manifest.id)
    const choices={global:global.value,card:card?.value || emptyCardMods(),skin:skin?.document}
    const skinRevision=skin ? [skin.ref || skin.document.id,skin.resource?.identity,skin.document.mods,skin.document.assets] : null
    return {installation,global,card,cardId,sessionId,skin,manifests,authorized,choices,revision:JSON.stringify([installation.revision,global.revision,cardId || null,card?.revision || null,skinRevision])}
  }
  const resolution=f=>resolveMods({manifests:f.manifests,authorized:f.authorized,...f.choices})
  function dependencyRows(f,manifest) {
    // The resolver diagnoses disabled consumers without changing their switches.
    const state=resolution(f),installed=new Map(f.manifests.map(row=>[row.id,row]))
    const context={installed,authorized:f.authorized,blocked:new Set(state.blocked),active:id=>resolveSwitch(f.choices.global.mods[id],f.choices.card.mods[id],f.skin?.document?.mods?.[id]?.enabled)}
    return manifest.dependencies.map(edge=>{
      const found=installed.get(edge.id),reason=modDependencyReason(edge,context)
      const mapped={operations:'operation',permission:'unauthorized','dependency-blocked':'disabled'}[reason] || reason
      return {consumerId:manifest.id,dependencyId:edge.id,range:edge.range,installedVersion:found?.version || null,optional:edge.optional===true,policy:edge.onMissing || 'notify',reason:mapped,
        message:reason?`${found?.name || '\u4f9d\u8d56\u6a21\u7ec4'}${({missing:'\u5c1a\u672a\u5b89\u88c5',version:'\u7248\u672c\u4e0d\u517c\u5bb9',disabled:'\u5df2\u7981\u7528',unauthorized:'\u5c1a\u672a\u540c\u610f\u8fd0\u884c',operation:'\u7f3a\u5c11\u6240\u9700\u80fd\u529b'})[mapped] || '\u6682\u4e0d\u53ef\u7528'}`:''}
    })
  }
  function modRow(f,id,state=resolution(f)) {
    const releases=f.installation.value.releases.filter(row=>row.manifest.id===id),selected=releases.find(row=>row.active && row.installed),manifest=(selected || releases[0])?.manifest
    if(!manifest)fail('MOD_MISSING','Mod is not in the local library',{id})
    const lock=(f.installation.value.locks || []).find(row=>row.cardId===f.cardId && row.modId===id)
    const incompatible=!!lock && lock.digest!==selected?.digest
    const switches={global:f.global.value.mods[id]===true,card:f.card?.value.mods[id] ?? null,effective:!incompatible && state.enabled.includes(id)}
    const notices=dependencyRows(f,manifest).filter(row=>row.reason)
    const status=!selected?'missing':!selected.authorized?'unauthorized':incompatible || !modVersionMatches(MOD_HOST_API,manifest.hostApi)?'incompatible':state.blocked.includes(id)?'blocked':switches.effective?'ready':'disabled'
    return {id,name:manifest.name,experimental:manifest.experimental===true,...(manifest.summary?{summary:manifest.summary}:{}),packageName:manifest.packageName,version:selected?.manifest.version || null,installed:!!selected,authorized:selected?.authorized===true,
      versions:releases.map(row=>({version:row.manifest.version,digest:row.digest,installed:row.installed,active:row.active})),dependencies:clone(manifest.dependencies),status,switches,notices,
      globalRoot:selected?.globalRoot===true,retainedByCards:(f.installation.value.locks || []).filter(row=>row.modId===id && row.digest===selected?.digest).map(row=>row.cardId)}
  }
  function manifestFor(f,id) {
    const row=f.installation.value.releases.find(row=>row.manifest.id===id && row.active) || f.installation.value.releases.find(row=>row.manifest.id===id)
    if(!row)fail('MOD_MISSING','Mod is not in the local library',{id})
    return row.manifest
  }
  function configView(f,id) {
    const manifest=manifestFor(f,id),empty=()=>({version:manifest.config.version,values:{}})
    return {revision:f.revision,modId:id,fields:fieldRows(manifest.config),preferenceFields:fieldRows(manifest.preferences),global:clone(f.global.value.config[id] || empty()),
      card:f.card?clone(f.card.value.config[id] || empty()):null,preferences:clone({...manifest.preferences.defaults,...f.global.value.preferences[id]})}
  }
  async function optionsView(f,modId) {
    const state=resolution(f),mods=[]
    for(const manifest of f.manifests.filter(row=>!modId || row.id===modId)) {
      const authorized=f.authorized.includes(manifest.id)
      // Unconsented code receives no skin settings; its declared preset remains inspectable.
      const context=authorized?f:{...f,skin:null}
      const projected=await resolveOptionConfig(manifest,context),stored=configView(f,manifest.id)
      mods.push({id:manifest.id,name:manifest.name,enabled:state.enabled.includes(manifest.id),authorized,fields:stored.fields,...projected,global:stored.global,card:stored.card})
    }
    return {revision:f.revision,cardId:f.cardId || null,skin:clone(f.skin),mods}
  }
  const requireRevision=(f,revision)=>{if(f.revision!==revision)fail('MOD_REVISION_CONFLICT','Mod settings changed; refresh before saving')}
  function remember(f,owner,request,result,internal={}) {
    const token=randomUUID(),plan={token,revision:f.revision,...result}
    plans.set(token,{f,owner,request:clone(request),plan:clone(plan),...internal})
    return plan
  }
  function switchDraft(f,args,enableDependencies=[]) {
    if(!['card','global'].includes(args.scope) || !['mod','pack'].includes(args.kind))fail('MOD_INVALID','Choose card/global and mod/pack')
    if(args.scope==='card' && !f.card)fail('MOD_INVALID','Select a card before changing its switch')
    if(args.scope==='global'?typeof args.value!=='boolean':![null,'on','off'].includes(args.value))fail('MOD_INVALID','Invalid switch value')
    if(typeof args.id!=='string' || !args.id || ['__proto__','constructor','prototype'].includes(args.id))fail('MOD_INVALID','Invalid switch identity')
    if(args.kind==='mod')manifestFor(f,args.id)
    const choices=clone(f.choices),map=choices[args.scope][args.kind==='mod'?'mods':'packs']
    if(args.value===null)delete map[args.id];else map[args.id]=args.value
    let state
    if(args.scope==='card' && args.kind==='mod') {
      const result=planCardModChoices({previous:f.choices.card,card:choices.card,global:choices.global,manifests:f.manifests,authorized:f.authorized,enableDependencies})
      choices.card=result.card;state=result.resolution
    } else state=resolveMods({manifests:f.manifests,authorized:f.authorized,...choices})
    return {choices,state}
  }
  function changedSwitches(f,args,choices) {
    const before=f.choices[args.scope],after=choices[args.scope],changes=[]
    for(const kind of ['mods','packs'])for(const id of new Set([...Object.keys(before[kind]),...Object.keys(after[kind])]))if(before[kind][id]!==after[kind][id])changes.push({scope:args.scope,id,before:before[kind][id] ?? null,after:after[kind][id] ?? null})
    return changes
  }
  async function switchPlan(args,owner) {
    const f=await frame(args.cardId);requireRevision(f,args.revision)
    // A card-lock repair is an installation transaction, not a hidden switch write.
    if(args.scope==='card' && args.kind==='mod' && args.value==='on' && modRow(f,args.id).status==='incompatible') {
      const releases=f.installation.value.releases.filter(row=>row.manifest.id===args.id),locks=(f.installation.value.locks || []).filter(row=>row.modId===args.id)
      const compatible=row=>modVersionMatches(MOD_HOST_API,row.manifest.hostApi) && locks.every(lock=>modVersionMatches(row.manifest.version,lock.range)) && f.manifests.every(manifest=>manifest.dependencies.filter(edge=>edge.id===args.id).every(edge=>modVersionMatches(row.manifest.version,edge.range) && (edge.operations || []).every(op=>row.manifest.api?.operations.includes(op))))
      const candidate=releases.find(row=>row.active && compatible(row)) || releases.filter(compatible).sort((a,b)=>b.manifest.version.localeCompare(a.manifest.version,undefined,{numeric:true}))[0] || releases.find(row=>row.active) || releases[0]
      return installationPlan({action:'selectVersion',modId:args.id,version:candidate.manifest.version,digest:candidate.digest,cardId:args.cardId},owner,f)
    }
    const {choices,state}=switchDraft(f,args)
    const confirmations=args.scope==='card' && args.kind==='mod' && args.value==='on' ? state.confirmations.map(row=>({id:'card-off:'+row.dependency,kind:'card-off',modId:row.dependency,message:`${manifestFor(f,row.consumer).name}\u9700\u8981${manifestFor(f,row.dependency).name}\uff0c\u4f46\u672c\u5361\u5df2\u7981\u7528\u5b83\u3002`,options:[option('enable','\u5728\u672c\u5361\u5f00\u542f'),option('keep-off','\u4fdd\u6301\u7981\u7528')]})):[]
    const unique=[...new Map(confirmations.map(row=>[row.id,row])).values()]
    const next={...f,choices,card:f.card?{...f.card,value:choices.card}:null,global:{...f.global,value:choices.global}}
    return remember(f,owner,args,{action:'switch',modId:args.id,changes:changedSwitches(f,args,choices),confirmations:unique,notices:f.manifests.flatMap(manifest=>dependencyRows(next,manifest)).filter(row=>row.reason),requiresNewSession:false})
  }
  async function installationPlan(args,owner,pinned) {
    if(!['install','uninstall','selectVersion'].includes(args.action))fail('MOD_INVALID','Unknown installation action')
    const f=pinned || await frame(args.cardId),manifest=manifestFor(f,args.modId)
    const current=f.installation.value.releases.find(row=>row.manifest.id===args.modId && row.active)
    const candidate=args.action==='uninstall'?current:f.installation.value.releases.find(row=>row.manifest.id===args.modId && row.manifest.version===args.version && row.digest===args.digest)
    if(!candidate)fail('MOD_MISSING','Choose an exact local release',{modId:args.modId})
    const proposed=f.manifests.filter(row=>row.id!==args.modId).concat(args.action==='uninstall'?[]:[candidate.manifest])
    validateDependencyGraph(proposed)
    if(args.action!=='uninstall' && !modVersionMatches(MOD_HOST_API,candidate.manifest.hostApi))fail('MOD_VERSION_CONFLICT','This release requires a different host API')
    const confirmations=[]
    if(args.action!=='uninstall' && !candidate.authorized)confirmations.push({id:'code-consent:'+candidate.digest,kind:'code-consent',modId:args.modId,message:`\u662f\u5426\u5141\u8bb8\u8fd0\u884c\u201c${manifest.name}\u201d${candidate.manifest.version}\u7248\u7684\u4ee3\u7801\uff1f\u6b64\u6388\u6743\u4ec5\u9002\u7528\u4e8e\u672c\u6b21\u786e\u8ba4\u7684\u6587\u4ef6\u3002`,options:[option('approve','\u540c\u610f\u8fd0\u884c'),option('cancel','\u53d6\u6d88')]})
    const locks=(f.installation.value.locks || []).filter(row=>row.modId===args.modId && row.digest!==candidate.digest)
    if(args.action!=='uninstall' && (current && current.digest!==candidate.digest || locks.length)) {
      const compatible=locks.every(row=>modVersionMatches(candidate.manifest.version,row.range)) && f.manifests.every(row=>row.dependencies.filter(edge=>edge.id===args.modId).every(edge=>modVersionMatches(candidate.manifest.version,edge.range) && (edge.operations || []).every(op=>candidate.manifest.api?.operations.includes(op))))
      confirmations.push({id:'version-conflict:'+args.modId,kind:'version-conflict',modId:args.modId,message:'\u540c\u4e00\u6a21\u7ec4\u53ea\u80fd\u8fd0\u884c\u4e00\u4e2a\u7248\u672c\uff0c\u672c\u5361\u9700\u8981\u7684\u7248\u672c\u4e0e\u5f53\u524d\u4e0d\u540c\u3002',options:[...(compatible?[option('upgrade','\u5347\u7ea7\u5230 '+candidate.manifest.version)]:[]),option('keep-missing','\u4fdd\u6301\u5f53\u524d\u7248\u672c\uff0c\u6682\u4e0d\u4f7f\u7528\u672c\u5361\u6a21\u7ec4'),option('cancel','\u53d6\u6d88')]})
    }
    const retainedByCards=(f.installation.value.locks || []).filter(row=>row.modId===args.modId && row.digest===candidate.digest).map(row=>row.cardId)
    const after=args.action==='uninstall' && !retainedByCards.length?null:candidate.digest
    const changes=[{scope:'installation',id:args.modId,before:current?.digest || null,after}]
    if(confirmations.some(row=>row.kind==='version-conflict' && row.options.some(option=>option.id==='upgrade')))for(const lock of locks)changes.push({scope:'card',id:args.modId,cardId:lock.cardId,before:lock.digest,after:candidate.digest})
    return remember(f,owner,args,{action:args.action,modId:args.modId,changes,confirmations,notices:[],retainedByCards,requiresNewSession:after!==(current?.digest || null)},{candidate:clone(candidate)})
  }
  async function apply(args,owner) {
    const saved=plans.get(args.token)
    if(!saved)fail('MOD_MISSING','Preview this change before applying it')
    if(saved.owner!==owner)fail('MOD_PERMISSION_DENIED','This plan belongs to another caller')
    if(!object(args.answers) || Object.keys(args.answers).some(id=>!saved.plan.confirmations.some(row=>row.id===id)))fail('MOD_INVALID','Unknown confirmation answer')
    for(const row of saved.plan.confirmations)if(!row.options.some(option=>option.id===args.answers[row.id]))fail('MOD_INVALID','Answer each confirmation',{id:row.id})
    return withLock(async()=>{
      const f=await frame(saved.f.cardId);requireRevision(f,args.revision);requireRevision(f,saved.f.revision)
      if(Object.values(args.answers).some(value=>value==='cancel' || value==='keep-missing')) {
        plans.delete(args.token);return {revision:f.revision,applied:false,requiresNewSession:false,notices:saved.plan.notices}
      }
      if(saved.plan.action==='switch') {
        const enableDependencies=saved.plan.confirmations.filter(row=>args.answers[row.id]==='enable').map(row=>row.modId)
        const {choices}=switchDraft(f,saved.request,enableDependencies),scope=saved.request.scope,source=f[scope]
        await (scope==='card'?cards:settings).compareAndSwap({...(scope==='card'?{cardId:f.cardId}:{}),expectedRevision:source.revision,expectedValue:source.value,value:choices[scope]})
      } else {
        const value=clone(f.installation.value),id=saved.request.modId,uninstall=saved.plan.action==='uninstall'
        for(const row of value.releases.filter(row=>row.manifest.id===id)) {
          if(uninstall) {
            row.globalRoot=false
            row.installed=value.locks.some(lock=>lock.modId===id && lock.digest===row.digest)
            if(!row.installed)row.active=false
          } else {
            row.active=row.digest===saved.candidate.digest
            if(row.active){row.installed=true;row.authorized=true;row.globalRoot=true}
          }
        }
        if(saved.plan.confirmations.some(row=>row.kind==='version-conflict' && args.answers[row.id]==='upgrade')) {
          for(const lock of value.locks.filter(row=>row.modId===id))lock.digest=saved.candidate.digest
        }
        await installations.compareAndSwap({expectedRevision:f.installation.revision,expectedValue:f.installation.value,value})
      }
      plans.delete(args.token);await onChange(saved.plan.action)
      const next=await frame(f.cardId)
      return {revision:next.revision,applied:true,requiresNewSession:saved.plan.requiresNewSession,notices:next.manifests.flatMap(manifest=>dependencyRows(next,manifest)).filter(row=>row.reason)}
    })
  }
  async function configWrite(args,{optionsOnly=false}={}) {
    if(!['card','global','preferences'].includes(args.scope) || !object(args.values))fail('MOD_INVALID','Choose a configuration scope and values')
    return withLock(async()=>{
      const f=await frame(args.cardId,args.sessionId);requireRevision(f,args.revision)
      if(args.scope==='card' && !f.card)fail('MOD_INVALID','Select a card before editing its config')
      const manifest=manifestFor(f,args.modId),scope=args.scope==='preferences'?'global':args.scope,source=f[scope],next=clone(source.value)
      const preferences=args.scope==='preferences'
      if(!preferences) for(const [key,value] of Object.entries(args.values)) {
        if(manifest.config.schema.properties[key]?.userAdjustable===false)fail('MOD_INVALID','This option is controlled by the skin',{key})
        if(f.skin?.document?.mods?.[args.modId]?.locks?.includes(key) && Object.hasOwn(f.skin.document.mods[args.modId].options || {},key))fail('MOD_INVALID','This option is locked by the skin',{key})
        if(optionsOnly && value!==null)validateUserModOptions(manifest,{[key]:value.fixed})
      }
      const values=preferences?next.preferences[args.modId] ||= {}:(next.config[args.modId] ||= {version:manifest.config.version,values:{}}).values
      const schema=preferences?manifest.preferences.schema:manifest.config.schema
      for(const [key,value] of Object.entries(args.values)) {
        if(!Object.hasOwn(schema.properties || {},key))fail('MOD_INVALID','Unknown field in this scope',{path:key})
        if(value===null)delete values[key];else values[key]=clone(value)
      }
      try {
        if(preferences)assertSchema(schema,{...manifest.preferences.defaults,...values})
        else {
          validateManagedConfigValues(manifest,values)
          for(const [key,value] of Object.entries(values))if(Object.hasOwn(value,'fixed'))assertSchema(schema.properties[key],value.fixed)
          await validateReferences({manifest,values,cardId:f.cardId,scope})
        }
      } catch(error) {if(error.code==='MOD_PERMISSION')throw modError('MOD_PERMISSION_DENIED',error.message,error.details);if(error.code?.startsWith('MOD_'))throw error;throw modError('MOD_INVALID',error.message)}
      await (scope==='card'?cards:settings).compareAndSwap({...(scope==='card'?{cardId:f.cardId}:{}),expectedRevision:source.revision,expectedValue:source.value,value:next})
      await onChange('config');const after=await frame(f.cardId,f.sessionId);return optionsOnly?optionsView(after,args.modId):configView(after,args.modId)
    })
  }
  return Object.freeze({
    async call(method,args={},authority) {
      if(!MANAGED_MOD_METHODS.includes(method))fail('MOD_INVALID','Unknown managed mod action')
      const owner=await authorize({method,args,authority})
      if(!owner)fail('MOD_PERMISSION_DENIED','Authenticated application access is required')
      if(method==='managedModInspect')return withLock(async()=>{
        const encoded=args.bytesBase64
        if(typeof encoded!=='string' || !encoded.length || encoded.length>64*1024**2)fail('MOD_INVALID','Choose a .dshmod file of at most 48 MiB')
        const bytes=Buffer.from(encoded,'base64')
        if(bytes.toString('base64')!==encoded)fail('MOD_INVALID','Invalid base64 package bytes')
        const release=await installations.inspect(bytes)
        return installationPlan({action:'install',...release,...(args.cardId?{cardId:args.cardId}:{})},owner)
      })
      if(method==='managedModSwitchPlan')return switchPlan(args,owner)
      if(method==='managedModPlan')return installationPlan(args,owner)
      if(method==='managedModApply') {
        const plan=plans.get(args.token)
        if(plan && !await authorize({method,args:{...args,cardId:plan.f.cardId},authority}))fail('MOD_PERMISSION_DENIED','Card access is no longer available')
        return apply(args,owner)
      }
      if(method==='managedModOptionsWrite') {
        if(!['global','card'].includes(args.scope) || !object(args.values))fail('MOD_INVALID','Choose global/card and option values')
        return configWrite({...args,values:Object.fromEntries(Object.entries(args.values).map(([key,value])=>[key,value===null?null:{fixed:value}]))},{optionsOnly:true})
      }
      if(method==='managedModConfigWrite')return configWrite(args)
      const f=await frame(args.cardId,args.sessionId)
      if(method==='managedModOptions')return optionsView(f,args.modId)
      if(method==='getStageModOptions') {
        if(!args.modId)fail('MOD_INVALID','A mod is required')
        const answer=await optionsView(f,args.modId),mod=answer.mods[0]
        if(!mod)fail('MOD_MISSING','Mod is not installed')
        const fields=mod.fields.filter(field=>field.schema['x-skin-asset']),keys=fields.map(field=>mod.values[field.key]).filter(Boolean)
        const media=await readOptionMedia(f.skin,keys)
        for(const field of fields)if(mod.values[field.key] && !Object.hasOwn(media,mod.values[field.key])) {
          mod.values[field.key]=clone(field.default)
          mod.options[field.key]={...mod.options[field.key],value:clone(field.default),source:'preset'}
        }
        return {revision:answer.revision,values:mod.values,options:mod.options,enabled:mod.enabled,skin:f.skin?{name:f.skin.document.label}:null,media}
      }
      if(method==='managedModConfig')return configView(f,args.modId)
      if(method==='managedModsList')return {revision:f.revision,mods:[...new Set(f.installation.value.releases.map(row=>row.manifest.id))].sort().map(id=>modRow(f,id))}
      if(method==='managedModDetail') {
        const manifest=manifestFor(f,args.modId)
        return {revision:f.revision,mod:modRow(f,args.modId),config:configView(f,args.modId),conflicts:clone(manifest.conflicts || []),assetKinds:(manifest.assetKinds || []).map(row=>({id:row.id,label:row.label || row.schema.title || row.id})),dependencies:dependencyRows(f,manifest),dependents:f.manifests.flatMap(row=>dependencyRows(f,row)).filter(row=>row.dependencyId===args.modId)}
      }
      const state=resolution(f),mods=Object.fromEntries([...new Set(f.installation.value.releases.map(row=>row.manifest.id))].map(id=>[id,modRow(f,id,state).switches])),packs={}
      for(const id of new Set([...Object.keys(f.global.value.packs),...Object.keys(f.card?.value.packs || {})]))packs[id]={global:f.global.value.packs[id]===true,card:f.card?.value.packs[id] ?? null,effective:resolveSwitch(f.global.value.packs[id],f.card?.value.packs[id])}
      return {revision:f.revision,mods,packs}
    },
    dispose(){plans.clear()},
  })
}
