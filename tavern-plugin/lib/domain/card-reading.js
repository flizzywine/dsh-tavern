const READABLE_CARD_FIELDS = Object.freeze([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'system_prompt', 'post_history_instructions', 'creator_notes', 'tags', 'alternate_greetings'
])

function fieldText(value) {
  if (Array.isArray(value)) return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function readCardField(card, request = {}) {
  const field = typeof request.field === 'string' ? request.field : ''
  if (!READABLE_CARD_FIELDS.includes(field)) throw new Error('不支持的人物卡字段: ' + field)
  const source = card !== null && typeof card === 'object' ? card : {}
  const text = fieldText(source[field])
  const offset = Number.isInteger(request.offset) && request.offset > 0 ? request.offset : 1
  const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit, 12000)) : 6000
  const start = Math.min(offset - 1, text.length)
  const chunk = text.slice(start, start + limit)
  return {
    field,
    text: chunk,
    totalChars: text.length,
    from: chunk.length > 0 ? start + 1 : 0,
    to: chunk.length > 0 ? start + chunk.length : 0,
    done: start + chunk.length >= text.length
  }
}

export { READABLE_CARD_FIELDS }

const SEARCH_CONTEXT = 60
const SEARCH_LIMIT = 30

function pointerToken(key) { return String(key).replace(/~/g, '~0').replace(/\//g, '~1') }

function searchLabel(chain) {
  for (let index = chain.length - 1; index >= 0; index--) {
    const { pointer, value } = chain[index]
    const book = /\/character_book\/entries\/([^/]+)$/.exec(pointer)
    if (book) return '世界书 entry:' + book[1] + (value.comment || value.name ? '「' + str(value.comment || value.name) + '」' : '')
    if (/\/regex_scripts\/[^/]+$/.test(pointer)) return '正则「' + str(value.scriptName || value.id) + '」'
    if (/\/scripts\/[^/]+$/.test(pointer) || /TavernHelper_scripts\/[^/]+$/.test(pointer)) return '脚本「' + str(value.name || value.value?.name || value.id) + '」'
    if (/\/alternate_greetings$/.test(pointer)) return '备用开场'
  }
  return ''
}

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

/** Locate text anywhere in a card's raw data so edits start from exact positions. */
export function searchCardRaw(raw, request = {}) {
  const query = str(request.query)
  if (query.trim() === '') throw new Error('搜索内容不能为空')
  let pattern
  try { pattern = new RegExp(request.regex === true ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') }
  catch (error) { throw new Error('正则无效: ' + error.message) }
  const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit, 100)) : SEARCH_LIMIT
  // V2/V3 mirror standard fields at the root; data is the copy edits target.
  const root = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? { value: raw.data, pointer: '/data' } : { value: raw, pointer: '' }
  const hits = []
  let total = 0, occurrences = 0
  function visit(value, pointer, chain) {
    if (typeof value === 'string') {
      const matches = [...value.matchAll(pattern)]
      if (matches.length === 0) return
      total += 1
      occurrences += matches.length
      if (hits.length >= limit) return
      const snippets = []
      let covered = 0
      for (const match of matches) {
        if (snippets.length >= 3) break
        if (match.index + match[0].length <= covered) continue
        const start = Math.max(covered, match.index - SEARCH_CONTEXT), end = Math.min(value.length, match.index + match[0].length + SEARCH_CONTEXT)
        snippets.push((start > 0 ? '…' : '') + value.slice(start, end) + (end < value.length ? '…' : ''))
        covered = end
      }
      hits.push({ pointer, label: searchLabel(chain), count: matches.length, chars: value.length, snippets })
      return
    }
    if (value === null || typeof value !== 'object') return
    const next = chain.concat([{ pointer, value }])
    for (const key of Object.keys(value)) visit(value[key], pointer + '/' + pointerToken(key), next)
  }
  visit(root.value, root.pointer, [])
  return { query, total, occurrences, truncated: total > hits.length, hits }
}
