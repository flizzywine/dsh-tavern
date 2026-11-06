import { appendGuides } from './guide-content.js'

// Own conversation lookup, current-state mutation, and library application.
// Callers never edit a detached chat snapshot or delete by its shifted index.
export function createConversationGuides({ chats, library, isPlay, now = Date.now }) {
  function requirePlay(chat) {
    if (!chat || !isPlay(chat)) throw new Error('请先打开游玩会话')
    return chat
  }
  async function find(sessionId) { return requirePlay(await chats.forSession(sessionId)) }
  async function change(chat, source, edit) {
    const saved = await chats.update(chat.id, current => {
      requirePlay(current)
      if (current.sessionId !== chat.sessionId) throw new Error('会话已变化，请刷新后重试')
      current.guides = edit(Array.isArray(current.guides) ? current.guides : [])
      current.updatedAt = now()
      return current
    }, { source })
    return requirePlay(saved).guides
  }
  return {
    async add(sessionId, text) {
      return change(await find(sessionId), 'guide.add', current => appendGuides(current, [text], { now: now() }))
    },
    async remove(sessionId, selection = {}) {
      const chat = await find(sessionId)
      let id = selection.id, target
      if (typeof id !== 'string' || !id) {
        // Older open clients send an index. Resolve it once, before entering the
        // mutation, then find that identity in the latest state without clamping.
        const index = selection.index
        if (!Number.isInteger(index) || index < 0 || index >= (chat.guides || []).length) throw new Error('Guide 序号无效，请刷新后重试')
        target = chat.guides[index]
        if (selection.expected && JSON.stringify(selection.expected) !== JSON.stringify(target)) throw new Error('Guide 已变化，请刷新后重试')
        id = target.id
      }
      return change(chat, 'guide.delete', current => {
        const matches = current.filter(item => id ? item.id === id : JSON.stringify(item) === JSON.stringify(target))
        if (matches.length !== 1) throw new Error('Guide 已删除或变化，请刷新后重试')
        return current.filter(item => item !== matches[0])
      })
    },
    async load(sessionId, id) {
      const chat = await find(sessionId)
      const item = await library.get(id)
      return change(chat, 'guide.library.load', current => appendGuides(current, item.guides, { deduplicate: true, now: now() }))
    },
    async save(sessionId, name) {
      const chat = await find(sessionId)
      return library.save(name, chat.guides)
    }
  }
}
