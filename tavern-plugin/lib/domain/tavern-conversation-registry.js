function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function normalizeLinks(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function chatRows(index) {
  return index && Array.isArray(index.chats) ? index.chats : []
}

/**
 * Owns the consistency protocol between Tavern chats, the published chat
 * index, and DSH Session links. Ordinary chat updates remain in the chat store;
 * creation, lookup recovery, and deletion cross only this interface.
 */
export function createTavernConversationRegistry(options = {}) {
  const store = options.store || {}
  for (const method of ['readLinks', 'updateLinks', 'readIndex', 'writeIndex', 'readChat', 'writeChat', 'removeChat']) {
    if (typeof store[method] !== 'function') throw new Error('Tavern Conversation Registry 缺少 store.' + method)
  }

  async function links() {
    return normalizeLinks(await store.readLinks())
  }

  async function resolve(sessionId) {
    const id = str(sessionId)
    if (id === '') return undefined
    let found
    await store.updateLinks(async function (value) {
      const current = Object.assign({}, normalizeLinks(value))
      let changed = false
      if (typeof current[id] === 'string') {
        const mapped = await store.readChat(current[id])
        if (mapped !== undefined) {
          found = mapped
          return undefined
        }
        delete current[id]
        changed = true
      }
      const index = await store.readIndex()
      for (const item of chatRows(index)) {
        const chat = await store.readChat(item.id)
        if (chat !== undefined && str(chat.sessionId) === id) {
          current[id] = chat.id
          found = chat
          return current
        }
      }
      return changed ? current : undefined
    })
    return found
  }

  async function publish(chat) {
    if (!chat || str(chat.id) === '') throw new Error('不能发布没有 id 的 Tavern Chat')
    const sessionId = str(chat.sessionId)
    let chatWritten = false
    let linked = false
    try {
      await store.writeChat(chat, { source: 'chat.create' })
      chatWritten = true
      if (sessionId !== '') {
        await store.updateLinks(function (value) {
          const current = Object.assign({}, normalizeLinks(value))
          if (current[sessionId] === chat.id) return undefined
          current[sessionId] = chat.id
          return current
        })
        linked = true
      }
      const index = await store.readIndex()
      const rows = chatRows(index).filter(function (item) { return item.id !== chat.id })
      rows.push({ id: chat.id, cardPath: chat.cardPath, cardName: chat.cardName, updatedAt: chat.updatedAt })
      await store.writeIndex(Object.assign({}, index || {}, { chats: rows }))
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

  async function remove(chatId) {
    const id = str(chatId)
    if (id === '') return { deleted: false }
    const index = await store.readIndex()
    const nextRows = chatRows(index).filter(function (item) { return item.id !== id })
    if (nextRows.length !== chatRows(index).length) await store.writeIndex(Object.assign({}, index || {}, { chats: nextRows }))
    await store.updateLinks(function (value) {
      const current = Object.assign({}, normalizeLinks(value))
      let changed = false
      for (const sessionId of Object.keys(current)) {
        if (current[sessionId] === id) { delete current[sessionId]; changed = true }
      }
      return changed ? current : undefined
    })
    await store.removeChat(id)
    return { deleted: true }
  }

  return { links, resolve, publish, remove }
}
