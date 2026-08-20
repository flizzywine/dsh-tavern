function removeHtmlBlocks(text) {
  const tagPattern = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi
  const stack = []
  const ranges = []
  let match
  while ((match = tagPattern.exec(text)) !== null) {
    if (match[0].startsWith('<!--')) {
      ranges.push([match.index, tagPattern.lastIndex])
      continue
    }
    const closing = /^<\//.test(match[0])
    const standalone = /\/\s*>$/.test(match[0]) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(match[1])
    if (!closing && !standalone) {
      stack.push({ name: match[1].toLowerCase(), start: match.index })
      continue
    }
    if (!closing) {
      ranges.push([match.index, tagPattern.lastIndex])
      continue
    }
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].name !== match[1].toLowerCase()) continue
      const opening = stack[index]
      stack.length = index
      ranges.push([opening.start, tagPattern.lastIndex])
      break
    }
  }
  ranges.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1] })
  let result = ''
  let cursor = 0
  for (const range of ranges) {
    if (range[0] < cursor) {
      if (range[1] > cursor) cursor = range[1]
      continue
    }
    result += text.slice(cursor, range[0])
    cursor = range[1]
  }
  return (result + text.slice(cursor)).replace(/<\/?[a-z][^>]*>/gi, '')
}

function cleanText(text, characterName) {
  return removeHtmlBlocks(text).replace(/\{\{([\s\S]*?)\}\}/g, function (_group, body) {
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
