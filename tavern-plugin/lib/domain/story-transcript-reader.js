import { readRecentWindow } from './bounded-history.js'
import { projectStoryTranscript } from './story-transcript.js'
import { storyToolCalls } from './story-tool-calls.js'

const summaryOf = message => ({
  role: message?.role,
  turn: message?.turn,
  greeting: message?.greeting
})

// The reader still loads sourceText/nativeAnchor for legacyMessageUid and the
// server-side view. They are removed only after stable row identity is computed.
const transportFields = Object.freeze([
  'id', 'messageUid', 'role', 'tavernRole', 'tavernHidden', 'turn', 'greeting', 'text', 'displayText',
  'displayMode', 'projectionVersion', 'projectionWarnings', 'placeholder', 'swipeId'
])
function transportMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return message
  const result = {}
  for (const field of transportFields) {
    if (Object.hasOwn(message, field)) result[field] = message[field]
  }
  // Helper/native repair rows can store their text in one of these containers.
  // Keep the fallback only when the ordinary story text fields are absent.
  if (typeof result.text !== 'string' && typeof result.displayText !== 'string') {
    if (Object.hasOwn(message, 'message')) result.message = message.message
    if (Object.hasOwn(message, 'content')) result.content = message.content
  }
  return result
}
async function projectWindow(window, summaries, readToolEvents) {
  const transcript = projectStoryTranscript(window, summaries)
  const calls = readToolEvents ? await storyToolCalls(window, summaries, readToolEvents) : []
  return {
    ...transcript,
    messages: transcript.messages.map((entry, index) => ({ ...entry, message: transportMessage(entry.message),
      ...(calls[index]?.length ? { toolCalls: calls[index] } : {}) }))
  }
}

/**
 * Old Chat storage is materialized once. Paged storage uses inline floor
 * summaries pinned to the window revision. Native tool events are opt-in.
 */
export function createStoryTranscriptReader({
  readSessionMap, readWindow, readRecentSummaries, readChat,
  readToolEvents, messageFields, limit = 120
}) {
  async function fullWindow(chatId, sessionId, tools) {
    const chat = await readChat(chatId)
    if (!chat || String(chat.sessionId || '') !== String(sessionId)
      || !['story', 'script'].includes(chat.mode || 'story')
      || !Array.isArray(chat.messages)) return null
    const messageCount = chat.messages.length
    const window = {
      chat,
      from: 0,
      to: messageCount - 1,
      messageCount,
      revision: Number(chat._storageRevision) || 0
    }
    return {
      ...window,
      storyTranscript: await projectWindow(window, chat.messages.map(summaryOf), tools)
    }
  }

  return async function readStoryTranscriptWindow(sessionId, historyFrom, { includeToolCalls = false } = {}) {
    const chatId = (await readSessionMap())[String(sessionId)]
    if (!chatId) return null
    const tools = includeToolCalls ? readToolEvents : undefined
    const from = Number.isSafeInteger(historyFrom) && historyFrom >= 0 ? historyFrom : undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      const window = await readRecentWindow(readWindow, chatId, {
        limit,
        from,
        messageFields
      })
      if (!window) return fullWindow(chatId, sessionId, tools)
      if (String(window.chat?.sessionId || '') !== String(sessionId)
        || !['story', 'script'].includes(window.chat?.mode || 'story')) return null
      const summaryPage = await readRecentSummaries(chatId, window.messageCount, { revision: window.revision })
      if (summaryPage?.revision === window.revision && summaryPage.from === 0
        && summaryPage.messageCount === window.messageCount
        && Array.isArray(summaryPage.messages)) {
        return {
          ...window,
          storyTranscript: await projectWindow(window, summaryPage.messages, tools)
        }
      }
      // A write landed between the page and summary reads. Retry; the final
      // fallback is one coherent full Chat read rather than mixed revisions.
    }
    return fullWindow(chatId, sessionId, tools)
  }
}
