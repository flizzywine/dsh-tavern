// host composition; feature providers are registered explicitly here.
import { check } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { createVariableBindingRegistry } from './variable-bindings/index.js'
import { widgetVariableProvider } from './widget-variable-provider.js'
import { itemVariableProvider } from './item-variable-provider.js'
import { modVariableSlots } from './mods/variable-slots.js'
import { resolveWidgetVariableSnapshot } from './widget-variables.js'
import { widgetSettlementState } from './widget-variable-transaction.js'
export { emptyCardVariableBindings, validateVariableTarget, validateCardVariableBindings, variableTargetKey } from './variable-bindings/index.js'
export const cardVariableRegistry = createVariableBindingRegistry()
cardVariableRegistry.register(widgetVariableProvider)
cardVariableRegistry.register(itemVariableProvider)
cardVariableRegistry.register({id:'mods',label:'模组',slots:({modManifests=[]}={})=>modManifests.flatMap(modVariableSlots)})
export const validateVariableSlots = (value,packs,previous,modManifests=[]) => cardVariableRegistry.validateSlots(value,{packs,modManifests},previous)
export const listCardVariableProviders = ({raw,packs,sources,...context}) => cardVariableRegistry.list({raw,context:{packs,...context},sources})

export async function readCardVariableSources({path,indexed,readWindow,readRevision}) {
  check(indexed?.cardPath === path,'$.sessionId','Session does not belong to this card','NOT_FOUND')
  const ids = []
  for (let i = indexed.messages.length - 1; i >= 0 && ids.length < 20; i--) if (indexed.messages[i]?.role === 'assistant') ids.unshift(i)
  const rows = []; let head
  for (const messageId of ids) {
    // Variable projection needs settlement flags, not whole director/playback records or timeline checkpoints.
    let page = await readWindow(indexed.id,{limit:1,before:messageId+1,revision:indexed._storageRevision,
      fields:['variables','timeline.branchId','timeline.operations'],
      messageFields:['role','turn','greeting','swipeId','variables','mvu.pending','mvu.delivery.prepared','mvu.receipt.status']})
    // A journal snapshot has no native window. Read its pinned revision once,
    // rather than treating unsupported pagination as an endlessly retryable conflict.
    if (page === null && readRevision) {
      const chat = await readRevision(indexed.id,indexed._storageRevision)
      check(chat?._storageRevision === indexed._storageRevision,'$.sessionId','Read point changed','REVISION_CONFLICT')
      head = chat
      rows.push(...ids.map(messageId => ({messageId,message:chat.messages[messageId]})))
      break
    }
    check(page?.revision === indexed._storageRevision && page.from === messageId,'$.sessionId','Read point changed','REVISION_CONFLICT')
    head = page.chat
    rows.push({messageId,message:page.chat.messages[0]})
  }
  if (!rows.length) return {'helper-chat':{available:true,value:indexed.variables}}
  const sources=resolveWidgetVariableSnapshot({rows,messageId:ids.at(-1),lastPage:true,live:true,chatVariables:head.variables,settlement:widgetSettlementState(head,rows.at(-1).message)}).sources
  if(sources.mvu) {
    const selected=rows.findLastIndex(row=>row.message.variables?.[row.message.swipeId || 0]?.stat_data===sources.mvu.value)
    sources.mvu.recent=rows.slice(0,selected).filter(row=>!row.message.mvu?.pending && !['error','failed','rejected'].includes(row.message.mvu?.receipt?.status)).map(row=>row.message.variables?.[row.message.swipeId || 0]?.stat_data).filter(Boolean).slice(-6)
  }
  return sources
}
