import { projectSceneImageState, projectChatBackgroundConfig } from './chat-session-state.js'
import { currentBackgroundSessionId, referencedBackgroundSessionIds } from './background-identity.js'
import { isScopedMessages } from './scoped-messages.js'
import { isStoryFloor } from './story-transcript.js'
function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function normalizeLinks(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function chatRows(index) {
  return index && Array.isArray(index.chats) ? index.chats : []
}

// Chat ids are uid('chat'): the base36 segment is the creation time. Older index
// rows predate the stored createdAt, so the id is their only record of it.
function createdAtFromId(id) {
  const match = /^chat-([0-9a-z]+)-/.exec(str(id))
  const value = match ? parseInt(match[1], 36) : 0
  return value > Date.UTC(2020, 0, 1) && value < Date.UTC(2100, 0, 1) ? value : 0
}

// Timeline participants/checkpoints also preserve historical background-session aliases.
export const conversationSummaryFields = Object.freeze([
  'id','sessionId','cardPath','cardName','title','mode','requestMode','createdAt','updatedAt','lastOpenedAt',
  'backgroundHistoryIds','candidateAgent','timeline'
])

function cleanPreviewText(raw, maxLines = 5, maxChars = 240) {
  let text = str(raw)
  if (!text) return ''
  text = text
    .replace(/<(?:think|thinking|initvar|UpdateVariable|StatusPlaceHolderImpl)\b[\s\S]*?<\/(?:think|thinking|initvar|UpdateVariable|StatusPlaceHolderImpl)>/gi, '\n')
    .replace(/<StatusPlaceHolderImpl\b[^>]*\/?>/gi, '\n')
    .replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/```(?:yaml|json|initvar|status|xml|html)?\s*\n[\s\S]*?```/gi, '\n')
    .replace(/<\/?(?:br|p|div|li|tr|h[1-6]|blockquote|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
  const lines = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line || /^[-*_—=~]{3,}$/.test(line)) continue
    lines.push(line)
    if (lines.length >= maxLines) break
  }
  const joined = lines.join('\n')
  return joined.length > maxChars ? joined.slice(0, maxChars).trimEnd() + '…' : joined
}

function messageRawText(msg) {
  if (typeof msg === 'string') return msg
  if (!msg || typeof msg !== 'object') return ''
  const swipeId = Math.max(0, Number(msg.swipeId) || 0)
  const swipeText = Array.isArray(msg.swipes) && typeof msg.swipes[swipeId] === 'string' ? msg.swipes[swipeId] : ''
  return str(msg.displayText || msg.text || msg.projectionText || msg.sourceText || swipeText)
}

function normalizePreview(preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return undefined
  return {
    ...(preview.latest === true ? { latest: true } : {}),
    ...(Number.isSafeInteger(preview.floorNo) ? { floorNo: preview.floorNo } : {}),
    ...(Number.isSafeInteger(preview.storageRevision) ? { storageRevision: preview.storageRevision } : {}),
    turnCount: Math.max(0, Number(preview.turnCount) || 0),
    messageCount: Math.max(0, Number(preview.messageCount) || 0),
    userText: str(preview.userText),
    replyText: str(preview.replyText),
    openingText: str(preview.openingText)
  }
}

// Use the same assistant ordinals as the transcript, including the opening.
// A live placeholder has an ordinal, but is not yet a body worth previewing.
function previewFloors(history) {
  let assistantIndex = -1, floorNo = 0, assistantCount = 0, userIndex = -1, userCount = 0, maxTurn = 0
  const first = history[0]
  const hasOpening = first?.placeholder !== true && (typeof first === 'string' || first?.greeting === true || isStoryFloor(first))
  for (let index = 0; index < history.length; index++) {
    const row = history[index]
    if (isStoryFloor(row)) {
      assistantCount++
      if (row.placeholder !== true) {
        assistantIndex = index
        floorNo = assistantCount
      }
    } else if (row?.role === 'user') {
      userIndex = index
      userCount++
    }
    if (row && row.greeting !== true && !(hasOpening && index === 0)) maxTurn = Math.max(maxTurn, Number(row.turn) || 0)
  }
  return { assistantIndex, floorNo, assistantCount, userIndex, userCount, hasOpening, maxTurn }
}

export function extractChatPreview(chat, preservedPreview = undefined, options = {}) {
  const existing = normalizePreview(preservedPreview) ?? normalizePreview(chat?.preview)
  if (options.metadataOnly === true || !Array.isArray(chat?.messages)) return existing
  const messages = chat.messages
  const totalMessages = options.messageCount ?? messages.length
  if (totalMessages === 0 && existing?.messageCount > 0 && !options.allowEmptyReset) return existing
  if (isScopedMessages(messages) && messages.length && (!messages[0] || !messages[messages.length - 1])) return existing

  const { assistantIndex, floorNo, assistantCount, userIndex, userCount, hasOpening, maxTurn } = options.floors ?? previewFloors(messages)
  const read = index => messages[options.indices ? options.indices.indexOf(index) : index]
  const assistant = read(assistantIndex)
  const opening = assistant?.greeting === true || (assistantIndex === 0 && hasOpening)
  const greetingSlots = hasOpening ? 1 : 0
  const exchangeMessages = Math.max(0, totalMessages - greetingSlots)
  const turnCount = exchangeMessages === 0 ? 0
    : maxTurn > 0 ? Math.max(1, maxTurn - greetingSlots)
    : Math.max(userCount, assistantCount - greetingSlots, Math.ceil(exchangeMessages / 2))
  return {
    latest: true, floorNo,
    ...(Number.isSafeInteger(chat._storageRevision) ? { storageRevision: chat._storageRevision } : {}),
    turnCount,
    messageCount: totalMessages,
    userText: cleanPreviewText(messageRawText(read(userIndex)), 3, 140),
    replyText: opening ? '' : cleanPreviewText(messageRawText(assistant), 5, 240),
    openingText: opening || (assistantIndex < 0 && hasOpening) ? cleanPreviewText(messageRawText(assistant ?? read(0)), 4, 200) : ''
  }
}

function samePreviewContent(left, right) {
  return Boolean(left && right && ['floorNo', 'turnCount', 'messageCount', 'userText', 'replyText', 'openingText'].every(key => left[key] === right[key]))
}

function chatSummary(chat, preservedLastOpenedAt = 0, preservedPreview = undefined, options = {}) {
  const updatedAt = Math.max(0, Number(chat && (chat.updatedAt || chat.createdAt)) || 0)
  const createdAt = Math.max(0, Number(chat && chat.createdAt) || 0) || createdAtFromId(chat && chat.id) || updatedAt
  const preview = extractChatPreview(chat, preservedPreview, options)
  return {
    id: str(chat && chat.id),
    cardPath: str(chat && chat.cardPath),
    cardName: str(chat && chat.cardName) || '未命名角色',
    title: str(chat && chat.title),
    mode: str(chat && chat.mode) || 'story',
    requestMode: chat && chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
    // Recovery (a new or background Session asking for its chat) matches on this
    // column; without it every save had to be read in full to learn its Session.
    sessionId: str(chat && chat.sessionId),
    ...(currentBackgroundSessionId(chat) === null ? {} : { backgroundSessionId: currentBackgroundSessionId(chat) }),
    ...(Array.isArray(chat?.backgroundHistoryIds) ? { backgroundHistoryIds: chat.backgroundHistoryIds } : {}),
    ...(preview !== undefined ? { preview } : {}),
    createdAt,
    updatedAt,
    lastOpenedAt: Math.max(0, Number(chat && chat.lastOpenedAt) || 0, Number(preservedLastOpenedAt) || 0) || updatedAt
  }
}

// What a recovery scan saw: every indexed chat and every link. Cheap next to reading chats.
function stampOf(index, links) {
  return chatRows(index).map(row => str(row.id)).join('\n') + '\u0000' + Object.entries(links).map(([key, value]) => key + '=' + value).join('\n')
}

function sameSummary(left, right) {
  if (!left || !right) return false
  // Rows written before summaries carried the bound Session have no column; both
  // missing and empty mean "no Session", so an old row migrates once and then stops.
  if (str(left.sessionId) !== str(right.sessionId)) return false
  if (JSON.stringify(left.preview || null) !== JSON.stringify(right.preview || null)) return false
  return JSON.stringify(left.backgroundHistoryIds || []) === JSON.stringify(right.backgroundHistoryIds || []) && ['id', 'cardPath', 'cardName', 'title', 'mode', 'requestMode', 'createdAt', 'updatedAt', 'lastOpenedAt', 'backgroundSessionId'].every(function (key) { return left[key] === right[key] })
}

/**
 * Owns the consistency protocol between Tavern chats, the published chat
 * index, and DSH Session links. Ordinary chat updates remain in the chat store;
 * creation, lookup recovery, and deletion cross only this interface.
 */
export function createTavernConversationRegistry(options = {}) {
  const store = options.store || {}
  const isDeleted = options.isDeleted || (() => false)
  const onPreviewChange = options.onPreviewChange
  const stage = (name, operation) => typeof options.trace?.stage === 'function' ? options.trace.stage(name, operation) : operation()
  for (const method of ['readLinks', 'updateLinks', 'readIndex', 'updateIndex', 'readChat', 'writeChat', 'removeChat']) {
    if (typeof store[method] !== 'function') throw new Error('Tavern Conversation Registry 缺少 store.' + method)
  }

  async function links() {
    return normalizeLinks(await store.readLinks())
  }

  async function resolve(sessionId) { return resolveUsing(sessionId, id => store.readChat(id)) }
  // Same alias/recovery rules, with a detached read-only projection when supported.
  async function resolveState(sessionId) {
    return resolveUsing(sessionId, id => typeof store.readChatState === 'function' ? store.readChatState(id) : store.readChat(id))
  }

  async function resolveSceneImageState(sessionId, options) {
    return resolveUsing(sessionId, async id => {
      if (store.readSceneImageState) return store.readSceneImageState(id, options)
      const chat = await store.readChat(id)
      return chat ? projectSceneImageState(chat) : undefined
    })
  }

  async function resolveBackgroundConfig(sessionId) {
    return resolveUsing(sessionId, async id => {
      if (typeof store.readBackgroundConfig === 'function') return store.readBackgroundConfig(id)
      const chat = await store.readChat(id)
      return chat ? projectChatBackgroundConfig(chat) : undefined
    })
  }

  // Sessions the recovery scan found no chat for (background agents ask on every request),
  // keyed by the index and links they were scanned against: a new chat or link scans again.
  const missing = new Map()
  async function resolveUsing(sessionId, readChat) {
    const id = str(sessionId)
    if (id === '') return undefined
    const links = normalizeLinks(await store.readLinks())
    if (typeof links[id] === 'string') {
      const mapped = await readChat(links[id])
      if (mapped !== undefined) return mapped
    }
    const scanned = missing.get(id)
    if (scanned !== undefined && scanned === stampOf(await store.readIndex(), links)) return undefined
    let found, stamp
    await store.updateLinks(async function (value) {
      const current = Object.assign({}, normalizeLinks(value))
      let changed = false
      if (typeof current[id] === 'string') {
        const mapped = await readChat(current[id])
        if (mapped !== undefined) {
          found = mapped
          return undefined
        }
        delete current[id]
        changed = true
      }
      const index = await store.readIndex()
      stamp = stampOf(index, current)
      // Published links already own these chats (including intentional aliases).
      // Only unlinked records need recovery; a new Session must not materialize
      // every historical game while holding the shared links write lock.
      const linkedChatIds = new Set(Object.values(current).filter(value => typeof value === 'string'))
      for (const item of chatRows(index)) {
        if (linkedChatIds.has(item.id)) continue
        // A row that already names its Session skips the file; rows written before
        // summaries carried it still get one read and are rewritten by the next sync.
        const declared = typeof item.sessionId === 'string' ? item.sessionId : null
        if (declared !== null && declared !== id) continue
        const chat = await readChat(item.id)
        if (chat === undefined || linkedChatIds.has(chat.id)) continue
        if (str(chat.sessionId) === id) {
          current[id] = chat.id
          found = chat
          return current
        }
      }
      return changed ? current : undefined
    })
    if (found === undefined && stamp !== undefined) {
      missing.set(id, stamp)
      if (missing.size > 256) missing.delete(missing.keys().next().value)
    } else missing.delete(id)
    return found
  }

  async function publish(chat, { assertUnboundSession } = {}) {
    if (!chat || str(chat.id) === '') throw new Error('不能发布没有 id 的 Tavern Chat')
    const sessionId = str(chat.sessionId)
    let chatWritten = false
    let linked = false
    try {
      await stage('publish.writeChat', () => store.writeChat(chat, { source: 'chat.create' }))
      chatWritten = true
      if (sessionId !== '') {
        await stage('publish.updateLinks', () => store.updateLinks(function (value) {
          const current = Object.assign({}, normalizeLinks(value))
          if (current[sessionId] === chat.id) return undefined
          if (assertUnboundSession) {
            // Concurrent forks can both pass the initial check before either writes the link.
            if (Object.hasOwn(current, sessionId)) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
            assertUnboundSession()
          }
          current[sessionId] = chat.id
          return current
        }))
        linked = true
      }
      await stage('publish.updateIndex', () => store.updateIndex(index => {
        const rows = chatRows(index).filter(item => item.id !== chat.id)
        rows.push(chatSummary(chat))
        return { ...index, chats: rows }
      }))
      return chat
    } catch (error) {
      if (linked) {
        await store.updateLinks(function (value) {
          const current = Object.assign({}, normalizeLinks(value))
          if (current[sessionId] !== chat.id) return undefined
          delete current[sessionId]
          return current
        }).catch(function () {})
      }
      if (chatWritten) await store.removeChat(chat.id).catch(function () {})
      throw error
    }
  }

  async function sync(chat, options = {}) {
    if (!chat || str(chat.id) === '') throw new Error('不能同步没有 id 的 Tavern Chat 摘要')
    const projected = options.refreshPreview ? await readLatestPreview(chat.id) : undefined
    let summary, previewChanged = false
    await store.updateIndex(index => {
      if (isDeleted(chat.id)) return undefined
      const rows = chatRows(index)
      const current = rows.find(item => item && item.id === str(chat.id))
      summary = chatSummary(chat, current?.lastOpenedAt, projected ?? current?.preview, options)
      if ((current?.preview?.storageRevision ?? -1) > (summary.preview?.storageRevision ?? -1)) summary.preview = current.preview
      previewChanged = summary.preview?.latest === true && !samePreviewContent(current?.preview, summary.preview)
      const previousIds = [...(current?.backgroundHistoryIds || []), current?.backgroundSessionId, ...referencedBackgroundSessionIds(chat)].filter(id => typeof id === 'string' && id && id !== summary.backgroundSessionId)
      if (previousIds.length) summary.backgroundHistoryIds = [...new Set(previousIds)].slice(-200)
      if (sameSummary(current, summary)) return undefined
      return { ...index, chats: rows.filter(item => !item || item.id !== summary.id).concat([summary]) }
    })
    if (previewChanged) onPreviewChange?.(summary)
    return summary
  }

  async function list() {
    const currentLinks = await links()
    const index = await store.readIndex()
    const summaries = new Map(chatRows(index).map(function (item) { return [str(item && item.id), item] }))
    const rows = []
    for (const sessionId of Object.keys(currentLinks)) {
      // API test identities are not ordinary sessions in the browser controller.
      // Check ownership rather than hiding arbitrary user IDs with a test prefix.
      if (/^test-[0-9a-f-]{36}$/i.test(sessionId) && typeof store.readAutomationOwner === 'function') {
        const owner = await store.readAutomationOwner(sessionId)
        if (owner?.sessionId === sessionId) continue
      }
      const chatId = str(currentLinks[sessionId])
      const summary = summaries.get(chatId)
      if (!summary) continue
      const normalized = chatSummary(summary)
      rows.push({ sessionId, chatId, ...(normalized.backgroundHistoryIds ? { backgroundHistoryIds: normalized.backgroundHistoryIds } : {}), ...(typeof normalized.backgroundSessionId === 'string' ? { backgroundSessionId: normalized.backgroundSessionId } : {}), ...(normalized.preview !== undefined ? { preview: normalized.preview } : {}), cardPath: normalized.cardPath, cardName: normalized.cardName, title: normalized.title, mode: normalized.mode, requestMode: normalized.requestMode, createdAt: normalized.createdAt, updatedAt: normalized.updatedAt, lastOpenedAt: normalized.lastOpenedAt })
    }
    // Conversations keep a fixed place: opening or continuing one must not move it.
    rows.sort(function (left, right) { return right.createdAt - left.createdAt || right.lastOpenedAt - left.lastOpenedAt })
    return rows
  }

  async function readLatestPreview(chatId, previous) {
    if (typeof store.readChatSlice === 'function' && typeof store.readRecentSummaries === 'function') {
      const fields = ['id', '_storageRevision']
      for (let attempt = 0; attempt < 2; attempt++) {
        const meta = await store.readChatSlice(chatId, [], fields)
        const count = meta?.messageCount, revision = meta?.chat?._storageRevision
        if (!Number.isSafeInteger(count) || count < 0) break
        if (count === 0) return extractChatPreview(meta.chat, previous, { allowEmptyReset: true })
        // The same metadata projection as the story view supplies exact floor
        // ordinals. Read text only from the latest reply and input.
        const page = await store.readRecentSummaries(chatId, count, { revision })
        if (!page) break
        if (page.from !== 0 || page.revision !== revision || page.messageCount !== count || page.messages?.length !== count) continue
        const floors = previewFloors(page.messages)
        const indices = [...new Set([0, floors.assistantIndex, floors.userIndex])].filter(index => index >= 0).sort((a, b) => a - b)
        const sliced = await store.readChatSlice(chatId, indices, fields)
        if (sliced?.chat && sliced.messageCount === count && sliced.chat._storageRevision === revision) {
          return extractChatPreview(sliced.chat, previous, { messageCount: count, floors, indices, allowEmptyReset: true })
        }
      }
    }
    const chat = await store.readChat(chatId)
    return chat ? extractChatPreview(chat, previous, { allowEmptyReset: true }) : undefined
  }

  async function backfillPreviews(chatIds = [], { limit = 60 } = {}) {
    const requested = Array.isArray(chatIds) ? chatIds.map(id => str(id)).filter(Boolean) : []
    const maxBatch = Math.max(1, Math.min(200, Number(limit) || 60))
    const index = await store.readIndex()
    const rows = chatRows(index)
    const byId = new Map(rows.map(item => [str(item && item.id), item]))
    const candidates = (requested.length ? requested : rows.map(item => str(item && item.id)))
      .filter(id => {
        const row = byId.get(id)
        return row && !Number.isSafeInteger(row.preview?.floorNo)
      })
    const batch = [...new Set(candidates)].slice(0, maxBatch)
    if (!batch.length) return { previews: {}, remaining: 0 }
    const extracted = new Map()
    for (const id of batch) {
      try {
        const preview = await readLatestPreview(id, byId.get(id).preview)
        if (preview) extracted.set(id, preview)
      } catch (error) {
        console.warn('dsh-tavern: 提取会话预览失败', id, error?.message || error)
      }
    }
    if (extracted.size > 0) {
      await store.updateIndex(current => {
        const currentRows = chatRows(current)
        let changed = false
        const nextRows = currentRows.map(item => {
          const id = str(item && item.id)
          if (!extracted.has(id) || isDeleted(id)) return item
          if (Number.isSafeInteger(item.preview?.floorNo)) {
            extracted.set(id, item.preview)
            return item
          }
          changed = true
          return { ...item, preview: extracted.get(id) }
        })
        return changed ? { ...current, chats: nextRows } : undefined
      })
    }
    const previews = {}
    for (const [id, preview] of extracted.entries()) previews[id] = preview
    return {
      previews,
      remaining: Math.max(0, new Set(candidates).size - batch.length)
    }
  }

  async function touch(sessionId, openedAt = Date.now()) {
    const id = str(sessionId)
    if (id === '') throw new Error('不能记录空 Session 的打开时间')
    const currentLinks = await links()
    const chatId = str(currentLinks[id])
    if (chatId === '') return { touched: false }
    let result = { touched: false }
    await store.updateIndex(index => {
      const rows = chatRows(index)
      const position = rows.findIndex(item => item && str(item.id) === chatId)
      if (position < 0) return undefined
      const stamp = Math.max(0, Number(openedAt) || 0)
      const previous = Math.max(0, Number(rows[position].lastOpenedAt) || 0)
      if (stamp <= previous) { result.lastOpenedAt = previous; return undefined }
      const nextRows = rows.slice()
      nextRows[position] = { ...rows[position], lastOpenedAt: stamp }
      result = { touched: true, lastOpenedAt: stamp }
      return { ...index, chats: nextRows }
    })
    return result
  }

  // The index and the session links are derived from the stored chats. A game on disk
  // that neither lists is registered again, so a lost or replaced index (#251) never hides
  // a save. Deletion removes the chat before its rows, so a deleted game cannot return.
  async function recoverUnlisted(chatIds) {
    const listed = new Set(chatRows(await store.readIndex()).map(item => str(item && item.id)))
    const recovered = []
    for (const id of chatIds) {
      if (isDeleted(id) || listed.has(str(id))) continue
      let chat
      try { chat = await store.readChat(id) } catch (error) { console.warn('dsh-tavern: 无法读取未登记的存档', id, error?.message || error); continue }
      if (!chat || str(chat.id) !== str(id)) continue
      const sessionId = str(chat.sessionId)
      if (sessionId !== '') {
        await store.updateLinks(function (value) {
          const current = Object.assign({}, normalizeLinks(value))
          if (typeof current[sessionId] === 'string' && current[sessionId] !== '') return undefined
          current[sessionId] = chat.id
          return current
        })
      }
      await store.updateIndex(index => {
        const rows = chatRows(index)
        if (rows.some(item => item && item.id === chat.id)) return undefined
        return { ...index, chats: rows.concat([chatSummary(chat)]) }
      })
      recovered.push(chat.id)
    }
    return recovered
  }

  async function remove(chatId) {
    const id = str(chatId)
    if (id === '') return { deleted: false }
    await store.removeChat(id)
    await store.updateIndex(index => {
      const nextRows = chatRows(index).filter(item => item.id !== id)
      return nextRows.length === chatRows(index).length ? undefined : { ...index, chats: nextRows }
    })
    await store.updateLinks(function (value) {
      const current = Object.assign({}, normalizeLinks(value))
      let changed = false
      for (const sessionId of Object.keys(current)) {
        if (current[sessionId] === id) { delete current[sessionId]; changed = true }
      }
      return changed ? current : undefined
    })
    return { deleted: true }
  }

  return { links, resolve, resolveState, resolveSceneImageState, resolveBackgroundConfig, publish, sync, list, backfillPreviews, touch, remove, recoverUnlisted }
}
