import { redactMvuLoadError, sanitizeModuleFailure, sanitizeMvuLoadDiagnostic } from '../domain/mvu-diagnostics.js'
import { saveSessionIds } from '../domain/save-upgrade.js'
import { exportSessionDiagnostics } from '../domain/session-diagnostics.js'
import { resolveTavernDataRoot } from '../domain/tavern-data.js'
import path from 'node:path'

// Save upgrade, host patch, app update and diagnostics requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createMaintenanceHandlers(deps) {
  const { TAVERN_PACKAGE_VERSION, agentRegistry, applicationUpdater, attachPlayChatDebug,
    backgroundAgentRunner, chatForSession, chatHeaderForSession, compatibilityDiagnostics,
    displayRuntimeCaptures, exportTavernLogs, hostCompatibility, modelRequestLog, mvuDiagnostics,
    preparedSaveSessions, readChat, readChatCard, readSessionMap, saveUpgrade, sessionPatch,
    sessionStateForSession, sessionStore, str, worldbookRecallLog } = deps
  const handlers = {
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
    async getLatestRequestContext(args) {
      const sessionId = str(args?.sessionId)
      const background = backgroundAgentRunner.requestContext(sessionId)
      const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      // A forked game has a parentSession too, but its requests are filed under its own chat.
      const own = background ? undefined : await sessionStateForSession(sessionId)
      const chat = own || await sessionStateForSession(background?.parentSessionId || session?.header?.parentSession || sessionId)
      return { record: await modelRequestLog.latestForSession(sessionId, str(args?.knownId), chat?.id) }
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
          // Each game's background work is checked above, from its own save; speech keeps no running count.
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
