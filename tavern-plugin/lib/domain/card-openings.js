function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function resolveCardOpening(card) {
  const source = card !== null && typeof card === 'object' ? card : {}
  const primary = str(source.first_mes)
  if (primary.trim() !== '') return primary
  const alternatives = Array.isArray(source.alternate_greetings) ? source.alternate_greetings : []
  for (const alternative of alternatives) {
    const text = str(alternative)
    if (text.trim() !== '') return text
  }
  return ''
}
