// Green-lamp recall (docs/design/asset-library.md): an entry is offered when its name, a keyword or a keyword's
// synonym appears in the text.
const length = value => [...value].length
export function normalizeCatalogueText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

// Han words match anywhere; Latin and digit words only as whole words.
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
export function triggerEvidence(item, units, { minLength = 2 } = {}) {
  const text = units.map(normalizeCatalogueText), candidates = new Map()
  for (const raw of [item.name, ...(item.keywords || [])].filter(Boolean)) {
    const canonical = normalizeCatalogueText(raw)
    for (const surface of [raw, ...(item.synonyms?.[raw] || [])]) {
      const word = surface === raw ? canonical : normalizeCatalogueText(surface)
      if (length(word) >= minLength) candidates.set(word, canonical)
    }
  }
  const groups = new Map()
  for (const [word, canonical] of candidates) for (let i = 0; i < text.length; i++) {
    const offset = matchOffset(text[i], word)
    if (offset < 0) continue
    if (!groups.has(canonical)) groups.set(canonical, { word, canonical, paragraph: i + 1, offset })
    break
  }
  const evidence = [...groups.values()]
  return { matched: evidence.length > 0, evidence }
}
