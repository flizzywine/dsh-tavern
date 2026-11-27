const PENDING_PATH = 'pending-chat-deletions.json'

function pendingEntries(document) {
  if (document === undefined) return {}
  if (document?.version !== 1 || !document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) {
    throw new Error('对话删除队列格式无效')
  }
  return document.entries
}

// Persist the cleanup plan before removing the save. Once the save is gone it
// can no longer tell us which files and native sessions belonged to the game.
export function createConversationDeletion({ store, deletedChatIds, removeCore, cleanup, logger = console }) {
  const running = new Map()

  async function pendingIds() {
    return Object.keys(pendingEntries(await store.readJson(PENDING_PATH)))
  }

  async function finish(chatId, footprint) {
    let plan
    await store.updateJson(PENDING_PATH, current => {
      const entries = pendingEntries(current)
      if (Object.hasOwn(entries, chatId)) {
        plan = entries[chatId]
        if (!plan || !Object.hasOwn(plan, 'footprint')) throw new Error('对话删除记录格式无效')
        return undefined
      }
      if (deletedChatIds.has(chatId)) return undefined
      plan = { footprint }
      return { version: 1, entries: { ...entries, [chatId]: plan } }
    })
    if (!plan) return { deleted: true }
    deletedChatIds.add(chatId)

    const result = await removeCore(chatId)
    try {
      await cleanup(chatId, plan.footprint)
      await store.updateJson(PENDING_PATH, current => {
        const entries = pendingEntries(current)
        if (!Object.hasOwn(entries, chatId)) return undefined
        const next = { ...entries }
        delete next[chatId]
        return { version: 1, entries: next }
      })
    } catch (error) {
      // The save and its registrations are gone. Retain the plan for cleanup
      // on the next startup without reporting that the save still exists.
      logger.warn('dsh-tavern: 对话残留清理待重试', chatId, error?.message || error)
    }
    return result
  }

  async function remove(chatId, footprint = null) {
    if (typeof chatId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(chatId)) throw new Error('无效的游戏编号')
    if (running.has(chatId)) return running.get(chatId)
    const task = finish(chatId, footprint)
    running.set(chatId, task)
    try { return await task }
    finally { running.delete(chatId) }
  }

  async function resumePending(chatIds) {
    for (const chatId of chatIds) {
      try { await remove(chatId) }
      catch (error) { logger.warn('dsh-tavern: 对话删除恢复失败', chatId, error?.message || error) }
    }
  }

  return Object.freeze({ pendingIds, remove, resumePending })
}

const DELETION_HEADER_FIELDS = [
  'id', 'sessionId', 'mode', 'cardPath', 'timeline', 'candidates', 'candidateAgent',
  'backgroundSessionId', 'backgroundHistoryIds', 'importHistory', 'backgroundTasks',
  'backgroundConfigVersion', 'conversationFeaturesVersion',
]

export function createConversationDeletionWorkflow({
  store, deletedChatIds, removeCore, chats, sessions, gameFootprint, cleanupChatRecords, logger = console,
}) {
  const deletedSessionIds = new Set()
  const journal = createConversationDeletion({ store, deletedChatIds, removeCore, cleanup: cleanupDeletedChat, logger })

  async function loadPending() {
    const pending = await journal.pendingIds().catch(error => {
      logger.warn('dsh-tavern: 读取对话删除队列失败', error?.message || error)
      return []
    })
    for (const chatId of pending) deletedChatIds.add(chatId)
    return pending
  }

  async function stopChatForDeletion(chatId) {
    if (deletedChatIds.has(chatId)) return undefined
    const chat = await readChatForDeletion(chatId)
    if (!chat) return undefined
    const ids = new Set([chat.sessionId, ...Object.values(chats.inspect({ chat }).participants || {}).map(item => item.sessionId)])
    const workers = [...ids].map(id => sessions.agents.get(id)).filter(Boolean)
    for (const worker of workers) {
      if (typeof worker.cancel === 'function') worker.cancel({ kind: 'user' })
    }
    await sessions.cancelSettlement(chat.id)
    for (const worker of workers) {
      if (typeof worker.whenIdle === 'function') await worker.whenIdle()
    }
    return chat
  }
  // Stopping and deleting a game needs a handful of header fields, never the whole save.
  // A play save carries a ~1 MB preset snapshot and megabytes of foreground frames, so a
  // full readChat here decoded hundreds of blocks per deletion just to reach sessionId
  // and the timeline. Saves outside the current header layout still take the whole read,
  // which is what upgrades session aliases and configuration.
  async function readChatForDeletion(chatId) {
    try {
      const chat = (await chats.readSlice(chatId, [], DELETION_HEADER_FIELDS))?.chat
      if (chat && chat.id === chatId && chat.sessionId !== undefined
        && chat.backgroundConfigVersion === 1 && chat.conversationFeaturesVersion === 1) return chat
    } catch { /* a damaged save reports the same failure through the whole read */ }
    return await chats.read(chatId)
  }
  // Deleting a batch stops every game first, describes the whole batch in one disk
  // scan, then removes them one by one. Each game used to repeat all three phases,
  // re-reading the same index and re-listing the same sessions tree per game.
  async function deleteChats(chatIds, prepareOnly = false) {
    if (!Array.isArray(chatIds) || chatIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效的对话')
    const unique = [...new Set(chatIds)]
    const outcomes = new Map()
    if (prepareOnly) {
      for (const chatId of unique) {
        try { await stopChatForDeletion(chatId); outcomes.set(chatId, { chatId, ok: true }) }
        catch (error) { outcomes.set(chatId, { chatId, ok: false, error: String(error?.message || error) }) }
      }
      return { results: unique.map(chatId => outcomes.get(chatId)) }
    }
    const prepared = []
    for (const chatId of unique) {
      try { prepared.push({ chatId, chat: await stopChatForDeletion(chatId) }) }
      catch (error) { outcomes.set(chatId, { chatId, ok: false, error: String(error?.message || error) }) }
    }
    const known = prepared.filter(item => item.chat !== undefined)
    const footprints = new Map()
    let described = null
    let indexSnapshot
    const readChatIndex = async function () {
      if (indexSnapshot === undefined) indexSnapshot = await chats.readIndex()
      return indexSnapshot
    }
    try {
      described = typeof gameFootprint.describeMany === 'function'
        ? await gameFootprint.describeMany(known.map(item => item.chat), { ownsSession: (id, chat) => ownsBackgroundSession(chat || {}, id, readChatIndex) })
        : await Promise.all(known.map(item => gameFootprint.describe(item.chat, { ownsSession: id => ownsBackgroundSession(item.chat, id, readChatIndex) })))
    } catch (error) { described = null }
    for (let index = 0; described !== null && index < known.length; index++) footprints.set(known[index].chatId, described[index])
    // A batch-wide description can fail on one damaged save; retry per game so the rest still go.
    if (described === null) {
      for (const item of known) {
        try { footprints.set(item.chatId, await gameFootprint.describe(item.chat, { ownsSession: id => ownsBackgroundSession(item.chat, id, readChatIndex) })) }
        catch (error) { outcomes.set(item.chatId, { chatId: item.chatId, ok: false, error: String(error?.message || error) }) }
      }
    }
    for (const item of prepared) {
      if (outcomes.has(item.chatId)) continue
      try {
        await journal.remove(item.chatId, footprints.get(item.chatId))
        outcomes.set(item.chatId, { chatId: item.chatId, ok: true })
      } catch (error) { outcomes.set(item.chatId, { chatId: item.chatId, ok: false, error: String(error?.message || error) }) }
    }
    return { results: unique.map(chatId => outcomes.get(chatId)) }
  }
  // A background session is this game's only if its stored parent is this game's foreground
  // session and no other game still refers to it (imports used to keep foreign ids).
  async function ownsBackgroundSession(chat, sessionId, readIndexOnce) {
    const index = await readIndexOnce()
    if ((index.chats || []).some(row => row.id !== chat.id && (row.backgroundSessionId === sessionId || (row.backgroundHistoryIds || []).includes(sessionId)))) return false
    try {
      const handle = await sessions.open(sessionId)
      try { return handle.header?.parentSession === chat.sessionId } finally { await handle.close() }
    } catch { return false }
  }
  async function cleanupDeletedChat(chatId, footprint) {
    const sessionId = footprint?.foregroundSessionId
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      deletedSessionIds.add(sessionId)
      sessions.notifyRemoved(sessionId)
    }
    async function cleanupFiles() {
      if (!footprint) return
      if (sessionId) await sessions.release(sessionId)
      // A session DSH still holds loaded would be written back; delete it on the next start.
      const live = footprint.items.filter(item => item.category === 'subsession' && sessions.agents.get(item.sessionId))
      if (live.length) await gameFootprint.deferSessionDeletion(live)
      const cleanup = await gameFootprint.removeLeftovers({ ...footprint, items: footprint.items.filter(item => !live.includes(item)) })
      if (cleanup.failures.length) throw new Error(cleanup.failures[0].error)
    }
    // These stores are independent. Attempt each even if another fails, keeping
    // the journal entry until every step has succeeded or been durably deferred.
    const results = await Promise.allSettled([
      ...cleanupChatRecords.map(remove => remove(chatId)),
      cleanupFiles()
    ])
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new Error(failures.map(({ reason }) => reason?.message || String(reason)).join('；'))
  }
  async function deleteChat(chatId) {
    const { results: [result] } = await deleteChats([chatId])
    if (!result.ok) throw new Error(result.error)
    return { deleted: true }
  }

  return {
    deleteChat, deleteChats, loadPending, resumePending: journal.resumePending,
    isSessionDeleted: sessionId => deletedSessionIds.has(sessionId),
  }
}
