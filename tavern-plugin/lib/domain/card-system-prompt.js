import { promptSection, promptSectionBody } from './prompt-section.js'
import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { sessionStablePrefixSections } from './session-stable-prefix.js'
import { isProducerSource } from './message-source.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "The card system prompt is now empty; all earlier card system prompts are void.",
  p002: (value0, value1) => `Card system prompt update · ${value0}\nThis is the complete current version. It replaces the opening card system prompt and all earlier updates, and applies only to writing story and choice text; background tasks still follow this turn's task protocol.\n${value1}`
})


export const CARD_SYSTEM_PROMPT_SECTION = 'tavern:card-system-prompt'
const MARKER = '【人物卡系统提示】'

export function cardSystemPromptText(text) {
  text = String(text || '').trim()
  return text ? promptSection('card_system', text) : ''
}

/**
 * The latest update of one kind (`field` of a Tavern message's trace) the model still sees, or null: an update that
 * was rewound or compacted away must be resent.
 */
export function liveContextUpdate(session, field, pendingMessages = []) {
  const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
  const messages = (session?.surface?.nodes || []).map(seq => events.get(seq))
    .filter(event => event?.type === 'user/message').map(event => event.data).concat(pendingMessages)
  let live = null
  for (const message of messages) {
    const record = message?.source?.trace?.[field]
    if (!isProducerSource(message?.source, 'dsh-tavern') || record?.schemaVersion !== 1) continue
    const content = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('')
    if (typeof record.rendered === 'string' && content.includes(record.rendered)) live = record
  }
  return live
}

/** Compare the live model context: a rewound or compacted update must be resent. */
export function cardSystemPromptSnapshot(session, text, pendingMessages = [], openingText = '') {
  text = String(text || '').trim()
  const fixed = sessionStablePrefixSections(session, openingText).find(section => section.name === CARD_SYSTEM_PROMPT_SECTION)
  const fixedText = promptSectionBody('card_system', fixed?.text || '')
  let previousText = fixed?.text.startsWith('<card_system>\n') ? fixedText.trim() : fixedText.startsWith(MARKER + '\n') ? fixedText.slice(MARKER.length + 1).trim() : ''
  const live = liveContextUpdate(session, 'cardSystemPromptSnapshot', pendingMessages)
  if (live) previousText = live.text
  if (previousText === text) return null
  const version = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const rendered = promptSection('card_system_update', PROMPT_PROSE.p002(version, text || PROMPT_PROSE.p001))
  return { schemaVersion: 1, text, version, rendered }
}

export function cardSystemPromptSource(snapshot) {
  return snapshot ? { cardSystemPromptSnapshot: snapshot } : {}
}
