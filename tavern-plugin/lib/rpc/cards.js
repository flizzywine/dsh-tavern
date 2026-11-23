import { waitForWritableSession } from '../domain/agent-readiness.js'
import { normalizeResourcePath } from '../domain/file-resources.js'
import { pngPayload } from '../domain/mobile-card-import.js'
import { readFile, rm } from 'node:fs/promises'
import { isCardArchiveUpload } from '../domain/uploads.js'
import { encryptCardArchiveFile, isCardPasswordError } from '../domain/card-encryption.js'

// Card library, card workspace and card import requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createCardHandlers(deps) {
  const { agentRegistry, cardMemory, cardOrganization, cardPacksOf, cardPlugins, cardPreparation,
    cardTaskPrompts, castAssets, chatForSession, deleteCard, ensureNativeCardWorkspace, fileResources,
    importCard, importCardArchiveFile, importPluginCardFile, previewCardArchiveFile, replaceCard, revertCardUpdate, listCards, mobileCardImport, pluginApi,
    readCardWorkspace, runtimePrompt, sessionStore, setCardPlugins, sleep, str, updateCard, uploads,
    worldBooks } = deps

  const cardUploadFor = id => isCardArchiveUpload(id) ? deps.cardArchiveUploads : uploads

  async function readSessionScripts(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat?.cardPath) throw new Error('找不到对话或人物卡')
    const extensions = await deps.readCardExtensions(chat.cardPath, chat, true)
    return { chat, scripts: (extensions?.helperScripts || []).filter(script => script.type === 'script') }
  }

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
      return { replacementSupported: true, card: Object.assign(cardPreparation.present({ card: workspace, as: 'detail' }), { path: cardPath }) }
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
      const { path, updateCard } = deps

        // Same host function the card Agent's tavern_update_card tool ends at: Card Preparation
        // validation, the shared card lock and the projection bump. rawOperations (extension
        // fields such as /data/extensions/regex_scripts) stay on that one path; the revision entry
        // stays tool-owned so an RPC caller cannot write changelog records.
        const change = await updateCard(args && args.path, args && args.patch, undefined, args && args.rawOperations, {expectedAssetRevision: args && args.expectedAssetRevision, expectedRevision: args && args.expectedRevision})
        return { card: change.card, changed: change.changed }

    },
    // A log the host cannot open is repaired on demand: the client retries the open
    // once after this reports a rewrite, and untouched logs cost one read.
    async listMobileCardImports(args) {
      return await mobileCardImport.list()
    },
    async importMobileCard(args) {
      const archive = await mobileCardImport.archive(args && args.id)
      return { card: archive ? await importCardArchiveFile(archive.file, archive.name, { password: args?.password }) : await importCard(await mobileCardImport.read(args && args.id)) }
    },
    async importCard(args) {
      return { card: args?.replacePath ? await replaceCard(args.replacePath, { payload: args.payload }) : await importCard(args && args.payload) }
    },
    // An uploaded card archive before it is imported or replaces a card: its name, version, cover and the installed
    // packs it carries another version of (card-files.js previewCardArchiveFile). The upload stays for importCardUpload.
    async previewCardUpload(args) {
      const upload = await cardUploadFor(args?.uploadId).take(args?.uploadId)
      return await previewCardArchiveFile(upload.file, str(args?.name) || '人物卡.dshcard', { password: args?.password })
    },
    // packDecisions: pack id → 'update' | 'merge', for the packs previewCardUpload listed.
    async importCardUpload(args) {
      const name = str(args && args.name) || '人物卡.dshcard'
      if (isCardArchiveUpload(args?.uploadId) && !/\.(charx|dshcard)$/i.test(name)) throw new Error('分段上传仅支持 CHARX 和 DSHCARD 人物卡')
      const upload = await cardUploadFor(args?.uploadId).take(args?.uploadId)
      const packDecisions = args?.packDecisions ?? {}
      if (!packDecisions || typeof packDecisions !== 'object' || Array.isArray(packDecisions) || Object.values(packDecisions).some(value => typeof value !== 'string')) throw new Error('素材包的更新方式无效')
      let keepForPasswordRetry = false
      try {
        if (args?.replacePath) {
          if (/\.(charx|dshcard)$/i.test(name)) return { card: await replaceCard(args.replacePath, { file: upload.file, name, password: args.password, packDecisions }) }
          if (/\.png$/i.test(name)) return { card: await replaceCard(args.replacePath, { payload: pngPayload(await readFile(upload.file), name) }) }
          throw new Error('更新支持 PNG、JSON、CHARX 和 DSHCARD 人物卡')
        }
        if (/\.(charx|dshcard)$/i.test(name)) return { card: await importCardArchiveFile(upload.file, name, { password: args?.password, packDecisions }) }
        if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
        if (/\.png$/i.test(name)) return { card: await importCard(pngPayload(await readFile(upload.file), name)) }
        if (await pluginApi.cardImporterFor(name)) return { card: await importPluginCardFile(upload.file, name) }
        throw new Error('无法识别的人物卡文件（需要 PNG、JSON、CHARX、DSH 人物卡 .dshcard，或装上能导入这种文件的插件）')
      }
      catch (error) { keepForPasswordRetry = isCardPasswordError(error); throw error }
      finally { if (!keepForPasswordRetry) await upload.remove() }
    },
    async revertCardUpdate(args) {
      return await revertCardUpdate(args?.updateId)
    },
    async discardCardUpload(args) {
      if (isCardArchiveUpload(args?.uploadId)) await deps.cardArchiveUploads.discard(args.uploadId)
      else await (await uploads.take(args?.uploadId)).remove()
      return { removed: true }
    },
    async encryptCardUpload(args) {
      const upload = await uploads.take(args?.uploadId)
      const output = upload.file + '.encrypted'
      try {
        const name = str(args?.name) || '人物卡.dshcard'
        await encryptCardArchiveFile(upload.file, output, args?.password, { name })
        const filename = name.replace(/\.(dshcard|charx|png|json)(\.png)?$/i, '').replace(/[\\/:*?"<>|\r\n]/g, '_') + '-加密.dshcard'
        const stored = await deps.transferExports.putFile(output, filename)
        return { filename, bytes: stored.bytes, downloadUrl: '/api/dsh-tavern/transfer-export/' + encodeURIComponent(filename) + '?token=' + stored.token }
      } finally { await upload.remove(); await rm(output, { force: true }).catch(() => {}) }
    },
    // The current card as an encrypted DSH card: the same export (packIds / excludeFigures as the card-export route),
    // encrypted straight from its spool file.
    async encryptLibraryCard(args) {
      if (typeof args?.password !== 'string' || !args.password.length) throw new Error('请设置人物卡密码')
      const card = await deps.exportCardFile(normalizeResourcePath(args?.path, 'card'), { packIds: args?.packIds, excludeFigures: args?.excludeFigures })
      const output = card.file + '.encrypted'
      try {
        await encryptCardArchiveFile(card.file, output, args.password, { name: card.name + '.dshcard' })
        const filename = card.name.replace(/[\\/:*?"<>|\r\n]/g, '_') + '-加密.dshcard'
        const stored = await deps.transferExports.putFile(output, filename)
        return { filename, bytes: stored.bytes, downloadUrl: '/api/dsh-tavern/transfer-export/' + encodeURIComponent(filename) + '?token=' + stored.token }
      } finally { await card.dispose(); await rm(output, { force: true }).catch(() => {}) }
    },
    async decryptCardUpload(args) {
      const upload = await uploads.take(args?.uploadId), output = upload.file + '.decrypted'
      let retry = false
      try {
        const name = str(args?.name) || '人物卡.dshcard'
        await encryptCardArchiveFile(upload.file, output, args?.password, { name, decrypt: true })
        const filename = name.replace(/\.(dshcard|charx|png|json)(\.png)?$/i, '').replace(/[\\/:*?"<>|\r\n]/g, '_') + '-已解密.dshcard'
        const stored = await deps.transferExports.putFile(output, filename)
        return { filename, bytes: stored.bytes, downloadUrl: '/api/dsh-tavern/transfer-export/' + encodeURIComponent(filename) + '?token=' + stored.token }
      } catch (error) { retry = isCardPasswordError(error); throw error }
      finally { if (!retry) await upload.remove(); await rm(output, { force: true }).catch(() => {}) }
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
    async previewCardPluginUpdate(args) {
      const cardPath = normalizeResourcePath(args?.path, 'card')
      if (await fileResources.readCard(cardPath) === undefined) throw new Error('人物卡不存在')
      const upload = await deps.cardPluginUploads.take(args?.uploadId)
      try { return await deps.cardPluginUpdates.preview({cardPath, file:upload.file, pluginName:args?.pluginName}) }
      finally { await upload.remove() }
    },
    async recoverCardPluginUpdate() {
      return await deps.cardPluginUpdates.recover()
    },
    async updateCardPlugin(args) {
      const cardPath = normalizeResourcePath(args?.path, 'card')
      if (await fileResources.readCard(cardPath) === undefined) throw new Error('人物卡不存在')
      return await deps.cardPluginUpdates.confirm({cardPath, inspectionId:args?.inspectionId, acceptPluginRisk:args?.acceptPluginRisk})
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
    async reserveCardZipTarget(args, method, serverTemplate, authority) {
      const { cardZipTargets } = deps
return await cardZipTargets.reserve()
    },
    async releaseCardZipTarget(args, method, serverTemplate, authority) {
      const { cardZipTargets, normalizeResourcePath, path } = deps
return cardZipTargets.release(normalizeResourcePath(args && args.path, 'card'))
    },
    async duplicateCard(args, method, serverTemplate, authority) {
      const { duplicateCard, path } = deps
return { card: await duplicateCard(args && args.path, args && args.name) }
    },
    async getCardScriptSource(args) {
      const { scripts } = await readSessionScripts(args?.sessionId)
      const ref = str(args?.ref).trim(), id = str(args?.id).trim()
      const script = ref && scripts.find(item => item.ref === ref && item.id === id)
      if (!script) throw new Error('找不到该脚本，请重新打开卡片脚本页')
      return { content: script.content }
    },
    async setCardScriptMuted(args, method) {
      const { chat, scripts } = await readSessionScripts(args?.sessionId)
      if (method === 'setCardScriptMuted') {
        const id = str(args?.id).trim()
        if (!scripts.some(script => script.id === id)) throw new Error('Unknown card script ID')
        await deps.cardScripts.setMuted(chat.cardPath, id, args.muted)
      }
      return { cardName: str(chat.cardName), cardId: await deps.resolveCardId(chat.cardPath),
        ...await deps.cardScripts.list(scripts, chat.cardPath) }
    },
  }
}
