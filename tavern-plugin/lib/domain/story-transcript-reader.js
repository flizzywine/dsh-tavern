import { readRecentWindow } from './bounded-history.js'
import { projectStoryTranscript, storyReplyNativeTurns } from './story-transcript.js'
import { storyToolCalls } from './story-tool-calls.js'
import { sessionViewMessageFields } from './session-view-projection.js'
import { projectDisplayParts } from './display-source.js'

const summaryOf = message => ({
  role: message?.role,
  turn: message?.turn,
  greeting: message?.greeting
})

// The reader still loads sourceText/nativeAnchor for legacyMessageUid and the
// server-side view. They are removed only after stable row identity is computed.
const transportFields = Object.freeze([
  'id', 'messageUid', 'role', 'tavernRole', 'tavernHidden', 'turn', 'greeting', 'text', 'displayText',
  'displayMode', 'projectionVersion', 'projectionWarnings', 'placeholder', 'swipeId', 'narrativeDamper', 'damperState'
])
// 会话视图投影本身不读 source，故事列表却要按请求号把宿主的提交回声换成落盘行；
// 这里只点取请求号，不把整段 source 读进窗口。
export const storyTranscriptMessageFields = Object.freeze([...sessionViewMessageFields, 'source.rpcId'])
function transportMessage(message, includeDisplayParts) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return message
  const result = {}
  for (const field of transportFields) {
    if (Object.hasOwn(message, field)) result[field] = message[field]
  }
  // 视图的玩家行靠请求号认领宿主的提交回声：落盘行带上它，回声才能原位让位。
  // 少了它，同一条输入在回声退休前会被画成两个气泡。只带请求号，不搬整段 source。
  const rpcId = message.source && typeof message.source.rpcId === 'string' ? message.source.rpcId : ''
  if (rpcId !== '') result.source = { rpcId: rpcId }
  // Helper/native repair rows can store their text in one of these containers.
  // Keep the fallback only when the ordinary story text fields are absent.
  if (typeof result.text !== 'string' && typeof result.displayText !== 'string') {
    if (Object.hasOwn(message, 'message')) result.message = message.message
    if (Object.hasOwn(message, 'content')) result.content = message.content
  }
  if (includeDisplayParts && result.role === 'assistant' && result.placeholder !== true
    && (result.displayMode === 'html' || result.displayMode === 'rich') && typeof result.displayText === 'string') {
    result.displayParts = projectDisplayParts(result.displayText).parts
  }
  return result
}
async function projectWindow(window, summaries, readToolEvents) {
  const transcript = projectStoryTranscript(window, summaries)
  const nativeTurns = storyReplyNativeTurns(window, summaries)
  const calls = readToolEvents ? await storyToolCalls(window.chat.sessionId, nativeTurns, readToolEvents) : []
  return {
    ...transcript,
    messages: transcript.messages.map((entry, index) => ({ ...entry, message: transportMessage(entry.message, entry.key.startsWith('index:')),
      ...(nativeTurns[index] === null ? {} : { nativeTurn: nativeTurns[index] }),
      ...(calls[index]?.length ? { toolCalls: calls[index] } : {}) }))
  }
}

/**
 * Old Chat storage is materialized once. Paged storage uses inline floor
 * summaries pinned to the window revision. Native tool events are opt-in.
 */
export function createStoryTranscriptReader({
  readSessionMap, readWindow, readRecentSummaries, readChat,
  readToolEvents, messageFields, limit = 120, cacheSize = 12
}) {
  const transcriptCache = new Map()
  function readCachedTranscript(key) {
    const cached = transcriptCache.get(key)
    if (!cached) return null
    transcriptCache.delete(key)
    transcriptCache.set(key, cached)
    return cached
  }
  function rememberTranscript(key, value) {
    if (cacheSize <= 0) return value
    transcriptCache.delete(key)
    transcriptCache.set(key, value)
    while (transcriptCache.size > cacheSize) transcriptCache.delete(transcriptCache.keys().next().value)
    return value
  }

  async function fullWindow(chatId, sessionId, tools) {
    const chat = await readChat(chatId)
    if (!chat || String(chat.sessionId || '') !== String(sessionId)
      || !['story', 'script'].includes(chat.mode || 'story')
      || !Array.isArray(chat.messages)) return null
    const messageCount = chat.messages.length
    const revision = Number(chat._storageRevision) || 0
    const window = {
      chat,
      from: 0,
      to: messageCount - 1,
      messageCount,
      revision
    }
    const key = !tools && revision > 0
      ? JSON.stringify([chatId, String(sessionId), revision, 0, messageCount - 1, messageCount])
      : null
    const cached = key ? readCachedTranscript(key) : null
    if (cached) return { ...window, storyTranscript: cached }
    const projected = await projectWindow(window, chat.messages.map(summaryOf), tools)
    return {
      ...window,
      storyTranscript: key ? rememberTranscript(key, projected) : projected
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
      const key = !tools && window.revision > 0
        ? JSON.stringify([chatId, String(sessionId), window.revision, window.from, window.to, window.messageCount, window.stamp])
        : null
      const cached = key ? readCachedTranscript(key) : null
      if (cached) return { ...window, storyTranscript: cached }
      const summaryPage = await readRecentSummaries(chatId, window.messageCount, { revision: window.revision })
      if (summaryPage?.revision === window.revision && summaryPage.stamp === window.stamp && summaryPage.from === 0
        && summaryPage.messageCount === window.messageCount
        && Array.isArray(summaryPage.messages)) {
        const projected = await projectWindow(window, summaryPage.messages, tools)
        return {
          ...window,
          storyTranscript: key ? rememberTranscript(key, projected) : projected
        }
      }
      // A write landed between the page and summary reads. Retry; the final
      // fallback is one coherent full Chat read rather than mixed revisions.
    }
    return fullWindow(chatId, sessionId, tools)
  }
}
