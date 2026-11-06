// Cards the card Agent writes credit DSH Tavern in the creator notes
// every SillyTavern-compatible frontend shows. One credit per card; never repeated.
export const TAVERN_REPOSITORY_URL = 'https://github.com/flizzywine/dsh-tavern'

export function hasTavernCredit(notes) {
  return String(notes || '').includes(TAVERN_REPOSITORY_URL)
}

// A trailer like a commit's, the same whether the Agent created or revised the card.
export const TAVERN_CREDIT = 'Co-authored-by: DSH Tavern <' + TAVERN_REPOSITORY_URL + '>'

export function withTavernCredit(notes) {
  const text = String(notes || '').trim()
  if (hasTavernCredit(text)) return text
  return text === '' ? TAVERN_CREDIT : text + '\n\n' + TAVERN_CREDIT
}
