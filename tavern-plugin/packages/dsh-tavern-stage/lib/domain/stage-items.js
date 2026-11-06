// item facts are pinned in the director binding and published only by commit seams.
import {analyzeVariableSchema,resolveSlot} from '../../../../lib/domain/variable-bindings/index.js'
import {itemVariableProvider} from '../../../../lib/domain/item-variable-provider.js'
import {projectItems} from '../../../../lib/domain/item-binding.js'
import {selectCoreItem} from '../../../../lib/domain/item-catalogue.js'
import {reconcileItems} from '../../../../lib/domain/item-settlement.js'
import {verifiedWidgetSnapshot} from '../../../../lib/domain/widget-variable-transaction.js'

const extension = raw => (raw?.data || raw)?.extensions?.dsh_tavern
export function prepareStageItems(raw,chat,index = chat.messages.length) {
  const ext = extension(raw) || {}
  const previous = chat.messages.slice(0,index).findLast(message => message.role === 'assistant' && verifiedWidgetSnapshot(chat,message))
  const variables = previous?.variables?.[previous.swipeId || 0]?.stat_data
  const slot = itemVariableProvider.slots({itemsEnabled:true})[0]
  const resolved = resolveSlot(slot,ext.variableBindings,analyzeVariableSchema(raw),{mvu:{available:variables !== undefined,value:variables}})
  const mapping = {scopeKey:resolved.variable?.path || 'inventory',ownerMapped:!!resolved.variable?.fields?.owner}
  const mappingKey = JSON.stringify(resolved.variable || null)
  const inventory = projectItems({committed:!!previous,complete:!!previous,revision:chat._storageRevision,mappingKey},resolved,mapping)
  const owners = [...new Set(inventory.items.map(item => item.ownerKey))]
  const scope = {scopeKey:mapping.scopeKey,ownerKey:owners.length === 1 ? owners[0] : null}
  return {version:2,enabled:true,inventory,scope,mapping,variable:resolved.variable ?? null,source:resolved.source ?? null}
}
export function validateStageItem(op,context) {
  return selectCoreItem(context.items.catalogue,op,context.items.variable)
}

/** Called inside the existing atomic director/MVU commit. Never reads mutable latest state. */
export function invalidateStageItems(message,reason='CORRECTED') {
  if(message.stageItems?.version===2) {
    message.stageItems.invalidated=true;message.stageItems.revision++
    for(const row of message.stageItems.performances){row.removed=true;row.revision++;row.reconciliation=reason}
  }
}

export function coreItemIntents(record) {
  const input=record.binding.items
  const source={branchId:record.binding.target.branchId,sourceKey:record.binding.target.sourceKey,generation:record.binding.generation || 0,textVersion:record.binding.target.sourceKey}
  return record.entries.flatMap((entry,entryIndex)=>entry.ops.flatMap((op,opIndex)=>op.op !== 'item.play' ? [] : [{
    id:JSON.stringify([source.sourceKey,source.generation,entryIndex,opIndex]),modId:'core.items',kind:'core.items.item',source,at:entry.at,
    revision:0,payload:selectCoreItem(input.catalogue,op,input.variable),reconciliation:'pending'
  }]))
}
// The original message owner calls this after either director or MVU commits.
export function finalizeStageItems(chat,index) {
  const message=chat.messages[index],record=message?.stageDirectionAssetPacks,input=record?.binding?.items
  if(input?.version!==2)return
  if(message.stageItems?.invalidated && message.stageItems.directionDigest===record.digest)return
  const performances=coreItemIntents(record)
  const receipt=message.mvu?.receipt
  const settled=!message.mvu?.pending && ['updated','unchanged'].includes(receipt?.status)
  if (settled) {
    const project=value=>{
      const resolved=resolveSlot(itemVariableProvider.slots()[0],{version:1,entries:input.variable?[{target:{kind:'items',slot:'inventory'},variable:input.variable}]:[]},[],{mvu:{available:value!==undefined,value}})
      return resolved.status==='ready' ? resolved.value : undefined
    }
    const beforeValues=message.mvuBaseline?.swipeId===(message.swipeId || 0) ? message.mvuBaseline.variables?.stat_data : undefined
    const before=project(beforeValues)
    const pinned=projectItems({committed:true,complete:before!==undefined,revision:input.inventory?.revision,mappingKey:input.inventory?.mappingKey},
      {status:before===undefined?'unavailable':'ready',source:'author',variable:input.variable,value:before},input.mapping)
    const sameBaseline=JSON.stringify(pinned.items)===JSON.stringify(input.inventory?.items) && pinned.complete===input.inventory?.complete
    const settlement={bindings:{inventory:input.variable},beforeRevision:'before',afterRevision:'after',
      before:{inventory:sameBaseline?before:undefined},after:{inventory:project(message.variables?.[message.swipeId || 0]?.stat_data)},performances}
    for (const revision of reconcileItems(settlement)) {
      const row=performances.find(row=>row.id===revision.performanceId)
      if (revision.action==='remove') row.removed=true
      else row.payload=revision.payload
      row.revision=1;row.reconciliation=revision.reason
    }
  }
  const next={version:2,directionDigest:record.digest,sourceKey:record.binding.target.sourceKey,generation:record.binding.generation || 0,performances}
  if (JSON.stringify({...message.stageItems,revision:undefined})===JSON.stringify({...next,revision:undefined})) return
  message.stageItems={...next,revision:(message.stageItems?.version===2 ? message.stageItems.revision : 0)+1}
}
export function stageItemPerformances(message,binding) {
  const value=message?.stageItems
  return value?.version===2 && value.directionDigest===binding?.digest ? value.performances.filter(row=>!row.removed) : []
}

// the 履历's performance records of each round - the same
// stored records the stage played (direction.modPerformances: managed mod placements and core items), never a second history.
// readPerformances(turn) is the director's read-only modPerformances of that round.
export async function stageModHistoryTurns(messages,readPerformances) {
  const turns=[]
  for(const message of messages || []) {
    if(message.role!=='assistant' || !message.modCorrections && !message.stageItems)continue
    const turn=Number(message.turn || (message.greeting?1:0))
    const performances=await readPerformances(turn)
    if(performances?.length)turns.push({turn,performances})
  }
  return turns
}
