import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {assertResourceControl,acquireResourceControl,releaseResourceControl,requireCapability,resolveModCapabilities} from './capabilities.js'
import {assetRefKey} from '../../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {modStageContribution,modStageContributions} from './stage-contributions.js'
const {modCheck:check}=contract
// Host-owned whitelist; assets opt into this use, never register or enable a mod. The capability edges come from the
// installed mods' stage contributions (performanceUses).
export const PERFORMANCE_CONSUMER='core.performance'
export const performanceInteropUse=()=>Object.freeze({id:PERFORMANCE_CONSUMER,name:'演出组合',dependencies:{},consumes:modStageContributions().flatMap(row=>row.performanceUses || [])})

// Trusted static handlers (a contribution's stageControls) produce drafts only. No callback, IO or plugin code runs in the
// stage transaction.
const controlHandler=(provider,handler)=>modStageContribution(provider)?.stageControls?.[handler]
export function releaseStageControls(state, predicate) {
  let next=state
  for(const [key,control] of Object.entries(state.stageControls || {})) {
    if(!predicate(control))continue
    const own=next.modState?.[control.provider] || {}
    next={...next,modState:{...next.modState,[control.provider]:controlHandler(control.provider,control.handler).apply(own,{operation:'release',budgetKey:control.budgetKey,policy:control.releasePolicy})},
      stageControls:releaseResourceControl(next.stageControls,key,control.epoch)}
  }
  return next
}
export function assertCommandControl(state,command,context) {
  if(command.resourceUse?.access!=='control')return
  const capability=command.resourceUse.capability
  // Installed grammar is frozen, while this control fact belongs to the current stage draft.
  for(const [key,held] of Object.entries(state.stageControls || {}))if(held.capability===capability)assertResourceControl(state.stageControls,key,'director')
}
export function applyPerformanceInterop(previous,next,command,params,document,context,metadata) {
  const consumer=PERFORMANCE_CONSUMER,owned=control=>control.consumer===consumer
  if(command.id==='off') {
    return {...next,interopNotices:[],stageControls:Object.fromEntries(Object.entries(next.stageControls || {}).map(([key,value])=>[key,owned(value)?{...value,exiting:true}:value]))}
  }
  const edges=document?.interop || []
  check(edges.length || params.sec===undefined,'$.sec','A duration override requires a performance with a countdown.','ARG_INVALID')
  if(JSON.stringify(next.performance)===JSON.stringify(previous.performance)) {
    check(params.sec===undefined,'$.sec','An existing topic keeps its remaining time; omit the duration override.','ARG_INVALID')
    return next
  }
  // A replacement cancels old control in this same draft; a failed new grant discards all of it.
  let draft=releaseStageControls(next,owned)
  const notices=[]
  for(const edge of edges) {
    const rows=context.capabilities?.[consumer] || resolveModCapabilities({manifests:[],enabled:[],coreUses:[performanceInteropUse()]})[consumer],declared=rows.find(row=>row.use===edge.use)
    check(declared,'$.interop.use','This optional performance use is not authorized by the host.','MOD_PERMISSION_DENIED')
    // A performance never hard-depends on a mod (skin-interface.md §17.1): a missing, disabled or unadmitted provider only
    // leaves this use out of the projection - notify (default) or silent; the performance itself always plays.
    const policy=edge.onMissing ?? 'notify'
    let grant=declared
    const handler=controlHandler(grant.provider,grant.handler),admitted=handler && context.modCommands?.find(row=>row.modId===grant.provider && handler.admission(row))
    const choices=admitted ? handler.admission(admitted).choices || [] : []
    const selected=choices.find(row=>assetRefKey(row.ref)===assetRefKey(edge.target))
    if(grant.available && !selected)grant={...grant,available:false,reason:'admission',message:'演出需要的计时素材本轮不可用，本次不显示计时器。可在素材设置中开启。'}
    const resolution={[consumer]:[grant]}
    if(!grant.available) {
      if(policy==='notify')notices.push({consumer,use:edge.use,message:grant.message})
      continue
    }
    check(handler && grant.contract==='countdown/1','$.interop','This capability handler is not supported.','MOD_PERMISSION_DENIED')
    check(typeof params.topic==='string' && params.topic.trim(),'$.topic','Name the discussion topic. Reuse exactly the same topic to preserve its remaining time.','ARG_INVALID')
    const budgetKey=params.topic,own=draft.modState?.[grant.provider] || {},operation=handler.operation(own,budgetKey)
    requireCapability(resolution,consumer,edge.use,operation)
    const operationId=JSON.stringify([metadata.sourceKey,metadata.generation ?? 0,metadata.turn,metadata.at,metadata.entryOrdinal ?? 0,metadata.opOrdinal ?? 0])
    const controls=acquireResourceControl(draft.stageControls,grant,{controller:consumer+':'+operationId,label:document.label,operationId,budgetKey,releasePolicy:edge.release})
    const input={...selected,...(operation==='start'?{sec:params.sec ?? selected.seconds}:params.sec===undefined?{}:{sec:params.sec})}
    for(const field of ['label','onTimeout'])if(!input[field])delete input[field]
    const state=handler.apply(own,{operation,budgetKey,params:input},metadata)
    const key=grant.resource.key
    draft={...draft,stageControls:{...controls,[key]:{...controls[key],consumer,handler:grant.handler,timerInstanceId:handler.instanceId(state),performanceRef:params.ref,startedAt:next.performance.startedAt,topic:params.topic}},
      modState:{...draft.modState,[grant.provider]:state}}
  }
  return {...draft,interopNotices:notices}
}
