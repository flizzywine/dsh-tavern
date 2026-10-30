import {latestSettledModTurn,settledModTurns} from './domain/mods/settled-source.js'
import {ledgerSource} from './domain/mods/state-source.js'
import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import {freezeJson} from './domain/freeze-json.js'
import {createScopedMessages} from './domain/scoped-messages.js'
import {resolveWidgetVariableSnapshot} from './domain/widget-variables.js'
import {verifiedWidgetSnapshot,widgetSettlementState,widgetWriteReason} from './domain/widget-variable-transaction.js'
import {applyMvuSettlementEffect,diffMvuChanges} from './domain/mvu-settlement-effect.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check} = contract

// Uses the existing isolated MVU executor and Timeline intents; no new variable store or digest.
export function createModVariablePort({index,readWindow,timeline,patch,execute,availability,sourceCurrent,prepareCommit,onError=()=>{}}) {
  const snapshots=new Map(),owner=randomUUID(),position=context=>({lastPage:true,revealed:true,live:context.mode!=='history'})
  const conflict=()=>check(false,'$.baseRevision','Variable baseline changed','MOD_REVISION_CONFLICT')
  async function readTurn(context,turn) {
    const head=await index(context.gameId)
    check(head && await sourceCurrent(context,head),'$.source','Variable source changed','MOD_SOURCE_STALE')
    turn ??= latestSettledModTurn(head)
    check(settledModTurns(head).has(turn),'$.turn','Only completed Timeline replies are disclosed','MOD_RESOURCE_UNAVAILABLE')
    const id=head.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===turn)
    check(id>=0,'$.turn','Turn unavailable','MOD_RESOURCE_UNAVAILABLE')
    const selected=[]
    for (let at=id;at>=0 && selected.length<20;at--) if(head.messages[at]?.role==='assistant')selected.unshift(at)
    const entries=[];let header
    for (const at of selected) {
      const page=await readWindow(head.id,{limit:1,before:at+1,revision:head._storageRevision,includeCheckpoints:true})
      check(page?.revision===head._storageRevision && page.from===at,'$.turn','Turn changed','MOD_SOURCE_STALE')
      header ||= page.chat;entries.push([at,page.chat.messages[0]])
    }
    const chat={...header,messages:createScopedMessages(head.messages.length,entries)},message=chat.messages[id]
    const snapshot=resolveWidgetVariableSnapshot({rows:entries.map(([messageId,message])=>({messageId,message,verified:verifiedWidgetSnapshot(chat,message)})),messageId:id,lastPage:true,live:id===head.messages.length-1,chatVariables:chat.variables,settlement:widgetSettlementState(chat,message)})
    check(await sourceCurrent(context,await index(context.gameId)),'$.source','Variable source changed','MOD_SOURCE_STALE')
    const runtime=availability(context.gameId),writable=turn===context.turn && !widgetWriteReason(chat,id,position(context)) && runtime.ready===true && !runtime.busy && !runtime.initializationError
    const revision=JSON.stringify([head.id,head._storageRevision,id,message.swipeId || 0])
    snapshots.set(revision,{chat,id,baseline:freezeJson({revision:String(head._storageRevision),value:structuredClone(message.variables?.[message.swipeId || 0] ?? null)})})
    while(snapshots.size>64)snapshots.delete(snapshots.keys().next().value)
    return {turn,revision,textVersion:context.source.textVersion,source:context.source,writable,snapshotKind:snapshot.kind,
      sources:Object.fromEntries(Object.entries({...snapshot.sources,ledger:ledgerSource(header)}).map(([key,row])=>[key,row.value===undefined?{available:false}:row]))}
  }
  const get=before=>{const row=snapshots.get(before.revision);check(row,'$.baseRevision','Read snapshot expired','MOD_SOURCE_STALE');return row}
  const key=(context,request)=>context.modId+':'+request.operationId
  async function receipt({context,request}) {
    const head=await index(context.gameId)
    check(head && await sourceCurrent(context,head),'$.source','Variable source changed','MOD_SOURCE_STALE')
    const operation=head.timeline.operations[key(context,request)]
    if(!operation)return null
    check(equal(operation.modRequest,request) && equal(operation.modSource,context.source),'$.operationId','Operation ID has different intent or source','MOD_REVISION_CONFLICT')
    check(operation.status==='completed' && operation.modReceipt,'$.operationId','Operation has no committed receipt','MOD_RESOURCE_UNAVAILABLE')
    return structuredClone(operation.modReceipt)
  }
  return Object.freeze({readTurn,receipt,
    async execute({context,before,declarations,operations,request}) {
      const row=get(before),{chat,id,baseline}=row,operationId=key(context,request)
      check(Object.values(chat.timeline.operations).filter(op=>op.mod?.id===context.modId && equal(op.modSource,context.source)).length<128,
        '$.operationId','Turn operation budget exceeded','MOD_RUNTIME_FAILED')
      const result=await execute({sessionId:context.gameId,operationId,messageId:id,swipeId:Number(chat.messages[id].swipeId || 0),baseline,
        declarations,operations,branchId:chat.timeline.branchId,basedOnRevision:chat.timeline.revision,expectedLifecycleRevision:chat.tavernHelperLifecycleRevision || 0})
      check(result.updated || result.unchanged,'$.effect','MVU draft was not accepted',result.stale?'MOD_REVISION_CONFLICT':'MOD_RESOURCE_UNAVAILABLE')
      const effect=result.unchanged?{version:1,operationId,chatId:chat.id,sessionId:chat.sessionId,branchId:chat.timeline.branchId,basedOnRevision:chat.timeline.revision,
        expectedLifecycleRevision:chat.tavernHelperLifecycleRevision || 0,messageId:id,swipeId:Number(chat.messages[id].swipeId || 0),changes:[]}:result.effect
      const draft=timeline.apply({chat,messageIndices:[id],intent:{kind:'variables.edit.begin',operationId,messageId:id,position:position(context),baseline,
        requestDigest:operationId,owner,mod:{id:context.modId,revision:context.modRevision}}}).chat
      applyMvuSettlementEffect(draft,effect,{messageIndices:[id]})
      row.executed={operationId,declarations,operations,effect,request}
      return {after:draft.messages[id].variables[draft.messages[id].swipeId || 0].stat_data,effect}
    },
    async commit({context,before,effect,request,assertCurrent}) {
      const {chat,id,baseline,executed}=get(before)
      check(executed && equal(effect,executed.effect) && equal(request,executed.request),'$.effect','Unrecognized MVU effect','MOD_PERMISSION_DENIED')
      const previous=await receipt({context,request})
      if(previous)return previous
      const head=await index(context.gameId)
      if(head?._storageRevision!==chat._storageRevision || !await sourceCurrent(context,head))conflict()
      assertCurrent()
      const committed=timeline.apply({chat,messageIndices:[id],intent:{kind:'variables.edit.apply',operationId:executed.operationId,messageId:id,position:position(context),baseline,
        requestDigest:executed.operationId,owner,mod:{id:context.modId,revision:context.modRevision},source:context.source,request,
        declarations:executed.declarations,operations:executed.operations,effect}})
      const afterCommit=committed.value.status==='committed'?await prepareCommit?.({before:chat,after:committed.chat,messageId:id}):null
      let saved
      try {
        saved=await patch(chat.id,chat._storageRevision,diffMvuChanges(chat,committed.chat,[id]),{source:'mods.variables.commit',assertCurrent})
        if(!saved)conflict()
      } catch(error) {
        const existing=await receipt({context,request})
        if(!existing)throw error
        saved={_storageRevision:Number(existing.revision)}
      }
      if(afterCommit)queueMicrotask(()=>Promise.resolve().then(()=>afterCommit(saved._storageRevision)).catch(onError))
      return committed.value
    },
  })
}
