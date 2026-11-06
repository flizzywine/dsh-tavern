import {modVersionMatches,modRangeBounds} from './mod-system-semver.js'
import {fixedConfigValues,boundConfigValues} from './mod-system-config.js'
import {assertSchema,validateModSystem,emptyCardMods,emptyGlobalMods,MOD_HOST_API,modError} from './mod-system-contract.js'
import performanceKinds from '../../src/client/stage-performance-kinds.cjs'
import {resolveModOptions} from './mod-system-options.js'

export function resolveSwitch(globalOn,cardValue,skinEnabled) {
  return cardValue!=='off' && (globalOn===true || cardValue==='on' || (cardValue==null && skinEnabled===true))
}
export function validateDistributionManifest(value) {
  // Named, fixable messages for a missing or malformed performance declaration come before the generic schema error.
  performanceKinds.createStagePerformanceRegistry([{owner:value?.id,performances:value?.performances}])
  validateModSystem('manifest',value);modRangeBounds(value.hostApi);modVersionMatches(value.version,value.version)
  validateDependencyGraph([value])
  for(const edge of [...value.dependencies,...value.conflicts || []])modRangeBounds(edge.range)
  for(const rows of [value.dependencies,value.assetKinds || [],value.coreAssets])if(new Set(rows.map(row=>row.id)).size!==rows.length)throw modError('MOD_INVALID','Duplicate declaration identity',{id:value.id})
  for(const ops of [value.api?.operations || [],...value.dependencies.map(d=>d.operations || [])])if(new Set(ops).size!==ops.length)throw modError('MOD_INVALID','Duplicate API operation',{id:value.id})
  assertSchema(value.config.schema,value.config.defaults);assertSchema(value.preferences.schema,value.preferences.defaults)
  return value
}

// Check the whole installation, even disabled mods. Optional edges cannot create a required cycle.
export function validateDependencyGraph(manifests) {
  const installed=new Map(manifests.map(m=>[m.id,m])),done=new Set(),stack=[],order=[]
  if(installed.size!==manifests.length)throw modError('MOD_VERSION_CONFLICT','Only one runtime version per mod ID is allowed')
  if(new Set(manifests.map(m=>m.packageName)).size!==manifests.length)throw modError('MOD_VERSION_CONFLICT','One package name can register only one managed mod')
  function visit(id) {
    const at=stack.indexOf(id)
    if(at!==-1){const ids=[...stack.slice(at),id];throw modError('MOD_DEPENDENCY_CYCLE','Required dependency cycle: '+ids.join(' -> ')+'; remove one required edge before installing',{ids})}
    if(done.has(id))return
    stack.push(id)
    for(const edge of installed.get(id).dependencies.filter(d=>!d.optional).sort((a,b)=>a.id.localeCompare(b.id)))if(installed.has(edge.id))visit(edge.id)
    stack.pop();done.add(id);order.push(id)
  }
  for(const id of [...installed.keys()].sort())visit(id)
  return order
}
const supportsDependency=(other,dep)=>modVersionMatches(other.version,dep.range) && (dep.operations || []).every(op=>other.api?.operations.includes(op))
export function modDependencyReason(dep,{installed,active,authorized,blocked}) {
  const other=installed.get(dep.id)
  return !other?'missing':!modVersionMatches(other.version,dep.range)?'version':!supportsDependency(other,dep)?'operations':!active(dep.id)?'disabled':!authorized.includes(dep.id)?'permission':blocked.has(dep.id)?'dependency-blocked':null
}
export function resolveMods({manifests,global=emptyGlobalMods(),card=emptyCardMods(),authorized=manifests.map(m=>m.id),autoEnable=[],skin=null}) {
  validateModSystem('card',card);validateModSystem('global',global)
  const order=validateDependencyGraph(manifests),installed=new Map(manifests.map(m=>[m.id,m])),switches={...card.mods},blocked=new Set(),confirmations=[],seen=new Set()
  const active=id=>resolveSwitch(global.mods[id],switches[id],skin?.mods?.[id]?.enabled)
  function enable(id,consumer) {
    const mod=installed.get(id)
    if(!mod)throw modError('MOD_MISSING','Install this mod before enabling it',{id})
    if(switches[id]==='off') {
      if(!consumer)throw modError('MOD_CARD_DISABLED','Change the explicit card-off choice only after confirmation',{id})
      confirmations.push({consumer,dependency:id,reason:'card-disabled',choices:['enable-explicitly','keep-missing']});return
    }
    if(seen.has(id))return
    seen.add(id);switches[id]='on'
    for(const dep of mod.dependencies.filter(d=>!d.optional)) {
      const other=installed.get(dep.id)
      if(other && supportsDependency(other,dep))enable(other.id,id)
    }
  }
  for(const id of autoEnable)enable(id)
  const activeMods=manifests.filter(m=>active(m.id))
  for(const mod of activeMods) {
    if(!modVersionMatches(MOD_HOST_API,mod.hostApi) || !authorized.includes(mod.id))blocked.add(mod.id)
    for(const conflict of mod.conflicts || [])if(active(conflict.id) && installed.has(conflict.id) && modVersionMatches(installed.get(conflict.id).version,conflict.range))throw modError('MOD_CODE_CONFLICT','Conflicting mods cannot execute together',{mods:[mod.id,conflict.id]})
  }
  const reason=dep=>modDependencyReason(dep,{installed,active,authorized,blocked})
  // Optional error policies may also propagate blocking; a finite set reaches a fixed point.
  for(let pass=0;pass<manifests.length;pass++) {
    const before=blocked.size
    for(const mod of activeMods)if(mod.dependencies.some(dep=>dep.onMissing==='error' && reason(dep)))blocked.add(mod.id)
    if(blocked.size===before)break
  }
  const notices=[],dependencies={},edges={}
  for(const mod of manifests) {
    dependencies[mod.id]=mod.dependencies.map(dep=>({id:dep.id,range:dep.range,available:!reason(dep),reason:reason(dep)}))
    if(!active(mod.id))continue
    edges[mod.id]=dependencies[mod.id].filter(dep=>dep.available).map(dep=>dep.id)
    for(const dep of mod.dependencies) {
      const missing=reason(dep),onMissing=dep.onMissing || 'notify'
      if(missing==='disabled' && !dep.optional && switches[dep.id]==='off' && !confirmations.some(row=>row.consumer===mod.id && row.dependency===dep.id))confirmations.push({consumer:mod.id,dependency:dep.id,reason:'card-disabled',choices:['enable-explicitly','keep-missing']})
      if(missing && onMissing!=='silent')notices.push({consumer:mod.id,dependency:dep.id,reason:missing,onMissing})
    }
  }
  return {card:{...structuredClone(card),mods:switches},enabled:order.filter(id=>active(id) && !blocked.has(id)),blocked:[...blocked],notices,confirmations,dependencies,edges}
}
export function resolveConfig(manifest,global,card,{resolvedValues,skin,assetAvailable}={}) {
  const shared=global.config[manifest.id],local=card.config[manifest.id]
  for(const value of [shared,local])if(value && value.version!==manifest.config.version)throw modError('MOD_MIGRATION_REQUIRED','Upgrade configuration before activation',{id:manifest.id})
  const userValues=resolvedValues || fixedConfigValues(manifest,shared?.values,local?.values)
  assertSchema(manifest.config.schema,userValues)
  const layer=stored=>Object.fromEntries(Object.keys(stored?.values || {}).map(key=>[key,userValues[key]]))
  const projected=resolveModOptions({manifest,skin,global:layer(shared),card:layer(local),assetAvailable})
  const preferences={...manifest.preferences.defaults,...Object.fromEntries(Object.entries(global.preferences[manifest.id] || {}).filter(([key])=>Object.hasOwn(manifest.preferences.schema.properties || {},key)))}
  return {...projected,preferences,configuredKeys:[...new Set([...Object.keys(skin?.options || {}),...Object.keys(shared?.values || {}),...Object.keys(local?.values || {})])]}
}
export async function resolveBoundConfig(manifest,global,card,options) {
  const resolved=await boundConfigValues(manifest,global.config[manifest.id]?.values || {},card.config[manifest.id]?.values || {},options)
  return {...resolveConfig(manifest,global,card,{resolvedValues:resolved.values,skin:options.skin,assetAvailable:options.assetAvailable}),notices:resolved.notices}
}
export function exportModClosure({manifests,global,card,usedMods=[],usedPacks=[],selectedMods=[],selectedPacks=[]}) {
  const checklist={mods:usedMods.filter(id=>global.mods[id]===true && card.mods[id]===undefined),packs:usedPacks.filter(id=>global.packs[id]===true && card.packs[id]===undefined)}
  for(const [kind,selected] of [['mods',selectedMods],['packs',selectedPacks]])for(const id of selected)if(!checklist[kind].includes(id))throw modError('MOD_EXPORT_SELECTION','Only global-only used items belong on this checklist',{kind,id})
  let exported=structuredClone(card)
  // Performance now belongs to core; stale card choices must not request retired executable code.
  delete exported.mods['dsh.performance'];delete exported.config['dsh.performance']
  for(const id of selectedMods)exported.mods[id]='on'
  for(const id of selectedPacks)exported.packs[id]='on'
  const roots=Object.keys(exported.mods).filter(id=>exported.mods[id]==='on')
  const resolved=resolveMods({manifests,global:emptyGlobalMods(),card:exported,autoEnable:roots});exported=resolved.card
  const ids=new Set([...Object.keys(exported.mods),...Object.keys(exported.config)])
  const mods=manifests.filter(m=>ids.has(m.id)).map(m=>m.id).sort()
  return {card:exported,mods,packs:Object.keys(exported.packs).sort(),checklist,notices:resolved.notices,confirmations:resolved.confirmations,missing:[...ids].filter(id=>!mods.includes(id)),edges:resolved.edges}
}
// Pure steps run on a draft; the storage owner publishes config/data plus the lock together.
export function migrateModData({manifest,config,data,steps}) {
  let next=structuredClone({config,data})
  for(const [kind,target] of [['config',manifest.config.version],['data',manifest.dataVersion]]) {
    if(next[kind].version>target)throw modError('MOD_MIGRATION_REQUIRED','Downgrade is not supported')
    while(next[kind].version<target) {
      const from=next[kind].version,upgrade=steps[kind]?.[from]
      if(!upgrade)throw modError('MOD_MIGRATION_REQUIRED','No upgrade path',{kind,from,target})
      next[kind]={version:from+1,values:upgrade(structuredClone(next[kind].values))}
    }
  }
  assertSchema(manifest.config.schema,fixedConfigValues(manifest,{},next.config.values))
  return next
}
