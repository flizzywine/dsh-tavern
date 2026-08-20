function cleanText(text, characterName) {
  return text.replace(/\{\{([\s\S]*?)\}\}/g, function (_group, body) {
    const macro = body.trim().toLowerCase()
    if (macro === 'char') return characterName
    if (macro === 'user') return '玩家'
    return ''
  })
}

function cleanValue(value, characterName) {
  if (typeof value === 'string') return cleanText(value, characterName)
  if (Array.isArray(value)) return value.map(function (item) { return cleanValue(item, characterName) })
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(function (entry) {
    return [entry[0], cleanValue(entry[1], characterName)]
  }))
}

export function cleanWorkspaceCardMacros(card) {
  const rawName = card !== null && typeof card === 'object' && typeof card.name === 'string' ? card.name : ''
  const characterName = cleanText(rawName, '').trim() || '角色'
  return cleanValue(card, characterName)
}
