import { cardOpeningSwipes } from './card-openings.js'

/** Only an untouched greeting may hand off to a new native play session. */
export function sessionOpeningDescriptor(chat, card) {
  const messages = chat?.messages || []
  if (!['story', 'script'].includes(chat?.mode) || messages.length !== 1 || messages[0]?.greeting !== true) return null
  if (Object.values(chat.timeline?.operations || {}).some(op => op.status === 'running')) return null
  const { swipes, openingIds } = cardOpeningSwipes(card)
  const text = messages[0].sourceText ?? messages[0].text
  const selectedIndex = swipes.indexOf(text)
  if (selectedIndex < 0) return null
  return { swipes, selectedIndex, characterName: card.name, openingIds }
}

export async function prepareSessionOpening({ chat, card, swipeId, message, preparation }) {
  const descriptor = sessionOpeningDescriptor(chat, card)
  if (!descriptor) throw new Error('已有剧情的对话不能切换开场，请新开游戏')
  if (!Number.isInteger(swipeId) || !descriptor.openingIds[swipeId] || descriptor.swipes[swipeId] !== message) throw new Error('只能选择人物卡已有开场')
  const draft = await preparation.create(chat.cardPath, { sourceChat: chat })
  const openingId = descriptor.openingIds[swipeId]
  preparation.select(draft.id, openingId)
  return { card: { path: chat.cardPath, name: card.name }, targetMode: chat.mode,
    preparationId: draft.id, openingId, userName: chat.macroState?.userName || '你', requestMode: chat.requestMode || 'dsh' }
}
