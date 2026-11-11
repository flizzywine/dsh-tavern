import {modStageContribution} from './stage-contributions.js'

export const modTurnActive = (manifest,catalogue) => !manifest.admission.entryKinds.length || !!catalogue?.recalled.some(ref=>manifest.admission.entryKinds.includes(ref.kind) && catalogue.packs.some(pack=>pack.id===ref.packId && pack.scope!=='builtin'))

// Core recall is the authority; this view neither scores nor resolves names again.
export function modAssetCatalogue(manifest,assetCatalogue) {
  const rows=manifest.admission.entryKinds.flatMap(kind=>assetCatalogue?.candidates[kind] || [])
  const packs=new Map()
  for(const row of rows) {
    if(!packs.has(row.ref.packId))packs.set(row.ref.packId,{id:row.ref.packId,name:row.packName,scope:'library',entries:[],files:[]})
    packs.get(row.ref.packId).entries.push({...structuredClone(row.asset),ref:structuredClone(row.ref),
      ...(row.performanceLevels?{performanceLevels:row.performanceLevels,performanceDefault:row.performanceDefault,directorNote:row.performanceNote,...(row.performanceTopicBudget?{performanceTopicBudget:true}:{})}:{})})
  }
  return {packs:[...packs.values()],recalled:rows.map(row=>structuredClone(row.ref))}
}

// A mod that reads no library kinds owns no entries of its own; its stage contribution may still add built-in views
// (the phone's device).
export function modCatalogue(manifest) {
  const view={packs:[],recalled:[]}
  return modStageContribution(manifest.id)?.catalogue?.(view) || view
}
