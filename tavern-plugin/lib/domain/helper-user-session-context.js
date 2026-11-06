import { sessionEvents } from './session-events.js'
import { producerSource } from './message-source.js'

/** Publish script-created user text without starting a turn or rewriting history. */
export function appendHelperUserSessionContext(session, chat, targets) {
  if (!session || typeof session.append !== 'function') throw new Error('无法访问人物卡消息所属的原生会话')
  const existing = new Set(sessionEvents(session).filter(event => event.type === 'user/message').map(event => event.data?.id))
  let appended = 0
  for (const target of targets) {
    const message = chat.messages[target.messageId]
    if (message?.role !== 'tavern-helper' || message.tavernRole !== 'user' || message.tavernHidden === true) continue
    const id = `tavern-helper-user:${chat.id}:${target.messageId}`
    if (existing.has(id)) continue
    session.append('user/message', {
      id, role: 'user', content: [{ type: 'text', text: String(message.sourceText || message.text || '') }],
      source: producerSource('dsh-tavern-helper', { chatId: chat.id, messageId: target.messageId })
    }, { surfaceOp: 'append' })
    existing.add(id)
    appended += 1
  }
  return appended
}
