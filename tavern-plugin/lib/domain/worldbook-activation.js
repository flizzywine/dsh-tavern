// Selection priority and prompt order are different in SillyTavern.
import { worldBookChannel } from './worldbook-channel.js'

const str = value => value == null ? '' : String(value)
export const DEFAULT_WORLD_BOOK_TOKEN_BUDGET = 8192
// Local admission estimate, not provider usage. CJK text is about 0.6 tokens per character on current tokenizers.
export function estimateWorldBookTokens(value) {
  let ascii = 0, other = 0
  for (const char of str(value)) char.codePointAt(0) < 128 ? ascii++ : other++
  return Math.ceil(ascii / 4 + other * 0.6)
}
export function priorityOrder(entries) {
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
    (Number(b.entry.order ?? 100) - Number(a.entry.order ?? 100)) ||
    (Number(a.entry.displayIndex ?? a.index) - Number(b.entry.displayIndex ?? b.index)) || a.index - b.index
  ).map(item => item.entry)
}
export function promptOrder(entries) {
  const buckets = new Map()
  for (const entry of priorityOrder(entries)) {
    const key = placementKey(entry)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).unshift(entry)
  }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).flatMap(([, entries]) => entries)
}

// Preserve author-defined position boundaries without pretending to implement
// all ST message/depth anchors in the DSH adapter.
export function placementKey(entry) {
  const position = entry.position === 'before_char' ? 0 : entry.position === 'after_char' ? 1 : Number(entry.position ?? 0)
  return position === 4 ? `4:${entry.depth ?? 4}:${entry.role ?? 0}` : String(position)
}

function integer(value, fallback, max = 1000) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Math.min(max, Math.trunc(Number(value))))
}
export function worldBookSettings(worldBook) {
  const raw = worldBook?.view?.raw || {}
  return {
    scanDepth: integer(raw.scan_depth, 2),
    tokenBudget: integer(raw.token_budget, DEFAULT_WORLD_BOOK_TOKEN_BUDGET, 1000000),
    recursive: raw.recursive_scanning === true,
    caseSensitive: raw.case_sensitive === true,
    matchWholeWords: raw.match_whole_words === true
  }
}

/** Deepest history any entry of this book scans, in user/assistant floors. */
export function historyScanDepth(worldBook) {
  const fallback = worldBookSettings(worldBook).scanDepth
  let depth = fallback
  for (const entry of worldBook?.view?.entries || []) depth = Math.max(depth, integer(entry.scanDepth, fallback))
  return depth
}

const regexKeyCache = new Map()
const literalRegexCache = new Map()

function cacheSetBounded(map, key, value, limit = 512) {
  if (map.size >= limit) map.delete(map.keys().next().value)
  map.set(key, value)
  return value
}

function regexKey(value) {
  const raw = str(value)
  if (regexKeyCache.has(raw)) return regexKeyCache.get(raw)
  const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(raw)
  if (!match) return cacheSetBounded(regexKeyCache, raw, null)
  try {
    return cacheSetBounded(regexKeyCache, raw, new RegExp(match[1], match[2].replaceAll('g', '').replaceAll('y', '')))
  } catch (_error) {
    return cacheSetBounded(regexKeyCache, raw, null)
  }
}

function singleHanRegex(needle) {
  const key = 'han:' + needle
  if (literalRegexCache.has(key)) return literalRegexCache.get(key)
  return cacheSetBounded(literalRegexCache, key, new RegExp('(?:^|[^\\p{L}\\p{N}\\p{M}_])' + needle + '(?=$|[^\\p{L}\\p{N}\\p{M}_])', 'u'))
}

function wholeWordRegex(needle) {
  const key = 'word:' + needle
  if (literalRegexCache.has(key)) return literalRegexCache.get(key)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return cacheSetBounded(literalRegexCache, key, new RegExp('(?:^|\\W)' + escaped + '(?:$|\\W)'))
  } catch (_error) {
    return cacheSetBounded(literalRegexCache, key, null)
  }
}

function literalMatch(text, key, entry, lowerText) {
  const sensitive = entry.caseSensitive === true
  const source = sensitive ? text : (lowerText !== undefined ? lowerText : text.toLocaleLowerCase())
  const needle = sensitive ? key : key.toLocaleLowerCase()
  if (needle === '') return false
  // Single Han aliases must stand alone; JS \W treats every Han character as a boundary.
  if (/^\p{Script=Han}$/u.test(needle)) return singleHanRegex(needle).test(source)
  if (entry.matchWholeWords !== true || needle.split(/\s+/).length > 1) return source.includes(needle)
  const regex = wholeWordRegex(needle)
  return regex ? regex.test(source) : source.includes(needle)
}

function keyMatch(text, value, entry, lowerText) {
  const key = str(value).trim()
  if (key === '') return false
  const regex = regexKey(key)
  if (regex !== null) return regex.test(text)
  return literalMatch(text, key, entry, lowerText)
}

function keywordEvaluation(entry, body, sources, lowerBody) {
  const keys = values => (Array.isArray(values) ? values : []).map(value => str(value).trim()).filter(Boolean)
  const bodyLower = entry.caseSensitive === true ? undefined : (lowerBody !== undefined ? lowerBody : body.toLocaleLowerCase())
  function hits(values) {
    return keys(values).filter(key => keyMatch(body, key, entry, bodyLower)).map(key => {
      const source = sources.find(source => keyMatch(source.text, key, entry, source.lowerText))
      const text = source?.text || body
      const textLower = source ? (source.lowerText ?? text.toLocaleLowerCase()) : (bodyLower ?? text.toLocaleLowerCase())
      const regex = regexKey(key)
      const index = regex ? (regex.exec(text)?.index ?? 0) : (entry.caseSensitive ? text : textLower).indexOf(entry.caseSensitive ? key : key.toLocaleLowerCase())
      return { key, source: source?.source || 'combined', messageIndex: source?.messageIndex, turn: source?.turn, role: source?.role,
        ref: source?.ref, excerpt: text.slice(Math.max(0, index - 45), Math.max(0, index) + 115) }
    })
  }
  const primary = hits(entry.primaryKeys), secondary = hits(entry.secondaryKeys)
  const secondaryKeys = keys(entry.secondaryKeys)
  let secondaryPassed = true
  if (entry.selective === true && secondaryKeys.length) {
    switch (Number(entry.selectiveLogic) || 0) {
      case 1: secondaryPassed = secondary.length !== secondaryKeys.length; break
      case 2: secondaryPassed = secondary.length === 0; break
      case 3: secondaryPassed = secondary.length === secondaryKeys.length; break
      default: secondaryPassed = secondary.length > 0
    }
  }
  return { matched: primary.length > 0 && secondaryPassed, primary, secondary, secondaryPassed,
    primaryKeyCount: keys(entry.primaryKeys).length, secondaryKeys, selectiveLogic: entry.selective === true ? Number(entry.selectiveLogic) || 0 : null }
}

export function matchesWorldBookKeywords(entry, text) {
  return keywordEvaluation(entry, text, []).matched
}

export function worldbookScanMessages(input) {
  const messages = (input.chat?.messages || []).map((message, messageIndex) => ({ ...message, messageIndex }))
    .filter(message => ['user', 'assistant'].includes(message?.role) && (!input.ignorePlaceholders || !message.placeholder))
    .map(message => ({ text: str(message.sourceText || message.text), source: 'history', messageIndex: message.messageIndex, role: message.role, turn: message.turn, greeting: message.greeting === true }))
  if (input.latestBody !== undefined) {
    const last = messages.length - 1
    const source = { text: str(input.latestBody), source: 'latest-body', role: 'assistant' }
    if (last >= 0 && input.chat?.messages?.at(-1)?.role === 'assistant') messages[last] = { ...messages[last], ...source }
    else messages.push(source)
  }
  if (!input.userTextInHistory && str(input.userText).trim()) messages.push({ text: str(input.userText), source: 'current-input', role: 'user' })
  // Greetings often contain setup menus and initial variables, not the active scene.
  // Filter after latestBody replacement so that legacy previews cannot reintroduce them.
  return messages.filter(message => !message.greeting).map(({ greeting, ...source }) => source).reverse()
}
function groupNames(entry) { return str(entry.group).split(/,\s*/).map(value => value.trim()).filter(Boolean) }
function option(entry, key, fallback) { return entry[key] ?? entry.rawEntry?.[key] ?? fallback }
function groupScore(entry, text) {
  const hits = keys => (keys || []).filter(key => keyMatch(text, key, entry)).length
  const primary = hits(entry.primaryKeys)
  const secondary = hits(entry.secondaryKeys)
  if (!(entry.primaryKeys || []).length) return 0
  // ST only counts positive secondary conditions; AND_ALL adds them only when all match.
  const logic = Number(entry.selectiveLogic) || 0
  return primary + (logic === 0 || (logic === 3 && secondary === (entry.secondaryKeys || []).length) ? secondary : 0)
}
function filterGroups(candidates, activated, textFor, random, reject) {
  const groups = new Map()
  for (const entry of candidates) for (const name of groupNames(entry)) {
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(entry)
  }
  const retained = new Set(candidates)
  const occupied = new Set(activated.flatMap(groupNames))
  for (const [name, members] of groups) {
    let pool = members.filter(entry => retained.has(entry))
    const remove = (entry, details = {}) => { retained.delete(entry); reject(entry, 'group', { group: name, ...details }) }
    if (occupied.has(name)) { pool.forEach(entry => remove(entry, { groupReason: 'already-selected', winners: activated.filter(item => groupNames(item).includes(name)).map(item => item.ref) })); continue }
    if (pool.length < 2) continue
    if (pool.some(entry => option(entry, 'useGroupScoring', false))) {
      const scores = pool.map(entry => groupScore(entry, textFor(entry)))
      const max = Math.max(...scores)
      pool = pool.filter((entry, index) => {
        if (option(entry, 'useGroupScoring', false) && scores[index] < max) { remove(entry, { groupReason: 'score', score: scores[index], maxScore: max }); return false }
        return true
      })
    }
    const overrides = priorityOrder(pool.filter(entry => option(entry, 'groupOverride', false)))
    let winner = overrides[0]
    if (!winner) {
      const weight = entry => Math.max(0, Number(option(entry, 'groupWeight', 100)) || 0)
      let roll = random() * pool.reduce((sum, entry) => sum + weight(entry), 0)
      winner = pool.find(entry => { roll -= weight(entry); return roll < 0 }) || pool[0]
    }
    for (const entry of pool) if (entry !== winner) remove(entry, { groupReason: overrides.length ? 'priority' : 'weight', winners: winner ? [winner.ref] : [], weight: option(entry, 'groupWeight', 100) })
  }
  return candidates.filter(entry => retained.has(entry))
}

/** ST-style bounded history, keyword conditions, inclusion groups and recursion.
 * No model-based search, no full-text lookup of inactive entries. Timed effects
 * deliberately remain owned by the existing DSH ten-turn cooldown.
 */
export function activateWorldBook(input) {
  const settings = worldBookSettings(input.worldBook)
  const messages = worldbookScanMessages(input)
  const injected = str(input.scanText)
  const random = input.random || Math.random
  const entries = priorityOrder(input.entries).map(entry => ({ ...entry,
    caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords
  }))
  const activated = [], activatedRefs = new Set(), recurse = [], diagnostics = new Map(), rejected = new Set()
  const entryRank = new Map(entries.map((entry, index) => [entry, index + 1]))
  const currentUserText = str(input.userText)
  const currentUserLower = currentUserText ? currentUserText.toLocaleLowerCase() : ''
  const injectedSource = injected ? { text: injected, lowerText: injected.toLocaleLowerCase(), source: 'script' } : null
  for (const message of messages) message.lowerText = message.text.toLocaleLowerCase()
  // 固定注入通道关闭触发词、冷却与语义筛选；其中 tail 仍计入 Token 预算，prefix 进稳定前缀不占每轮预算。
  const channelOf = entry => worldBookChannel(entry)
  const alwaysOn = entry => entry.constant === true || channelOf(entry) !== 'auto'
  const chargesBudget = entry => channelOf(entry) === 'tail' || (entry.constant !== true && channelOf(entry) === 'auto')
  const reject = (entry, reason, extra = {}) => diagnostics.set(entry.ref, { ...diagnostics.get(entry.ref), ref: entry.ref, title: str(entry.title || entry.comment), constant: entry.constant === true,
    order: entry.order ?? 100, displayIndex: entry.displayIndex, placement: placementKey(entry), priorityRank: entryRank.get(entry) || 0,
    scanDepth: integer(entry.scanDepth, settings.scanDepth), caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords, reason, ...extra })
  const levels = [...new Set(entries.map(entry => integer(entry.delayUntilRecursion, 0)).filter(Boolean))].sort((a, b) => a - b)
  let level = 0, iteration = 0, budgetUsed = 0, budgetOverflowed = false
  // Each successful step consumes entries; delayed levels are finite as well.
  while (iteration <= entries.length + levels.length + 1) {
    const depthCache = new Map()
    const scanFor = entry => {
      const depth = integer(entry.scanDepth, settings.scanDepth)
      let cached = depthCache.get(depth)
      if (!cached) {
        const sources = !depth ? [] : [...messages.slice(0, depth), ...(injectedSource ? [injectedSource] : []), ...(iteration > 0 ? recurse : [])]
        const text = sources.map(source => source.text).filter(Boolean).join('\n\x01\n')
        cached = { sources, text, lowerText: text.toLocaleLowerCase(), meta: null }
        depthCache.set(depth, cached)
      }
      return cached
    }
    const textFor = entry => scanFor(entry).text
    const candidates = []
    for (const entry of entries) {
      if (rejected.has(entry.ref) || activatedRefs.has(entry.ref)) continue
      const requests = (input.activationRequests || []).filter(request => request.ref === entry.ref)
      if (requests.length) reject(entry, 'requested', { activationRequests: requests })
      const cooling = !alwaysOn(entry) && input.isCoolingDown(entry)
      // A screened-out entry comes back as soon as the player names it in this turn's input.
      const playerNamed = cooling === 'screened' && !input.userTextInHistory && currentUserText.trim() &&
        keywordEvaluation(entry, currentUserText, [{ text: currentUserText, lowerText: currentUserLower, source: 'current-input' }], currentUserLower).matched
      if (cooling && !playerNamed) { reject(entry, cooling === 'screened' ? 'screened-cooldown' : 'cooldown', { cooldown: { readTurn: input.chat?.worldBookReads?.[entry.ref]?.turn, currentTurn: input.turn, duration: 10 } }); continue }
      const delay = integer(entry.delayUntilRecursion, 0)
      if (delay && (!iteration || delay > level)) { reject(entry, 'recursion-delay'); continue }
      if (iteration && entry.excludeRecursion) { reject(entry, 'recursion-excluded'); continue }
      if (!alwaysOn(entry) && !requests.some(request => request.force)) {
        const scan = scanFor(entry)
        const match = keywordEvaluation(entry, scan.text, scan.sources, scan.lowerText)
        if (scan.meta === null) scan.meta = scan.sources.map(({ text, lowerText, ...source }) => ({ ...source, chars: text.length }))
        reject(entry, 'matched', { match, stage: iteration ? 'recursion' : 'initial', recursionLevel: level, scanSources: scan.meta })
        if (!match.matched) { reject(entry, 'keywords'); continue }
      }
      if (!alwaysOn(entry) && input.allowedRefs && !input.allowedRefs.has(entry.ref) && !input.protectedRefs?.has(entry.ref)) { reject(entry, 'semantic'); continue }
      candidates.push(entry)
    }
    const winners = filterGroups(candidates, activated, textFor, random, (entry, reason, extra) => {
      reject(entry, reason, extra)
      rejected.add(entry.ref)
    })
    const added = []
    for (const entry of winners) {
      const tokenCost = input.tokenCosts ? (input.tokenCosts[entry.ref] ?? 0) : (estimateWorldBookTokens(entry.content) + 2)
      const hardLimit = settings.tokenBudget * 2
      if (chargesBudget(entry) && !input.ignoreBudget && (budgetOverflowed || budgetUsed >= settings.tokenBudget || budgetUsed + tokenCost > hardLimit)) {
        reject(entry, 'budget', { tokenCost, budgetUsed, tokenBudget: settings.tokenBudget, hardLimit,
          budgetReason: budgetOverflowed ? 'stopped' : budgetUsed >= settings.tokenBudget ? 'soft-limit-reached' : 'hard-limit', overflowedEarlier: budgetOverflowed,
          selectedBefore: activated.filter(item => chargesBudget(item)).map(item => item.ref) })
        budgetOverflowed = true
        rejected.add(entry.ref)
        continue
      }
      activated.push(entry)
      activatedRefs.add(entry.ref)
      added.push(entry)
      if (chargesBudget(entry)) budgetUsed += tokenCost
      reject(entry, 'selected', { tokenCost: chargesBudget(entry) ? tokenCost : 0, budgetUsed, stage: iteration ? 'recursion' : 'initial', scanDepth: integer(entry.scanDepth, settings.scanDepth) })
    }
    if (!settings.recursive) break
    const sources = added.filter(entry => !entry.preventRecursion).map(entry => {
      const text = str(entry.content)
      return { text, lowerText: text.toLocaleLowerCase(), source: 'recursion', ref: entry.ref }
    }).filter(source => source.text)
    recurse.push(...sources)
    iteration++
    if (sources.length) continue
    const nextLevel = levels.find(value => value > level)
    if (nextLevel === undefined) break
    level = nextLevel
  }
  return { budget: { limit: settings.tokenBudget, hardLimit: settings.tokenBudget * 2, mode: 'soft', used: budgetUsed, overflowed: budgetOverflowed, estimator: 'unicode-estimate', scope: 'non-constant' }, entries: activated, diagnostics: [...diagnostics.values()], settings, scanSources: messages.map(({ text, ...source }) => ({ ...source, chars: text.length })) }
}
