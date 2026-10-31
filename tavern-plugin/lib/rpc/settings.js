import { readBackgroundModelReasoning } from '../domain/background-model-selection.js'
import { SYSTEM_PROMPT_NAMES } from '../prompt-catalog.js'

// Tavern settings, system prompts, user profile and background model requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createSettingsHandlers(deps) {
  const { agentRegistry, autoChoices, chatForSession, chatHeaderForSession, conversationBackgroundSettings, groupOfMode,
    llm, playCardSnapshots, presentSystemPrompts, presentUserPreferenceProfile, readTavernSettings,
    sessionActivity, str, tavernModelCatalog, updateChat, updateTavernSettings, userPreferenceProfile } = deps
  const handlers = {
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
      return { hideContextAndReasoning: settings.hideContextAndReasoning, headerItems: settings.headerItems, viewTabs: settings.viewTabs }
    },
    async getCandidatePreferences(args) {
      const { readTavernSettings } = deps

        const settings = await readTavernSettings()
        return { candidateDismissMode: settings.candidateDismissMode, candidateAutoGenerate: settings.candidateAutoGenerate }

    },

    async getTavernSettings(args) {
      const { assetEngineSettings, readTavernSettings, slotDeclarations, tavernModelCatalog } = deps
return { settings: await readTavernSettings(), modModelSlots: await slotDeclarations(), scoringCatalog: [assetEngineSettings.read().values.judge].filter(config=>config.provider!=='unset').map(({provider,model})=>({provider,model})), modelCatalog: await tavernModelCatalog() }
    },
    async updateTavernSettings(args) {
      const { checkSlotSelection, autoChoices, modService, updateTavernSettings } = deps

        if(args?.patch?.modModelSelection) {
          const {modId,slotId,selection}=args.patch.modModelSelection
          await checkSlotSelection({modId,slotId,selection})
        }
        const settings = await updateTavernSettings(args && args.patch)
        if(args?.patch?.modModelSelection)modService.invalidate()
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
    async getModelPricing(args, method, serverTemplate, authority) {
      const { modelSelection, routerPricing } = deps
return await routerPricing.quote(modelSelection(args && args.sessionId))
    },
  }
  handlers.getConversationBackgroundConfig = handlers.getConversationBackgroundModel
  handlers.setConversationBackgroundConfig = handlers.setConversationBackgroundModel
  return handlers
}
