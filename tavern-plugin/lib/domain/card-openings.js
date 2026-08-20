function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function cardOpeningChoices(card) {
  const source = card !== null && typeof card === 'object' ? card : {}
  const choices = []
  const defaultText = str(source.first_mes)
  if (defaultText.trim() !== '') choices.push({ id: 'default', text: defaultText })
  for (let index = 0; index < (Array.isArray(source.alternate_greetings) ? source.alternate_greetings.length : 0); index++) {
    const text = str(source.alternate_greetings[index])
    if (text.trim() !== '') choices.push({ id: 'alternate:' + index, text })
  }
  return choices
}

export function resolveCardOpening(card, openingId) {
  const source = card !== null && typeof card === 'object' ? card : {}
  if (openingId === undefined || openingId === null || openingId === '' || openingId === 'default') return str(source.first_mes)
  const match = /^alternate:(\d+)$/.exec(str(openingId))
  const index = match === null ? -1 : Number(match[1])
  const alternatives = Array.isArray(source.alternate_greetings) ? source.alternate_greetings : []
  if (!Number.isInteger(index) || index < 0 || index >= alternatives.length || str(alternatives[index]).trim() === '') {
    throw new Error('开场白选项不存在: ' + str(openingId))
  }
  return str(alternatives[index])
}
