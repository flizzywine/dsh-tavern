import { readRecentWindow } from './bounded-history.js'
import { projectStoryTranscript } from './story-transcript.js'

const summaryOf = message => ({
  role: message?.role,
  turn: message?.turn,
  greeting: message?.greeting
})

/**
 * Story-only history reads. This reader deliberately has no native-session
 * dependency: old Chat storage is materialized once, while paged storage uses
 * inline floor summaries pinned to the exact window revision.
 */
export function createStoryTranscriptReader({
  readSessionMap, readWindow, readRecentSummaries, readChat,
  messageFields, limit = 120
}) {
  async function fullWindow(chatId, sessionId) {
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
      storyTranscript: projectStoryTranscript(window, chat.messages.map(summaryOf))
    }
  }

  return async function readStoryTranscriptWindow(sessionId, historyFrom) {
    const chatId = (await readSessionMap())[String(sessionId)]
    if (!chatId) return null
    const from = Number.isSafeInteger(historyFrom) && historyFrom >= 0 ? historyFrom : undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      const window = await readRecentWindow(readWindow, chatId, {
        limit,
        from,
        messageFields
      })
      if (!window) return fullWindow(chatId, sessionId)
      if (String(window.chat?.sessionId || '') !== String(sessionId)
        || !['story', 'script'].includes(window.chat?.mode || 'story')) return null
      const summaryPage = await readRecentSummaries(chatId, window.messageCount, { revision: window.revision })
      if (summaryPage?.revision === window.revision && summaryPage.from === 0
        && summaryPage.messageCount === window.messageCount
        && Array.isArray(summaryPage.messages)) {
        return {
          ...window,
          storyTranscript: projectStoryTranscript(window, summaryPage.messages)
        }
      }
      // A write landed between the page and summary reads. Retry; the final
      // fallback is one coherent full Chat read rather than mixed revisions.
    }
    return fullWindow(chatId, sessionId)
  }
}
