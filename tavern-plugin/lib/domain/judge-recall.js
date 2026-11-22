import {figureRefKey} from './figure-catalogue.js'

export const figureJudgeId = ref => 'figure:' + figureRefKey(ref)

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
