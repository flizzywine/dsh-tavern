const READABLE_CARD_FIELDS = Object.freeze([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'system_prompt', 'post_history_instructions', 'creator_notes', 'tags', 'alternate_greetings'
])

function fieldText(value) {
  if (Array.isArray(value)) return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function cardFieldCatalog(card) {
  const source = card !== null && typeof card === 'object' ? card : {}
  return READABLE_CARD_FIELDS.map(function (field) {
    const text = fieldText(source[field])
    return { field, chars: text.length, empty: text.length === 0 }
  })
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
