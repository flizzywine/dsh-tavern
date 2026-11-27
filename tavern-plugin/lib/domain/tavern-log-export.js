import { createMvuDiagnosticExport } from './mvu-diagnostics.js'
import { OFFICIAL_MVU_VERSION, inspectOfficialMvuAsset } from './official-mvu-assets.js'
import { createPresetDiagnostics } from './preset-diagnostics.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createTavernLogExporter({
  chatForSession, sessionStore, agentRegistry, backgroundParentSessionId, getPersistence, getSessionQuery, getAttachments,
  readChatCard, readCardExtensions, worldBooks, tavernRemoteAssets,
  mvuDiagnostics, compatibilityDiagnostics, apiDiagnostics, displayRuntimeStore,
  performanceDiagnostics, requestPerformance, sessionProjection, applicationUpdater, fullTemplateRuntime, readRuntime
}) {
  // Captures from the diagnostics store, falling back to ones old saves kept inline.
  async function displayDiagnosticFrames(chat) {
    const stored = await displayRuntimeStore.recent(chat.id).catch(() => ({}))
    return (chat.messages || []).filter(message => message.displayRuntime).slice(-20).flatMap(message => {
      const runtime = message.displayRuntime.version === 2 ? stored[String(message.turn)] : message.displayRuntime
      return (runtime?.frames || []).map(frame => ({ turn: message.turn, partIndex: frame.partIndex, panelId: frame.panelId, placement: frame.placement, capturedAt: frame.capturedAt, console: frame.console, errors: frame.errors, network: frame.network }))
    })
  }

  return async function exportTavernLogs(requestedSessionId) {
    let sessionId = str(requestedSessionId)
    let chat = await chatForSession(sessionId)
    // Opened from a background session: export its game's logs, which include this session.
    if (!chat) {
      let header = (sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session)?.header
      if (!header && sessionId) {
        try {
          const handle = await getPersistence().open(sessionId, 'read')
          try { header = handle.header } finally { await handle.close() }
        } catch {}
      }
      const parentId = str(backgroundParentSessionId(sessionId) || header?.parentSession)
      chat = parentId ? await chatForSession(parentId) : undefined
      if (chat) sessionId = parentId
    }
    if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const diagnostic = await mvuDiagnostics.read(sessionId)
    const backgroundSessionIds = [...new Set(diagnostic.records.map(record => record.traceSessionId).filter(Boolean))]
    let compatibilityDiagnostic
    try { compatibilityDiagnostic = await compatibilityDiagnostics.read(sessionId) }
    catch { compatibilityDiagnostic = { version: 1, records: [], error: '兼容能力诊断读取失败，仍导出其他日志。' } }
    const cardDiagnostics = { version: 1, capturedAt: Date.now(), source: 'export-time', cardPath: chat.cardPath, errors: [] }
    try { cardDiagnostics.card = await readChatCard(chat) }
    catch { cardDiagnostics.errors.push('人物卡读取失败') }
    try { cardDiagnostics.extensions = await readCardExtensions(chat.cardPath, chat) }
    catch { cardDiagnostics.errors.push('脚本与正则配置读取失败') }
    try {
      const worldbook = cardDiagnostics.card ? await worldBooks.bound(chat.cardPath, cardDiagnostics.card, chat) : null
      cardDiagnostics.worldbook = worldbook ? { source: worldbook.source, document: worldbook.view.raw } : null
    } catch { cardDiagnostics.errors.push('绑定世界书读取失败') }
    let presetDiagnostics
    try {
      const extensions = cardDiagnostics.extensions || {}
      const pinned = await tavernRemoteAssets.pinExtensions(extensions)
      presetDiagnostics = createPresetDiagnostics(chat, { ...extensions, regexScripts: pinned.regexScripts })
    } catch {
      presetDiagnostics = { ...createPresetDiagnostics(chat, cardDiagnostics.extensions || {}),
        error: '远程正则解析失败，ordered 保留解析前配置。' }
    }
    const exported = await createMvuDiagnosticExport({
      presetDiagnostics, cardDiagnostics,
      performanceDiagnostics: { ...performanceDiagnostics.read(), requests: requestPerformance.read(), replyProjection: sessionProjection.stats() },
      updateDiagnostics: applicationUpdater.diagnostics(),
      sessionId, backgroundSessionIds,
      displayDiagnostics: { version: 1, frames: await displayDiagnosticFrames(chat) },
      apiDiagnostics: await apiDiagnostics.read(sessionId).catch(() => null),
      compatibilityDiagnostics: compatibilityDiagnostic,
      store: mvuDiagnostics, sessions: sessionStore, persistence: getPersistence(),
      query: getSessionQuery(), attachments: getAttachments(),
      environment: {
        templateRuntime: await fullTemplateRuntime.inspect(sessionId),
        mvu: OFFICIAL_MVU_VERSION, mvuAsset: inspectOfficialMvuAsset(),
        runtime: { ...readRuntime(), platform: process.platform, arch: process.arch, nodeVersion: process.version }
      }
    })
    return { filename: exported.filename, base64: exported.buffer.toString('base64') }
  }
}
