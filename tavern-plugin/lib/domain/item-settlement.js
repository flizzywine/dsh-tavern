import {normalizeItemName,projectItems,diffItems} from './item-binding.js'
function inventory(rows,revision,previousRevision,binding) {
  return projectItems({committed:true,complete:Array.isArray(rows),revision,previousRevision,mappingKey:JSON.stringify(binding)},
    {status:'ready',source:'author',variable:binding,value:rows},{scopeKey:binding.path,ownerMapped:!!binding.fields?.owner})
}
export function reconcileItems(settlement) {
  const pending=settlement.performances || [],binding=settlement.bindings?.inventory
  const changed=pending.filter(row=>row.payload.action!=='show')
  const display=row=>({performanceId:row.id,expectedRevision:row.revision,action:'replace',payload:row.payload,reason:'display-only'})
  if(!changed.length)return pending.map(display)
  if(!binding || binding.source!=='mvu' || changed.some(row=>row.payload.binding!==JSON.stringify(binding)))return pending.map(display)
  const before=inventory(settlement.before?.inventory,settlement.beforeRevision,undefined,binding)
  const after=inventory(settlement.after?.inventory,settlement.afterRevision,settlement.beforeRevision,binding)
  const diff=diffItems(before,after)
  if(!diff.ok)return pending.map(display)
  if(before.ownerMapped && new Set([...before.items,...after.items].map(row=>row.ownerKey)).size!==1)return pending.map(display)
  if([...before.items,...after.items].some(row=>row.counted && row.count===null))return pending.map(display)
  const used=new Set(),revisions=[]
  for(const performance of pending) {
    const payload=performance.payload
    if(payload.action==='show'){revisions.push(display(performance));continue}
    const matches=diff.changes.filter(row=>payload.inventoryId?row.stableId===payload.inventoryId:normalizeItemName(row.name)===normalizeItemName(payload.name))
    if(!payload.inventoryId && !matches.length) {
      const lost=before.items.filter(row=>row.stableId===null && !after.items.some(next=>next.itemKey===row.itemKey))
      const added=after.items.filter(row=>row.stableId===null && !before.items.some(old=>old.itemKey===row.itemKey))
      if(lost.some(row=>added.some(next=>next.ownerKey===row.ownerKey) && [row,...added].some(item=>normalizeItemName(item.name)===normalizeItemName(payload.name)))){revisions.push(display(performance));continue}
    }
    // Multiple holders/identities are not a license to guess a recipient.
    if(matches.length>1){revisions.push(display(performance));continue}
    const change=matches[0],fact=change?.itemKey
    const keep=change?.action===payload.action && !used.has(fact)
    if(keep)used.add(fact)
    revisions.push({performanceId:performance.id,expectedRevision:performance.revision,action:keep?'replace':'remove',
      ...(keep?{payload:{...payload,count:change.delta,text:(payload.action==='gain'?'获得 ':'失去 ')+payload.name+(change.delta===null?'':' ×'+change.delta)}}:{}),
      reason:keep?'settled-count':change?.action===payload.action?'duplicate-fact':change?'opposite-direction':'no-change'})
  }
  return revisions
}
