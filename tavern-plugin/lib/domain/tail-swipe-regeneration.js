import { randomUUID } from 'node:crypto'
import { locateRegenerationSurface } from './rollback-surface.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function eventAt(events, seq) {
  const direct = events[seq]
  if (direct && Number(direct.seq) === Number(seq)) return direct
  return events.find(function (event) { return event && Number(event.seq) === Number(seq) }) || null
}

/** Resolve the only mutable story position: the final assistant reply. */
export function selectedTailSwipe(chat, requested = {}) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const messageId = messages.length - 1
  const message = messages[messageId]
  const user = messages[messageId - 1] || null
  if (!message || message.role !== 'assistant') {
    throw new Error('只有最后一条正文可以切换 Swipe')
  }
  if (requested.messageId !== undefined && Number(requested.messageId) !== messageId) {
    throw new Error('只有最后一条正文可以切换 Swipe')
  }
  const swipes = Array.isArray(message.swipes) && message.swipes.length > 0
    ? message.swipes
    : [str(message.sourceText || message.text)]
  const swipeId = requested.swipeId === undefined
    ? Math.max(0, Number(message.swipeId) || 0)
    : Number(requested.swipeId)
  if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= swipes.length) throw new Error('Swipe 不存在')
  const text = str(message.sessionText ?? message.text).trim()
  if (text === '') throw new Error('当前 Swipe 正文为空')
  return Object.freeze({ messageId, message, user, swipeId, turn: Math.max(1, Number(message.turn) || 1), text })
}

/** Expose Swipe controls only for the still-mutable assistant tail. */
export function projectTailSwipeView(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const messageId = messages.length - 1
  const message = messages[messageId]
  if (!message || message.role !== 'assistant') return []
  const count = Math.max(Array.isArray(message.swipes) ? message.swipes.length : 0, 1)
  const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
  if (turn === 0) return []
  return [{
    messageId,
    turn,
    swipeId: Math.max(0, Math.min(count - 1, Number(message.swipeId) || 0)),
    count
  }]
}

/** Project the final selected Tavern Swipe into the append-only DSH surface. */
export function synchronizeTailSwipeSurface(input = {}) {
  const messages = Array.isArray(input.chat && input.chat.messages) ? input.chat.messages : []
  const last = messages[messages.length - 1]
  if (!last) {
    return Object.freeze({ updated: false, reason: 'no-tail-swipe' })
  }
  const selected = selectedTailSwipe(input.chat)
  const session = input.session
  const events = Array.isArray(session && session.events) ? session.events : []
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  if (!session || typeof session.append !== 'function') throw new Error('无法访问 DSH Session')
  const target = locateRegenerationSurface({ events, nodes, turn: selected.turn })
  if (target === null) throw new Error('模型消息面中找不到最后一条正文')
  const event = eventAt(events, target.assistantSeq)
  const content = event && event.data && event.data.message && event.data.message.content
  if (Array.isArray(content) && content.length === 1 && content[0] && content[0].type === 'text' && str(content[0].text) === selected.text) {
    return Object.freeze({ updated: false, messageId: selected.messageId, swipeId: selected.swipeId, turn: selected.turn })
  }
  session.append('assistant/message', {
    turn: selected.turn,
    step: 1,
    message: {
      id: typeof input.id === 'function' ? input.id() : randomUUID(),
      role: 'assistant',
      content: [{ type: 'text', text: selected.text }],
      source: target.source
    }
  }, {
    surfaceOp: { op: 'replace', start: target.assistantSeq, end: target.assistantSeq },
    sourceEventSeqs: [target.assistantSeq]
  })
  return Object.freeze({ updated: true, messageId: selected.messageId, swipeId: selected.swipeId, turn: selected.turn })
}
