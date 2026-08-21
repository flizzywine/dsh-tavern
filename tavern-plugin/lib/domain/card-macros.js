export function projectCardText(text) {
  return text.replace(/\{\{([\s\S]*?)\}\}/g, function (_group, body) {
    const macro = body.trim()
    return macro.includes('::') ? '' : macro
  })
}

function projectValue(value) {
  if (typeof value === 'string') return projectCardText(value)
  if (Array.isArray(value)) return value.map(projectValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(function (entry) {
    return [entry[0], projectValue(entry[1])]
  }))
}

export function projectCardMacros(card) {
  return projectValue(card)
}
