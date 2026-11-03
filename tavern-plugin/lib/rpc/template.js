import { helperGenerationHistory, validateHelperGenerateConfig } from '../domain/helper-generation-prompts.js'
import { defaultOrderedRawConfig, generateHelper, generateHelperCompletion, generateHelperRaw } from '../domain/helper-generation.js'
import { sanitizeRuntimeDiagnostics } from '../domain/mvu-diagnostics.js'
import { hydrateTavernHelperMessages } from '../domain/tavern-helper-context.js'
import { recordVariableUpdate } from '../domain/variable-update.js'
import { estimateWorldBookTokens } from '../domain/worldbook-activation.js'
import { randomUUID } from 'node:crypto'

// Prompt template and Tavern Helper script runtime requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createTemplateHandlers(deps) {
  const { agentRegistry, callModel, chatForSession, chatPersistence, commands, ctx, fullTemplateRuntime,
    helperGenerationPreset, helperGenerationTasks, helperHistoryAccess, openingPreparation, pagesInFront,
    projectOpeningWindow, readCardExtensions, readChatCard, readOpeningWindow, readSessionMap, sessionViews,
    str, tavernScriptHostAdapter, updateChat, worldBooks } = deps
  const handlers = {
    async generateTavernHelper(args, method) {
      return await helperGenerationTasks.run(args?.sessionId, args?.config?.generation_id, async signal => {
        const chat = await chatForSession(args?.sessionId)
        if (!chat) throw new Error('找不到当前游戏')
        signal.throwIfAborted()
        const backgroundCall = opts => callModel({ ...opts, background: true, signal })
        if (method === 'generateTavernHelperRaw' && args.completion) return { text: await generateHelperCompletion(args.completion, { callModel: backgroundCall, sessionId: chat.sessionId }) }
        const context = { callModel: backgroundCall, sessionId: chat.sessionId, history: helperGenerationHistory(chat) }
        // generateRaw without an order is Tavern Helper's default-order request: build it like generate.
        const defaultOrder = method === 'generateTavernHelperRaw' ? defaultOrderedRawConfig(args.config) : null
        if (method === 'generateTavernHelperRaw' && !defaultOrder) return { text: await generateHelperRaw(args.config, context) }
        const config = defaultOrder || args.config
        validateHelperGenerateConfig(config)
        const card = await readChatCard(chat)
        const presetSnapshot = await helperGenerationPreset(config.preset_name, chat.runtimePresetSnapshot || null)
        const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
        const extensions = await readCardExtensions(chat.cardPath, chat)
        signal.throwIfAborted()
        return { text: await generateHelper(config, { ...context, chat, card, worldBook, presetSnapshot, extensions,
          presetRegexScripts: chat.runtimePresetSnapshot?.regexScripts || [], characterVariables: extensions?.variables || {} }) }
      }, args?.generationToken)
    },
    async stopTavernHelperGeneration(args) {
      return { stopped: helperGenerationTasks.stop(args?.sessionId, args?.generationId, { generationToken: args?.generationToken, pending: args?.pending }) }
    },
    async stopAllTavernHelperGeneration(args) {
      return { stopped: true, generationIds: helperGenerationTasks.stopAll(args?.sessionId, args?.pendingGenerations) }
    },
    async getTavernHelperContext(args) {
      if (!args?.eventId && args?.openingWindow === 1) {
        const window = await readOpeningWindow(args.sessionId)
        if (window) {
          const projected = await projectOpeningWindow(window)
          return { contextWindow: {historyWindow:projected.historyWindow,tavernHelper:projected.tavernHelper} }
        }
      }
      return { context: args?.eventId ? await tavernScriptHostAdapter.transactionContext(args.sessionId,args.eventId) : await tavernScriptHostAdapter.context(args && args.sessionId) }
    },
    async updateTavernHelperPrompts(args) {
      return await tavernScriptHostAdapter.updatePrompts(args && args.sessionId, args && args.operation, args && args.expectedLifecycleRevision, args && args.eventId)
    },
    async updateTavernHelperVariables(args) {
      const result = await tavernScriptHostAdapter.updateVariables(args && args.sessionId, args && args.option, args && args.variables, args && args.expectedLifecycleRevision, args && args.eventId, args && args.contextBaseline)
      // The variable panel's edits; card scripts never send variableUpdate.
      if (args?.variableUpdate && !result?.stale) {
        await recordVariableUpdate({ chatForSession, updateChat }, args.sessionId, args.variableUpdate, args.variables?.stat_data)
          .catch(error => console.warn('dsh-tavern: 记录变量更新失败:', error?.message || error))
      }
      return result
    },
    async updateTavernHelperMessages(args) {
      return await tavernScriptHostAdapter.updateMessages(args && args.sessionId, args && args.messages, args && args.expectedLifecycleRevision, args && args.eventId)
    },
    async createTavernHelperMessages(args) {
      return await tavernScriptHostAdapter.createMessages(args && args.sessionId, args && args.messages, args && args.option, args && args.expectedLifecycleRevision, args && args.eventId)
    },
    // Old pages must not create a second executor or receive server work.
    async releaseFullTemplateRuntime(args) {
      return { released: false }
    },
    async heartbeatFullTemplateRuntime(args) {
      return { active: false, executor: 'server' }
    },
    async claimFullTemplateWork(args) {
      return { event: null, executor: 'server' }
    },
    async startFullTemplateWork(args) {
      return { started: false }
    },
    async completeFullTemplateWork(args) {
      return { completed: false }
    },
    async executeTemplateHostCommand(args, method, serverTemplate) {
      if (!serverTemplate) throw new Error('模板命令仅由服务端执行器调用')
      const text = str(args.text)
      const send = /^\/send\s+([\s\S]+?)\|\s*\/trigger(?:\s+await=(?:true|false))?\s*$/i.exec(text)
      if (send || /^\/trigger(?:\s+await=(?:true|false))?\s*$/i.test(text)) {
        await ctx.get('sessionController').prompt({ sessionId: args.sessionId, requestId: randomUUID(),
          content: send ? [{ type: 'text', text: send[1].trim() }] : [], mode: 'followup' }, new AbortController().signal)
        return { pipe: '' }
      }
      if (/^\/setinput(?:\s|$)/.test(text)) throw new Error('服务端模板不能操作网页输入框，请使用 /send … | /trigger')
      const agent = agentRegistry.get(args.sessionId)
      if (!agent || !commands) throw new Error('当前会话没有可用的命令执行器')
      const result = await commands.execute(agent, text, [])
      if (!result || result.result?.kind === 'error') throw new Error(result?.result?.text || '未注册的模板命令')
      return { pipe: str(result.result?.text) }
    },
    async getFullTemplateWorldbook(args) {
      return await tavernScriptHostAdapter.getWorldbook(args.sessionId, args.name, true)
    },
    async replaceFullTemplateWorldbook(args) {
      return await tavernScriptHostAdapter.replaceWorldbook(args.sessionId, args.name, args.entries, args.expectedEntries, true)
    },
    async executeFullTemplateCommand(args) {
      return await fullTemplateRuntime.forSession(args.sessionId).command(args.text)
    },
    async countFullTemplateTokens(args) {
      return { tokens: estimateWorldBookTokens(args.text), estimator: 'unicode-estimate' }
    },
    async getGlobalPromptTemplateSettings(args) {
      return await tavernScriptHostAdapter.readGlobalPromptTemplateSettings()
    },
    async saveGlobalPromptTemplateSettings(args) {
      return await tavernScriptHostAdapter.saveGlobalPromptTemplateSettings(args.settings, args.expectedSettings)
    },
    async getFullPromptTemplateState(args) {
      if (args.sessionId?.startsWith('opening:')) return openingPreparation.templateState(args.sessionId.slice(8)); return await tavernScriptHostAdapter.readFullPromptTemplateState(args && args.sessionId, args?.cursor, args?.openingWindow === 1)
    },
    async getPromptTemplateHistory(args, method, serverTemplate) {
      if (!serverTemplate) throw new Error('Template history is server-only')
      return await helperHistoryAccess.read(args.token,args.messageId,args.messageId)
    },
    async saveFullPromptTemplateGlobals(args, method, serverTemplate) {
      if (!serverTemplate) throw new Error('提示词模板已迁移到服务端，请刷新页面'); if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateGlobals(args.sessionId.slice(8), args.variables); return await tavernScriptHostAdapter.saveFullPromptTemplateGlobals(args && args.sessionId, args && args.variables, args && args.expectedVariables)
    },
    async saveFullPromptTemplateSettings(args) {
      if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateSettings(args.sessionId.slice(8), args.settings); return await tavernScriptHostAdapter.saveFullPromptTemplateSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
    },
    async saveFullPromptTemplateState(args, method, serverTemplate) {
      if (!serverTemplate) throw new Error('提示词模板已迁移到服务端，请刷新页面'); if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateState(args.sessionId.slice(8), args.state); return await tavernScriptHostAdapter.saveFullPromptTemplateState(args && args.sessionId, args && args.state)
    },
    async saveTavernChatData(args) {
      return await tavernScriptHostAdapter.saveChatData(args && args.sessionId, args && args.request)
    },
    async saveTavernExtensionSettings(args) {
      return await tavernScriptHostAdapter.saveExtensionSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
    },
    async loadTavernWorldInfo(args) {
      return await tavernScriptHostAdapter.loadWorldInfo(args && args.sessionId, args && args.name)
    },
    async saveTavernWorldInfo(args) {
      return await tavernScriptHostAdapter.saveWorldInfo(args && args.sessionId, args && args.name, args && args.worldInfo, args && args.expectedWorldInfo)
    },
    async getTavernHelperWorldbook(args) {
      return await tavernScriptHostAdapter.getWorldbook(args && args.sessionId, args && args.name, false, args && args.knownVersion)
    },
    async patchTavernHelperWorldbook(args) {
      return await tavernScriptHostAdapter.patchWorldbook(args && args.sessionId, args && args.name, args && args.patch)
    },
    async replaceTavernHelperWorldbook(args) {
      return await tavernScriptHostAdapter.replaceWorldbook(args && args.sessionId, args && args.name, args && args.entries, args && args.expectedEntries)
    },
    async claimTavernScriptWork(args) {
      // A visible desktop page runs its game's card scripts; a hidden one or a
      // phone hands them to the server. Background games run nowhere.
      if (deps.serverScripts && args?.foreground === true && !String(args?.runtimeId || '').startsWith('server-')) {
        if (args?.pageActive === true) pagesInFront.set(String(args.sessionId || ''), Date.now())
        else deps.serverScripts.demand(args?.sessionId)
      }
      const claimed = await tavernScriptHostAdapter.claimWork(args && args.sessionId, args && args.runtimeId, args && args.ready, args && args.initializationError, args && args.contextBaseline)
      if (claimed?.event && String(args?.runtimeId || '').startsWith('server-')) console.log('dsh-tavern: 服务端卡脚本运行时领取事件', claimed.event.name, claimed.event.id)
      return claimed
    },
    async startTavernScriptWork(args) {
      return tavernScriptHostAdapter.startWork(args && args.sessionId, args && args.eventId, args && args.leaseToken, args && args.runtimeId)
    },
    async getTavernScriptWorkState(args) {
      return tavernScriptHostAdapter.workState(args && args.sessionId, args && args.eventId, args && args.leaseToken, args && args.runtimeId, args && args.keepAlive)
    },
    async heartbeatTavernScriptRuntime(args) {
      return tavernScriptHostAdapter.heartbeatRuntime(args && args.sessionId, args && args.runtimeId, args && args.ready, args && args.initializationError)
    },
    async completeTavernHelperEvent(args) {
      return { completed: tavernScriptHostAdapter.completeEvent(args && args.sessionId, args && args.eventId, args && args.args, args && args.runtimeId, args && args.leaseToken, args && args.error, sanitizeRuntimeDiagnostics(args && args.diagnostics)) }
    },
    async releaseTavernHelperRuntime(args) {
      return { released: tavernScriptHostAdapter.releaseRuntime(args && args.sessionId, args && args.runtimeId) }
    },
    async getFullTemplateRuntimeInfo(args) {
      throw new Error('提示词模板已迁移到服务端，请刷新页面');
    },
    async hydrateTavernHelperMessages(args) {
      const sessionId = args && args.sessionId
      const chatId = (await readSessionMap())[sessionId]
      if (args?.chatId && args.chatId !== chatId) throw new Error('聊天已切换，请重新读取历史')
      const selected = chatId && await chatPersistence.readHelperContext(chatId, {from:args?.from,to:args?.to,revision:args?.revision})
      if (selected && selected.chat.sessionId === sessionId && selected.chat.backgroundConfigVersion === 1 && selected.chat.conversationFeaturesVersion === 1) {
        const payload = {from:selected.from,to:selected.to,messages:selected.context.messages}
        sessionViews.acceptHelperMessages(sessionId,chatId,selected.chat._storageRevision,payload)
        return payload
      }
      const chat = await chatForSession(sessionId)
      if (!chat) throw new Error('请先打开游玩会话')
      return hydrateTavernHelperMessages(chat, args && args.from, args && args.to)
    },
  }
  handlers.generateTavernHelperRaw = handlers.generateTavernHelper
  return handlers
}
