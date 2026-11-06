import {createOrderedNumericIndex} from './ordered-numeric-index.js'

// Object identity matters for captured parts shared by several projections.
// Weak ids avoid retaining parts after all projection versions are released.
export function createStatusPartIndex() {
  const ids=new WeakMap();let sequence=0
  const positions=createOrderedNumericIndex()
  const parts=createOrderedNumericIndex({measure:row=>positions.info(row.owners).bytes})
  function id(part){if(!ids.has(part))ids.set(part,++sequence);return ids.get(part)}
  function update(previous,projectionEdits,removalEdits){
    const base=previous || parts.from([]),dirty=new Map()
    function edit(part){
      const key=id(part)
      if(!dirty.has(key))dirty.set(key,{...(parts.get(base,key)||{owners:positions.from([]),count:0})})
      return dirty.get(key)
    }
    for(const [position,before,after] of projectionEdits){
      for(const part of new Set(before || []))if(part?.kind==='html'){
        const row=edit(part);row.owners=positions.update(row.owners,[[position,undefined]])
      }
      for(const part of new Set(after || []))if(part?.kind==='html'){
        const row=edit(part);row.owners=positions.update(row.owners,[[position,position]])
      }
    }
    for(const [before,after] of removalEdits){
      for(const part of before || [])edit(part).count--
      for(const part of after || [])edit(part).count++
    }
    const affected=new Set(),entries=[]
    for(const [key,row] of dirty){
      if(row.count<0)throw new Error('Invalid status part removal count')
      if(Boolean(parts.get(base,key)?.count)!==Boolean(row.count))for(const position of row.owners)affected.add(position)
      entries.push([key,row.owners.length || row.count ? row : undefined])
    }
    const state=parts.update(base,entries)
    return {state,affected,bytes:parts.info(state).bytes}
  }
  function has(state,part){const key=ids.get(part);return key!==undefined && (parts.get(state,key)?.count || 0)>0}
  return {update,has}
}
