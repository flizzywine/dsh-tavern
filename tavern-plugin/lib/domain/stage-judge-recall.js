// Green-lamp recall (docs/design/asset-library.md): a blue entry is always offered; a green one when the text so far names
// it, or — with 判断模型 configured — when the judge finds it fits this turn. A switched-off entry is never in the catalog
// and never asked about. Judge failures fall back to triggers only; nothing is filled in at random.
import { triggerEvidence } from './asset-pack-lexical.js'
import { judgeEnabled } from './engine-judge.js'

const RECALL_FIELDS = Object.freeze({ background: 'background', music: 'music', items: 'item' })
export const judgeAssetId = row => row.ref.packId + '/' + row.ref.kind + '/' + row.ref.assetId
// Credits do not tell use cases apart; the question keeps the entry's name and its director note.
export function judgeItemText(name, description = '', kind) {
  const note = description
    .replace(/;\s*based on\s+[^.!?。]+\s+by\s+[^.!?。]+(?:[.!?。]|$)/gi, '.')
    .replace(/(?:[;；]\s*|^|(?<=[.!?。])\s*)(?:licensed under|licen[cs]e:|copyright\s)[^.!?。]+(?:[.!?。]|$)/gi, ' ')
    .trim()
  return '<judge_request>\n' + `Does this asset fit this turn's story? [${kind}] ${name}; use when: ${note}` + '\n</judge_request>'
}
// The shared material: the preamble, then the turn's text so far. No player input, history, variables or card.
export const judgeMaterial = (preamble, units) => [preamble, ...units].filter(Boolean).join('\n\n')

// p ≥ threshold, then per kind the most likely capPerKind (ties by id).
export function selectJudgeRecall(questions, probabilities, config) {
  const selected = new Set(), groups = new Map()
  if (!probabilities) return selected
  for (const question of questions) {
    const probability = probabilities.get(question.id)
    if (probability === undefined || probability < config.threshold) continue
    const rows = groups.get(question.kind) || []
    rows.push({ id: question.id, probability }); groups.set(question.kind, rows)
  }
  for (const rows of groups.values()) for (const row of rows.sort((a, b) => b.probability - a.probability || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, config.capPerKind)) selected.add(row.id)
  return selected
}

// The catalog this window offers: blue entries, green entries the text names, then the green ones the judge recalls.
// `ask(request)` is the judge; it is called only when it is configured and some green entry was not named.
export async function recallGreenAssets(assets, units, config, ask) {
  const offered = { ...assets }, missed = []
  for (const field of Object.keys(RECALL_FIELDS)) {
    offered[field] = (assets[field] || []).filter(item => {
      if (item.recall?.mode !== 'keyword' || triggerEvidence({ name: item.name, ...item.recall }, units).matched) return true
      missed.push({ field, item })
      return false
    })
  }
  if (!missed.length || !judgeEnabled(config) || !ask) return offered
  const questions = missed.map(({ field, item }) => ({ id: judgeAssetId(item), kind: field, text: judgeItemText(item.name, item.note || '', RECALL_FIELDS[field]) }))
  const probabilities = await ask({ material: judgeMaterial(config.preamble, units), questions: questions.map(({ id, text }) => ({ id, text })) }, config)
  const selected = selectJudgeRecall(questions, probabilities, config)
  if (!selected.size) return offered
  // Recalled entries keep catalog order.
  for (const field of Object.keys(RECALL_FIELDS)) offered[field] = (assets[field] || []).filter(item => offered[field].includes(item) || selected.has(judgeAssetId(item)))
  return offered
}
