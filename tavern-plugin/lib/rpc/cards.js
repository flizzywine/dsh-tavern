import { waitForWritableSession } from '../domain/agent-readiness.js'
import { normalizeResourcePath } from '../domain/file-resources.js'

// Card library, card workspace and card import requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createCardHandlers(deps) {
  const { agentRegistry, cardMemory, cardOrganization, cardPacksOf, cardPlugins, cardPreparation,
    cardTaskPrompts, castAssets, chatForSession, deleteCard, ensureNativeCardWorkspace, fileResources,
    importCard, importCardArchiveFile, importPluginCardFile, listCards, mobileCardImport, pluginApi,
    readCardWorkspace, runtimePrompt, sessionStore, setCardPlugins, sleep, str, updateCard, uploads,
    worldBooks } = deps
  return {
    async getCardOrganization(args) {
      return { groups: (await cardOrganization.read()).groups }
    },
    async organizeCards(args) {
      return { groups: (await cardOrganization.update(args || {}, await fileResources.list('card'))).groups }
    },
    async listCards(args) {
      return { cards: await listCards() }
    },
    async getCard(args) {
      const cardPath = normalizeResourcePath(args && args.path, 'card')
      const workspace = await readCardWorkspace(cardPath)
      if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
      return { card: Object.assign(cardPreparation.present({ card: workspace, as: 'detail' }), { path: cardPath }) }
    },
    async getCardTaskPrompt(args) {
      const task = str(args && args.task)
      const promptName = cardTaskPrompts[task]
      if (promptName === undefined) throw new Error('未知卡片任务: ' + task)
      const chat = await chatForSession(args && args.sessionId)
      let legacyWorkspaceText = ''
      if (task === 'edit' && chat?.cardEditContext?.version === 1) {
        const target = await waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId: chat.sessionId, sleep })
        legacyWorkspaceText = await ensureNativeCardWorkspace(target.session, chat)
      }
      return { task, text: runtimePrompt(promptName), legacyWorkspaceText }
    },
    async getCardMemory(args) {
      const chat = await chatForSession(args?.sessionId)
      if (!chat) return { enabled: false }
      return { enabled: true, ...await cardMemory.search(chat, args?.query, { manual: true }) }
    },
    async changeCardMemoryPreference(args) {
      return await cardMemory.preference(await chatForSession(args?.sessionId), args || {}, { manual: true })
    },
    async changeCardMemoryExperience(args) {
      return await cardMemory.experience(await chatForSession(args?.sessionId), args || {}, { manual: true })
    },
    async updateCard(args) {
      const change = await updateCard(args && args.path, args && args.patch)
      return { card: change.card, changed: change.changed }
    },
    // A log the host cannot open is repaired on demand: the client retries the open
    // once after this reports a rewrite, and untouched logs cost one read.
    async listMobileCardImports(args) {
      return await mobileCardImport.list()
    },
    async importMobileCard(args) {
      const archive = await mobileCardImport.archive(args && args.id)
      return { card: archive ? await importCardArchiveFile(archive.file, archive.name) : await importCard(await mobileCardImport.read(args && args.id)) }
    },
    async importCard(args) {
      return { card: await importCard(args && args.payload) }
    },
    async importCardUpload(args) {
      const upload = await uploads.take(args && args.uploadId)
      const name = str(args && args.name) || '人物卡.dshcard'
      try {
        if (/\.(charx|dshcard)$/i.test(name)) return { card: await importCardArchiveFile(upload.file, name) }
        if (await pluginApi.cardImporterFor(name)) return { card: await importPluginCardFile(upload.file, name) }
        throw new Error('无法识别的人物卡文件（需要 PNG、JSON、CHARX、DSH 人物卡 .dshcard，或装上能导入这种文件的插件）')
      }
      finally { await upload.remove() }
    },
    async cardPacks(args) {
      return { packs: await cardPacksOf(args && args.sessionId) }
    },
    async cardPlugins(args) {
      return { plugins: (await castAssets.read(normalizeResourcePath(args && args.path, 'card'))).plugins || [] }
    },
    async setCardPlugins(args) {
      return { plugins: await setCardPlugins(args && args.path, args && args.enabled === true) }
    },
    async cardPluginScopes(args) {
      return { scopes: Object.fromEntries([...await cardPlugins.scope()].map(([name, scope]) => [name, scope.cards])) }
    },
    async deleteCard(args) {
      return await deleteCard(args && args.path)
    },
    async exportCard(args) {
      const cardPath = args && args.path
      const workspace = await readCardWorkspace(cardPath)
      if (workspace === undefined) throw new Error('人物卡不存在: ' + (args && args.path))
      const characterBook = await worldBooks.characterBookForCard(cardPath)
      return { document: cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook }) }
    },
  }
}
