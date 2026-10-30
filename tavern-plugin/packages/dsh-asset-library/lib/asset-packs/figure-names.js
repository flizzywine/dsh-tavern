import {array, check, text} from './common.js'
import {validateRecall} from './manifest.js'
import {normalizeCatalogueText, triggerEvidence} from '../shared/asset-pack-lexical.js'

export const figureNameKey = value => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()

// Ingress only: retain the first spelling and order; the display name already identifies the figure.
export function normalizeFigureAliases(name, aliases = []) {
  array(aliases, '$.aliases', 256)
  text(name, '$.name')
  const seen = new Set([normalizeCatalogueText(name)]), result = []
  for (const alias of aliases) {
    text(alias, '$.aliases', 160)
    const value = alias.trim(), key = normalizeCatalogueText(value)
    check(key.length > 0, '$.aliases', 'Empty figure name')
    if (!seen.has(key)) { seen.add(key); result.push(value) }
  }
  const words = [name, ...result].map(normalizeCatalogueText)
  const minimal = result.filter((_, index) => {
    const word = words[index + 1]
    // Han ignores outer boundaries. Uppercase padding cannot occur in normalized
    // words, but still exercises the matcher's Latin boundary on either side.
    const context = /\p{Script=Han}/u.test(word) ? 'A' + word + 'A' : word
    return !words.some((other, i) => i !== index + 1 && word.includes(other) && triggerEvidence({name:other}, [context], {excludeTimeWords:false}).matched)
  })
  array(minimal, '$.aliases', 128)
  return minimal
}

// The single old-data conversion, shared by archive ingress and the offline migration.
export function migrateFigureNames(figure) {
  const next = structuredClone(figure), recall = next.recall
  if (recall && (Object.hasOwn(recall, 'keywords') || Object.hasOwn(recall, 'synonyms'))) validateRecall(recall, '$.recall')
  if (next.aliases !== undefined) array(next.aliases, '$.aliases', 128)
  const aliases = [...(next.aliases || [])]
  aliases.push(...(recall?.keywords || []), ...Object.values(recall?.synonyms || {}).flat())
  if (next.aliases !== undefined || aliases.length) next.aliases = normalizeFigureAliases(next.name, aliases)
  if (recall) { delete recall.keywords; delete recall.synonyms }
  return next
}

// Offline distribution baselines predate alias tracking. Do not treat current local
// aliases as publisher defaults: that would discard local names on the next update.
export function migrateFigureNameBaselines(local, figures) {
  const next = structuredClone(local)
  for (const [key, row] of Object.entries(next.distribution?.baseMetadata || {})) {
    if (!key.startsWith('figure/') || !row.recall || !['keywords','synonyms'].some(field => Object.hasOwn(row.recall,field))) continue
    const converted = migrateFigureNames({...row,name:figures[key.slice(7)]?.name || key})
    row.recall = converted.recall
    if (converted.aliases !== undefined) row.aliases = converted.aliases
  }
  return next
}

// Card bubble configurations contain typed FigureRef rows, not complete pack figures.
export function migrateFigureNameCopies(value, {onChange} = {}) {
  if (Array.isArray(value)) return value.map(item => migrateFigureNameCopies(item,{onChange}))
  if (!value || typeof value !== 'object') return value
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateFigureNameCopies(item,{onChange})]))
  if (next.ref?.packId && next.ref?.figureId && typeof next.name === 'string' && next.recall) {
    const converted = migrateFigureNames(next)
    if (JSON.stringify(converted) !== JSON.stringify(next)) onChange?.()
    return converted
  }
  return next
}
