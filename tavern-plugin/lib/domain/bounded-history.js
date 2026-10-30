import { createScopedMessages } from './scoped-messages.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'

// Story preparation, worldbook prefilter and plugin task context only. Template
// executors and request hooks retain their own complete-message readers.
export const storyContextMessageFields = Object.freeze([
  'role', 'turn', 'greeting', 'text', 'sourceText', 'projectionText',
  'swipeId', 'swipes', 'variables',
  // A new foreground capability epoch reuses the last director's judge result.
  'stageDirectionAssetPacks.stats.judge.probabilities'
])

const legacyStory = chat => Object.values(chat?.timeline?.operations || {}).some(operation =>
  operation?.kind === 'body' && operation.status === 'foreground-completed')

/** Story rows a world-book scan of `depth` reads: user/assistant floors, greetings excluded. */
export function scannedStoryRows(rows, depth) {
  let count = 0
  for (const row of rows) if ((row?.role === 'user' || row?.role === 'assistant') && row.greeting !== true) count++
  return count >= depth
}

/**
 * Recent history at its absolute floor positions, without materializing the
 * complete Chat. Pages backwards on one pinned revision until the window holds
 * `storyRows` story floors (a number, or computed from the header), the latest
 * reply when `lastAssistant`, and the latest variable floor when
 * `lastVariables` (located through the storage's world index, not a scan),
 * and whatever `enough(rows)` asks for; `include` names further floors.
 * Rows outside the window read as holes. Undefined means only the complete
 * reader is safe: legacy or unadopted stories, non-native storage, an unknown
 * depth, or a window above `maxRows`.
 */
export function createBoundedHistory({ links, readWindow, pageSize = 48, maxRows = 2000 }) {
  async function read(chatId, sessionId, { storyRows = 0, lastAssistant = false, lastVariables = false, enough = () => true, include = [], revision, messageFields } = {}) {
    const projection = messageFields === undefined ? {} : { messageFields }
    const first = await readWindow(chatId, { limit: pageSize, includeCheckpoints: true, ...projection })
    const head = first?.chat
    if (!head || (revision !== undefined && first.revision !== revision) || (sessionId !== undefined && head.sessionId !== sessionId) || head.backgroundConfigVersion !== 1
      || head.conversationFeaturesVersion !== 1 || legacyStory(head)) return undefined
    const depth = typeof storyRows === 'function' ? await storyRows(head) : storyRows
    if (!Number.isSafeInteger(depth) || depth < 0) return undefined
    let rows = head.messages, from = first.from
    const satisfied = () => scannedStoryRows(rows, depth) && (!lastAssistant || rows.some(row => row?.role === 'assistant')) && enough(rows)
    while (from > 0 && !satisfied()) {
      if (rows.length >= maxRows) return undefined
      const page = await readWindow(chatId, { limit: Math.min(500, Math.max(pageSize, rows.length)), before: from, revision: first.revision, fields: ['_storageRevision'], ...projection })
      if (!page || page.revision !== first.revision || page.to !== from - 1) return undefined
      rows = page.chat.messages.concat(rows)
      from = page.from
    }
    const entries = rows.map((row, index) => [from + index, row])
    if (lastVariables && from > 0 && lastTavernHelperVariables(rows) === undefined) {
      const position = first.worldMessage
      if (position === undefined) return undefined
      if (position !== null) {
        if (position >= from) return undefined
        const page = await readWindow(chatId, { limit: 1, before: position + 1, revision: first.revision, fields: ['_storageRevision'], ...projection })
        const row = page?.revision === first.revision ? page.chat.messages[0] : undefined
        if (!row || row.role === 'tavern-helper' || lastTavernHelperVariables([row]) === undefined) return undefined
        entries.unshift([position, row])
      }
    }
    // Named floors outside the window, read on the same revision.
    for (const position of new Set(include)) {
      if (!Number.isSafeInteger(position) || position < 0 || position >= first.messageCount) return undefined
      if (position >= from || entries.some(([at]) => at === position)) continue
      const page = await readWindow(chatId, { limit: 1, before: position + 1, revision: first.revision, fields: ['_storageRevision'], ...projection })
      if (page?.revision !== first.revision || !page.chat.messages[0]) return undefined
      entries.unshift([position, page.chat.messages[0]])
    }
    const { messages: _rows, ...header } = head
    return {
      chat: { ...header, messages: createScopedMessages(first.messageCount, entries) },
      messageCount: first.messageCount, from, revision: first.revision, ...projection
    }
  }
  return Object.freeze({
    read,
    async forSession(sessionId, need) {
      const chatId = (await links())[sessionId]
      return chatId ? read(chatId, sessionId, need) : undefined
    }
  })
}

/** Header and named floors exactly as they were at `revision`; undefined when that
 * revision is no longer readable. Rows come back in ascending floor order. */
export async function readRowsAt(readWindow, chatId, revision, indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  if (sorted.some(index => !Number.isSafeInteger(index) || index < 0)) return undefined
  const rows = new Map()
  let header, messageCount
  const groups = []
  for (const index of sorted) {
    const group = groups.at(-1)
    if (group && index - group[0] < 500) group[1] = index
    else groups.push([index, index])
  }
  for (const [start, end] of groups.length ? groups : [[null, null]]) {
    let window
    try { window = await readWindow(chatId, start === null ? { limit: 1, revision, includeCheckpoints: true } : { limit: end - start + 1, before: end + 1, revision, includeCheckpoints: true }) }
    catch (error) { if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') return undefined; throw error }
    if (!window || window.revision !== revision || (start !== null && window.from !== start)) return undefined
    header ??= window.chat; messageCount = window.messageCount
    if (start !== null) window.chat.messages.forEach((row, offset) => rows.set(start + offset, row))
  }
  const { messages: _rows, ...head } = header
  return { chat: { ...head, messages: sorted.map(index => rows.get(index)) }, messageCount, denseMessages: sorted.every(index => rows.has(index)) }
}

/** The latest `limit` floors, extended on the same revision back to `from` when
 * the reader has already viewed older history. `requirePartial` keeps the old
 * contract of returning null for a history the window would cover entirely. */
export async function readRecentWindow(readWindow, chatId, { limit, from, requirePartial = false, messageFields } = {}) {
  const projection = messageFields === undefined ? {} : { messageFields }
  const extended = Number.isSafeInteger(from) && from >= 0
  // Background tasks write several times a turn: a revision moving under the extension is
  // read again, never answered with "no window" (which turns the view into the whole history).
  for (let attempt = 0; attempt < 3; attempt++) {
    let window = await readWindow(chatId, { limit, requirePartial: requirePartial && !extended, ...projection })
    // Back to `from` in one read when it fits: a single revision, nothing to stitch.
    if (window && extended && window.from > from && window.messageCount - from <= 500) {
      window = await readWindow(chatId, { limit: Math.max(limit, window.messageCount - from), ...projection })
      if (window && window.from > from) continue
    }
    let stitched = true
    while (window && extended && window.from > from) {
      const page = await readWindow(chatId, { limit: Math.min(500, window.from - from), before: window.from, revision: window.revision, fields: ['_storageRevision'], ...projection })
      if (!page || page.revision !== window.revision || page.to !== window.from - 1) { stitched = false; break }
      window = { ...window, from: page.from, chat: { ...window.chat, messages: page.chat.messages.concat(window.chat.messages) } }
    }
    if (stitched) return window
  }
  return null
}
