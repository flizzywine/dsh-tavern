import { normalizeBackgroundModel, readBackgroundModelReasoning } from '../domain/background-model-selection.js'
import { SYSTEM_PROMPT_NAMES } from '../prompt-catalog.js'
import { configuredBodyGeneration } from '../domain/plugin-body-generation.js'
import { normalizeDisabledForegroundTools } from '../domain/foreground-tools.js'
import { canonicalTavernSkillName } from '../domain/tavern-skills.js'
import { normalizeConfiguredBackgroundTasks, normalizeDefaultBodyGeneration } from '../domain/tavern-settings.js'
import { DAMPER_KEY_REFS, validateNarrativeDamperConfig } from '../domain/narrative-damper.js'

// Tavern settings, system prompts, user profile and background model requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createSettingsHandlers(deps) {
  const { agentRegistry, autoChoices, chatForSession, chatHeaderForSession, conversationBackgroundSettings, groupOfMode,
    llm, playCardSnapshots, presentSystemPrompts, presentUserPreferenceProfile, readTavernSettings,
    sessionActivity, str, tavernModelCatalog, updateChat, updateTavernSettings, userPreferenceProfile } = deps
  const handlers = {
    async getBodyGenerationSettings(args) {
      const chat = await chatForSession(str(args?.sessionId))
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      return { ...configuredBodyGeneration(chat, await readTavernSettings()),
        inherited: chat.storyGenerationMode === undefined,
        hostRegexInherited: chat.storyPluginOutputRegex === undefined,
        providers: await deps.pluginApi.bodyGenerators.list(chat.sessionId) }
    },
    async setBodyGenerationSettings(args) {
      const chat = await chatForSession(str(args?.sessionId))
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      const regexChange = Object.hasOwn(args, 'hostRegex')
      const routeChange = !regexChange || args.inherit === true || Object.hasOwn(args, 'mode') || Object.hasOwn(args, 'provider')
      if (regexChange && args.hostRegex !== null && typeof args.hostRegex !== 'boolean') throw new Error('插件正文宿主正则设置无效')
      if (routeChange && args.inherit !== true) {
        if (!['host', 'plugin-direct', 'plugin-tool-call'].includes(args.mode)) throw new Error('正文生成方式无效')
        if (typeof args.provider !== 'string' || args.provider.length > 300) throw new Error('正文生成器无效')
        if (args.mode !== 'host') await deps.pluginApi.bodyGenerators.require(args.provider, chat.sessionId)
      }
      await updateChat(chat.id, current => {
        if (routeChange) {
          if (args.inherit === true) { delete current.storyGenerationMode; delete current.storyGenerationProvider }
          else { current.storyGenerationMode = args.mode; current.storyGenerationProvider = args.provider }
        }
        if (regexChange) {
          if (args.hostRegex === null) delete current.storyPluginOutputRegex
          else current.storyPluginOutputRegex = args.hostRegex
        }
        return current
      }, { source: 'settings.body-generation' })
      return handlers.getBodyGenerationSettings(args)
    },
    async getUserPreferenceProfile(args) {
      const chat = args?.sessionId && args.globalDefaults !== true ? await chatHeaderForSession(args.sessionId, ['userProfileEnabled','userProfileContextSnapshot','userProfileId','userProfileRevision']) : null
      return {
        userProfile: presentUserPreferenceProfile(await userPreferenceProfile.read()),
        currentConversation: chat && groupOfMode(chat.mode) === 'play' ? {
          enabled: chat.userProfileEnabled === true,
          content: chat.userProfileEnabled === true ? str(chat.userProfileContextSnapshot) : '',
          profileId: chat.userProfileId || 'default',
          revision: Math.max(0, Number(chat.userProfileRevision) || 0)
        } : null
      }
    },
    async manageUserPreferenceProfile(args) {
      return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.manage(args)) }
    },
    async updateUserPreferenceProfile(args) {
      return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.updateConfirmed(args)) }
    },
    async setConversationUserProfileEnabled(args) {
      const sessionId = str(args?.sessionId)
      const chat = await chatForSession(sessionId)
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      if (typeof args.enabled !== 'boolean') throw new Error('画像开关必须为布尔值')
      if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再切换画像')
      const patch = await playCardSnapshots.preferenceReplacement(chat, args.enabled, args.profileId)
      const saved = Object.keys(patch).length ? await updateChat(chat.id, current => {
        if (current._storageRevision !== chat._storageRevision || Number(current.cardContextRevision || 0) !== Number(chat.cardContextRevision || 0) || current.cardContextSnapshot !== chat.cardContextSnapshot || current.userProfileEnabled !== chat.userProfileEnabled) throw new Error('当前游戏配置已变化，请刷新后重试')
        return Object.assign(current, patch)
      }, { source: 'user-profile.toggle-conversation' }) : chat
      return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.read()), currentConversation: {
        content: saved.userProfileEnabled === true ? str(saved.userProfileContextSnapshot) : '',
        enabled: saved.userProfileEnabled === true, profileId: saved.userProfileId || 'default', revision: Math.max(0, Number(saved.userProfileRevision) || 0)
      } }
    },
    async setUserPreferenceProfileDefaultEnabled(args) {
      return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.setDefaultEnabled(args && args.enabled === true, args?.profileId)) }
    },
    async getConversationBackgroundModel(args) {
      return conversationBackgroundSettings.read(args?.sessionId)
    },
    async setConversationBackgroundModel(args) {
      return conversationBackgroundSettings.save(args)
    },
    async getBackgroundModelReasoning(args) {
      return { reasoning: await readBackgroundModelReasoning(llm, args) }
    },
    async getDisplayPreferences(args) {
      const settings = await readTavernSettings()
      return {
        showPlayProcess: settings.showPlayProcess,
        showDamperStatus: settings.narrativeDamper?.showTurnStatus !== false,
        hideContextAndReasoning: settings.hideContextAndReasoning,
        headerItems: settings.headerItems,
        viewTabs: settings.viewTabs
      }
    },
    async getCandidatePreferences(args) {
      const { readTavernSettings } = deps

        const settings = await readTavernSettings()
        return { candidateDismissMode: settings.candidateDismissMode, candidateAutoGenerate: settings.candidateAutoGenerate }

    },

    async getTavernSettings(args) {
      const { scoringCatalog, readTavernSettings, slotDeclarations, tavernModelCatalog } = deps
return { bodyGenerationProviders: await deps.pluginApi?.bodyGenerators?.list(), settings: await readTavernSettings(), modModelSlots: await slotDeclarations(), scoringCatalog: scoringCatalog(), modelCatalog: await tavernModelCatalog() }
    },
    async updateTavernSettings(args) {
      const { checkSlotSelection, autoChoices, modelSelectionChanged, updateTavernSettings } = deps

        if(args?.patch?.modModelSelection) {
          const {modId,slotId,selection}=args.patch.modModelSelection
          await checkSlotSelection({modId,slotId,selection})
        }
        const settings = await updateTavernSettings(args && args.patch)
        if(args?.patch?.modModelSelection)modelSelectionChanged()
        if (!settings.candidateAutoGenerate) autoChoices.cancelAll()
        return { settings }

    },
    async getSystemPrompts(args) {
      return { systemPrompts: presentSystemPrompts(await readTavernSettings()) }
    },
    async updateSystemPrompt(args) {
      const name = str(args && args.name)
      if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
      return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompt: { name, text: args && args.text } })) }
    },
    async resetSystemPrompts(args) {
      return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ resetSystemPrompts: SYSTEM_PROMPT_NAMES })) }
    },
    async getCardPersonas(args) {
      return { cardPersonas: (await readTavernSettings()).cardPersonas }
    },
    async manageCardPersona(args) {
      const action = str(args && args.action)
      if (!['select', 'create', 'duplicate', 'rename', 'delete', 'save', 'restore'].includes(action)) throw new Error('未知的性格操作')
      return { cardPersonas: (await updateTavernSettings({ cardPersona: { action, id: args.id, name: args.name, text: args.text } })).cardPersonas }
    },
    async manageSystemPromptSet(args) {
      const action = str(args && args.action)
      if (!['create', 'duplicate', 'select', 'rename', 'delete'].includes(action)) throw new Error('未知的系统提示词方案操作')
      return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ promptSet: { action, id: args.id, name: args.name } })) }
    },
    // Prices come from a plugin (tavern.pricingProvider); Tavern itself keeps no price tables.
    async getModelPricing(args) {
      const { modelSelection, pluginApi } = deps
      const [provider] = pluginApi.pricingProviders()
      if (!provider) return { available: false, reason: '没有插件提供模型价格' }
      return await provider.quote(modelSelection(args && args.sessionId))
    },
    async saveConversationSettingsAsDefaultTemplate(args) {
      const sessionId = str(args?.sessionId)
      const chat = await chatForSession(sessionId)
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      const currentSettings = await readTavernSettings()
      const warnings = []
      const playerName = str(chat.macroState?.userName).trim().slice(0, 80) || '你'
      const tasks = normalizeConfiguredBackgroundTasks(chat.backgroundTasks)
      const backgroundModel = normalizeBackgroundModel(chat.backgroundModelSelection)
      let includeBackgroundModel = true
      if (backgroundModel !== null && typeof llm?.resolveCallConfig === 'function') {
        try { await llm.resolveCallConfig(backgroundModel) } catch {
          includeBackgroundModel = false
          warnings.push('本局后台模型当前不可用，未更新默认后台模型')
        }
      }
      const disabledForegroundTools = normalizeDisabledForegroundTools(chat.disabledForegroundTools)
      const disabledWritingSkills = (Array.isArray(chat.disabledWritingSkills) ? chat.disabledWritingSkills : [])
        .map(canonicalTavernSkillName)
        .filter(name => typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      const defaultBodyGeneration = {
        mode: ['host', 'plugin-direct', 'plugin-tool-call'].includes(chat.storyGenerationMode) ? chat.storyGenerationMode : 'inherit',
        provider: typeof chat.storyGenerationProvider === 'string' ? chat.storyGenerationProvider : '',
        hostRegex: typeof chat.storyPluginOutputRegex === 'boolean' ? chat.storyPluginOutputRegex : null
      }
      if (defaultBodyGeneration.mode.startsWith('plugin-') && !defaultBodyGeneration.provider.trim()) {
        defaultBodyGeneration.mode = 'inherit'
      }
      const defaultPluginGameSettings = { ...(currentSettings.defaultPluginGameSettings || {}) }
      const gamePlugins = await deps.pluginApi?.gamePlugins?.(sessionId).catch(() => null)
      for (const entry of gamePlugins?.settings || []) {
        if (!entry.card && entry.plugin && entry.values) defaultPluginGameSettings[entry.plugin] = { ...entry.values }
      }
      const presetPath = str(chat.runtimePresetSnapshot?.presetPath || chat.runtimePresetPath)
      if (deps.presetLibrary) {
        if (presetPath === '') {
          await deps.presetLibrary.select('')
        } else {
          const preset = await deps.presetLibrary.read(presetPath).catch(() => undefined)
          if (preset && preset.valid === true && preset.recognized === true) await deps.presetLibrary.select(presetPath)
          else warnings.push('本局预设源文件不可用，未更新默认预设')
        }
      }
      if (userPreferenceProfile) {
        if (chat.userProfileEnabled === true) {
          const profileId = str(chat.userProfileId) || 'default'
          const profileDoc = await userPreferenceProfile.read()
          if (profileDoc.profiles?.some(item => item.id === profileId && item.hasConfirmed)) {
            await userPreferenceProfile.manage({ action: 'default', profileId })
          } else {
            warnings.push('本局长期偏好不可用，未更新默认长期偏好')
          }
        } else {
          await userPreferenceProfile.manage({ action: 'default', profileId: '' })
        }
      }
      const patch = {
        defaultPlaySettings: {
          playerName,
          backgroundTasks: { posture: tasks.posture !== false, styleReference: tasks.styleReference === true, foregroundCandidates: tasks.foregroundCandidates === true },
          webSearchEnabled: chat.webSearchEnabled === true
        },
        defaultDisabledForegroundTools: disabledForegroundTools,
        defaultDisabledWritingSkills: disabledWritingSkills,
        defaultBodyGeneration,
        defaultPluginGameSettings,
        ...(includeBackgroundModel ? { defaultBackgroundModel: backgroundModel } : {})
      }
      const settings = await updateTavernSettings(patch)
      return { saved: true, warnings, settings }
    },
    async restoreConversationSettingsFromDefaultTemplate(args) {
      const sessionId = str(args?.sessionId)
      let chat = await chatForSession(sessionId)
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      if ((await sessionActivity?.(sessionId))?.busy || agentRegistry?.get(sessionId)?.phase?.kind === 'running') {
        throw new Error('请等待当前生成和后台任务完成后再恢复默认模板')
      }
      const settings = await readTavernSettings()
      const defaults = settings.defaultPlaySettings
      const warnings = []
      let presetSnapshot = null
      if (deps.presetLibrary && deps.runtimePresets) {
        const presetCatalog = await deps.presetLibrary.catalog()
        const defaultPresetPath = str(presetCatalog?.activePresetPath)
        if (defaultPresetPath !== '') {
          try { presetSnapshot = await deps.runtimePresets.fullSnapshot(defaultPresetPath) } catch {
            presetSnapshot = null
            warnings.push('默认预设不可用，已切换为不使用酒馆预设')
          }
        }
      }
      let bodyDefaults = normalizeDefaultBodyGeneration(settings.defaultBodyGeneration)
      if (bodyDefaults.mode !== 'inherit' && bodyDefaults.mode !== 'host' && deps.pluginApi?.bodyGenerators?.require) {
        try { await deps.pluginApi.bodyGenerators.require(bodyDefaults.provider, chat.sessionId) } catch {
          bodyDefaults = { ...bodyDefaults, mode: 'inherit', provider: '' }
          warnings.push('默认正文生成插件不可用，已恢复为跟随全局设置')
        }
      }
      if (typeof deps.setPlayerName === 'function') {
        await deps.setPlayerName(sessionId, defaults.playerName)
        chat = await chatForSession(sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
      }
      let preferencePatch = {}
      if (userPreferenceProfile && playCardSnapshots) {
        const profileDoc = await userPreferenceProfile.read()
        const defaultProfileId = str(profileDoc?.defaultProfileId)
        const canEnableProfile = defaultProfileId !== '' && Boolean(profileDoc?.profiles?.some(item => item.id === defaultProfileId && item.hasConfirmed))
        if (defaultProfileId !== '' && !canEnableProfile) warnings.push('默认长期偏好不可用，已切换为不使用长期偏好')
        if (canEnableProfile || chat.userProfileEnabled === true) {
          if (!str(chat.cardContextSnapshot) && typeof deps.readChatCard === 'function') {
            const card = await deps.readChatCard(chat).catch(() => null)
            if (card) {
              await playCardSnapshots.ensure(chat, card)
              chat = await chatForSession(sessionId)
            }
          }
          preferencePatch = await playCardSnapshots.preferenceReplacement(chat, canEnableProfile, canEnableProfile ? defaultProfileId : undefined)
        }
      }
      await updateChat(chat.id, current => {
        if ((current.messages || []).length !== (chat.messages || []).length) throw new Error('当前游戏已变化，请刷新后重试')
        if (typeof deps.setPlayerName !== 'function') {
          current.macroState = { local: {}, global: {}, ...current.macroState, userName: defaults.playerName }
        }
        current.runtimePresetSnapshot = presetSnapshot
        current.runtimePresetPath = str(presetSnapshot?.presetPath)
        Object.assign(current, preferencePatch)
        current.backgroundConfigVersion = 1
        current.conversationFeaturesVersion = 1
        current.backgroundModelSelection = normalizeBackgroundModel(settings.defaultBackgroundModel)
        current.backgroundTasks = normalizeConfiguredBackgroundTasks(defaults.backgroundTasks)
        current.webSearchEnabled = defaults.webSearchEnabled === true
        current.disabledForegroundTools = normalizeDisabledForegroundTools(settings.defaultDisabledForegroundTools)
        current.disabledWritingSkills = [...(settings.defaultDisabledWritingSkills || [])]
        if (bodyDefaults.mode === 'inherit') {
          delete current.storyGenerationMode
          delete current.storyGenerationProvider
        } else {
          current.storyGenerationMode = bodyDefaults.mode
          current.storyGenerationProvider = bodyDefaults.provider
        }
        if (bodyDefaults.hostRegex === null) delete current.storyPluginOutputRegex
        else current.storyPluginOutputRegex = bodyDefaults.hostRegex
        return current
      }, { source: 'settings.restore-default-template' })
      deps.invalidateTavernSkills?.()
      await deps.pluginApi?.resetGamePluginSettings?.(sessionId, settings.defaultPluginGameSettings || {})
      return { restored: true, warnings }
    },
    async getNarrativeDamperSettings() {
      const settings = await readTavernSettings()
      const config = settings.narrativeDamper
      const credential = deps.narrativeDamper
        ? await deps.narrativeDamper.credentialStatus(config.provider, config.keyName)
        : { configured: false, source: null, keyName: config.keyName }
      return { config, credential }
    },
    async updateNarrativeDamperSettings(args) {
      const patch = args?.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('叙事阻尼器设置补丁无效')
      const updated = await updateTavernSettings({ narrativeDamper: patch })
      const config = updated.narrativeDamper
      const credential = deps.narrativeDamper
        ? await deps.narrativeDamper.credentialStatus(config.provider, config.keyName)
        : { configured: false, source: null, keyName: config.keyName }
      return { config, credential, settings: updated }
    },
    async setNarrativeDamperKey(args) {
      if (!deps.narrativeDamper) throw new Error('叙事阻尼器服务未就绪')
      const provider = str(args?.provider)
      const value = args?.value ?? null
      if (!Object.hasOwn(DAMPER_KEY_REFS, provider)) throw new Error('决策模型提供方无效')
      if (value !== null && (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value))) {
        throw new Error('API Key 须为不含空格或中文的可见 ASCII 字符')
      }
      let settings = await readTavernSettings()
      if (value !== null && await deps.narrativeDamper.isReference(value)) {
        settings = await updateTavernSettings({ narrativeDamper: { ...settings.narrativeDamper, provider, keyName: value } })
        await deps.narrativeDamper.setKey(provider, null)
      } else {
        await deps.narrativeDamper.setKey(provider, value)
      }
      const config = settings.narrativeDamper
      const credential = await deps.narrativeDamper.credentialStatus(provider, provider === config.provider ? config.keyName : '')
      return { credential, config }
    },
    async testNarrativeDamperConnection(args = {}) {
      if (!deps.narrativeDamper) throw new Error('叙事阻尼器服务未就绪')
      const draft = args?.config === undefined ? undefined : validateNarrativeDamperConfig(args.config)
      return deps.narrativeDamper.test(draft)
    },
  }
  handlers.getConversationBackgroundConfig = handlers.getConversationBackgroundModel
  handlers.setConversationBackgroundConfig = handlers.setConversationBackgroundModel
  return handlers
}
