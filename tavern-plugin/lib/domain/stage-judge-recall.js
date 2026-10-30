// judge candidates use the same eligibility/trigger decisions as the catalogue.
import {assetRefKey} from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {figureRefKey} from './figure-catalogue.js'
import {normalizeCatalogueText,triggerEvidence} from './asset-pack-lexical.js'
import {judgeItemText} from './judge-item-text.js'
const names = {backgrounds:'background',music:'music',sfx:'sound effect',ambience:'ambience',cg:'CG',looks:'lighting',outfits:'outfit',figures:'character',performances:'performance',widgets:'widget'}
export const outfitJudgeId = (actor,key) => JSON.stringify(['outfit',actor,key])
export const figureJudgeId = ref => 'figure:' + figureRefKey(ref)
export function greenJudgeQuestions({catalogue,actors,figures,units,state,dimensions}) {
  const rows = catalogue.rows.filter(row => row.excluded === 'no-trigger').map(row => ({id:assetRefKey(row.ref),kind:row.ref.kind,title:row.asset.name,description:row.asset.directorNote || row.asset.description || ''}))
  for (const row of figures.all.filter(row => !row.reasons.length)) rows.push({id:figureJudgeId(row.ref),kind:'figures',title:row.name,description:row.figure?.description || ''})
  const text = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text || ''))
  if (dimensions.actors && dimensions.outfit) for (const [alias,actor] of Object.entries(actors)) {
    for (const [index,outfit] of actor.outfits.entries()) {
      if (!outfit.enabled || index === 0 || state?.actors?.[alias]?.outfitKey === outfit.key || outfit.recall?.mode === 'constant') continue
      if (triggerEvidence({name:outfit.label,...outfit.recall},text,{excludeTimeWords:false,minLength:1}).matched) continue
      rows.push({id:outfitJudgeId(alias,outfit.key),kind:'outfits',title:outfit.label,description:outfit.guidance || ''})
    }
  }
  return rows.map(row => ({id:row.id,kind:row.kind,text:judgeItemText(row.title,row.description,names[row.kind] || row.kind)}))
}
export function selectJudgeRecall(questions,probabilities,config) {
  const selected = new Set(), groups = new Map()
  if (!probabilities) return selected
  for (const question of questions) {
    const probability = probabilities.get(question.id)
    if (probability === undefined || probability < config.threshold) continue
    const rows = groups.get(question.kind) || []
    rows.push({id:question.id,probability});groups.set(question.kind,rows)
  }
  for (const rows of groups.values()) for (const row of rows.sort((a,b) => b.probability-a.probability || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0,config.capPerKind)) selected.add(row.id)
  return selected
}
export const judgeMaterial = (preamble,units) => [preamble,...units.map(unit => typeof unit === 'string' ? unit : unit.text || '')].filter(Boolean).join('\n\n')
