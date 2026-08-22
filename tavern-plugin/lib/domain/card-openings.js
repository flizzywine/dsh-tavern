function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function cardOpeningChoices(card) {
  const source = card !== null && typeof card === 'object' ? card : {}
  const choices = []
  const primary = str(source.first_mes)
  if (primary.trim() !== '') choices.push({ id: 'primary', text: primary })
  const alternatives = Array.isArray(source.alternate_greetings) ? source.alternate_greetings : []
  for (let index = 0; index < alternatives.length; index += 1) {
    const alternative = alternatives[index]
    const text = str(alternative)
    if (text.trim() !== '') choices.push({ id: 'alternate:' + index, text })
  }
  return choices
}

export function resolveCardOpening(card, openingId) {
  const choices = cardOpeningChoices(card)
  const requested = str(openingId)
  if (requested === '') return choices.length > 0 ? choices[0].text : ''
  const selected = choices.find(function (choice) { return choice.id === requested })
  if (selected === undefined) throw new Error('人物卡开场白不存在: ' + requested)
  return selected.text
}
