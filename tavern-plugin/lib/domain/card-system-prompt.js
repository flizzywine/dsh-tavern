import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { sessionStablePrefixSections } from './session-stable-prefix.js'
import { isProducerSource } from './message-source.js'

export const CARD_SYSTEM_PROMPT_SECTION = 'tavern:card-system-prompt'
const MARKER = '【人物卡系统提示】'

export function cardSystemPromptText(text) {
  text = String(text || '').trim()
  return text ? MARKER + '\n' + text : ''
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
  const live = liveContextUpdate(session, 'cardSystemPromptSnapshot', pendingMessages)
  const previousText = live ? live.text : fixed?.text.startsWith(MARKER + '\n') ? fixed.text.slice(MARKER.length + 1).trim() : ''
  if (previousText === text) return null
  const version = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const rendered = `【人物卡系统指令更新 · ${version}】\n以下是当前完整版本，替代开局人物卡系统提示及此前所有人物卡系统指令更新；仅用于正文与候选文本的写作，后台任务仍遵循本轮任务协议。\n${text || '当前人物卡系统指令为空，此前人物卡系统指令全部失效。'}`
  return { schemaVersion: 1, text, version, rendered }
}

export function cardSystemPromptSource(snapshot) {
  return snapshot ? { cardSystemPromptSnapshot: snapshot } : {}
}
