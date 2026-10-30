// authoring validation, not a migration of installed pack documents.
import {check} from './common.js'

export function keywordHygieneIssue(word, item = {}) {
  if (word === item.name || word === item.label || word === item.description) return 'redundant name/description (names already trigger recall)'
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(word) || /^[a-f0-9]{12,}$/i.test(word) || /[/\\]|\.(?:png|webp|jpe?g|json|wav|mp3|ogg)$/i.test(word)) return 'internal slug, hash or file token'
  // Do not count Japanese titles plus a short English version suffix as English prose.
  if (/[\u3001\uff0c,;\uff1b]/u.test(word) || (word.match(/\p{Script=Han}/gu) || []).length > 8 || (/^[\p{Script=Latin}\p{N}\s'().!?-]+$/u.test(word) && word.trim().split(/\s+/u).length > 3)) return 'description-like phrase; use short meaningful triggers and put prose in description'
  return null
}

export function validatePackKeywords({manifest, figures = {}}) {
  function inspect(item, path) {
    if (!item.recall) return
    const seen = new Set()
    item.recall.keywords.forEach((word, index) => {
      const issue = seen.has(word) ? 'duplicate keyword' : keywordHygieneIssue(word, item)
      check(!issue, `${path}.recall.keywords[${index}]`, `Keyword hygiene: ${JSON.stringify(word)}: ${issue}`)
      seen.add(word)
    })
  }
  manifest.assets.forEach((asset, index) => inspect(asset, `$.assets[${index}]`))
  for (const [id, figure] of Object.entries(figures)) {
    figure.outfits.forEach((outfit, index) => inspect(outfit, `$.figures.${id}.outfits[${index}]`))
  }
}

// Legacy repacks can discard a redundant name without discarding its existing aliases.
export function omitRedundantRecallKeywords(item) {
  const recall = structuredClone(item.recall), removed = recall.keywords.filter(word => [item.name,item.label,item.description].includes(word))
  recall.keywords = [...new Set(recall.keywords.filter(word => !removed.includes(word)))]
  for (const word of removed) {
    for (const alias of recall.synonyms?.[word] || []) if (!recall.keywords.includes(alias) && ![item.name,item.label,item.description].includes(alias)) recall.keywords.push(alias)
    if (recall.synonyms) delete recall.synonyms[word]
  }
  return recall
}
