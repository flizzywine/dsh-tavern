import { validateDistributionManifest, validateDependencyGraph, resolveMods, resolveConfig, resolveBoundConfig } from './mod-system.js'
import { emptyCardMods, emptyGlobalMods, modError, MOD_HOST_API, assertSchema } from './mod-system-contract.js'
import {assembleModPrompts,freezeForegroundModPrompts} from './mod-system-prompts.js'

const clone=structuredClone
const keyOf=(modId,instance)=>JSON.stringify([modId,instance])
const checkInstance=id=>{if(typeof id!=='string' || !id.trim() || id.length>160 || /[\u0000-\u001f]/.test(id) || ['__proto__','prototype','constructor'].includes(id))throw modError('MOD_INVALID','Use a bounded resource instance identity')}
const frozen=value=>{if(value && typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))frozen(child)}return value}

// Storage adapters pass the original stage draft and publish only a successful result.
// No filesystem, timers or provider private state access crosses this service.
export function createManagedModHost({authorized=[]}={}) {
  const registrations=new Map(),revoked=new Set(),approved=new Set(authorized),sessionNotices=new WeakMap(),requests=new WeakMap(),listeners=new Set()
  const changed=()=>{for(const listener of listeners)listener()}
  let generation=0,pending={global:emptyGlobalMods(),card:emptyCardMods()},current=null
  function checkRequest({signal,isCurrent}={}) {
    if(signal?.aborted || isCurrent && !isCurrent())throw modError('MOD_REQUEST_STALE','This request was cancelled or its source changed')
  }
  function register(owner,manifest,implementation) {
    validateDistributionManifest(manifest)
    if(Object.keys(implementation).some(key=>!['commands','api','plan','prepare','command','render','event','dispose','execution'].includes(key)))throw modError('MOD_INVALID','Unknown managed implementation hook',{id:manifest.id})
    if(manifest.api?.operations.length && typeof implementation.api!=='function')throw modError('MOD_INVALID','Published mod API needs an api reducer',{id:manifest.id})
    if(manifest.api?.operations.length && !manifest.permissions.includes('stage.state'))throw modError('MOD_PERMISSION','Instance API state requires stage.state',{id:manifest.id})
    if(owner!==manifest.packageName)throw modError('MOD_PERMISSION','Cordis owner differs from declared package')
    if(registrations.has(manifest.id))throw modError('MOD_CODE_CONFLICT','Mod ID already registered')
    const commands=(implementation.commands || []).map(row=>row.op)
    for(const row of registrations.values())if((row.implementation.commands||[]).some(c=>commands.includes(c.op)))throw modError('MOD_CODE_CONFLICT','Command already registered')
    validateDependencyGraph([...registrations.values()].map(row=>row.manifest).concat(manifest))
    const row={manifest:frozen(clone(manifest)),implementation:Object.freeze({...implementation,commands:frozen(clone(implementation.commands || []))}),epoch:++generation,lifetime:new AbortController()}
    registrations.set(manifest.id,row);revoked.delete(manifest.id);changed()
    return ()=>{
      if(registrations.get(manifest.id)!==row)return
      revoked.add(manifest.id);registrations.delete(manifest.id);generation++
      row.lifetime.abort();row.implementation.dispose?.();changed()
    }
  }
  function beginSession() {
    const identities=[...registrations].map(([id,row])=>[id,row.epoch])
    const grammar=frozen([...registrations.values()].flatMap(row=>clone(row.implementation.commands || [])))
    return Object.freeze({identities,grammar,toolSchemaBytes:Buffer.byteLength(JSON.stringify(grammar)),generation})
  }
  function beginRequest(session,{choices=pending,resolved={},signal,isCurrent}={}) {
    checkRequest({signal,isCurrent})
    if(session.generation!==generation)throw modError('MOD_SESSION_REQUIRED','The installed grammar changed; begin a new model session')
    const manifests=[...registrations.values()].map(row=>row.manifest)
    const resolution=resolveMods({manifests,...choices,authorized:manifests.filter(m=>approved.has(m.id) && !revoked.has(m.id)).map(m=>m.id)})
    const config=Object.fromEntries(manifests.filter(m=>resolution.enabled.includes(m.id)).map(m=>[m.id,resolved[m.id] || resolveConfig(m,choices.global,choices.card,{skin:choices.skin?.mods?.[m.id],assetAvailable:key=>Object.hasOwn(choices.skin?.assets || {},key)})]))
    const prefix=JSON.stringify({enabled:resolution.enabled,config:Object.fromEntries(Object.entries(config).map(([id,c])=>[id,c.values]))})
    let notified=sessionNotices.get(session)
    if(!notified){notified=new Set();sessionNotices.set(session,notified)}
    resolution.notices=resolution.notices.filter(notice=>{const key=JSON.stringify([notice.consumer,notice.dependency]);if(notice.onMissing!=='notify')return true;if(notified.has(key))return false;notified.add(key);return true})
    current=frozen({session,...clone(choices),resolution,config,prefix})
    requests.set(current,{signal,isCurrent})
    return current
  }
  async function beginConfiguredRequest(session,{sources,context={},choices:input=pending,signal,isCurrent}) {
    checkRequest({signal,isCurrent})
    const choices=clone(input),resolved={}
    const enabled=resolveMods({manifests:[...registrations.values()].map(r=>r.manifest),...choices,authorized:[...approved].filter(id=>!revoked.has(id))}).enabled
    let sourceSnapshot
    const capturedSources={...sources,snapshot:(...args)=>sourceSnapshot ||= sources.snapshot(...args)}
    const options={sources:capturedSources,context:clone(context),manifests:enabled.map(id=>registrations.get(id).manifest),globalValues:choices.global.config,cardValues:choices.card.config}
    for(const id of enabled)resolved[id]=await resolveBoundConfig(registrations.get(id).manifest,choices.global,choices.card,{...options,skin:choices.skin?.mods?.[id],assetAvailable:key=>Object.hasOwn(choices.skin?.assets || {},key)})
    return beginRequest(session,{choices,resolved,signal,isCurrent})
  }
  function allowed(snapshot,id) {
    if(!requests.has(snapshot))throw modError('MOD_PERMISSION','Use a request snapshot issued by this host')
    checkRequest(requests.get(snapshot))
    const row=registrations.get(id)
    if(!row || revoked.has(id) || !approved.has(id) || !snapshot.resolution.enabled.includes(id) || !snapshot.session.identities.some(([key,epoch])=>key===id && epoch===row.epoch))throw modError('MOD_DISABLED','This mod is not available in this request',{id})
    return row
  }
  function call(draft,snapshot,consumer,controller,action,boundary) {
    const own=allowed(snapshot,consumer)
    const edge=own.manifest.dependencies.find(e=>e.id===action.modId)
    if(!edge || !(edge.operations || []).includes(action.operation))throw modError('MOD_PERMISSION','Declare this mod ID and API operation before calling it',{consumer,modId:action.modId,operation:action.operation})
    const dependency=snapshot.resolution.dependencies[consumer]?.find(d=>d.id===action.modId)
    if(!dependency?.available) {
      if((edge.onMissing ?? 'notify')==='error')throw modError('MOD_MISSING','Required mod API unavailable',{consumer,modId:action.modId})
      return {status:'missing',modId:action.modId,reason:dependency?.reason,notify:false}
    }
    const provider=allowed(snapshot,action.modId)
    checkInstance(action.instanceId)
    const key=keyOf(action.modId,action.instanceId),held=draft.stageControls[key]
    if(action.operation!=='read' && held && held.controller!==controller)throw modError('MOD_RESOURCE_BUSY',`Resource is controlled by ${held.label}; finish it or choose another instance`,{modId:action.modId,controller:held.controller,instanceId:action.instanceId})
    const state=draft.modState[action.modId] ||= {instances:{}}
    if(action.operation==='read')return clone(state.instances[action.instanceId] ?? null)
    if(held && held.token!==action.token && !['start','resume'].includes(action.operation))throw modError('MOD_CONTROL_STALE','A newer operation owns this resource')
    if(action.operation==='release' && !held)return {status:'stale'}
    const reduced=provider.implementation.api(clone(state.instances[action.instanceId] || {}),action,{...boundary,config:snapshot.config[action.modId].values})
    state.instances[action.instanceId]=reduced
    if(action.operation==='release')delete draft.stageControls[key]
    else draft.stageControls[key]={provider:action.modId,consumer,controller,label:action.label || consumer,token:action.token,budgetKey:action.budgetKey,instanceId:action.instanceId,releasePolicy:action.releasePolicy || 'freeze'}
    return {status:'ok',token:action.token}
  }
  function execute({state,snapshot,modId,instanceId,operation,input={},boundary={},mode='live'}) {
    if(mode!=='live')return {ok:true,state:clone(state),projection:true}
    try {
      checkInstance(instanceId)
      const row=allowed(snapshot,modId),draft=clone(state),controller=JSON.stringify([modId,instanceId])
      if(!row.manifest.permissions.includes('stage.state'))throw modError('MOD_PERMISSION','State changes require stage.state')
      draft.stageControls ||= {};draft.modState ||= {};draft.performances ||= {}
      const plan=row.implementation.plan?.({state:clone(draft.modState[modId] || {}),instanceId,operation,input:clone(input),config:snapshot.config[modId].values,configuredKeys:snapshot.config[modId].configuredKeys,boundary})
      if(!plan)throw modError('MOD_INVALID','Unknown mod operation')
      const results=[]
      for(const action of plan.actions || [])results.push(call(draft,snapshot,modId,controller,action,boundary))
      draft.modState[modId]=plan.state
      return {ok:true,state:draft,results}
    } catch(error) {return {ok:false,state,error:{code:error.code || 'MOD_INVALID',message:error.message,details:error.details}}}
  }
  function direct({state,snapshot,provider,instanceId,operation,input,boundary={},mode='live'}) {
    if(mode!=='live')return {ok:true,state:clone(state),projection:true}
    try {
      checkInstance(instanceId)
      const row=allowed(snapshot,provider),key=keyOf(provider,instanceId),held=state.stageControls?.[key]
      if(held)throw modError('MOD_RESOURCE_BUSY',`Resource is controlled by ${held.label}; finish it before using the director`,{modId:provider,instanceId})
      if(!row.manifest.api?.operations.includes(operation))throw modError('MOD_PERMISSION','Unknown mod API operation',{modId:provider,operation})
      const draft=clone(state);draft.modState ||= {};draft.modState[provider] ||= {instances:{}}
      const instances=draft.modState[provider].instances
      instances[instanceId]=row.implementation.api(clone(instances[instanceId]||{}),{...input,operation,instanceId},{...boundary,config:snapshot.config[provider].values})
      return {ok:true,state:draft}
    }catch(error){return {ok:false,state,error:{code:error.code || 'MOD_INVALID',message:error.message,details:error.details}}}
  }
  function advance({state,snapshot,provider,instanceId,elapsedMs,activity,mode='live'}) {
    if(mode!=='live')return clone(state)
    checkInstance(instanceId)
    const row=allowed(snapshot,provider),draft=clone(state)
    if(!row.manifest.api?.operations.includes('advance'))throw modError('MOD_PERMISSION','Mod API does not publish advance',{modId:provider})
    const current=draft.modState?.[provider]?.instances?.[instanceId]
    if(!current)return draft
    draft.modState[provider].instances[instanceId]=row.implementation.api(current,{operation:'advance',elapsedMs,activity},{})
    return draft
  }
  function releaseUnavailable(state,snapshot,{all=false}={}) {
    const draft=clone(state)
    for(const [key,held] of Object.entries(draft.stageControls || {})) {
      if(!all && snapshot.resolution.enabled.includes(held.consumer) && snapshot.resolution.enabled.includes(held.provider) && !revoked.has(held.consumer) && !revoked.has(held.provider))continue
      const provider=registrations.get(held.provider)
      if(provider)draft.modState[held.provider].instances[held.instanceId]=provider.implementation.api(clone(draft.modState[held.provider].instances[held.instanceId]),{operation:'release',instanceId:held.instanceId,budgetKey:held.budgetKey,policy:held.releasePolicy},{})
      delete draft.stageControls[key]
    }
    return draft
  }
  async function invoke(snapshot,id,hook,message,facade) {
    const row=allowed(snapshot,id),request=requests.get(snapshot)
    const signal=request.signal?AbortSignal.any([request.signal,row.lifetime.signal]):row.lifetime.signal
    const check=()=>allowed(snapshot,id)
    const guard=value=>Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
      typeof item==='function'?function(...args){check();return item.apply(value,args)}:
      item && Object.getPrototypeOf(item)===Object.prototype?guard(item):item])))
    const result=await row.implementation[hook]?.(clone(message),{...guard(facade),signal,assertCurrent:check},snapshot.config[id])
    check();return result
  }
  return Object.freeze({apiVersion:MOD_HOST_API,register,beginSession,beginRequest,beginConfiguredRequest,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)},
    authorize(ids){
      if(approved.size===ids.length && ids.every(id=>approved.has(id)))return
      approved.clear();for(const id of ids)approved.add(id);changed()
    },
    execution(id){const row=registrations.get(id);if(!row || revoked.has(id) || !approved.has(id))throw modError('MOD_DISABLED','Managed execution is not registered or authorized: '+id,{id});return row.implementation.execution},

    prompts:(snapshot,options)=>assembleModPrompts({...options,snapshot,manifests:[...registrations.values()].map(row=>row.manifest)}),
    foregroundPrompts:(snapshot,options)=>freezeForegroundModPrompts({...options,snapshot,manifests:[...registrations.values()].map(row=>row.manifest)}),execute,direct,advance,releaseUnavailable,
    queueChoices(value){pending=clone(value)},revoke(id){revoked.add(id);registrations.get(id)?.lifetime.abort()},
    // The storage owner calls this inside its existing lock, immediately before publishing a draft.
    assertCurrent(snapshot,id){allowed(snapshot,id)},
    current:()=>current,manifests:()=>[...registrations.values()].map(r=>r.manifest),
    project(state){return clone(state)},
    event:(snapshot,id,message,facade)=>invoke(snapshot,id,'event',message,facade),
    prepare:(snapshot,id,input={},facade={})=>invoke(snapshot,id,'prepare',input,facade),
    render:(snapshot,id,input={},facade={})=>invoke(snapshot,id,'render',input,facade),
    async command(snapshot,id,input,facade) {
      const row=allowed(snapshot,id),command=row.implementation.commands.find(command=>command.id===input.commandId)
      if(!command || typeof row.implementation.command!=='function')throw modError('MOD_INVALID','Unknown managed command',{id,commandId:input.commandId})
      assertSchema(command.params,input.params)
      return invoke(snapshot,id,'command',input,facade)
    },
    dispose(){
      const rows=[...registrations.values()];registrations.clear();generation++;current=null
      for(const row of rows){revoked.add(row.manifest.id);row.lifetime.abort()}
      for(const row of rows)row.implementation.dispose?.()
    },
  })
}
