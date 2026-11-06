import path from 'node:path'
import { rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { readGameSave, sessionTitleOf } from './game-save.js'
import { assertImportableSave, createGameSaveImportContent } from './game-save-import-content.js'
import { beginRelaxedSync, endRelaxedSync, relaxedSyncPending } from './conversation-page-store.js'
const str = value => value == null ? '' : String(value)

/** Own import admission, publication and compensating cleanup. A game is published only after all restores succeed. */
export function createGameSaveImporter({ tavernVersion, dataRoot, readCard, prepareGameSaveResources, getAttachments,
  rawWriteChat, conversationRegistry, sessions, profileData, sceneWorldbookArchive, pluginApi,
  restorePresetSnapshot = async chat => chat,
  newChatId = () => 'chat-' + randomUUID(), newSessionId = () => 'session-' + randomUUID() }) {
  const importingGameSaves = new Set()
  async function importGameSave(args) {
    if (typeof args?.fileB64 !== 'string' || !args.fileB64) throw new Error('请选择 .dshsave 存档文件')
    const save = readGameSave(Buffer.from(args.fileB64, 'base64'), { tavernVersion })
    assertImportableSave(save)
    if (!save.card?.payload && !save.chat.cardDefinitionSnapshot && !await readCard(str(save.chat.cardPath)).catch(() => undefined)) throw new Error('存档包里没有人物卡，本机也没有这张卡，无法导入')
    const sourceChatId = str(save.chat.id), sourceSessionId = str(save.session.header?.id || save.chat.sessionId)
    if (!/^[a-zA-Z0-9_-]+$/.test(sourceChatId) || !/^[a-zA-Z0-9_-]+$/.test(sourceSessionId)) throw new Error('存档包里的游戏编号无效')
    if (importingGameSaves.has(sourceChatId)) throw new Error('这份存档正在导入，请稍候')
    importingGameSaves.add(sourceChatId)
    // 一局存档要写几千个不可变块：慢的时候得知道慢在哪个阶段，超过 1 秒才记一次。
    const startedAt = Date.now()
    const stageMs = {}
    let stageFrom = startedAt
    const markStage = stage => { stageMs[stage] = Date.now() - stageFrom; stageFrom = Date.now() }
    let importedResources
    try {
      const chatId = newChatId(), sessionId = newSessionId()
      // 1. Reuse matching resources; isolate conflicting cards and scripts.
      importedResources = await prepareGameSaveResources(save)
      markStage('resources')
      const { cardPath } = importedResources
      // 2. Images: store each picture here, then point every reference at the stored copy.
      const replacedRefs = new Map()
      for (const attachment of save.scene?.attachments || []) {
        if (!attachment.data) continue
        try { replacedRefs.set(attachment.attachmentId, await getAttachments().saveImage({ data: new Uint8Array(attachment.data), mediaType: attachment.mediaType, name: 'imported-save' })) }
        catch { /* An unreadable picture stays a dangling reference, like a deleted file. */ }
      }
      const content = createGameSaveImportContent(save, { chatId, sessionId, cardPath, replacedRefs })
      const { prepare, rename, renameJson } = content
      let written = false, created = false, saved
      const cwd = path.join(dataRoot, 'resources')
      // 一局存档要盖上千个目录，逐目录 fsync 在手机上就是几十秒。导入期间攒着，
      // 让这局可见之前一次性落盘；崩在中间只会留下用户看不见的半成品。
      beginRelaxedSync()
      let relaxed = true
      const settleDurability = async function () {
        if (!relaxed) return
        relaxed = false
        await endRelaxedSync()
      }
      try {
        // A save that came without its preset snapshot re-freezes it from the preset it points
        // at: the bundle installed that preset just before these games.
        // 只要最新进度时这些存档点不写：一局 7 份快照就是 7 倍写盘，还带来几千个块。
        const historyRevisions = args?.latestOnly === true ? [] : save.revisions
        for (const { revision, state } of historyRevisions) {
          const historyState = await rawWriteChat(await restorePresetSnapshot(prepare(state)), { source: 'game-save.import.history' })
          written = true
          content.recordRevision(revision, historyState._storageRevision)
        }
        markStage('revisions')
        if (args?.latestOnly === true) stageMs.skippedRevisions = save.revisions.length
        const current = await restorePresetSnapshot(prepare(save.chat))
        current.title = (sessionTitleOf(save.session.events) || str(save.chat.title) || str(save.chat.cardName) || '游戏') + '（导入）'
        current.lastOpenedAt = Date.now()
        current.importedSave = { sourceChatId, exportedAt: save.manifest.exportedAt, tavernVersion: save.manifest.tavernVersion }
        saved = await rawWriteChat(current, { source: 'game-save.import' })
        written = true
        markStage('current')
        // 5. Native session: same events and sequence numbers under the new id and this install's cwd.
        const events = renameJson(save.session.events)
        let handle
        try {
          handle = await sessions.create({ sessionId, events, cwd, preset: str(save.session.header?.agentPreset) || 'tavern' })
        } catch (error) { throw new Error('存档包已损坏：模型会话记录无法恢复（' + str(error?.message || error).slice(0, 200) + '）') }
        created = true
        try { await sessions.flush(handle.agent.session) } finally { await handle.dispose() }
        await sessions.attach(sessionId, cwd)
        markStage('session')
        // 6. Scene image records under the new chat.
        if (save.scene) {
          for (const file of save.scene.files) await profileData.writeBytes('scene-images/' + createHash('sha256').update(chatId).digest('hex') + '/' + rename(file.path),
            Buffer.from(JSON.stringify(renameJson(JSON.parse(file.content.toString('utf8'))))))
          await sceneWorldbookArchive.importForSave(chatId, [save.chat, ...save.revisions.map(item => item.state)], save.scene.worldbooks)
        }
        markStage('scene')
        // 7. Plugin data and media, re-keyed to the new game's text versions; their content is the plugins' own.
        if (save.plugins) {
          const files = new Map(), store = getAttachments()
          for (const attachment of save.plugins.attachments) {
            if (!attachment.data || !store) continue
            try {
              files.set(attachment.attachmentId, attachment.mediaType
                ? await store.saveImage({ data: new Uint8Array(attachment.data), mediaType: attachment.mediaType, name: 'imported-save' })
                : await store.saveFile({ data: new Uint8Array(attachment.data), name: attachment.name || 'file' }))
            } catch { /* The item that needs it is left out. */ }
          }
          await pluginApi.importGame({ targetChatId: chatId, targetSessionId: sessionId, keyMap: content.pluginKeys, data: save.plugins.data, media: save.plugins.media,
            attachment: ref => files.has(ref.attachmentId) ? { ...ref, ...files.get(ref.attachmentId) } : null })
        }
        markStage('plugins')
        stageMs.directories = relaxedSyncPending()
        await settleDurability()
        await conversationRegistry.publish(saved)
        markStage('publish')
      } catch (error) {
        await settleDurability().catch(() => {})
        if (created) {
          try { await sessions.detach(sessionId, cwd) } catch {}
          try { await sessions.remove(sessionId, cwd) } catch {}
        }
        if (written) try { await conversationRegistry.remove(chatId) } catch {}
        try { await sceneWorldbookArchive.forgetChat(chatId) } catch {}
        try { await rm(path.join(dataRoot, 'scene-images', createHash('sha256').update(chatId).digest('hex')), { recursive: true, force: true }) } catch {}
        throw error
      }
      const elapsed = Date.now() - startedAt
      if (process.env.DSH_TAVERN_FSYNC_COUNT === '1') console.log('TAVERN-FSYNC', JSON.stringify(Object.assign({ elapsed }, globalThis.__tavernFsync || {})))
      console.log('TAVERN-STORE-STATS', JSON.stringify(globalThis.__tavernStoreStats||{}))
      console.log('TAVERN-COUNTS', JSON.stringify(globalThis.__c||{}))
      if (elapsed >= 1000) {
        console.log('dsh-tavern: 导入存档「' + str(saved.title) + '」用时 ' + elapsed + ' ms（' +
          Object.entries(stageMs).map(function (row) { return row[0] + ' ' + row[1] }).join(' / ') + '）')
      }
      return { chatId, sessionId, cardPath, title: saved.title, revisions: save.revisions.length, images: replacedRefs.size, stageMs: elapsed >= 300 ? stageMs : undefined }
    } catch (error) {
      try { await importedResources?.rollback() } catch {}
      throw error
    } finally { importingGameSaves.delete(sourceChatId) }
  }
  return importGameSave
}
