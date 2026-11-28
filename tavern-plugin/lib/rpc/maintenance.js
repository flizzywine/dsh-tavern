import { resolveChatBackgroundModel } from '../domain/background-model-selection.js'
import { redactMvuLoadError, sanitizeModuleFailure, sanitizeMvuLoadDiagnostic } from '../domain/mvu-diagnostics.js'
import { saveSessionIds } from '../domain/save-upgrade.js'
import { exportSessionDiagnostics } from '../domain/session-diagnostics.js'
import { resolveTavernDataRoot } from '../domain/tavern-data.js'
import { isTavernAgentSession } from '../domain/tavern-agent-scope.js'
import path from 'node:path'

// Save upgrade, host patch, app update and diagnostics requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createMaintenanceHandlers(deps) {
  const { TAVERN_PACKAGE_VERSION, agentRegistry, applicationUpdater, attachPlayChatDebug,
    backgroundAgentRunner, chatForSession, chatHeaderForSession, compatibilityDiagnostics, ctx,
    displayRuntimeCaptures, exportTavernLogs, hostCompatibility, llm, modelRequestLog, modelSelection,
    mvuDiagnostics, pluginApi, preparedSaveSessions, readChat, readChatCard, readSessionMap,
    readTavernSettings, saveUpgrade, sessionPatch, sessionStateForSession, sessionStore, str,
    worldbookRecallLog } = deps
  let storageConversion = null
  const handlers = {
    // 设置 › 高级 › 现有存档的格式（实验）：手动把全部存档转成 Format 3，或转回 Format 2。一次只跑一批。
    async convertConversationStorage(args) {
      const format = args?.format
      if (format !== 2 && format !== 3) throw new Error('目标存档格式只能是 2 或 3')
      if (storageConversion) throw new Error('存档格式转换正在进行，请等它完成')
      storageConversion = deps.chatJournalStore.convertStorage(format)
      try { return await storageConversion } finally { storageConversion = null }
    },
    async getSaveUpgrade(args, method) {
      const chatId = (await readSessionMap())[str(args?.sessionId)]
      if (!chatId) throw new Error('找不到当前存档')
      return method === 'getSaveUpgrade' ? saveUpgrade.status(chatId) : saveUpgrade.start(chatId)
    },
    async exportSessionDiagnostics(args) {
      const chatId = str(args?.chatId) || (await readSessionMap())[str(args?.sessionId)]
      const chat = chatId && await readChat(chatId)
      if (!chat) throw new Error('找不到这局存档')
      const report = await exportSessionDiagnostics({
        sessionsRoot: path.join(path.dirname(resolveTavernDataRoot()), 'sessions'),
        sessionIds: saveSessionIds(chat),
        errorOf: id => preparedSaveSessions.get(id)?.error,
        tavernVersion: TAVERN_PACKAGE_VERSION,
        chat,
      })
      return { filename: '酒馆诊断-' + chat.id.slice(0, 8) + '.json', text: JSON.stringify(report) }
    },
    async getHostCompatibility(args) {
      return { compatibility: hostCompatibility }
    },
    async getSessionPatchStatus(args) {
      return { patch: sessionPatch.view() }
    },
    async getSessionPatchClient(args) {
      return sessionPatch.serverReady
        ? { source: sessionPatch.clientSource }
        : { source: '', skipped: sessionPatch.status === 'skipped', reason: sessionPatch.reason }
    },
    async confirmSessionPatch(args) {
      sessionPatch.confirmClient(args || {})
      return { patch: sessionPatch.view() }
    },
    async getUpdateStatus(args) {
      return { status: await applicationUpdater.status() }
    },
    async checkUpdate(args) {
      return { status: await applicationUpdater.check() }
    },
    async startUpdate(args) {
      return { status: await applicationUpdater.start() }
    },
    async cancelUpdate(args) {
      return { status: await applicationUpdater.cancel() }
    },
    async getTavernTrajectoryPolicy(args) {
      const sessionId = str(args?.sessionId)
      const game = sessionId ? await chatHeaderForSession(sessionId, []) : null
      const hideSystemReminders = Boolean(game) || await isTavernAgentSession(sessionId, {
        isGame: async id => id !== sessionId && Boolean(await chatHeaderForSession(id, [])),
        isBackground: id => backgroundAgentRunner.owns(id),
        readHeader: async id => {
          const live = sessionStore.get(id) || agentRegistry.get(id)?.session
          if (live) return live.header
          const query = ctx.get('sessionQuery')
          if (typeof query?.inspectSession === 'function') {
            return query.inspectSession(id, session => session.header).catch(() => null)
          }
          const snapshot = await query?.readSession(id).catch(() => null)
          return snapshot?.session
        }
      })
      const hideSkillContext = ['story', 'script'].includes(game?.mode)
        && Boolean(await pluginApi?.writingPreparation?.forGame(sessionId))
      return { hideSystemReminders, ...(hideSkillContext ? { hideSkillContext } : {}) }
    },
    async getLatestRequestContext(args) {
      const sessionId = str(args?.sessionId)
      const background = backgroundAgentRunner.requestContext(sessionId)
      const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      // A forked game has a parentSession too, but its requests are filed under its own chat.
      const own = background ? undefined : await sessionStateForSession(sessionId)
      const chat = own || await sessionStateForSession(background?.parentSessionId || session?.header?.parentSession || sessionId)
      const requestedScope = args?.scope === 'background' || args?.scope === 'foreground' ? args.scope : ''
      const effectiveScope = background ? 'background' : (requestedScope || 'foreground')
      const knownStatus = str(args?.knownStatus)
      const latestOptions = {
        ...(knownStatus ? { knownStatus } : {}),
        ...(background ? {} : (own || requestedScope ? { scope: effectiveScope } : {}))
      }
      const record = await modelRequestLog.latestForSession(sessionId, str(args?.knownId), chat?.id, Object.keys(latestOptions).length ? latestOptions : undefined)
      if (record?.unchanged && args?.includeMeta !== true) return { record }

      const settings = typeof readTavernSettings === 'function' ? await readTavernSettings().catch(() => null) : null
      const compactionPolicy = settings?.contextCompaction || null
      const reqProvider = record && !record.unchanged ? (record.provider || record.request?.provider) : ''
      const reqModel = record && !record.unchanged ? (record.model || record.request?.model) : ''
      let route = (reqProvider && reqModel)
        ? { provider: reqProvider, model: reqModel }
        : null
      if (!route && typeof modelSelection === 'function') {
        const fgSelection = modelSelection(sessionId)
        route = effectiveScope === 'background'
          ? resolveChatBackgroundModel(chat, fgSelection, settings)
          : fgSelection
      }
      const modelResolver = llm || ctx?.llm
      let contextWindow = null
      if (route?.provider && route?.model && typeof modelResolver?.resolveModelInfo === 'function') {
        const info = await Promise.resolve(modelResolver.resolveModelInfo(route.provider, route.model)).catch(() => null)
        const cw = Number(info?.context?.contextWindow)
        if (Number.isFinite(cw) && cw > 0) contextWindow = cw
      }
      const entries = chat?.id && typeof modelRequestLog?.list === 'function'
        ? await modelRequestLog.list(chat.id).catch(() => [])
        : []
      const hasBackground = record?.scope === 'background' || entries.some(item => item.scope === 'background')
      const recentSeries = chat?.id && typeof modelRequestLog?.recentSeries === 'function'
        ? await modelRequestLog.recentSeries(chat.id, {
          scope: effectiveScope,
          sessionId: effectiveScope === 'background' && !background ? '' : sessionId,
          limit: 12
        }).catch(() => [])
        : []
      return {
        record,
        meta: {
          scope: effectiveScope,
          contextWindow,
          compactionPolicy,
          hasBackground,
          recentSeries
        }
      }
    },
    async exportTavernLogs(args) {
      return await exportTavernLogs(args && args.sessionId)
    },
    async recordTavernCompatibilityCalls(args) {
      const chat = await chatHeaderForSession(str(args && args.sessionId), [])
      if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
      await compatibilityDiagnostics.record(chat.sessionId, args && args.runtimeId, args && args.calls)
      return { recorded: true }
    },
    async recordMvuRuntimeDiagnostic(args) {
      const chat = await chatHeaderForSession(str(args && args.sessionId), [])
      if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
      const diagnostic = args && args.diagnostic || {}
      if (diagnostic.kind === 'mvu-load') {
        const detail = sanitizeMvuLoadDiagnostic(diagnostic)
        if (!detail) return { recorded: false }
        try { await mvuDiagnostics.record(chat.sessionId, { stage: 'mvu-load', diagnostic: detail }) }
        catch { return { recorded: false } }
        return { recorded: true }
      }
      await mvuDiagnostics.record(chat.sessionId, { stage: 'script-runtime', diagnostic: { level: diagnostic.level === 'error' ? 'error' : 'warn', scriptId: str(diagnostic.scriptId).slice(0, 200), message: redactMvuLoadError(diagnostic.message, 4000), ...(sanitizeModuleFailure(diagnostic.moduleFailure) ? { moduleFailure: sanitizeModuleFailure(diagnostic.moduleFailure) } : {}) } })
      return { recorded: true }
    },
    async getWorldBookRecallLog(args) {
      const chat = await chatForSession(args && args.sessionId)
      if (!chat) throw new Error('对话不存在')
      return await worldbookRecallLog.read(chat, args && args.turn)
    },
    async getPlayChatDebugTarget(args) {
      const sourceChat = await chatForSession(args && args.sessionId)
      if (sourceChat === undefined || ((sourceChat.mode || 'story') !== 'story' && (sourceChat.mode || 'story') !== 'script')) throw new Error('当前对话不是游玩对话')
      const card = await readChatCard(sourceChat)
      return { card: { path: sourceChat.cardPath, name: card.name }, chatId: sourceChat.id }
    },
    async attachPlayChatDebug(args) {
      return { reference: await attachPlayChatDebug(args && args.targetSessionId, args && args.sourceSessionId, args && args.turn) }
    },
    async captureDisplayRuntime(args) {
      return await displayRuntimeCaptures.capture(args && args.sessionId, args && args.turn, args && args.partIndex, args && args.runtime)
    },
    async getDeploymentActivity(args, method, serverTemplate, authority) {
      const { agentRegistry, backgroundAgentRunner, backgroundTasks, deploymentActivity, deploymentWork, autoChoices, listTavernSessions, pluginSettlementProgress, taskStateReader } = deps
        const work = [], sessions = await listTavernSessions(), chats = []
        for (const { sessionId } of sessions) chats.push(await taskStateReader.forSession(sessionId))
        // No awaits from the live-owner snapshot through the hand-off return boundary.
        for (const [index, { sessionId }] of sessions.entries()) {
          const chat = chats[index], background = chat ? backgroundTasks.activity(chat) : null
          work.push(deploymentActivity({
            foreground: agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat?.regenInProgress,
            background, director: background?.director,
            progress: backgroundAgentRunner.progress(sessionId) || pluginSettlementProgress.snapshot(sessionId),
            choices: autoChoices.isPending(sessionId)
          }))
        }
        work.push(deploymentActivity({
          // Each game's background work is checked above, from its own save; voice and the coordinator report through deploymentWork.
          foreground: agentRegistry.list().some(agent => agent.phase.kind !== 'idle')
        }))
        // Work other modules registered (the stage director): each reports what deploymentActivity reads.
        for (const report of deploymentWork) work.push(deploymentActivity(report()))
        const reasons = [...new Set(work.flatMap(item => item.reasons))]
        return { work: { version: 1, busy: reasons.length > 0, reasons } }
    },
  }
  handlers.upgradeSave = handlers.getSaveUpgrade
  return handlers
}
