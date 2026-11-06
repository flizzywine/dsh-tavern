import { searchCardRaw } from './card-reading.js'

const TEXT_FIELDS = new Set(['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'])
const LIST_FIELDS = new Set(['tags', 'alternate_greetings'])
const ENTRY_TEXT = { content: 'content', comment: 'comment' }
const ENTRY_LISTS = { keys: 'primaryKeys', secondary_keys: 'secondaryKeys' }

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }
function unescapeToken(token) { return token.replace(/~1/g, '/').replace(/~0/g, '~') }
function at(root, tokens) { return tokens.reduce((value, token) => value === null || value === undefined ? undefined : value[token], root) }

function selected(pointer, pointers) {
  return !pointers.length || pointers.some(item => pointer === item || pointer.startsWith(item.replace(/\/$/, '') + '/'))
}

/**
 * Plan a text replacement across a card as ordinary Tavern saves: standard
 * fields, embedded worldbook entry patches and raw operations for the rest.
 */
export function planCardTextReplace(raw, request = {}) {
  const find = str(request.find)
  const replacement = str(request.replace)
  const regex = request.regex === true
  const pointers = (Array.isArray(request.pointers) ? request.pointers : []).map(str).filter(Boolean)
  const search = searchCardRaw(raw, { query: find, regex, limit: 100000 })
  const pattern = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const swap = text => regex ? text.replace(pattern, replacement) : text.replace(pattern, () => replacement)
  const base = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? '/data' : ''
  const root = base ? raw.data : raw
  const fields = {}, rawOperations = [], entries = new Map(), locations = [], skipped = []
  for (const hit of search.hits) {
    if (!selected(hit.pointer, pointers)) continue
    const tokens = hit.pointer.slice(base.length).split('/').slice(1).map(unescapeToken)
    const [head] = tokens
    const location = { pointer: hit.pointer, label: hit.label, count: hit.count }
    if (TEXT_FIELDS.has(head) && tokens.length === 1) fields[head] = swap(str(root[head]))
    else if (LIST_FIELDS.has(head) && tokens.length === 2) fields[head] = (fields[head] || root[head].map(str)).map((item, index) => String(index) === tokens[1] ? swap(item) : item)
    else if (head === 'character_book' && tokens[1] === 'entries' && tokens.length >= 4) {
      const ref = 'entry:' + tokens[2], entry = at(root, tokens.slice(0, 3))
      const patch = entries.get(ref) || {}
      if (ENTRY_TEXT[tokens[3]] && tokens.length === 4) patch[ENTRY_TEXT[tokens[3]]] = swap(str(entry[tokens[3]]))
      else if (ENTRY_LISTS[tokens[3]] && tokens.length === 5) patch[ENTRY_LISTS[tokens[3]]] = (patch[ENTRY_LISTS[tokens[3]]] || entry[tokens[3]].map(str)).map((item, index) => String(index) === tokens[4] ? swap(item) : item)
      else { skipped.push(location); continue }
      entries.set(ref, patch)
    } else if (head === 'character_book') { skipped.push(location); continue }
    else rawOperations.push({ op: 'set', path: hit.pointer, value: swap(str(at(root, tokens))) })
    locations.push(location)
  }
  const occurrences = locations.reduce((total, item) => total + item.count, 0)
  return { fields, rawOperations, worldbook: [...entries].map(([ref, patch]) => ({ op: 'update', ref, patch })), locations, skipped, occurrences }
}
