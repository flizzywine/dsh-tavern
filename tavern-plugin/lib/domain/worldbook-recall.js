import { lastTavernHelperVariables } from './tavern-helper-context.js'

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

function allEntries(worldBook) {
  const view = worldBook && worldBook.view
  return view !== null && typeof view === 'object' && Array.isArray(view.entries) ? view.entries.filter(Boolean) : []
}

export function isWorldBookTemplateEntry(entry) {
  return /<%[=_-]?[\s\S]*?%>/i.test(str(entry && entry.content))
}

function templateBody(value) {
  const lines = str(value).replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length && /^@@\S*/.test(lines[index].trim())) index += 1
  return lines.slice(index).join('\n')
}

function templateResource(entry, book) {
  return {
    id: str(entry.sourceUid ?? entry.ref),
    name: str(entry.title || entry.comment),
    comment: str(entry.comment || entry.title),
    book: str(book),
    content: str(entry.content)
  }
}

function transcriptOf(chat) {
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).filter(Boolean).map(function (message) {
    return {
      role: message.role === 'user' ? 'user' : 'assistant',
      content: str(message.sourceText || message.text)
    }
  })
}

export function isMvuUpdateEntry(entry) {
  return /^\s*\[mvu_update\]/i.test(str(entry && (entry.comment || entry.title || entry.name)))
}

export function mvuUpdateRulesFromWorldBook(worldBook) {
  return enabledEntries(worldBook).filter(isMvuUpdateEntry).map(function (entry) {
    return str(entry.content).trim()
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
  const entries = tavernOrder(enabledEntries(input.worldBook).filter(function (entry) {
    return entry.constant === true && !isMvuUpdateEntry(entry) && !isWorldBookTemplateEntry(entry)
  }))
  return {
    context: entries.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: entries.map(function (entry) { return str(entry.ref) }),
    count: entries.length,
    totalChars: entries.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  }
}

/** Resolve enabled constant EJS controllers for one native DSH foreground turn.
 * Disabled entries remain addressable by getwi(), but never activate themselves.
 * Scope mutations stay inside this read-only projection and cannot change Chat state.
 */
export function projectWorldBookTemplates(input = {}) {
  const runtime = input.runtime
  if (!runtime || typeof runtime.render !== 'function') throw new Error('缺少世界书模板运行时')
  const resources = allEntries(input.worldBook)
  const controllers = tavernOrder(resources.filter(function (entry) {
    return entry.enabled !== false && entry.constant === true && !isMvuUpdateEntry(entry) && isWorldBookTemplateEntry(entry)
  }))
  let scopes = {
    global: clone(input.globalVariables || {}),
    initial: clone(input.chat && input.chat.promptTemplateInitialVariables || {}),
    local: clone(input.chat && input.chat.variables || {}),
    message: lastTavernHelperVariables(input.chat && input.chat.messages) || {}
  }
  const context = []
  const refs = []
  const diagnostics = []
  const templateContext = {
    charName: str(input.card && input.card.name),
    userName: str(input.chat && input.chat.macroState && input.chat.macroState.userName) || '你',
    runType: 'generate',
    generateType: str(input.generateType),
    transcript: transcriptOf(input.chat),
    worldBookEntries: resources.map(function (entry) {
      return templateResource(entry, input.worldBook && input.worldBook.view && input.worldBook.view.displayName)
    })
  }
  for (const entry of controllers) {
    const result = runtime.render(templateBody(entry.content), Object.assign({}, templateContext, { scopes }))
    if (!result.ok) {
      diagnostics.push({ kind: 'worldbook-template', code: result.kind, ref: str(entry.ref) })
      continue
    }
    scopes = clone(result.scopes)
    const text = str(result.text).trim()
    if (text === '') continue
    context.push(text)
    refs.push(str(entry.ref))
  }
  return {
    context: context.join('\n\n'),
    refs,
    diagnostics,
    evaluated: controllers.length
  }
}

/** Deterministically activate at most three non-constant entries for the next foreground turn. */
export function prepareWorldBookRecall(input = {}) {
  const all = enabledEntries(input.worldBook).filter(function (entry) { return !isMvuUpdateEntry(entry) })
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
