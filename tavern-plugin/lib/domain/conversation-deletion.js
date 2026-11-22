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
