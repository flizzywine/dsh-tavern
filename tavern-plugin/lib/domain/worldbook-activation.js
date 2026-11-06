// Selection priority and prompt order are different in SillyTavern.
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

function regexKey(value) {
  const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(str(value))
  if (!match) return null
  try {
    return new RegExp(match[1], match[2].replaceAll('g', '').replaceAll('y', ''))
  } catch (_error) {
    return null
  }
}

function literalMatch(text, key, entry) {
  const sensitive = entry.caseSensitive === true
  const source = sensitive ? text : text.toLocaleLowerCase()
  const needle = sensitive ? key : key.toLocaleLowerCase()
  if (needle === '') return false
  // Single Han aliases must stand alone; JS \W treats every Han character as a boundary.
  if (/^\p{Script=Han}$/u.test(needle)) return new RegExp('(?:^|[^\\p{L}\\p{N}\\p{M}_])' + needle + '(?=$|[^\\p{L}\\p{N}\\p{M}_])', 'u').test(source)
  if (entry.matchWholeWords !== true || needle.split(/\s+/).length > 1) return source.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(?:^|\\W)' + escaped + '(?:$|\\W)').test(source)
  } catch (_error) {
    return source.includes(needle)
  }
}

function keyMatch(text, value, entry) {
  const key = str(value).trim()
  if (key === '') return false
  const regex = regexKey(key)
  if (regex !== null) return regex.test(text)
  return literalMatch(text, key, entry)
}

function keywordEvaluation(entry, body, sources) {
  const keys = values => (Array.isArray(values) ? values : []).map(value => str(value).trim()).filter(Boolean)
  function hits(values) {
    return keys(values).filter(key => keyMatch(body, key, entry)).map(key => {
      const source = sources.find(source => keyMatch(source.text, key, entry))
      const text = source?.text || body
      const regex = regexKey(key)
      const index = regex ? (regex.exec(text)?.index ?? 0) : (entry.caseSensitive ? text : text.toLocaleLowerCase()).indexOf(entry.caseSensitive ? key : key.toLocaleLowerCase())
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

function scanMessages(input) {
  const messages = (input.chat?.messages || []).map((message, messageIndex) => ({ ...message, messageIndex }))
    .filter(message => ['user', 'assistant'].includes(message?.role))
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
  const messages = scanMessages(input)
  const injected = str(input.scanText)
  const random = input.random || Math.random
  const entries = priorityOrder(input.entries).map(entry => ({ ...entry,
    caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords
  }))
  const activated = [], recurse = [], diagnostics = new Map(), rejected = new Set()
  const reject = (entry, reason, extra = {}) => diagnostics.set(entry.ref, { ...diagnostics.get(entry.ref), ref: entry.ref, title: str(entry.title || entry.comment), constant: entry.constant === true,
    order: entry.order ?? 100, displayIndex: entry.displayIndex, placement: placementKey(entry), priorityRank: entries.indexOf(entry) + 1,
    scanDepth: integer(entry.scanDepth, settings.scanDepth), caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords, reason, ...extra })
  const levels = [...new Set(entries.map(entry => integer(entry.delayUntilRecursion, 0)).filter(Boolean))].sort((a, b) => a - b)
  let level = 0, iteration = 0, budgetUsed = 0, budgetOverflowed = false
  // Each successful step consumes entries; delayed levels are finite as well.
  while (iteration <= entries.length + levels.length + 1) {
    const sourcesFor = entry => {
      const depth = integer(entry.scanDepth, settings.scanDepth)
      if (!depth) return []
      return [...messages.slice(0, depth), ...(injected ? [{ text: injected, source: 'script' }] : []), ...(iteration > 0 ? recurse : [])]
    }
    const textFor = entry => sourcesFor(entry).map(source => source.text).filter(Boolean).join('\n\x01\n')
    const candidates = []
    for (const entry of entries) {
      if (rejected.has(entry.ref) || activated.some(item => item.ref === entry.ref)) continue
      const requests = (input.activationRequests || []).filter(request => request.ref === entry.ref)
      if (requests.length) reject(entry, 'requested', { activationRequests: requests })
      const cooling = !entry.constant && input.isCoolingDown(entry)
      // A screened-out entry comes back as soon as the player names it in this turn's input.
      const playerNamed = cooling === 'screened' && !input.userTextInHistory && str(input.userText).trim() &&
        keywordEvaluation(entry, str(input.userText), [{ text: str(input.userText), source: 'current-input' }]).matched
      if (cooling && !playerNamed) { reject(entry, cooling === 'screened' ? 'screened-cooldown' : 'cooldown', { cooldown: { readTurn: input.chat?.worldBookReads?.[entry.ref]?.turn, currentTurn: input.turn, duration: 10 } }); continue }
      const delay = integer(entry.delayUntilRecursion, 0)
      if (delay && (!iteration || delay > level)) { reject(entry, 'recursion-delay'); continue }
      if (iteration && entry.excludeRecursion) { reject(entry, 'recursion-excluded'); continue }
      if (!entry.constant && !requests.some(request => request.force)) {
        const match = keywordEvaluation(entry, textFor(entry), sourcesFor(entry))
        reject(entry, 'matched', { match, stage: iteration ? 'recursion' : 'initial', recursionLevel: level, scanSources: sourcesFor(entry).map(({ text, ...source }) => ({ ...source, chars: text.length })) })
        if (!match.matched) { reject(entry, 'keywords'); continue }
      }
      if (!entry.constant && input.allowedRefs && !input.allowedRefs.has(entry.ref) && !input.protectedRefs?.has(entry.ref)) { reject(entry, 'semantic'); continue }
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
      if (!entry.constant && !input.ignoreBudget && (budgetOverflowed || budgetUsed >= settings.tokenBudget || budgetUsed + tokenCost > hardLimit)) {
        reject(entry, 'budget', { tokenCost, budgetUsed, tokenBudget: settings.tokenBudget, hardLimit,
          budgetReason: budgetOverflowed ? 'stopped' : budgetUsed >= settings.tokenBudget ? 'soft-limit-reached' : 'hard-limit', overflowedEarlier: budgetOverflowed,
          selectedBefore: activated.filter(item => !item.constant).map(item => item.ref) })
        budgetOverflowed = true
        rejected.add(entry.ref)
        continue
      }
      activated.push(entry)
      added.push(entry)
      if (!entry.constant) budgetUsed += tokenCost
      reject(entry, 'selected', { tokenCost: entry.constant ? 0 : tokenCost, budgetUsed, stage: iteration ? 'recursion' : 'initial', scanDepth: integer(entry.scanDepth, settings.scanDepth) })
    }
    if (!settings.recursive) break
    const sources = added.filter(entry => !entry.preventRecursion).map(entry => ({ text: str(entry.content), source: 'recursion', ref: entry.ref })).filter(source => source.text)
    recurse.push(...sources)
    iteration++
    if (sources.length) continue
    const nextLevel = levels.find(value => value > level)
    if (nextLevel === undefined) break
    level = nextLevel
  }
  return { budget: { limit: settings.tokenBudget, hardLimit: settings.tokenBudget * 2, mode: 'soft', used: budgetUsed, overflowed: budgetOverflowed, estimator: 'unicode-estimate', scope: 'non-constant' }, entries: activated, diagnostics: [...diagnostics.values()], settings, scanSources: messages.map(({ text, ...source }) => ({ ...source, chars: text.length })) }
}
