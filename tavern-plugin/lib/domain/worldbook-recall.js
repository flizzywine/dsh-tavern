const DYNAMIC_ENTRY_LIMIT = 3
const READ_COOLDOWN_TURNS = 10

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function charCount(value) {
  return Array.from(str(value).trim()).length
}

function fingerprint(value) {
  const text = str(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return text.length.toString(36) + ':' + (hash >>> 0).toString(36)
}

function enabledEntries(worldBook) {
  const view = worldBook && worldBook.view
  if (view === null || typeof view !== 'object') return []
  return (Array.isArray(view.entries) ? view.entries : []).filter(function (entry) {
    return entry && entry.enabled !== false && str(entry.content).trim() !== ''
  })
}

function tavernOrder(entries) {
  return entries.map(function (entry, index) { return { entry, index } }).sort(function (left, right) {
    const order = (Number(right.entry.order) || 0) - (Number(left.entry.order) || 0)
    if (order !== 0) return order
    const display = (Number(left.entry.displayIndex) || 0) - (Number(right.entry.displayIndex) || 0)
    return display !== 0 ? display : left.index - right.index
  }).map(function (item) { return item.entry })
}

function latestBody(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const text = (str(message.sourceText) || str(message.text)).trim()
    if (text !== '') return text
  }
  return ''
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
  if (entry.matchWholeWords !== true) return source.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'u').test(source)
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

function keywordMatch(entry, body) {
  const primary = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []).filter(function (key) { return str(key).trim() !== '' })
  if (primary.length === 0 || !primary.some(function (key) { return keyMatch(body, key, entry) })) return false
  const secondary = (Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []).filter(function (key) { return str(key).trim() !== '' })
  if (entry.selective !== true || secondary.length === 0) return true
  const matches = secondary.map(function (key) { return keyMatch(body, key, entry) })
  switch (Number(entry.selectiveLogic) || 0) {
    case 1: return !matches.every(Boolean)
    case 2: return !matches.some(Boolean)
    case 3: return matches.every(Boolean)
    default: return matches.some(Boolean)
  }
}

function readRecord(chat, entry) {
  const reads = chat && chat.worldBookReads
  if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) return null
  const record = reads[str(entry && entry.ref)]
  return record !== null && typeof record === 'object' && !Array.isArray(record) ? record : null
}

function isCoolingDown(chat, entry, turn) {
  const record = readRecord(chat, entry)
  if (record === null || str(record.fingerprint) !== fingerprint(entry && entry.content)) return false
  const readTurn = Number(record.turn)
  const currentTurn = Number(turn)
  if (!Number.isSafeInteger(readTurn) || !Number.isSafeInteger(currentTurn)) return false
  const elapsed = currentTurn - readTurn
  return elapsed > 0 && elapsed <= READ_COOLDOWN_TURNS
}

function readRecorder(entries, turn) {
  return function recordReads(existing) {
    const next = clone(existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? existing : {})
    for (const entry of entries) {
      next[str(entry.ref)] = { turn: Number(turn) || 0, fingerprint: fingerprint(entry.content) }
    }
    return next
  }
}

/** Constant Tavern entries are part of the stable play prefix and never enter cooldown. */
export function constantWorldBookContext(input = {}) {
  const entries = tavernOrder(enabledEntries(input.worldBook).filter(function (entry) { return entry.constant === true }))
  return {
    context: entries.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: entries.map(function (entry) { return str(entry.ref) }),
    count: entries.length,
    totalChars: entries.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  }
}

/** Deterministically activate at most three non-constant entries for the next foreground turn. */
export function prepareWorldBookRecall(input = {}) {
  const all = enabledEntries(input.worldBook)
  const emptyRecorder = readRecorder([], input.turn)
  if (!input.worldBook || !input.worldBook.view) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'unbound', recordReads: emptyRecorder }
  }
  if (all.length === 0) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'empty', recordReads: emptyRecorder }
  }
  const totalChars = all.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  const body = str(input.latestBody) || latestBody(input.chat)
  const selected = tavernOrder(all.filter(function (entry) {
    return entry.constant !== true && !isCoolingDown(input.chat, entry, input.turn) && keywordMatch(entry, body)
  })).slice(0, DYNAMIC_ENTRY_LIMIT)
  return {
    kind: 'keywords',
    context: selected.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: selected.map(function (entry) { return str(entry.ref) }),
    totalChars,
    matchedCount: selected.length,
    recordReads: readRecorder(selected, input.turn)
  }
}
