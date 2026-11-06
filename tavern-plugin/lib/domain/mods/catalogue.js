import {modStageContribution} from './stage-contributions.js'
import {triggerEvidence,normalizeCatalogueText} from '../asset-pack-lexical.js'
import {judgeItemText} from '../judge-item-text.js'

// Preparation, previews and script lookup share these exact authorized recall identities.
export const modRecallId = ref => 'mod:' + JSON.stringify([ref.modId,ref.packId,ref.kind,ref.entryId])
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

export function modCatalogue(manifest,packs,scopes,text,judgeRecall) {
  const enabled=packs.flatMap(pack=>{
    const scope=scopes.find(row=>row.id===pack.id)?.scope || 'off'
    return scope==='off'?[]:[{...pack,scope}]
  })
  const recalled=enabled.flatMap(pack=>pack.entries.filter(entry=>entry.enabled && manifest.assetKinds.find(kind=>kind.id===entry.kind)?.directorSelectable &&
    (entry.recall?.mode==='constant' || triggerEvidence({name:entry.name,...entry.recall},[normalizeCatalogueText(text)]).matched || judgeRecall?.has(modRecallId({modId:manifest.id,packId:pack.id,kind:entry.kind,entryId:entry.id}))))
    .map(entry=>({modId:manifest.id,packId:pack.id,kind:entry.kind,entryId:entry.id})))
  const view={packs:enabled,recalled}
  return modStageContribution(manifest.id)?.catalogue?.(view) || view
}

// These join the director's existing judge batch; modules never run a second recall model.
export function modJudgeQuestions(manifest,catalogue) {
  const recalled=new Set(catalogue.recalled.map(modRecallId))
  return catalogue.packs.flatMap(pack=>pack.entries.filter(entry=>entry.enabled && entry.recall?.mode==='keyword' && manifest.assetKinds.find(kind=>kind.id===entry.kind)?.directorSelectable).flatMap(entry=>{
    const id=modRecallId({modId:manifest.id,packId:pack.id,kind:entry.kind,entryId:entry.id})
    return recalled.has(id)?[]:[{id,kind:'mod:'+manifest.id+':'+entry.kind,text:judgeItemText(entry.name,entry.directorNote || '',manifest.name)}]
  }))
}
