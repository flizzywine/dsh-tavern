import {modVersionMatches} from './permissions.js'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modFreeze}=contract

export const missingPolicy = edge => edge.onMissing ?? 'notify'
const name = manifest => manifest?.i18n?.messages?.[manifest.i18n.defaultLocale]?.[manifest.name] || manifest?.name

// Resolve once from the registry snapshot; callers add their existing round admission, never recall dependencies here.
export function resolveModCapabilities({manifests,enabled,authorized=enabled,admitted=enabled,coreUses=[]}) {
  const installed=new Map(manifests.map(manifest=>[manifest.id,manifest]))
  const active=id=>enabled.includes(id) && authorized.includes(id)
  const results={}
  for(const consumer of [...manifests,...coreUses]) {
    const rows=[]
    if(!coreUses.includes(consumer) && (!active(consumer.id) || !admitted.includes(consumer.id))) {results[consumer.id]=rows;continue}
    for(const dependency of consumer.dependencies.mods || []) {
      const provider=installed.get(dependency.id)
      const reason=!provider?'missing':!active(provider.id)?'disabled':!modVersionMatches(provider.version,dependency.range)?'version':null
      const policy=missingPolicy(dependency)
      rows.push({use:'dependency:'+dependency.id,provider:dependency.id,available:!reason,optional:dependency.optional===true,onMissing:policy,
        ...(reason?{reason,blocked:policy==='error',message:`${name(consumer)}需要的${name(provider) || '辅助模组'}${reason==='missing'?'尚未安装':reason==='disabled'?'尚未开启或授权':'版本暂不兼容'}，${policy==='error'?'相关能力暂时不能使用':'本次将不使用这项增强'}。可在模组设置中调整。`}:{})})
    }
    for(const edge of consumer.consumes || []) {
      const provider=installed.get(edge.provider),provided=provider?.provides?.find(row=>row.id===edge.capability)
      const dependency=consumer.dependencies.mods?.find(row=>row.id===edge.provider)
      const reason=!provider?'missing':!active(provider.id)?'disabled':
        dependency && !modVersionMatches(provider.version,dependency.range) || !provided || !modVersionMatches(provided.version,edge.range)?'version':
        !admitted.includes(provider.id)?'admission':edge.operations.some(op=>!provided.operations.includes(op))?'operations':null
      const policy=missingPolicy(edge)
      const message=reason ? `${name(consumer)}需要的${name(provider) || '辅助模组'}${reason==='missing'?'尚未安装':reason==='disabled'?'尚未开启或授权':reason==='admission'?'本轮没有可用素材':'版本暂不兼容'}，${policy==='error'?'这项联动暂时不能使用':'本次将不使用这项增强'}。可在模组与素材设置中调整。` : null
      rows.push({use:edge.id,provider:edge.provider,capability:edge.capability,available:!reason,optional:edge.optional===true,onMissing:policy,
        ...(reason?{reason,message,blocked:policy==='error'}:{version:provided.version,contract:provided.contract,handler:provided.handler,operations:edge.operations,resource:provided.resource})})
    }
    results[consumer.id]=rows
  }
  return modFreeze(results)
}

export function assertRequiredDependencyGraph(manifests) {
  const rows=new Map(manifests.map(row=>[row.id,row])),done=new Set(),visiting=new Set()
  function visit(id) {
    if(done.has(id) || !rows.has(id))return
    check(!visiting.has(id),'$.dependencies.mods','Required mod dependencies must not form a cycle.','MOD_DEPENDENCY_MISSING')
    visiting.add(id)
    for(const edge of rows.get(id).dependencies.mods || [])if(!edge.optional)visit(edge.id)
    visiting.delete(id);done.add(id)
  }
  for(const id of rows.keys())visit(id)
}

export function requireCapability(resolution,consumer,use,operation) {
  const edge=resolution[consumer]?.find(row=>row.use===use)
  check(edge,'$.interop.use','This capability is not declared by the consumer.','MOD_PERMISSION_DENIED')
  if(!edge.available) {
    check(!edge.blocked,'$.interop',edge.message,'MOD_DEPENDENCY_MISSING')
    return null
  }
  check(edge.operations.includes(operation),'$.interop.operation','This operation is not granted.','MOD_PERMISSION_DENIED')
  return edge
}

// Semantic leases live in the original stage state. No TTL, event store or provider state is kept here.
export function assertResourceControl(controls,resourceKey,controller) {
  const held=controls?.[resourceKey]
  check(!held || held.controller===controller,'$.control',`该资源由${held?.label || '另一段演出'}控制，请先结束该演出再操作。`,'MOD_PERMISSION_DENIED')
}
export function acquireResourceControl(controls,grant,{controller,label,operationId,releasePolicy,budgetKey}) {
  check(grant.resource?.policy==='exclusive','$.control','This capability does not grant exclusive control.','MOD_PERMISSION_DENIED')
  const key=grant.resource.key
  assertResourceControl(controls,key,controller)
  const previous=controls?.[key]
  if(previous?.operationId===operationId) {
    check(previous.releasePolicy===releasePolicy && previous.budgetKey===budgetKey,'$.control','Use a new operation identity for a different intent.','MOD_REVISION_CONFLICT')
    return controls
  }
  return {...controls,[key]:{controller,label,provider:grant.provider,capability:grant.capability,version:grant.version,
    epoch:operationId,operationId,releasePolicy,budgetKey}}
}
export function releaseResourceControl(controls,resourceKey,epoch) {
  if(controls?.[resourceKey]?.epoch!==epoch)return controls
  const next={...controls};delete next[resourceKey];return next
}

export {createCapabilityNotices} from './notices.cjs'
