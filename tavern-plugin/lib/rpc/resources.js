import { normalizeResourcePath } from '../domain/file-resources.js'
import { canonicalTavernSkillName } from '../domain/tavern-skills.js'
import { worldBookViewForWire } from '../domain/worldbook-resource.js'

// Records handed to the client keep only what the panels render: the server-side `rawEntry`
// and `raw` copies of the source text stay here (they triple a large book's payload).
function worldBookForClient(record) {
  if (!record || typeof record !== 'object' || !record.view) return record
  return Object.assign({}, record, { view: worldBookViewForWire(record.view) })
}

// World books, presets, skills, scripts, regex and guide libraries.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createResourceHandlers(deps) {
  const { agentRegistry, bindScript, chatForSession, chatHeaderForSession, dataRoot, deletePreset,
    deleteResource, deleteScript, exportSettingsBundle, fileResources, groupOfMode, guideLibrary,
    importPreset, importScript, importSettingsBundle, importSource, listTavernResources, presetLibrary,
    previewPreset, readScript, readTavernSettings, renameResource, runtimePresets,
    scriptContinuity, scriptNavigation, sessionActivity, skillImportFiles, str, tavernSkills, updateChat,
    updateTavernSettings, worldBooks } = deps
  return {
    async getResourceWorkspace(args) {
      return { path: dataRoot + '/resources' }
    },
    async listResources(args) {
      return await listTavernResources()
    },
    async getResource(args) {
      const resourcePath = normalizeResourcePath(args && args.path, 'source')
      const text = await fileResources.readText(resourcePath)
      if (text === undefined) throw new Error('剧本不存在: ' + resourcePath)
      return { path: resourcePath, text }
    },
    async setGlobalWorldBook(args) {
      return worldBookForClient(await worldBooks.setGlobal(args && args.source, args && args.enabled))
    },
    async listWorldBooks(args) {
      const catalog = await worldBooks.catalog()
      const sessionId = str(args && args.sessionId)
      if (!sessionId) return catalog
      // 人物卡内置的世界书属于它那张卡：带上本局会话的卡，面板只列这一本，
      // 别的卡的书换到对应会话（或世界书库）里才出现。
      const chat = await chatHeaderForSession(sessionId, ['cardPath', 'cardName']).catch(() => null)
      return Object.assign({}, catalog, { sessionCardPath: str(chat && chat.cardPath), sessionCardName: str(chat && chat.cardName) })
    },
    async getWorldBook(args) {
      const source = args && args.source
      // A panel refresh may pass the revision it already holds. Answering that
      // from one stat keeps a reopen from loading or re-projecting the book.
      const ifRevision = args && args.ifRevision
      if (ifRevision !== undefined && ifRevision !== null && typeof worldBooks.revision === 'function') {
        const revision = await worldBooks.revision(source).catch(() => null)
        if (revision !== null && revision !== undefined && String(revision) === String(ifRevision)) {
          return { unchanged: true, source, revision }
        }
      }
      const record = await worldBooks.get(source)
      // Storage without a revision still needs the full-book comparison.
      if (ifRevision !== undefined && ifRevision !== null && record && record.revision !== undefined && record.revision !== null
        && String(record.revision) === String(ifRevision)) {
        return { unchanged: true, source: record.source, revision: record.revision }
      }
      return worldBookForClient(record)
    },
    async getWorldBookBinding(args) {
      return { binding: await worldBooks.binding(args && args.cardPath) }
    },
    async getWorldBookAssociations(args) {
      return { associations: await worldBooks.associations(args && args.source) }
    },
    async bindWorldBook(args) {
      return { binding: await worldBooks.bind(args && args.cardPath, args && args.source) }
    },
    async setWorldBookBindings(args) {
      return { binding: await worldBooks.setBindings(args && args.cardPath, args && args.sources) }
    },
    async unbindWorldBook(args) {
      return { binding: await worldBooks.unbind(args && args.cardPath, args && args.source) }
    },
    async importWorldBook(args) {
      return { worldBook: worldBookForClient(await worldBooks.import(args && args.payload)) }
    },
    async updateWorldBook(args) {
      const record = await worldBooks.update(args && args.source, args && args.update)
      // 快捷面板一次只翻一个开关：回身份与 revision，视图用客户端的乐观结果，
      // 不再每点一次就把整本书推回去。
      if (args && args.lean === true) {
        return { source: record.source, revision: record.revision === undefined ? null : record.revision, globalEnabled: record.globalEnabled, lean: true }
      }
      return worldBookForClient(record)
    },
    async exportWorldBook(args) {
      return { worldBook: await worldBooks.export(args && args.source) }
    },
    async deleteWorldBook(args) {
      return await worldBooks.remove(args && (args.source || args.path))
    },
    async listPresets(args) {
      return await presetLibrary.catalog()
    },
    async selectPreset(args) {
      return await presetLibrary.select(args && args.path)
    },
    async applyConversationPreset(args) {
      const sessionId = str(args?.sessionId)
      const chat = await chatForSession(sessionId)
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      if (typeof args.path !== 'string') throw new Error('请选择预设')
      if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用预设')
      const snapshot = args.path === '' ? null : await runtimePresets.fullSnapshot(args.path)
      // Only a new turn while the preset loaded is a conflict; display receipts and the like keep writing the save.
      const saved = await updateChat(chat.id, current => {
        if ((current.messages || []).length !== (chat.messages || []).length) throw new Error('当前游戏已变化，请刷新后重试')
        current.runtimePresetSnapshot = snapshot
        return current
      }, { source: 'preset.apply-conversation' })
      return { runtimePreset: saved.runtimePresetSnapshot === null ? null : { id: saved.runtimePresetSnapshot.presetPath, name: saved.runtimePresetSnapshot.presetName } }
    },
    async getPreset(args) {
      return { preset: await presetLibrary.detail(args && args.path) }
    },
    async exportPreset(args) {
      return await presetLibrary.export(args && args.path)
    },
    async movePresetEntry(args) {
      return { preset: await presetLibrary.moveEntry(args?.path, args?.entryKey, args?.phase, args?.beforeEntryKey, args?.revision) }
    },
    async updatePresetEntry(args) {
      return { preset: await presetLibrary.updateEntry(args && args.path, args && args.entryKey, args && args.patch) }
    },
    async updatePresetRegex(args) {
      return { preset: await presetLibrary.updateRegex(args && args.path, args && args.regexKey, args && args.patch !== undefined ? args.patch : args && args.enabled) }
    },
    async previewPresetConversion(args) {
      const preview = await previewPreset(args && args.path, args && args.orderGroupIndex)
      if (preview === undefined) throw new Error('预设不存在: ' + (args && args.path))
      return { preview }
    },
    async renameResource(args) {
      return { resource: await renameResource(args && args.path, args && args.name) }
    },
    async deleteResource(args) {
      return await deleteResource(args && args.path)
    },
    async deletePreset(args) {
      return await deletePreset(args && args.path)
    },
    async getDefaultWritingSkills(args) {
      const settings = await readTavernSettings()
      return { skills: (await tavernSkills.list()).filter(skill => skill.agents.includes('foreground')).map(skill => ({ name: skill.name, description: skill.description, enabled: !settings.defaultDisabledWritingSkills.includes(skill.name) })) }
    },
    async setDefaultWritingSkill(args) {
      const skill = await tavernSkills.read(args?.name)
      if (!skill?.agents.includes('foreground') || typeof args?.enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
      await updateTavernSettings({ defaultWritingSkill: { name: skill.name, enabled: args.enabled } })
      return { saved: true }
    },
    async getConversationWritingSkills(args) {
      const chat = await chatHeaderForSession(str(args?.sessionId), ['disabledWritingSkills'])
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      return { skills: (await tavernSkills.list()).filter(skill => skill.agents.includes('foreground')).map(skill => ({ name: skill.name, description: skill.description, enabled: !(chat.disabledWritingSkills || []).map(canonicalTavernSkillName).includes(skill.name) })) }
    },
    async setConversationWritingSkill(args) {
      const chat = await chatHeaderForSession(str(args?.sessionId), ['disabledWritingSkills'])
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      const skill = await tavernSkills.read(args.name)
      if (!skill?.agents.includes('foreground') || typeof args.enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
      await updateChat(chat.id, current => ({ ...current, disabledWritingSkills: args.enabled ? (current.disabledWritingSkills || []).map(canonicalTavernSkillName).filter(name => name !== skill.name) : [...new Set([...(current.disabledWritingSkills || []).map(canonicalTavernSkillName), skill.name])] }), { source: 'writing-skill.switch' })
      deps.invalidateTavernSkills()
      return { saved: true }
    },
    async listSkills(args) {
      return { skills: (await tavernSkills.list()).map(({ content, path, ...summary }) => summary) }
    },
    async editSkill(args) {
      return { skill: await tavernSkills.edit(args) }
    },
    async getSkill(args) {
      return { skill: await tavernSkills.read(args.name), references: await tavernSkills.referenceFiles(args.name) }
    },
    async assignSkill(args) {
      return { skill: await tavernSkills.assign(args.name, args.agents) }
    },
    async deleteSkill(args) {
      await tavernSkills.remove(args.name); return { deleted: true }
    },
    async importSkill(args) {
      return await tavernSkills.importBundle({ files: skillImportFiles(args), overwrite: args.overwrite === true })
    },
    async getScriptInfo(args) {
      const script = await readScript(args && args.path)
      const info = scriptContinuity.inspect({ script: script, state: null, request: { kind: 'info' } })
      return { script: script === undefined ? info : Object.assign({}, info, { path: script.path }) }
    },
    async importScript(args) {
      return { script: await importScript(args && args.cardPath, args && args.payload) }
    },
    async bindScript(args) {
      return { script: await bindScript(args && args.cardPath, args && args.path) }
    },
    async deleteScript(args) {
      return await deleteScript(args && (args.cardPath || args.path))
    },
    async importSource(args) {
      return { source: await importSource(args && args.payload) }
    },
    async importPreset(args) {
      return { preset: await importPreset(args && args.payload) }
    },
    async exportSettingsBundle(args) {
      return await exportSettingsBundle(args)
    },
    async importSettingsBundle(args) {
      return await importSettingsBundle(args)
    },
    async browseScript(args) {
      return await scriptNavigation.browse(args?.sessionId, args?.position)
    },
    async setScriptChunkSize(args) {
      return await scriptNavigation.setChunkSize(args?.sessionId, args || {})
    },
    async pointScript(args) {
      return await scriptNavigation.point(args?.sessionId, args || {})
    },
    async updateGuideLibrary(args) {
      return { item: await guideLibrary.update(args) }
    },
    async deleteGuideLibrary(args) {
      await guideLibrary.remove(args)
      return { ok: true }
    },
    async listGuideLibrary(args) {
      return { items: await guideLibrary.list() }
    },
    async getFrameStorage(args, method, serverTemplate, authority) {
      const { frameStorage } = deps
return { values: await frameStorage.read() }
    },
    async updateFrameStorage(args, method, serverTemplate, authority) {
      const { frameStorage } = deps
return await frameStorage.update(args && args.ops)
    },
  }
}
