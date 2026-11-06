import { RULE_ENTRY_HINT, stripEngineSyntax } from './planner.js'
import { PROMPT_FORMATS } from './prompt-presets.js'

const list = value => Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\n]/) : []
const clean = values => [...new Set(values.map(v => String(v ?? '').trim()).filter(Boolean))]

/** Normalize ordinary activation metadata while retaining legacy ST keyword fields. */
export function normalizeEntryActivation(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {}
  const backendValues = raw.backends ?? raw.backend ?? raw.imageBackends ?? []
  const backends = clean(list(backendValues))
  const explicit = String(raw.activation ?? raw.activationMode ?? '').toLowerCase()
  const rawKeywords = raw.keywords ?? raw.keys ?? raw.key
  const keywords = clean(list(rawKeywords))
  const constant = raw.constant === true || raw.constant === 1 || raw.constant === 'true'
  const enabled = value => value === true || value === 1 || value === 'true'
  // 附加条件（AND）：主关键词命中之后，还要求这一组里再命中至少一个。
  // 智绘姬的 andTriggerWords / ST 的 keysecondary 都落到这里。
  const secondary = clean(list(raw.andKeywords ?? raw.andTriggerWords ?? raw.secondaryKeywords ?? raw.keysecondary))
  const complexTrigger = Boolean(enabled(raw.use_regex) || enabled(raw.useRegex) || enabled(raw.regex)
    || enabled(raw.caseSensitive) || enabled(raw.wholeWords)
    || (enabled(raw.selective) && raw.selectiveLogic != null && !secondary.length))
  // ST constant entries remain resident. Other simple keyword entries remain conditional.
  const activation = explicit === 'always' || explicit === 'keywords'
    ? explicit
    : (!complexTrigger && !constant && keywords.length && (raw.keywords != null || raw.keys != null || raw.key != null) ? 'keywords' : 'always')
  return { activation, keywords, backends, andKeywords: secondary }
}

function matches(text, keyword) {
  const q = String(keyword).trim()
  if (!q) return false
  // Require boundaries only at Latin/numeric ends. CJK text has no spaces between words.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const isCjk = ch => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)
  const latinWord = '[\\p{Script=Latin}\\p{N}_]'
  const left = isCjk(q[0]) ? '' : `(?:^|[^${latinWord.slice(1, -1)}])`
  const right = isCjk(q[q.length - 1]) ? '' : `(?:$|[^${latinWord.slice(1, -1)}])`
  return new RegExp(`${left}${escaped}${right}`, 'iu').test(String(text))
}

function entryReason(entry, text) {
  const activation = normalizeEntryActivation(entry)
  if (entry.enabled === false || entry.disable === true) return { included: false, reason: 'disabled' }
  if (activation.activation === 'always') return { included: true, reason: 'always' }
  if (!activation.keywords.length) return { included: false, reason: 'empty-keywords' }
  if (!activation.keywords.some(key => matches(text, key))) return { included: false, reason: 'keyword-miss' }
  // AND 附加条件：主关键词已命中，还要再命中附加组里的任意一个，否则不注入。
  if (activation.andKeywords.length && !activation.andKeywords.some(key => matches(text, key))) return { included: false, reason: 'and-miss' }
  return { included: true, reason: activation.andKeywords.length ? 'keyword-and-match' : 'keyword-match' }
}

function characterTerms(character) {
  const name = String(character.name ?? '').trim()
  const aliases = String(character.match ?? '').split(/[,，]/).map(v => v.trim()).filter(Boolean)
  return clean([name, ...aliases])
}

/** Split resident/dynamic rules and scope character detail to names found in the story. */
const PROMPT_MODES = new Set(PROMPT_FORMATS)

export function selectPlannerContext({ entries = [], selected = [], text = '', definitions = {}, backend = '', backendAliases = [], promptMode = '', characterUpdates = false } = {}) {
  const staticBlocks = [], dynamicBlocks = []
  const diagnostics = { includedEntries: [], omittedEntries: [], includedCharacters: [], omittedCharacters: [], characterFallback: false }
  const hasEnabled = entries.some(e => e && 'enabled' in e)
  const selectedList = Array.isArray(selected) && selected.length ? selected : RULE_ENTRY_HINT
  const wanted = new Set(selectedList.map(Number))
  for (const entry of entries) {
    const index = Number(entry?.index ?? -1)
    let reason
    if (entry?.enabled === false || entry?.disable === true) reason = { included: false, reason: 'disabled' }
    else {
      const meta = normalizeEntryActivation(entry)
      // backends 里可以写渠道名（comfyui…），也可以写提示词写法（tags / natural / mixed）：
      // 只给 tag 模型或只给自然语言模型看的规则，换模型时自动切换。
      const modes = meta.backends.filter(b => PROMPT_MODES.has(b.toLowerCase())).map(b => b.toLowerCase())
      const names = meta.backends.filter(b => !PROMPT_MODES.has(b.toLowerCase()))
      const acceptedBackends = new Set([String(backend), ...(Array.isArray(backendAliases) ? backendAliases.map(String) : [])])
      if (names.length && !names.some(name => acceptedBackends.has(name))) reason = { included: false, reason: 'backend-mismatch' }
      else if (modes.length && promptMode && !modes.includes(String(promptMode))) reason = { included: false, reason: 'prompt-mode-mismatch' }
      else if (!hasEnabled && !wanted.has(index)) reason = { included: false, reason: 'not-selected' }
      else reason = entryReason(entry, text)
    }
    if (!String(entry?.content ?? '').trim()) reason = { included: false, reason: 'empty-content' }
    const record = { index, comment: String(entry?.comment ?? ''), reason: reason.reason }
    if (!reason.included) { diagnostics.omittedEntries.push(record); continue }
    diagnostics.includedEntries.push(record)
    const body = stripEngineSyntax(entry?.content ?? '').trim()
    if (!body) continue
    const block = `<!-- ${record.comment} -->\n${body}`
    ;(normalizeEntryActivation(entry).activation === 'keywords' ? dynamicBlocks : staticBlocks).push(block)
  }

  const characters = (definitions?.characters ?? []).filter(c => c && c.enabled !== false)
  const named = characters.filter(c => characterTerms(c).some(term => matches(text, term)))
  // 同一角色的其他形态（名字互为前缀，如「阿梅」与「阿梅（狐形）」）一起提供，让规划自己判断这一刻是哪个形态。
  // 否则正文只写了本名时，规划只看得到一个形态，会用错误形态的宏去描述另一个形态。
  const family = (a, b) => a !== b && String(a.name ?? '') && String(b.name ?? '') && (String(a.name).startsWith(String(b.name)) || String(b.name).startsWith(String(a.name)))
  const hit = characters.filter(c => named.includes(c) || named.some(n => family(c, n)))
  const fallback = characters.length > 0 && hit.length === 0
  const included = fallback ? characters : hit
  diagnostics.characterFallback = fallback
  diagnostics.includedCharacters = included.map(c => ({ name: String(c.name ?? ''), stable_id: String(c.id ?? ''), reason: fallback ? 'fallback-no-name-match' : (named.includes(c) ? 'name-match' : 'form-of-mentioned-character') }))
  diagnostics.omittedCharacters = characters.filter(c => !included.includes(c)).map(c => ({ name: String(c.name ?? ''), stable_id: String(c.id ?? ''), reason: 'not-mentioned' }))
  const fullSet = new Set(included)
  const scoped = { ...definitions, characters: included }
  const rosterIndex = characters.filter(c => !fullSet.has(c)).map(c => `- ${String(c.name ?? '')} [stable_id=${String(c.id ?? '')}]`).join('\n')
  return { staticRules: staticBlocks.join('\n\n'), dynamicRules: dynamicBlocks.join('\n\n'), definitions: scoped, rosterIndex, fullTraits: Boolean(characterUpdates), diagnostics }
}
