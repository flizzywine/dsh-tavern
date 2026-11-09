import { createHash } from 'node:crypto'
import { cardOpeningSwipes } from './card-openings.js'
import { nativeOpeningMessageId } from './native-opening.js'
import { sessionEvents } from './session-events.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { isNewTurnInput } from './session-turn-input.js'

/** Only an untouched greeting may switch openings. */
export function sessionOpeningDescriptor(chat, card) {
  const messages = chat?.messages || []
  if (!['story', 'script'].includes(chat?.mode) || messages.length !== 1 || messages[0]?.greeting !== true) return null
  if (chat.regenInProgress || Object.values(chat.timeline?.operations || {}).some(op => op.status === 'running')) return null
  const { swipes, openingIds } = cardOpeningSwipes(card)
  const text = messages[0].sourceText ?? messages[0].text
  const selectedIndex = messages[0].openingChoiceId
    ? openingIds.indexOf(messages[0].openingChoiceId) : swipes.indexOf(text)
  if (selectedIndex < 0 || !openingIds[selectedIndex] || openingIds.filter(Boolean).length < 2) return null
  // Card/Helper reloads can change the script lifecycle while the opening stays intact.
  const version = createHash('sha256').update(JSON.stringify([
    chat.id, messages[0].openingSelectionRevision, text, selectedIndex, openingIds, swipes
  ])).digest('hex')
  return { swipes, selectedIndex, characterName: card.name, openingIds, version }
}

export function selectSessionOpening({ chat, card, swipeId, message, expectedOpeningVersion }) {
  const descriptor = sessionOpeningDescriptor(chat, card)
  if (!descriptor) throw new Error('已有剧情的对话不能切换开场，请新开游戏')
  if (expectedOpeningVersion !== undefined && expectedOpeningVersion !== descriptor.version) {
    throw new Error('开场白已变化，请重新选择')
  }
  if (!Number.isInteger(swipeId) || !descriptor.openingIds[swipeId] ||
      (message !== undefined && descriptor.swipes[swipeId] !== message)) throw new Error('只能选择人物卡已有开场')
  return { id: descriptor.openingIds[swipeId], text: descriptor.swipes[swipeId], current: descriptor.selectedIndex === swipeId }
}

export function assertOpeningIdle({ session, agent }) {
  if (agent?.phase?.kind === 'running' || sessionEvents(session).some(event =>
    isNewTurnInput(event) ||
    (event.type === 'user/message' && event.data?.source?.kind === 'human' && event.surfaceOp === 'append') ||
    (event.type === 'assistant/message' && event.data?.turn > 1 && event.surfaceOp === 'append'))) {
    throw new Error('首轮已开始，请新开游戏切换开场')
  }
}

function textOf(message) {
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('')
}

// Select the current surface event, including the most recent replacement.
// Old saves used a UUID for the original turn-one greeting.
export function findSessionOpening(session, chat) {
  const nodes = new Set(session.surface?.nodes)
  const id = nativeOpeningMessageId(chat.id)
  const events = sessionEvents(session).filter(event => nodes.has(event.seq) && event.type === 'assistant/message')
  return events.find(event => event.data.message.id === id) || events.find(event => {
    const message = event.data.message
    if (chat.nativeOpeningSwitch) return message.id === chat.nativeOpeningSwitch.messageId
    return event.data.turn === 1 && event.data.step === 1 &&
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(message.id) && textOf(message) === (chat.openingText ?? chat.messages?.[0]?.text)
  })
}

export function replaceSessionOpening(session, chat) {
  const opening = findSessionOpening(session, chat)
  if (!opening) throw new Error('找不到本局开场白的原生消息')
  const { message } = opening.data
  if (textOf(message) === chat.openingText) return
  replaceSessionSurface(session, 'assistant/message', {
    turn: opening.data.turn,
    step: opening.data.step,
    message: { ...message, id: nativeOpeningMessageId(chat.id), content: [{ type: 'text', text: chat.openingText }] }
  }, { start: opening.seq, end: opening.seq, sourceEventSeqs: [opening.seq] })
}

/** Rename authored player slots in the frozen opening, leaving other macro output alone. */
export function renameOpeningPlayerSlots(row, { previousName, playerName, charName }) {
  if (!row?.greeting || typeof row.sourceText !== 'string' || typeof row.projectionText !== 'string') return null
  const segments = [['']]
  const tokens = row.sourceText.split(/(\{\{[^{}]*\}\}|<(?:user|char)>)/gi)
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index], parts = segments.at(-1)
    if (index % 2 === 0) {
      if (/\{\{|\}\}/.test(text)) return null
      parts[parts.length - 1] += text
    } else if (/^(?:\{\{\s*user\s*\}\}|<user>)$/i.test(text)) parts.push('')
    else if (/^(?:\{\{\s*char\s*\}\}|<char>)$/i.test(text)) parts[parts.length - 1] += charName
    else segments.push([''])
  }
  if (!segments.some(parts => parts.length > 1)) return null
  const value = row.projectionText
  if (segments.length === 1) {
    // Infer the name actually rendered, including saves renamed by older versions.
    const parts = segments[0]
    const length = (value.length - parts.join('').length) / (parts.length - 1)
    if (!Number.isInteger(length) || length < 1) return null
    const renderedName = value.slice(parts[0].length, parts[0].length + length)
    return parts.join(renderedName) === value ? parts.join(playerName) : null
  }
  // Stateful and random macros separate literal runs. Only rewrite a run when
  // its earliest and latest possible positions agree in the saved projection.
  const chunks = segments.map(parts => parts.join(previousName))
  const end = value.length - chunks.at(-1).length
  if (!value.startsWith(chunks[0]) || !value.endsWith(chunks.at(-1))) return null
  const positions = [0]
  let cursor = chunks[0].length
  for (const chunk of chunks.slice(1, -1)) {
    const at = value.indexOf(chunk, cursor)
    if (at < 0 || at + chunk.length > end) return null
    positions.push(at)
    cursor = at + chunk.length
  }
  if (cursor > end) return null
  positions.push(end)
  cursor = end
  for (let index = chunks.length - 2; index > 0; index--) {
    cursor = value.lastIndexOf(chunks[index], cursor - chunks[index].length)
    if (cursor < positions[index] || (segments[index].length > 1 && cursor !== positions[index])) return null
  }
  let renamed = ''
  cursor = 0
  for (const [index, parts] of segments.entries()) {
    if (parts.length === 1) continue
    renamed += value.slice(cursor, positions[index]) + parts.join(playerName)
    cursor = positions[index] + chunks[index].length
  }
  return renamed + value.slice(cursor)
}

// The host captures pre-step input before Tavern's hook can finish a pending
// switch. Keep the captured request aligned with the live opening replacement.
export function projectSessionOpening(session, chat, decision) {
  if (!chat || !['story', 'script'].includes(chat.mode)) return decision
  const id = nativeOpeningMessageId(chat.id)
  const index = decision.messages?.findIndex(message => message.id === id ||
    (message.source?.provider === 'dsh-tavern' && message.source?.model === 'character-card'))
  if (!(index >= 0)) return decision
  const nodes = session.surface?.nodes
  if (!nodes?.length) return decision
  const read = typeof session.eventAt === 'function' ? seq => session.eventAt(seq) : (() => {
    const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
    return seq => events.get(seq)
  })()
  let opening
  for (const seq of nodes) {
    const event = read(seq)
    if (event?.type !== 'assistant/message' || event.data?.message?.id !== id) continue
    opening = event
    break
  }
  if (opening?.surfaceOp?.op !== 'replace' || opening.data.message.source?.model !== 'character-card') return decision
  const messages = decision.messages.slice()
  messages[index] = opening.data.message
  return { ...decision, messages }
}
