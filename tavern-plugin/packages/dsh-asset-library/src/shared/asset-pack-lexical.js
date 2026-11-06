// Generated from domain/asset-pack-lexical.js by build.mjs; do not edit.
// Node and browser use the same exact name normalization.
import figureResolution from './figure-resolution.cjs'
const {normalizeCatalogueText, codepointCompare} = figureResolution
const length = value => [...value].length

const timeOnly = /^(?:清晨|早晨|早上|上午|中午|午后|下午|傍晚|黄昏|夜晚|夜间|深夜|凌晨|白天|日间|早|晚|夜|day|night|morning|noon|afternoon|evening|dawn|dusk)$/u
function matchOffset(text, word) {
  let offset = text.indexOf(word)
  const han = /\p{Script=Han}/u.test(word)
  while (offset >= 0) {
    if (han || (!/[\p{Script=Latin}\p{N}]/u.test(text[offset - 1] || '') && !/[\p{Script=Latin}\p{N}]/u.test(text[offset + word.length] || ''))) return offset
    offset = text.indexOf(word, offset + 1)
  }
  return -1
}
// Names and author words are equally hard triggers; no lexical score or soft ranking.
function triggerEvidence(item, units, { excludeTimeWords = true, minLength = 2 } = {}) {
  const candidates = new Map()
  for (const raw of [item.name, item.label, ...(item.keywords || [])].filter(Boolean)) {
    const canonical = normalizeCatalogueText(raw)
    for (const surface of [raw, ...(item.synonyms?.[raw] || [])]) {
      const word = surface === raw ? canonical : normalizeCatalogueText(surface)
      if (length(word) >= minLength && !(excludeTimeWords && timeOnly.test(word))) candidates.set(word, canonical)
    }
  }
  const groups = new Map()
  for (const [word, canonical] of candidates) for (let i = 0; i < units.length; i++) {
    const offset = matchOffset(units[i], word)
    if (offset < 0) continue
    if (!groups.has(canonical)) groups.set(canonical, {word, canonical, paragraph:i + 1, offset})
    break
  }
  const evidence = [...groups.values()].sort((a,b) => codepointCompare(a.canonical,b.canonical))
  return {matched:evidence.length > 0, evidence}
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze) }
  return value
}

export { normalizeCatalogueText, triggerEvidence, codepointCompare, deepFreeze }
