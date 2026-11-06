// Save list, rename, delete, fork, import and export requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createConversationHandlers(deps) {
  const { appendStoryRounds, chatForSession, chatHistoryImporter, deleteChat, deleteChats,
    exportConversation, exportGameSave, forkChat, importChatHistoryText, importGameSave, listTavernSessions,
    prepareConversationFork, readTavernSettings, sessionInventory, str, updateChat } = deps
  return {
    async listSessions(args) {
      const settings = await readTavernSettings()
      return { sessions: (await listTavernSessions()).filter(chat => chat.requestMode !== 'sillytavern'), capabilities: { trustedCardMode: settings.trustedCardMode } }
    },
    async renameConversation(args) {
      const chat = await chatForSession(args && args.sessionId)
      if (!chat) throw new Error('当前会话没有绑定 Tavern 对话')
      const title = str(args && args.title)
      const saved = await updateChat(chat.id, current => ({ ...current, title }), { source: 'conversation.rename' })
      // Renaming must not report success while the sidebar still has an old title.
      // The normal updateChat summary sync is best effort; retry it strictly here.
      await deps.conversationRegistry.sync(saved)
      return { title: saved.title }
    },
    async markConversationOpened(args) {
      return await deps.conversationRegistry.touch(args && args.sessionId, Date.now())
    },
    // Names of games by id, for plugin pages that list several games (tavernUi.getGames).
    async gameTitles(args) {
      const ids = [...new Set((Array.isArray(args?.gameIds) ? args.gameIds : []).map(str).filter(Boolean))].slice(0, 500)
      const games = {}
      for (const id of ids) {
        const chat = await chatForSession(id).catch(() => undefined)
        if (chat) games[id] = { title: str(chat.title), cardName: str(chat.cardName) }
      }
      return { games }
    },
    async prepareDeleteChats(args) {
      return await deleteChats(args && args.chatIds, true)
    },
    async deleteChats(args) {
      return await deleteChats(args && args.chatIds)
    },
    async deleteChat(args) {
      return await deleteChat(args && args.chatId)
    },
    async prepareConversationFork(args) {
      const plan = await prepareConversationFork(args?.chatId, args?.sessionId, args?.turn)
      return { turn: plan.turn, atSeq: plan.atSeq, sourceRevision: plan.source._storageRevision }
    },
    async forkChat(args) {
      return { fork: await forkChat(args?.chatId, args?.sessionId, args?.targetSessionId, args?.turn, args?.sourceRevision, args?.atSeq) }
    },
    async getSessionInventory(args) {
      return await sessionInventory.read()
    },
    async exportConversation(args) {
      return await exportConversation(args && args.chatId, args && args.sessionId, args && args.title)
    },
    async importGameSave(args) {
      return await importGameSave(args)
    },
    async exportGameSave(args) {
      return await exportGameSave(args && args.sessionId, { images: args && args.images !== false })
    },
    async previewChatImport(args) {
      return await chatHistoryImporter.preview(args || {})
    },
    async importChatHistoryText(args) {
      return await importChatHistoryText(args || {})
    },
    async appendStoryRounds(args) {
      return await appendStoryRounds(args || {})
    },
    async rescueChatHistory(args) {
      return await chatHistoryImporter.rescue(args || {})
    },
    async importChatHistory(args) {
      return await chatHistoryImporter.import(args || {})
    },
  }
}
