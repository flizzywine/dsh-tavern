import { createSessionSliceReader } from './session-view-reader.js'

/**
 * Reading a game's save by what the caller needs. Cost grows with what is read, so a
 * per-turn path picks the narrowest reader; whole-guard reports a whole read there.
 *
 *   header(sessionId, fields)        a few header fields (mode, settings, task state)
 *   recentSummaries(sessionId, n)    identity fields + the latest n floors' summaries
 *                                    (role, turn, greeting, MVU flags), no bodies
 *   latestFloors(sessionId, n)       the complete header + the latest n floors
 *   floors(sessionId, indices, f)    the header (fields f) + the floors at `indices`
 *   whole(sessionId)                 the whole save: rare operations only (edit,
 *                                    rollback, import, card workspace, legacy saves)
 *
 * Each narrow reader falls back to the whole save where storage cannot read floors alone
 * (legacy saves, small by construction) or the header still needs adoption.
 */
export function createChatReads({ links, persistence, whole, allow = (_reason, operation) => operation() }) {
  const chatIdOf = async sessionId => (await links())[String(sessionId ?? '')]
  async function header(sessionId, fields) {
    const chatId = await chatIdOf(sessionId)
    const chat = chatId && (await persistence.readSlice(chatId, [], [
      'id', 'sessionId', 'mode', 'backgroundConfigVersion', 'conversationFeaturesVersion', ...fields
    ]))?.chat
    if (chat && chat.sessionId === sessionId && chat.backgroundConfigVersion === 1 && chat.conversationFeaturesVersion === 1) return chat
    // Alias recovery and configuration adoption still require the original reader.
    return allow('存档配置升级', () => whole(sessionId))
  }
  // `messagesFrom` is the first summary's absolute index. Null where storage cannot read
  // the latest floors alone (callers use the session state then).
  async function recentSummaries(sessionId, count) {
    const chatId = await chatIdOf(sessionId)
    const recent = chatId && await persistence.readRecentSummaries(chatId, count)
    if (!recent) return null
    const head = (await persistence.readSlice(chatId, [], ['id', 'sessionId', 'mode', 'requestMode']))?.chat
    if (!head || head.sessionId !== String(sessionId ?? '')) return null
    return { ...head, messages: recent.messages, messagesFrom: recent.from, messageCount: recent.messageCount }
  }
  async function latestFloors(sessionId, count = 1, { includePosition = false } = {}) {
    const chatId = await chatIdOf(sessionId)
    const head = chatId && await persistence.readSlice(chatId, [])
    if (!head?.chat || head.chat.sessionId !== sessionId || !Number.isSafeInteger(head.messageCount)) return whole(sessionId)
    if (head.messageCount === 0) return head.chat
    const from = Math.max(0, head.messageCount - count)
    const latest = await persistence.readSlice(chatId, Array.from({ length: head.messageCount - from }, (_, index) => from + index))
    if (!latest?.chat) return whole(sessionId)
    // Native slices are dense: their length is the window size, not the story's length.
    return includePosition ? { ...latest.chat, messageCount: latest.messageCount, messagesFrom: from } : latest.chat
  }
  const floors = createSessionSliceReader({ links, readSlice: persistence.readSlice })
  return Object.freeze({ header, recentSummaries, latestFloors, floors, whole })
}
