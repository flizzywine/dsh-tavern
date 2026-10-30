// selected candidates grant operations, but only accepted operations create roster state.
import {figureJudgeId} from './stage-judge-recall.js'
import {normalizeCatalogueText, triggerEvidence} from './asset-pack-lexical.js'
import {figureRefKey, resolution} from './figure-catalogue.js'
export function recallFigures({rows, units = [], roster = {}, judgeRecall}) {
  const text = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text || ''))
  const speakers = new Set(units.filter(unit => typeof unit !== 'string' && unit.kind === 'line').map(unit => resolution.resolveFigureName(rows,unit,roster)).filter(row => row.status === 'resolved').map(row => figureRefKey(row.ref)))
  const candidates = rows.filter(row => row.enabled).map(row => {
    const reasons = []
    if (row.recall?.mode === 'constant') reasons.push('constant')
    const hit = triggerEvidence({name:row.name,keywords:row.aliases || []},text,{excludeTimeWords:false})
    if (speakers.has(figureRefKey(row.ref)) || hit.matched) reasons.push('hard-trigger')
    if (!reasons.length && judgeRecall?.has(figureJudgeId(row.ref))) reasons.push('judge')
    return {...row,reasons}
  })
  return {all:candidates,rows:candidates.filter(row => row.reasons.length)}
}
