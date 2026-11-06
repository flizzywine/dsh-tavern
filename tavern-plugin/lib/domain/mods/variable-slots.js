import {resolveVariable,variableTargetKey} from '../variable-bindings/index.js'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modSafeKey:key}=contract

export function validateModVariableSlots(slots=[]) {
  check(Array.isArray(slots) && slots.length<=32,'$.variableSlots')
  const ids=new Set()
  for(const slot of slots) {
    shape(slot,['id','label','source','valueType','fieldMapping'],['id','label','source','valueType'],'$.variableSlots')
    check(key(slot.id) && !ids.has(slot.id) && typeof slot.label==='string' && slot.label.length<=80,'$.variableSlots.id')
    ids.add(slot.id)
    check(slot.source==='mvu' && slot.valueType==='array','$.variableSlots.source')
    if(slot.fieldMapping)for(const [name,field] of Object.entries(slot.fieldMapping)) {
      check(key(name),'$.variableSlots.fieldMapping')
      shape(field,['label','valueType','required'],undefined,'$.variableSlots.fieldMapping')
      check(typeof field.label==='string' && ['string','number','boolean'].includes(field.valueType) && typeof field.required==='boolean','$.variableSlots.fieldMapping')
    }
  }
}
export const modVariableSlots=manifest=>(manifest.variableSlots || []).map(slot=>({
  target:{kind:'mods',modId:manifest.id,slot:slot.id},label:slot.label,active:true,valueType:slot.valueType,default:[],fieldMapping:slot.fieldMapping || {},
}))

// Only the explicit native mapping is authority; guessing is a UI proposal, never a correction baseline.
export function modReadBindings(manifest,raw) {
  const entries=(raw?.data || raw)?.extensions?.dsh_tavern?.variableBindings?.entries || []
  return Object.fromEntries((manifest.permissions.variables?.reads || []).flatMap(read=>{
    if(!read.slot)return []
    const slot=manifest.variableSlots.find(slot=>slot.id===read.slot),target={kind:'mods',modId:manifest.id,slot:read.slot}
    const variable=entries.find(row=>variableTargetKey(row.target)===variableTargetKey(target))?.variable
    return variable?.source===slot.source?[[read.id,structuredClone(variable)]]:[]
  }))
}
export function projectModReadSlots(manifest,bindings,sources) {
  return Object.fromEntries((manifest.permissions.variables?.reads || []).flatMap(read=>{
    const declaration=read.slot?bindings?.[read.id]:read
    if(!declaration)return []
    const found=resolveVariable(declaration,sources)
    return found.status==='ready'?[[read.id,found.value]]:[]
  }))
}
