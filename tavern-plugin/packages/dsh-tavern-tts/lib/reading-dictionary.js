// entry-time normalization; synthesis only consumes the stored language.
const fail = (code = 'INVALID_READINGS') => { throw Object.assign(new Error(code), {code}) }
// a preset may grow large (tested with 5,000 entries).
export const READING_ENTRY_LIMIT = 20000
const languages = new Set(['ja', 'zh', 'en', 'ko', 'yue', 'fr', 'de', 'ru', 'it', 'es', 'pt', 'ar', 'nl', 'pl'])
export const readingLanguage = value => value === 'all_ja' ? 'ja' : value === 'all_zh' ? 'zh' : value

export function parseReadingForms(value) {
  const parts = typeof value === 'string' ? [value] : value
  if (!Array.isArray(parts) || parts.some(item => typeof item !== 'string')) fail()
  const forms = [...new Set(parts.flatMap(item => item.split(/[,\uFF0C\u3001]/u)).map(item => item.trim()).filter(Boolean))]
  if (!forms.length || forms.length > 128 || forms.some(item => item.length > 256)) fail()
  return forms
}

export function inferReadingLanguage(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 512) fail()
  const reading = value.trim().normalize('NFC')
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}\u30FC]/u.test(reading)
  const han = /\p{Script=Han}/u.test(reading)
  const latin = /\p{Script=Latin}/u.test(reading)
  const toned = /[\u0101\u00E1\u01CE\u00E0\u0113\u00E9\u011B\u00E8\u012B\u00ED\u01D0\u00EC\u014D\u00F3\u01D2\u00F2\u016B\u00FA\u01D4\u00F9\u01D6\u01D8\u01DA\u01DC\u01F9\u0144\u0148]/iu.test(reading)
    || /(?:^|[\s'-])[a-z\u00FC]+[1-5](?=$|[\s'-])/iu.test(reading)
  const language = kana ? 'ja' : han || toned ? 'zh' : 'en'
  const warnings = []
  if (kana && (latin || han) || han && latin || /[^\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}\p{M}\p{P}\p{Z}\d\u30FC]/u.test(reading)) warnings.push('AMBIGUOUS_READING')
  else if (!kana && !han && !toned) warnings.push(latin ? 'LATIN_ASSUMED_EN' : 'AMBIGUOUS_READING')
  return {reading, inferredLanguage:language, warnings}
}

export function normalizeReadingEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail()
  const forms = parseReadingForms(input.forms)
  const inferred = inferReadingLanguage(input.reading)
  const override = input.languageOverride === '' || input.languageOverride == null ? undefined : readingLanguage(input.languageOverride)
  if (override !== undefined && !languages.has(override)) fail()
  return {forms, ...inferred, language:override || inferred.inferredLanguage, ...(override ? {languageOverride:override} : {})}
}

export function normalizeReadingEntries(input) {
  if (!Array.isArray(input) || input.length > READING_ENTRY_LIMIT) fail()
  const entries = input.map(normalizeReadingEntry)
  validateReadingEntries(entries)
  return entries
}

export function validateReadingEntries(entries) {
  if (!Array.isArray(entries) || entries.length > READING_ENTRY_LIMIT) fail()
  const seen = new Set()
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.forms) || !entry.forms.length || entry.forms.length > 128 || !languages.has(entry.language)
      || !['ja','zh','en'].includes(entry.inferredLanguage) || typeof entry.reading !== 'string' || !entry.reading.trim() || entry.reading.length > 512
      || !Array.isArray(entry.warnings) || entry.warnings.some(code => !['AMBIGUOUS_READING','LATIN_ASSUMED_EN'].includes(code))
      || entry.languageOverride !== undefined && (!languages.has(entry.languageOverride) || entry.language !== entry.languageOverride)
      || entry.languageOverride === undefined && entry.language !== entry.inferredLanguage) fail()
    for (const form of entry.forms) {
      if (typeof form !== 'string' || !form.trim() || form !== form.trim() || form.length > 256 || /[,\uFF0C\u3001]/u.test(form)) fail()
      const key = entry.language + '\0' + form
      if (seen.has(key)) fail('DUPLICATE_READING_FORM')
      seen.add(key)
    }
  }
  return entries
}

// one list — the active global preset (there is no per-card dictionary any more).
export function compileReadingDictionary(list = []) {
  const byLanguage = new Map()
  for (const entry of list) {
    if (!byLanguage.has(entry.language)) byLanguage.set(entry.language, new Map())
    for (const form of entry.forms) byLanguage.get(entry.language).set(form, entry.reading)
  }
  const compiled = new Map(), entries = []
  for (const [language, values] of [...byLanguage].sort(([a],[b]) => a.localeCompare(b))) {
    const forms = [...values.keys()].sort((a,b) => b.length - a.length || (a < b ? -1 : 1))
    const pattern = new RegExp(forms.map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu')
    compiled.set(language, {pattern, values})
    entries.push(...forms.map(form => ({language, form, reading:values.get(form)})))
  }
  return {entries, apply(text, language) {
    const selected = compiled.get(readingLanguage(language))
    return selected ? text.replace(selected.pattern, form => selected.values.get(form)) : text
  }}
}
