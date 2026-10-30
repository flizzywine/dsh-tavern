// bounded committed reads and CAS transactions on the existing Chat owner.
import { randomUUID } from 'node:crypto'
import { createScopedMessages } from './scoped-messages.js'
import { diffMvuChanges } from './mvu-settlement-effect.js'
import { widgetVariableDigest, widgetVariableJson, resolveWidgetVariableSnapshot, projectWidgetVariableValues, projectWidgetSettingBindings, prepareWidgetVariableOperations } from './widget-variables.js'
import widgetContract from '../../src/client/widget-contracts.cjs'
import { verifiedWidgetSnapshot, widgetSettlementState, widgetWriteReason } from './widget-variable-transaction.js'

const size = value => Buffer.byteLength(JSON.stringify(value))
const failure = (status,reason,operationId) => ({status,reason,...(operationId ? {operationId} : {})})
const refKey = ref => JSON.stringify([ref?.packId,ref?.kind,ref?.assetId])
export function createWidgetVariableService({ index, readWindow, authorize, timeline, patch, execute, availability = () => ({ready:false}), now = Date.now, prepareCommit }) {
  const owner = randomUUID(), contexts = new Map(), views = new Map(), running = new Map(), rates = new Map(), projections = new Map(), paths = new Map(), windows = new Map()
  const bounded = (map,key,value,limit=128) => {map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value}
  function viewKey(input) { return input.sessionId+':'+input.viewId }
  function invalidate(input) {
    const key=viewKey(input), old=views.get(key)
    if (!Number.isSafeInteger(input.viewEpoch) || input.viewEpoch < (old?.epoch || 0)
      || input.viewEpoch === old?.epoch && old.active === false && input.active !== false) return false
    bounded(views,key,{epoch:input.viewEpoch,active:input.active !== false})
    for (const work of running.values()) if (work.viewKey===key && (work.epoch!==input.viewEpoch || input.active===false)) work.controller.abort()
    return true
  }
  function current(context) {
    const view=views.get(context.viewKey)
    return contexts.get(context.key)===context && view?.active && view.epoch===context.epoch
  }
  async function window(input) {
    const indexed=await index(input.sessionId)
    if (!indexed?.timeline || !Number.isSafeInteger(indexed._storageRevision)) throw new Error('unavailable')
    const id=indexed.messages.findLastIndex(row=>row?.role==='assistant' && Number(row.turn || (row.greeting ? 1 : 0))===input.turn)
    if (id<0) throw new Error('position-missing')
    const cacheKey=JSON.stringify([indexed.id,indexed._storageRevision,id])
    if (windows.has(cacheKey)) return windows.get(cacheKey)
    const pending=(async()=>{
    const ids=[]
    for (let i=id;i>=0 && ids.length<20;i--) if(indexed.messages[i]?.role==='assistant')ids.unshift(i)
    const entries=[];let head
    // The existing index maps turns to absolute floors. Every selected row is pinned to its revision.
    for (const at of ids) {
      const page=await readWindow(indexed.id,{limit:1,before:at+1,revision:indexed._storageRevision,includeCheckpoints:true})
      if (!page || page.revision!==indexed._storageRevision || page.from!==at) throw new Error('position-changed')
      head ||= page.chat
      entries.push([at,page.chat.messages[0]])
    }
    const chat={...head,messages:createScopedMessages(indexed.messages.length,entries)}
    return {chat,id,rows:entries.map(([messageId,message])=>({messageId,message,verified:verifiedWidgetSnapshot(chat,message)}))}
    })()
    bounded(windows,cacheKey,pending,4)
    pending.catch(()=>windows.delete(cacheKey))
    return pending
  }
  const runtimeReason = sessionId => {const state=availability(sessionId);return state.initializationError || !state.ready ? 'runtime-unavailable' : state.busy ? 'runtime-busy' : ''}
  async function recover(sessionId) {
    const chat=await index(sessionId)
    if (!chat) return
    const changes=Object.values(chat.timeline?.operations || {}).filter(op=>op.kind==='variables.edit' && op.status==='running' && op.owner!==owner)
      .map(op=>({op:'set',path:['timeline','operations',op.id,'status'],value:'cancelled'}))
    if (changes.length) return patch(chat.id,chat._storageRevision,changes,{source:'variables.edit.recover'})
  }
  async function read(input) {
    if (size(input)>16384 || typeof input.viewId!=='string' || input.viewId.length>128 || !invalidate(input)) return failure('unavailable','position-changed')
    const authorized=await authorize(input)
    if (!authorized?.declarations) return failure('unavailable','revoked')
    const {chat,id,rows}=await window(input), message=chat.messages[id]
    if (chat.id!==authorized.chatId || authorized.storageRevision !== undefined && chat._storageRevision!==authorized.storageRevision) return failure('unavailable','position-changed')
    const position={lastPage:authorized.lastPage,revealed:input.revealed===true,live:input.live===true}
    const settlement=widgetSettlementState(chat,message)
    const snapshot=resolveWidgetVariableSnapshot({rows,messageId:id,lastPage:position.lastPage,live:position.live && id===chat.messages.length-1,chatVariables:chat.variables,settlement})
    const key=randomUUID(), revision=widgetVariableDigest([chat.id,chat._storageRevision,chat.timeline.branchId,chat.timeline.revision,chat.tavernHelperLifecycleRevision,id,message.swipeId || 0,message.variables?.[message.swipeId || 0]])
    const cacheKey=widgetVariableDigest([chat.id,chat._storageRevision,id,position.lastPage,position.live,authorized.declarations])
    const sourceKey=JSON.stringify([chat.id,chat._storageRevision,id,position.lastPage,position.live])
    const pathCache=paths.get(sourceKey) || bounded(paths,sourceKey,new Map(),4)
    const values=projections.get(cacheKey) || bounded(projections,cacheKey,projectWidgetVariableValues(authorized.declarations,snapshot.sources,pathCache),64)
    const settings = authorized.settings ? widgetContract.stageWidgetResolveSettings(authorized.settings.document,authorized.settings.defaults,authorized.settings.override,
      projectWidgetSettingBindings(authorized.settings.override.bindings,snapshot.sources,pathCache)) : null
    const settingsFeedback=settings ? widgetContract.stageWidgetSettingsFeedback(settings) : null
    for (const [field,binding] of Object.entries(authorized.settings?.override.bindings || {})) if (settingsFeedback?.[field]) {
      settingsFeedback[field]={...settingsFeedback[field],bindingSource:binding.source,snapshot:binding.source==='helper-chat'
        ? {kind:snapshot.sources['helper-chat']?.available?'live-only':'unavailable',turn:snapshot.sources['helper-chat']?.available?input.turn:null}
        : {kind:snapshot.kind,turn:snapshot.turn}}
    }
    const reason=widgetWriteReason(chat,id,position) || runtimeReason(input.sessionId)
    const context={key,revision,input,chat,id,position,authorized,viewKey:viewKey(input),epoch:input.viewEpoch}
    const view=views.get(context.viewKey)
    if (!view?.active || view.epoch!==context.epoch || !authorized.current()) return failure('unavailable','position-changed')
    for (const [oldKey,old] of contexts) if (old.viewKey===context.viewKey && (old.epoch!==context.epoch
      || refKey(old.input.ref)===refKey(input.ref) && ![...running.values()].some(work=>work.contextKey===oldKey))) contexts.delete(oldKey)
    bounded(contexts,key,context)
    if (!current(context) || !authorized.current()) {contexts.delete(key);return failure('unavailable','position-changed')}
    return {contextKey:key,revision,sequence:0,position:{turn:input.turn,swipeId:message.swipeId || 0},snapshot:{kind:snapshot.kind,turn:snapshot.turn},settlement,writable:{allowed:!reason,reason},values,...(settings ? {settings:settings.settings,settingsDiagnostics:settings.diagnostics,settingsFeedback} : {})}
  }
  async function status(input) {
    if (size(input)>16384) return failure('rejected','invalid-request')
    const chat=await index(input.sessionId), operation=chat?.timeline?.operations?.[input.operationId]
    const context=contexts.get(input.contextKey)
    if (!operation && context && context.input.sessionId===input.sessionId && context.revision===input.revision
      && context.chat._storageRevision===chat?._storageRevision && refKey(context.input.ref)===refKey(input.ref) && context.input.identity===input.identity) {
      // Fence a delayed, not-yet-admitted RPC before confirming it did not commit.
      contexts.delete(context.key)
      return failure('cancelled','not-admitted',input.operationId)
    }
    if (!operation || operation.kind!=='variables.edit' || refKey(operation.widget?.ref)!==refKey(input.ref)
      || operation.widget?.identity!==input.identity) return failure('unknown','operation-not-found',input.operationId)
    const page=await readWindow(chat.id,{limit:1,before:operation.messageId+1,revision:chat._storageRevision})
    const receipt=page?.chat.messages[0]?.variableEdits?.[operation.swipeId]?.receipts?.find(row=>row.operationId===operation.id)
    if (receipt) return {status:'committed',operationId:operation.id,normalized:receipt.normalized,revision:String(receipt.afterRevision)}
    if (running.has(operation.id)) return failure('running','executing',operation.id)
    // A restarted server has no surviving draft. It never resumes an unsaved widget intent.
    if (operation.status==='running') await patch(chat.id,chat._storageRevision,[{op:'set',path:['timeline','operations',operation.id,'status'],value:'cancelled'}],{source:'variables.edit.recover'})
    return failure(operation.status==='completed' ? 'unknown' : 'cancelled',operation.owner!==owner ? 'executor-restarted' : 'not-committed',operation.id)
  }
  async function propose(input) {
    const {operationId}=input
    if (size(input)>16384 || Object.keys(input).some(key=>!['sessionId','operationId','ref','identity','contextKey','revision','operations'].includes(key))
      || typeof operationId!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) return failure('rejected','invalid-request')
    const context=contexts.get(input.contextKey)
    if (!context || context.input.sessionId!==input.sessionId || !current(context) || input.revision!==context.revision) return failure('conflict','position-changed',operationId)
    const digest=widgetVariableDigest([context.revision,input.operations])
    const head=await index(input.sessionId),existing=head?.timeline?.operations?.[operationId]
    if (existing) return existing.requestDigest===digest ? status({...input,ref:context.input.ref,identity:context.input.identity}) : failure('rejected','operation-id-reused',operationId)
    if (!head || head.id!==context.chat.id || head._storageRevision!==context.chat._storageRevision || !current(context)) return failure('conflict','position-changed',operationId)
    const times=(rates.get(input.sessionId)||[]).filter(time=>now()-time<60000)
    if (times.length>=10 || [...running.values()].some(work=>work.sessionId===input.sessionId)) return failure('rejected','rate-limit',operationId)
    bounded(rates,input.sessionId,[...times,now()])
    const {chat,id,position,authorized}=context, message=chat.messages[id], swipeId=message.swipeId || 0
    const controller=new AbortController(), work={controller,sessionId:input.sessionId,viewKey:context.viewKey,epoch:context.epoch,contextKey:context.key}
    running.set(operationId,work)
    let committing=false
    try {
      if (!authorized.current()) return failure('unavailable','revoked',operationId)
      if (runtimeReason(input.sessionId)) return failure('unavailable',runtimeReason(input.sessionId),operationId)
      prepareWidgetVariableOperations(authorized.declarations,message.variables?.[swipeId]?.stat_data,input.operations)
      const baselineDigest=widgetVariableDigest(message.variables[swipeId])
      const begun=timeline.apply({chat,messageIndices:[id],intent:{kind:'variables.edit.begin',operationId,messageId:id,position,baselineDigest,requestDigest:digest,owner,widget:{ref:context.input.ref,identity:context.input.identity}}})
      const saved=await patch(chat.id,chat._storageRevision,diffMvuChanges(chat,begun.chat,[id]),{source:'variables.edit.begin',assertCurrent(){if(!current(context)||!authorized.current())throw new Error('position-changed')}})
      if (!saved) return failure('conflict','baseline-changed',operationId)
      const result=await execute({sessionId:input.sessionId,operationId,messageId:id,swipeId,baselineDigest,declarations:authorized.declarations,operations:input.operations,
        branchId:chat.timeline.branchId,basedOnRevision:chat.timeline.revision,expectedLifecycleRevision:chat.tavernHelperLifecycleRevision || 0,signal:controller.signal})
      if (controller.signal.aborted || !current(context)) return failure('cancelled','position-changed',operationId)
      if (!result.updated) return failure(result.unchanged?'unchanged':result.stale?'conflict':result.rejected?'rejected':'unavailable','not-applied',operationId)
      const renewed=await authorize(context.input)
      if (renewed?.chatId!==chat.id || !renewed?.current() || !authorized.current() || widgetVariableJson(renewed.declarations)!==widgetVariableJson(authorized.declarations)) return failure('unavailable','revoked',operationId)
      const before={...begun.chat,_storageRevision:saved._storageRevision}
      const committed=timeline.apply({chat:before,messageIndices:[id],intent:{kind:'variables.edit.commit',operationId,messageId:id,position,declarations:authorized.declarations,operations:input.operations,effect:result.effect}})
      const afterCommit=await prepareCommit?.({before:chat,after:committed.chat,messageId:id})
      committing=true
      const final=await patch(chat.id,before._storageRevision,diffMvuChanges(before,committed.chat,[id]),{source:'variables.edit.commit',assertCurrent(){if(controller.signal.aborted||!current(context)||!authorized.current()||!renewed.current())throw new Error('position-changed')}})
      if(final && afterCommit)queueMicrotask(()=>afterCommit(final._storageRevision))
      return final ? committed.value : failure('conflict','baseline-changed',operationId)
    } catch(error) {
      if (committing) {
        const receipt=await status({sessionId:input.sessionId,operationId,ref:context.input.ref,identity:context.input.identity})
          .catch(()=>failure('unknown','commit-status-unavailable',operationId))
        if (['committed','unknown'].includes(receipt.status)) return receipt
      }
      return failure(error.code==='WIDGET_VARIABLE_REJECTED'?'rejected':'conflict',error.code==='WIDGET_VARIABLE_REJECTED'?error.message:'not-applied',operationId)
    } finally {
      running.delete(operationId)
      // Failed/unchanged drafts must release admission, without overwriting any intervening writer.
      for (let attempt=0;attempt<3;attempt++) {
        const latest=(await readWindow(chat.id,{limit:1}).catch(()=>null))?.chat, operation=latest?.timeline?.operations?.[operationId]
        if (operation?.status!=='running' || await patch(latest.id,latest._storageRevision,[{op:'set',path:['timeline','operations',operationId,'status'],value:'cancelled'}],{source:'variables.edit.cancel'}).catch(()=>null)) break
      }
    }
  }
  return Object.freeze({read,propose,status,invalidate,recover,dispose(){for(const work of running.values())work.controller.abort();contexts.clear();views.clear()}})
}
