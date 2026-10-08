import { ensureSessionVariableDirectory } from './domain/session-variable-directory.js'
import { createCompatibilityTurnCompiler } from './domain/compatibility-turn.js'
import { registerTavernHttpRoutes } from './http/routes.js'
import { registerRequestHooks } from './hooks/request.js'
import { registerModelStreamHooks } from './hooks/model-stream.js'
import { registerTurnLifecycleHooks } from './hooks/turn-lifecycle.js'
import { registerGameplayTools } from './tools/gameplay.js'
import { registerUserProfileTools } from './tools/user-profile.js'
import { registerSkillTools } from './tools/skills.js'
import { registerCardReadingTools } from './tools/card-reading.js'
import { registerPlayChatTool } from './tools/play-chat.js'
import { registerScriptTool } from './tools/script.js'
import { registerWorldbookTools } from './tools/worldbook.js'
import { registerPresetTools } from './tools/preset.js'
import { registerRegexLibraryTools } from './tools/regex-library.js'
import { registerCardEditingTools } from './tools/card-editing.js'
import { createConversationGuides } from './domain/conversation-guides.js'
import { createGuideLibrary } from './domain/guide-library.js'
import { createRegexLibrary } from './domain/regex-library.js'
import { copyJsonTree } from './domain/copy-json-tree.js'
import { createCandidateContextReader } from './domain/candidate-context-reader.js'
import { createCandidateWorldbookPreparation } from './domain/candidate-worldbook-preparation.js'
import { createTemplateWindowReader, templateStateFields } from './domain/template-window-reader.js'
import { createSessionResourceAccess } from './domain/session-resource-access.js'
import { worldBookDisplayName } from './domain/worldbook-resource.js'
import { createConversationMigration } from './domain/conversation-migration.js'
import { createTaskStateReader, taskStateFields } from './domain/task-state-reader.js'
import { installHostProjectionReplay } from './domain/host-projection-replay.js'
import { createBoundedHistory, readRecentWindow, readRowsAt } from './domain/bounded-history.js'
import { readSettlementInput } from './domain/settlement-input.js'
import { createHelperHistoryAccess } from './domain/helper-history-access.js'
import { createInputFieldsProjection } from './domain/input-fields-projection.js'
import { createScopedMessages, isScopedMessages } from './domain/scoped-messages.js'
import {registerVariableReadTool} from './domain/read-variables.js'
import { createBackgroundSessionRetirement, installRetiredBackgroundFilter } from './domain/background-session-retirement.js'
import { createCardMemory, CARD_MEMORY_TOOLS } from '../packages/dsh-tavern-card-memory/index.js'
import { projectPlayerContent } from './domain/player-input-content.js'
import { installSkillCatalogSessionScope } from './domain/skill-catalog-session-scope.js'
import { projectCardSummary } from './domain/card-preparation.js'
import { createCardSummaryCache } from './domain/card-summary-cache.js'
import { openingPreviewPayload, openingInitializationPayload } from './domain/opening-transport.js'
import { createLiveCardUpdate } from './domain/live-card-update.js'
import { createSessionViewReader, createSessionChatReader, createSessionSliceReader } from './domain/session-view-reader.js'
import { createSessionStateView, settlementTurn, pendingMvuSettlementState, projectDisplayRuntimeState } from './domain/chat-session-state.js'
import { createSettlementProgressGuard } from './domain/settlement-progress-guard.js'
import { createSettlementJobs } from './domain/settlement-jobs.js'
import { rescueHistoryNotice } from './domain/chat-history-rescue.js'
import { readHostCompatibility } from './domain/host-compatibility.js'
import { installHostSessionPatch } from './domain/host-session-patch.js'
import { installHostSubprocessPatch } from './domain/host-subprocess-patch.js'
import { migrateInstalledLegacySessions } from './domain/legacy-session-migration.js'
import { measureForegroundPressure } from './domain/foreground-context-pressure.js'
import { replaceSessionSurface } from './domain/session-surface-mutations.js'
import { createPresetDiagnostics } from './domain/preset-diagnostics.js'
import { createIncrementalReplyView } from './domain/incremental-reply-view.js'
import { createRequestPerformance } from './domain/request-performance.js'
import { scriptChunkLayout } from './domain/script-chunks.js'
import { createScriptNavigation } from './domain/script-navigation.js'
import { createSessionInventory } from './domain/session-inventory.js'
import { createSessionViewSync } from './domain/session-view-sync.js'
import { setFailedErrorVisibility, setAllFailedErrorVisibility } from './domain/failed-error-visibility.js'
import { createCharacterDesignPublisher } from './domain/character-design-worldbook.js'
import { createManualCharacterDesign } from './domain/manual-character-design.js'
import { prepareTemplateHistory, synchronizeTemplateHistory } from './domain/template-history.js'
import { createServerTemplateSync } from './domain/server-template-sync.js'
import { createServerTemplateRuntime } from './domain/server-template-runtime.js'
import { estimateWorldBookTokens, historyScanDepth } from './domain/worldbook-activation.js'
import { createWorldbookFilter, WORLD_BOOK_FILTER_TOOLS } from './domain/worldbook-filter.js'
import { createWorldbookPrefilter } from './domain/worldbook-prefilter.js'
import { adoptConversationFeatures, adoptConversationBackground, patchConversationBackground } from './domain/conversation-background.js'
import { clearLegacyTavernDefault } from './domain/legacy-agent-default.js'
import { conversationStateAtTurn, conversationForkBoundary } from './domain/conversation-fork-point.js'
import { createCardResponseTest } from './domain/card-response-test.js'
import { createGameplayApi } from './gameplay-api.js'
import { cardOpeningChoices } from './domain/card-openings.js'
import { marked } from 'marked'
import { resolveAgentCompaction } from './agent-compaction.js'
import { compactForegroundIfNeeded } from './domain/foreground-compaction.js'
import { compactBackgroundIfNeeded, measureBackgroundBudget } from './domain/background-compaction.js'
import { createAutoCompaction, installCompactionPolicy } from './domain/auto-compaction.js'
import { RETAINED_ROUNDS_WINDOW_SHARE, storyHistoryFullyRetained } from './domain/story-compaction.js'
import { createPerformanceDiagnostics } from './domain/performance-diagnostics.js'
import { createBackgroundSuppressionReader } from './domain/background-surface.js'
import { ensureCardWorkspaceMessage } from './domain/card-workspace-message.js'
import { createPromptTemplateGlobalVariables } from './domain/prompt-template-global-variables.js'
import { createTavernApiDiagnostics } from './domain/tavern-api-diagnostics.js'
import { generateHelper, generateHelperRaw, generateHelperCompletion, identifyHelperModelMessages } from './domain/helper-generation.js'
import { validateHelperGenerateConfig, resolveHelperGenerationPreset, helperGenerationHistory } from './domain/helper-generation-prompts.js'
import { createHelperGenerationTasks } from './domain/helper-generation-tasks.js'
import { createBodyEditor } from './domain/body-editor.js'
import { appendHelperUserSessionContext } from './domain/helper-user-session-context.js'
import { sessionOpeningDescriptor, prepareSessionOpening } from './domain/session-opening.js'
import { scriptPromptScanText } from './domain/tavern-script-prompts.js'
import { createOpeningPreparation } from './domain/opening-preparation.js'
import { createChatHistoryImportService } from './domain/chat-history-import-service.js'
import { sessionEvents } from './domain/session-events.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner, executeBackgroundCompaction } from './background-agent-runner.js'
import { createApplicationUpdater } from './application-updater.js'
import { CANDIDATE_SUBMIT_TOOL, SCRIPT_POINT_TOOL, SCRIPT_READ_TOOL, createCandidateGenerator } from './domain/candidate-generation.js'
import { computeSceneTarget, createSceneIllustrations, sceneTarget } from './domain/scene-illustration.js'
import { legacyImageConfigurationReader } from './domain/image-generation-host.js'
import { createPluginMedia, publicPluginMedia, pluginFileMediaType } from './domain/plugin-media.js'
import { createPluginTurnReader } from './domain/plugin-turns.js'
import { createTavernPluginApi } from './plugin-api.js'
import { createSceneWorldbooks, sceneWorldbookBinding } from './domain/scene-worldbook.js'
import { createSceneImageDiagnostics, createSceneImageHostLogger, recordSceneImageInteraction } from './domain/scene-image-diagnostics.js'
import { TAVERN_RELEASE_CAPABILITIES } from './domain/release-capabilities.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix } from './domain/session-stable-prefix.js'
import { waitForWritableSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { createCardOrganization } from './domain/card-organization.js'
import { countGamesByCard, orderCardsForLibrary } from './domain/card-list-order.js'
import { createCardPreparation } from './domain/card-preparation.js'
import { withGlobalRegexScripts, composeTavernRegexScripts } from './domain/card-extension-reading.js'
import { projectCardOpeningPreviews } from './domain/card-opening-previews.js'
import { createConversationInitialization } from './domain/conversation-initialization.js'
import { assertConversationForkable, conversationForkReceipt, forkConversationChat } from './domain/conversation-fork.js'
import { normalizeBackgroundModel, resolveChatBackgroundModel, readBackgroundModelReasoning } from './domain/background-model-selection.js'
import { createPlayCardSnapshots } from './domain/play-card-snapshots.js'
import { createUserPreferenceProfile } from './domain/user-preference-profile.js'
import { createContextPlanner } from './domain/context-planner.js'
import { createConversationMarkdownExport, conversationStoryTurns } from './domain/conversation-text-export.js'
import { createCoordinationEventPublisher } from './domain/coordination-event-publisher.js'
import { createSessionSignalTransport } from './domain/session-signal-transport.js'
import { createCandidateTasks } from './domain/candidate-tasks.js'
import { extractEpubText } from './domain/epub-text.js'
import { createFileResourceStore, normalizeResourcePath, resourceKind } from './domain/file-resources.js'
import { createMobileCardImport } from './domain/mobile-card-import.js'
import { createForegroundHandoff } from './domain/foreground-handoff.js'
import { createForegroundFrameBuilder } from './domain/agent-input-frame.js'
import { retireForegroundFrames } from './domain/foreground-frame-retirement.js'
import { compactionFailureMessage } from './domain/compaction-failure.js'
import { createForegroundFrameSessionAdapter } from './domain/foreground-frame-session-adapter.js'
import { HISTORY_RECALL_TOOL, createHistoryRecall, renderHistoryRecall } from './domain/history-recall.js'
import { createModelRequestLog } from './domain/model-request-log.js'
import { createDisplayRuntimeCoalescer } from './domain/display-runtime-coalescer.js'
import { MVU_SUBMIT_UPDATE_TOOL, collectMvuHelperContext, createMvuSettlementModule } from './domain/mvu-background-settlement.js'
import { applyMvuSettlementEffect } from './domain/mvu-settlement-effect.js'
import { createMvuSettlementReconciler } from './domain/mvu-settlement-reconciler.js'
import {
  CHARACTER_DESIGN_READ_TOOL,
  CHARACTER_DESIGN_SAVE_TOOL,
  CHARACTER_DESIGN_REUSE_TOOL,
  createCharacterDesignDocumentTools,
  projectCharacterDesignDocument
} from './domain/character-design-document.js'
import { createLedgerEditor } from './domain/ledger-editor.js'
import { readLedger, LEDGER_SUBMIT_TOOL } from './domain/story-ledger.js'
import { createManualLedger } from './domain/manual-ledger.js'
import { POSTURE_SUBMIT_TOOL, POSTURE_SUBMIT_TOOL_NAME, lastSubmittedPosture, normalizePostureSubmission } from './domain/posture-submission.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES, createTavernCompatibilityDiagnosticStore } from './domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, sanitizeRuntimeDiagnostics, sanitizeModuleFailure, sanitizeMvuLoadDiagnostic, redactMvuLoadError } from './domain/mvu-diagnostics.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from './domain/play-chat-debug.js'
import { createPhoneChat } from './domain/phone-chat.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { createForegroundOrchestrationStrategies } from './domain/foreground-orchestration-strategies.js'
import { clearFailedTurnSurface } from './domain/rollback-surface.js'
import { assistantResultForTurn } from './domain/session-turn-result.js'
import { forkTurnsByMessageId as forkTargetsFromSession } from './domain/conversation-fork-targets.js'
import { createTavernRetryLimiter } from './domain/tavern-retry-limiter.js'
import { lastTavernHelperVariables, projectTavernHelperContext, hydrateTavernHelperMessages, replaceTavernHelperVariables, HELPER_MESSAGE_COLD_WINDOW } from './domain/tavern-helper-context.js'
import { projectTavernHelperWorldbook } from './domain/tavern-helper-worldbook.js'
import { projectTavernHelperScripts, hasTavernScriptRuntime } from './domain/tavern-helper-scripts.js'
import { createTavernScriptDispatch } from './domain/tavern-script-dispatch.js'
import { createTavernExtensionSettings } from './domain/tavern-extension-settings.js'
import { createTavernScriptHostAdapter } from './domain/tavern-script-host-adapter.js'
import { createTavernRemoteAssetPinStore } from './domain/tavern-remote-assets.js'
import { OFFICIAL_MVU_VERSION, inspectOfficialMvuAsset } from './domain/official-mvu-assets.js'
import { createTavernStaticResourceCache } from './domain/tavern-static-resource-cache.js'
import { SILLYTAVERN_CSS_COMPAT_URLS } from './domain/sillytavern-css-compatibility.js'
import { createRoundHistory } from './domain/round-history.js'
import { createResourceWorkspaceProjection } from './domain/resource-workspace-projection.js'
import { projectAgentContent, projectAgentMessageText, projectRuntimeReply } from './domain/runtime-content-projection.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { appendWritingSkillState } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { createTavernSkillProvider } from './domain/tavern-skill-provider.js'
import { canonicalTavernSkillName, createTavernSkillModule } from './domain/tavern-skills.js'
import { readZipEntries, writeZipEntries } from './domain/zip-entries.js'
import { createGameFootprint } from './domain/game-footprint.js'
import { buildGameSave, collectSaveRevisions, readGameSave } from './domain/game-save.js'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const TAVERN_PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import { installTavernTokenMeter } from './domain/tavern-token-meter.js'
import { cordisToolNames, createTurnOrchestrator, dshFileToolNames } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { createWorldbookRecallLog, compactRecallDiagnostics } from './domain/worldbook-recall-log.js'
import { foregroundWorldbookReads } from './domain/worldbook-read-handoff.js'
import { createWorldbookSearch, sharedWorldbookSearch } from './domain/worldbook-search.js'
import { createForegroundWorldbook } from './domain/foreground-worldbook.js'
import { prepareTemplateWorldbook, mvuUpdateRulesFromWorldBook, prepareWorldBookRecall, projectWorldBookTemplates } from './domain/worldbook-recall.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore } from './profile-data-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import { createChatJournalStore } from './domain/chat-journal-store.js'
import { createResourceGraph } from './domain/resource-graph.js'
import { normalizeBackgroundTasks, applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from './domain/tavern-settings.js'
// Runtime reads go through runtimePrompt() so panel overrides apply; the raw
// file catalog only supplies built-in defaults.
import { prompt as promptFile, SYSTEM_PROMPT_DEFINITIONS, SYSTEM_PROMPT_NAMES } from './prompt-catalog.js'
// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。

export async function apply(ctx) {
  const persistence = ctx.get('sessionPersistence')
  try {
    const restoreSubprocess = await installHostSubprocessPatch({ persistence })
    ctx.effect(() => restoreSubprocess)
  } catch (error) {
    console.warn('dsh-tavern: Windows 后台窗口补丁未安装：' + error.message)
  }
  const sessionPatch = await installHostSessionPatch({
    persistence,
    query: ctx.get('sessionQuery'),
  })
  if (sessionPatch.status === 'failed') console.warn('dsh-tavern: 会话补丁未安装，正文编辑、回退和重新生成不可用：' + sessionPatch.reason)
  // 更新到 0.1.5-rc.2 后，每次启动都在对话被打开之前准备旧档。已经能打开的不改文件。补丁没装上也要做。
  if (sessionPatch.view().hostVersion === '0.1.5-rc.2') {
    const open = (persistence?.tracker?.openHandles?.size || 0) + (persistence?.tracker?.writers?.size || 0)
    if (open) console.warn('dsh-tavern: 会话已经打开，旧档留到下次启动再迁移')
    else await migrateInstalledLegacySessions(resolveTavernDataRoot(), sessionPatch.loadSessionCatalog)
  }
  await clearLegacyTavernDefault(ctx.get('settings'))
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  const sessionStore = ctx.get('sessions')
  ctx.effect(() => installTavernTokenMeter(ctx.get('tokenMeter')))
  ctx.effect(() => installHostProjectionReplay(ctx.get('sessionProjections')))
  if (llm === undefined || agentRegistry === undefined || sessionStore === undefined) {
    console.error('dsh-tavern: 缺少 llm、agents 或 sessions 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')
  let autoCompaction = null
  const compactionTimers = new Map()
  const compactionAbort = new AbortController()
  const sessionSignals = createSessionSignalTransport()
  function queueAutoCompaction(sessionId) {
    if (!autoCompaction || compactionAbort.signal.aborted || compactionTimers.has(sessionId)) return
    const timer = setTimeout(async () => {
      compactionTimers.delete(sessionId)
      const agent = agentRegistry.get(sessionId)
      if (!agent || agent.phase?.kind === 'running') return
      try { await autoCompaction.run(sessionId, { agent, signal: compactionAbort.signal }) }
      catch (error) { if (!compactionAbort.signal.aborted) console.warn('dsh-tavern: 自动压缩暂未执行:', str(error.message || error)) }
    }, 50)
    timer.unref?.(); compactionTimers.set(sessionId, timer)
  }
  ctx.effect(() => () => { compactionAbort.abort(); for (const timer of compactionTimers.values()) clearTimeout(timer) })
	const tavernScriptDispatch = createTavernScriptDispatch({
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) }
  })
  async function promptTemplateRuntime(sessionId) { return fullTemplateRuntime.forSession(sessionId) }
  const commands = ctx.get('commands')
  if (commands) ctx.effect(function* () {
    for (const name of ['ejs', 'ejs-refresh']) yield commands.register({
      name, description: name === 'ejs' ? '执行提示词模板' : '刷新提示词模板世界书',
      ...(name === 'ejs' ? {input:{hint:'模板正文或 block=true JavaScript'}} : {}),
      handler: async invocation => {
        try {
          const result = await fullTemplateRuntime.forSession(invocation.agent.session.id).command('/' + name + ' ' + invocation.rawInput)
          return { kind: 'success', text: String(result.pipe ?? '') }
        } catch (error) { return { kind: 'error', text: String(error.message || error) } }
      }
    })
  })
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  const dataRoot = resolveTavernDataRoot()
  const cardMemory = createCardMemory({ dataRoot })
  const stablePrefixStorage = createSessionStablePrefixStorage(dataRoot + '/session-prefixes')
  const profileData = createProfileDataStore({ dataRoot })
  const gameFootprint = createGameFootprint({ dataRoot })
  const deletedSessionIds = new Set()
  try { const removed = await gameFootprint.processDeferredDeletions(); if (removed) console.log('dsh-tavern: 已清理已删除游戏的原生会话', removed) }
  catch (error) { console.warn('dsh-tavern: 清理已删除游戏的原生会话失败', error?.message || error) }
  // Oldest floor each browser session has viewed; the template window covers it.
  const templateHistoryFrom = new Map()
  const fullTemplateRuntime = createServerTemplateRuntime({ store: profileData,
    rpc: (method, args) => dispatchMethod(method, args, true),
    onDiagnostic: diagnostic => console.warn('dsh-tavern: 服务端模板进程异常:', diagnostic)
  })
  let candidateWorldbookPreparation
  const templateSync = createServerTemplateSync({
    run: async sessionId => {
      const result=await fullTemplateRuntime.synchronize(sessionId)
      if(!result?.deferred)void candidateWorldbookPreparation?.warm(sessionId)
      return result
    },
    onError: error => console.warn('dsh-tavern: 服务端模板显示处理失败:', str(error.message || error))
  })
  // Every scheduling caller already has this committed chat. Do not read a
  // full history projection again just to check its mode or settlement status.
  function scheduleTemplateSync(chat, metadata) {
    if (/^candidate\.mailbox\.|^background\.candidate\.(begin|bind)$/.test(str(metadata?.source))) {
      templateSync.unchanged(chat.sessionId,chat._storageRevision)
      return
    }
    templateSync.schedule(chat.sessionId, chat._storageRevision, {
      enabled: groupOfMode(chat.mode || 'story') === 'play',
      blocked: ['pending', 'running'].includes(chat.settleStatus)
    })
  }
  ctx.effect(() => () => templateSync.dispose())
  ctx.effect(() => () => fullTemplateRuntime.dispose())
  const cardOrganization = createCardOrganization(profileData)
  const worldbookRecallLog = createWorldbookRecallLog({ store: profileData })
  const guideLibrary = createGuideLibrary({ store: profileData })
  const regexLibrary = createRegexLibrary({ store: profileData })
  const userPreferenceProfile = createUserPreferenceProfile({ store: profileData })
  const sceneWorldbooks = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneWorldbooks({ store: profileData }) : null
  const imageHostDiagnostic = createSceneImageHostLogger(ctx.logger)
  const sceneDiagnostics = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneImageDiagnostics(profileData, { onDiagnostic: imageHostDiagnostic }) : null
  async function captureSceneWorldbook(chat, card, preparedBook) {
    if (sceneWorldbooks === null) return null
    try {
      const worldBook = preparedBook === undefined ? await worldBooks.bound(chat.cardPath, card, chat) : preparedBook
      return await sceneWorldbooks.capture({ worldBook, chat, card })
    } catch (_error) {
      console.warn('dsh-tavern: 场景世界书快照保存失败，正文继续；不会用后来的世界书补历史。')
      return null
    }
  }
  const tavernExtensionSettings = createTavernExtensionSettings(profileData)
  const mvuDiagnostics = createMvuDiagnosticStore(profileData)
  ctx.effect(() => () => mvuDiagnostics.dispose(), 'dsh-tavern: flush diagnostic logs')
  const apiDiagnostics = createTavernApiDiagnostics(profileData)
  const compatibilityDiagnostics = createTavernCompatibilityDiagnosticStore(profileData)
  const requestPerformance = createRequestPerformance()
  const performanceDiagnostics = createPerformanceDiagnostics()
  const tavernRemoteAssets = createTavernRemoteAssetPinStore({
    onDiagnostic: row => performanceDiagnostics.opening(row),
    readJson: async function (path) { return await profileData.readJson(path) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
  const tavernStaticResources = createTavernStaticResourceCache({ rootDir: dataRoot + '/cache/static-assets' })
  void tavernStaticResources.warm(SILLYTAVERN_CSS_COMPAT_URLS).then(function (results) {
    const failures = results.filter(function (result) { return result.status === 'rejected' })
    if (failures.length > 0) console.warn('dsh-tavern: 部分静态运行库暂未缓存，将在使用时重试:', failures.map(function (result) { return str(result.reason && result.reason.message || result.reason) }).join('；'))
  })
  const settingsPath = 'tavern-settings.json'
  const promptTemplateGlobalVariables = createPromptTemplateGlobalVariables(profileData)
  const readPromptTemplateGlobalVariables = promptTemplateGlobalVariables.read
  const writePromptTemplateGlobalVariables = promptTemplateGlobalVariables.save
  let tavernSettingsDocument = await profileData.readJson(settingsPath)
  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(function (name) { return [name, promptFile(name)] }))
  }
  async function readTavernSettings() {
    tavernSettingsDocument = await profileData.readJson(settingsPath)
    return presentTavernSettings(tavernSettingsDocument, promptDefaults())
  }
  async function updateTavernSettings(patch) {
    if (patch && (Object.hasOwn(patch, 'backgroundModel') || Object.hasOwn(patch, 'backgroundTasks') || Object.hasOwn(patch, 'webSearchEnabled'))) throw new Error('后台配置已移至顶栏的本局设置')
    for (const name of ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel']) {
      if (patch?.[name] != null) await llm.resolveCallConfig(patch[name])
    }
    tavernSettingsDocument = await profileData.updateJson(settingsPath, function (current) {
      return applyTavernSettingsPatch(current, patch)
    })
    return presentTavernSettings(tavernSettingsDocument, promptDefaults())
  }
  function runtimePrompt(name) {
    if (name === 'system-append' && tavernSettingsDocument?.systemAppendEnabled === false) return ''
    return resolveSystemPrompt(tavernSettingsDocument, name, promptFile)
  }
  function presentSystemPrompts(settings) {
    const byName = Object.fromEntries((settings.systemPrompts || []).map(function (item) { return [item.name, item] }))
    return {
      spec: 'dsh-tavern.system-prompts',
      version: 1,
      systemAppendEnabled: settings.systemAppendEnabled === true,
      prompts: SYSTEM_PROMPT_DEFINITIONS.map(function (definition) {
        return Object.assign({}, definition, byName[definition.name] || { text: promptFile(definition.name), customized: false })
      })
    }
  }
  function importSystemPromptDocument(payload) {
    const prepared = prepareTextImport(payload, '系统提示词文件为空')
    let document
    try { document = JSON.parse(prepared.text) } catch (error) { throw new Error('系统提示词 JSON 无效: ' + str(error && error.message || error)) }
    if (!document || document.spec !== 'dsh-tavern.system-prompts') throw new Error('不是 DSH Tavern 系统提示词文件')
    if (Number(document.version) !== 1) throw new Error('不支持的系统提示词版本: ' + String(document.version))
    const source = document.prompts && typeof document.prompts === 'object' && !Array.isArray(document.prompts) ? document.prompts : {}
    const values = {}
    for (const name of SYSTEM_PROMPT_NAMES) {
      if (name === 'system-append' && source[name] === undefined) continue
      if (typeof source[name] !== 'string' || (source[name].trim() === '' && name !== 'system-append' && name !== 'card-system')) throw new Error('系统提示词文件缺少有效内容: ' + name)
      values[name] = source[name]
    }
    return values
  }
  const applicationUpdater = createApplicationUpdater({
    dataRoot,
    sourceRoot,
    hostDependencyAnchor: fileURLToPath(import.meta.url),
  })
  const modelRequestLog = createModelRequestLog({
    readJson: async function (path) { return await profileData.readJson(path) },
    writeJson: async function (path, value) { return await profileData.writeJson(path, value) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) },
    writeText: async function (path, text) { return await profileData.writeBytes(path, Buffer.from(text, 'utf8')) },
    remove: async function (path) { return await profileData.remove(path) }
  })
  // A single SKILL.md arrives as text; a skill folder arrives as a ZIP. Only UTF-8 Markdown is read.
  function skillImportFiles(args) {
    if (typeof args?.text === 'string') return { 'SKILL.md': args.text }
    if (typeof args?.fileB64 !== 'string' || !args.fileB64) throw new Error('请选择 SKILL.md 或 Skill 文件夹的 .zip 压缩包')
    const files = {}
    for (const [name, bytes] of readZipEntries(Buffer.from(args.fileB64, 'base64'), { label: 'Skill 压缩包' })) {
      if (name.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(name) || !/\.md$/i.test(name)) continue
      files[name] = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    }
    return files
  }
  const tavernSkills = createTavernSkillModule({
    directory: dataRoot + '/skills',
    builtInDirectory: sourceRoot + '/presets/tavern/skills',
    backgroundDirectory: sourceRoot + '/presets/tavern-background/skills'
  })

  async function skillRoleFor(agent) {
    const sessionId = agent?.session?.id
    if (!sessionId) return null
    if (backgroundAgentRunner.owns(sessionId)) return backgroundAgentRunner.requestContext(sessionId)?.task === 'image' ? 'image' : 'background'
    const chat = await backgroundConfigForSession(sessionId)
    return chat ? (chat.mode === 'card' ? 'card' : 'foreground') : null
  }
  async function skillEnabledFor(skill, agent) {
    if (await skillRoleFor(agent) !== 'foreground') return true
    const chat = await chatHeaderForSession(agent?.session?.id, ['disabledWritingSkills'])
    return !(chat?.disabledWritingSkills || []).map(canonicalTavernSkillName).includes(skill.name)
  }
  let invalidateTavernSkills = () => {}
  ctx.inject(['sessionSkillCatalog'], scope => {
    scope.effect(() => installSkillCatalogSessionScope(scope.get('sessionSkillCatalog')))
  })
  const skillRegistry = ctx.get('skills')
  if (!skillRegistry) throw new Error('dsh-tavern: 缺少原生 Skills 服务')
  skillRegistry.registerProvider(control => {
    invalidateTavernSkills = () => control.invalidate()
    const providers = [
      new FileSystemSkillProvider(ctx, control, { providerName: 'tavern-interactive-files', includeDefaultRoots: false, customSkillDirs: [dataRoot + '/skills'], bundledSkillDir: sourceRoot + '/presets/tavern/skills' }),
      new FileSystemSkillProvider(ctx, control, { providerName: 'tavern-background-files', includeDefaultRoots: false, bundledSkillDir: sourceRoot + '/presets/tavern-background/skills' })
    ]
    ctx.effect(() => tavernSkills.subscribe(control.invalidate))
    ctx.effect(() => () => Promise.all(providers.map(provider => provider.dispose())))
    ctx.on('fs/observed', (target, _observation, actor) => {
      if (actor?.name === 'write' || actor?.name === 'edit') providers.forEach(provider => provider.observeHostMutation(target.displayPath))
    })
    return createTavernSkillProvider({ providers, library: tavernSkills, roleFor: skillRoleFor, enabledFor: skillEnabledFor })
  })

  // ---------- profile 私有 preset ----------
  // rc.6 启动器会固定系统 roots，因此在独立 Tavern 进程内追加 profile 自带目录。
  // 不写入全局 `.agent-presets`，避免 Tavern 出现在普通 Web profile 的模式列表。
  const agentPresetsProxy = ctx.get('agentPresets')
  if (agentPresetsProxy === undefined) throw new Error('dsh-tavern: 缺少 agentPresets 服务')
  const agentPresets = agentPresetsProxy[Symbol.for('cordis.original')] || agentPresetsProxy
  const presetSourceDir = fileURLToPath(new URL('../../presets/', import.meta.url))
  if (!agentPresets.resolvedRoots.some(function (root) { return root.path === presetSourceDir })) {
    agentPresets.resolvedRoots.unshift({ path: presetSourceDir, trust: 'user' })
  }

  // ---------- 基础工具 ----------
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
  const runtimeGeneration = uid('runtime')
  const hostCompatibility = readHostCompatibility()
  let coordinationEvents = null
  function str(v) {
    return typeof v === 'string' ? v : (v === undefined || v === null ? '' : String(v))
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }
  async function readJson(rel) {
    return await profileData.readJson(rel)
  }
  async function writeJson(rel, value) {
    await profileData.writeJson(rel, value)
  }
  const CARD_PROJECTION_REVISIONS = 'card-projection-revisions.json'
  async function cardProjectionRevision(cardPath) {
    const state = await readJson(CARD_PROJECTION_REVISIONS)
    return Math.max(0, Number(state && state.cards && state.cards[str(cardPath)]) || 0)
  }
  async function bumpCardProjectionRevision(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const saved = await profileData.updateJson(CARD_PROJECTION_REVISIONS, function (value) {
      const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const cards = state.cards && typeof state.cards === 'object' && !Array.isArray(state.cards) ? state.cards : {}
      const version = Math.max(0, Number(state.version) || 0) + 1
      return { version, cards: Object.assign({}, cards, { [normalized]: version }) }
    })
    void coordinationEvents?.publishAll()
    return saved
  }
  function groupOfMode(mode) {
    const m = mode || 'story'
    return m === 'story' || m === 'script' ? 'play' : 'card'
  }
  function renderCardText(text, card, macroState = {}) {
    const result = projectAgentContent(text, {
      charName: str(card && card.name),
      macroState
    })
    macroState.userName = result.macroState.userName
    macroState.local = result.macroState.local
    macroState.global = result.macroState.global
    return result.renderedText
  }

  const settlementJobs = createSettlementJobs({ run: runSettlement, onSettled: onSettlementSettled })
  const scriptContinuity = createScriptContinuity()
  const storyTimeline = createStoryTimeline({ id: uid, now: Date.now })
  const cardPreparation = createCardPreparation({ id: function () { return uid('card') }, now: Date.now })

  // ---------- 模型调用 ----------
  const helperGenerationTasks = createHelperGenerationTasks()
  ctx.effect(() => () => helperGenerationTasks.dispose())
  function modelSelection(sessionId) {
    // 会话级选择优先：与官方 api-proxy 相同的读取路径
    if (typeof sessionId === 'string' && sessionId !== '') {
      try {
        const agents = ctx.get('agents')
        const agent = agents !== undefined ? agents.get(sessionId) : undefined
        if (agent !== undefined && agent.session !== undefined && typeof agent.session.requestHeader === 'function') {
          const pending = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending
          const cfg = pending || agent.session.requestHeader()?.config
          if (cfg !== undefined && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
            return { provider: cfg.provider, model: cfg.model, ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }) }
          }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取会话模型失败', err)
      }
    }
    if (agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel !== null && typeof sel === 'object' && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }) }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取默认模型失败', err)
      }
    }
    return null
  }
  function backgroundModelSelection(chat) {
    return resolveChatBackgroundModel(chat, modelSelection(chat && chat.sessionId))
  }
  async function tavernModelCatalog() {
    const providers = llm.listProviders()
    const groups = await Promise.all(providers.map(async function (provider) {
      try {
        const models = await llm.listModels(provider.id)
        return {
          provider: provider.id,
          providerName: provider.name || provider.id,
          models: models.filter(function (model) {
            return !Array.isArray(model.inputModalities) || model.inputModalities.includes('text')
          }).map(function (model) { return { id: model.id, name: model.name || model.id } })
        }
      } catch (error) {
        console.warn('dsh-tavern: 读取后台模型目录失败:', provider.id, error)
        return { provider: provider.id, providerName: provider.name || provider.id, models: [] }
      }
    }))
    return groups.filter(function (group) { return group.models.length > 0 })
  }
  async function callModel(opts) {
    opts.signal?.throwIfAborted()
    const sel = opts.background === true ? backgroundModelSelection(await backgroundConfigForSession(opts.sessionId)) : modelSelection(opts.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    // Codex Responses API 不接受 temperature；其他模型仍保留候选温度阶梯。
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    const prepared = await llm.prepareCall(cfg, opts.signal)
    opts.signal?.throwIfAborted()
    const options = Object.assign({}, prepared.config, { messages: identifyHelperModelMessages(opts.messages), system: opts.system }, opts.signal ? { signal: opts.signal } : {})
    let text = ''
    let finish = null
    try {
      for await (const chunk of prepared.stream(options)) {
        opts.signal?.throwIfAborted()
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (err) {
      opts.signal?.throwIfAborted()
      throw new Error('模型流失败: ' + (err && (err.message || err.code) || err))
    }
    opts.signal?.throwIfAborted()
    if (finish !== null && finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
      const f = finish.failure
      throw new Error('模型调用失败: ' + (f !== undefined && f !== null ? (f.message || f.code) : finish.kind))
    }
    if (finish !== null && finish !== undefined && finish.kind === 'max-tokens') {
      throw new Error('模型输出达到 token 上限')
    }
    const out = text.trim()
    if (out === '') throw new Error('模型返回为空')
    return out
  }

  // ---------- 角色卡 ----------
  async function readIndex() {
    const idx = await readJson('index.json')
    return (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
  }
  async function writeIndex(idx) { await writeJson('index.json', idx) }
  const fileResources = createFileResourceStore({ dataRoot })
  const resourceWorkspaceProjection = createResourceWorkspaceProjection({ root: dataRoot + '/resources' })
  const mobileCardImport = createMobileCardImport({ runtimeHost: process.env.DSH_TAVERN_RUNTIME_HOST })
  const cardDeletion = createCardDeletion({ resources: fileResources })
  const cardTaskPrompts = Object.freeze({
    edit: 'card-task-edit',
    extract: 'card-task-extract',
    script: 'card-task-script',
    material: 'card-task-script',
    worldbook: 'card-task-worldbook',
    preset: 'card-task-preset',
    'debug-play': 'card-task-debug-play'
  })
  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    if (cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(normalized, function (working, payload) {
      return cardPreparation.migrate({ working, payload })
    })
  }
  async function readCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const workspace = await readCardWorkspace(normalized)
    const card = workspace === undefined ? undefined : cardPreparation.project(workspace)
    if (card !== undefined) {
      card.path = normalized
      const raw = workspace.raw?.data || workspace.raw || {}
      card.extensions = structuredClone(raw.extensions || {})
    }
    return card
  }
  async function readCardExtensions(cardPath, chat) {
    const workspace = chat?.cardDefinitionSnapshot || await readCardWorkspace(cardPath)
    if (workspace === undefined) return undefined
    const extensions = cardPreparation.present({ card: workspace, as: 'card-extensions' })
    return withGlobalRegexScripts(extensions, await tavernExtensionSettings.read())
  }
  async function readScript(scriptOrCardPath) {
    if (str(scriptOrCardPath) === '') return undefined
    let scriptPath = str(scriptOrCardPath)
    if (scriptPath.startsWith('cards/')) scriptPath = await fileResources.scriptForCard(scriptPath)
    if (!scriptPath) return undefined
    const kind = resourceKind(scriptPath)
    if (kind !== 'source' && kind !== 'script') throw new Error('剧本引用必须指向剧本文件')
    const source = await fileResources.readText(normalizeResourcePath(scriptPath, kind))
    if (source === undefined) return undefined
    return { path: scriptPath, title: scriptPath.split('/').pop(), sourceChars: source.length, ...scriptChunkLayout(source) }
  }
  function prepareTextImport(payload, emptyMessage) {
    const source = payload !== null && typeof payload === 'object' ? payload : {}
    const name = str(source.name).trim()
    const isEpub = /\.epub$/i.test(name) || str(source.type).toLowerCase() === 'application/epub+zip'
    let text
    let originalText
    if (isEpub) {
      const encoded = str(source.fileB64).replace(/\s+/g, '')
      if (encoded === '') throw new Error('EPUB 文件内容为空')
      if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) throw new Error('EPUB 文件编码无效')
      text = extractEpubText(Buffer.from(encoded, 'base64'))
    } else {
      originalText = str(source.text)
      text = originalText
    }
    text = text.replace(/\r\n?/g, '\n').trim()
    if (text === '') throw new Error(emptyMessage)
    return Object.assign({}, source, { name, text, ...(originalText === undefined ? {} : { originalText }) })
  }
  async function importScript(cardPath, payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const existing = (await listSources()).find(function (source) { return source.title === prepared.name })
    const materialPath = existing ? existing.path : await fileResources.importText('source', prepared)
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length, importedAt: Date.now() }
  }
  async function bindScript(cardPath, materialPath) {
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length }
  }
  async function deleteScript(cardPath) {
    await fileResources.unbindMaterial(cardPath)
    return { unbound: true }
  }
  // ---------- 剧本（可独立保存，也可与人物卡一对一绑定） ----------
  async function readSource(sourcePath) {
    const normalized = normalizeResourcePath(sourcePath, 'source')
    const source = await fileResources.readText(normalized)
    if (source === undefined) return undefined
    return { path: normalized, title: normalized.split('/').pop(), sourceChars: source.length, ...scriptChunkLayout(source) }
  }
  async function listSources() {
    return await Promise.all((await fileResources.list('source')).map(async function (sourcePath) {
      const source = await readSource(sourcePath)
      return { path: sourcePath, title: source.title, sourceChars: source.sourceChars, chunkCount: source.chunks.length }
    }))
  }
  async function importSource(payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }
  const presetLibrary = createPresetLibrary({ resources: fileResources, state: profileData, prepareImport: prepareTextImport })
  const { read: readPreset, readDocument: readPresetDocument, preview: previewPreset,
    import: importPreset, editor: presetEditor, runtime: runtimePresets } = presetLibrary
  let resourceGraph
  async function renameResource(resourcePath, name) { return await resourceGraph.rename(resourcePath, name) }
  async function deleteLibraryResource(resourcePath, expectedKind) {
    const result = await resourceGraph.remove(resourcePath, expectedKind)
    return { removed: result.path }
  }
  async function deleteResource(resourcePath) { return await deleteLibraryResource(resourcePath, 'source') }
  async function deletePreset(resourcePath) {
    return await deleteLibraryResource(resourcePath, 'preset')
  }
  // The catalog is refetched on every card/worldbook change; reparsing every card each time blocked the server.
  const worldBookSummaryCaches = {}
  function cachedWorldBookSummary(kind) {
    return function (path, compute) {
      worldBookSummaryCaches[kind] ||= createCardSummaryCache({ absolute: value => fileResources.absolute(value), read: compute })
      return worldBookSummaryCaches[kind].read(path)
    }
  }
  const worldBooks = createWorldBookLibrary({
    normalizePath: normalizeResourcePath,
    summaries: { standalone: cachedWorldBookSummary('standalone'), card: cachedWorldBookSummary('card') },
    resources: {
      globalSources: async function () { return await fileResources.globalWorldBookSources() },
      setGlobal: async function (path, enabled) { return await fileResources.setGlobalWorldBook(path, enabled) },
      list: async function (kind) { return await fileResources.list(kind) },
      readText: async function (path) { return await fileResources.readText(path) },
      metadata: async function (path) { return await fileResources.metadata(path) },
      import: async function (prepared, working) { return await fileResources.importWorldBook(prepared, working) },
      write: async function (path, text) { return await fileResources.writeWorking(path, text) },
      bindingForCard: async function (cardPath) { return await fileResources.worldBookBindingForCard(cardPath) },
      bind: async function (cardPath, path) { return await fileResources.bindWorldBook(cardPath, path) },
      bindMany: async function (cardPath, sources) { return await fileResources.bindWorldBooks(cardPath, sources) },
      unbind: async function (cardPath) { return await fileResources.unbindWorldBook(cardPath) }
    },
    cards: {
      listPaths: async function () { return await fileResources.list('card') },
      read: readCard,
      metadata: async function (cardPath) { return await fileResources.metadata(cardPath) },
      update: async function (cardPath, patch) { return await updateCard(cardPath, patch) }
    },
    removeStandalone: async function (path) { return await deleteLibraryResource(path, 'worldbook') }
  })
  function emptyCardWorkspace() {
    return { mountedResources: [], sourcePaths: [], cursor: 0, prepared: null, done: false, player: '', draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', creator_notes: '', tags: [], alternate_greetings: [] } }
  }
  function normalizeChat(chat) {
    if (chat === undefined || chat === null || typeof chat !== 'object') return chat
    if (chat.mode === 'revision' || chat.mode === 'extract') chat.mode = 'card'
    if (chat.requestMode !== 'sillytavern') chat.requestMode = 'dsh'
    if (typeof chat.cardPath !== 'string') chat.cardPath = ''
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: '你', local: {}, global: {} }
    if (typeof chat.macroState.userName !== 'string' || chat.macroState.userName === '' || chat.macroState.userName === 'User') chat.macroState.userName = '你'
    if (chat.macroState.local === null || typeof chat.macroState.local !== 'object') chat.macroState.local = {}
    if (chat.macroState.global === null || typeof chat.macroState.global !== 'object') chat.macroState.global = {}
    if (chat.mode === 'card') {
      if (chat.workspace === null || typeof chat.workspace !== 'object') chat.workspace = chat.extract !== null && typeof chat.extract === 'object' ? chat.extract : emptyCardWorkspace()
      if (!Array.isArray(chat.workspace.mountedResources)) chat.workspace.mountedResources = []
      delete chat.extract
      if (chat.cardName === '抽取中') chat.cardName = str(chat.workspace.draft && chat.workspace.draft.name) || '卡片工作台'
    }
    return chat
  }
  const chatJournalStore = createChatJournalStore({ dataRoot, legacyData: profileData, now: Date.now, logger: console, backgroundSnapshots: true, newConversations: true, migrateLegacy: process.env.DSH_TAVERN_COMPATIBLE_STORAGE === '1' })
  ctx.effect(() => () => chatJournalStore.flushMaintenance(), 'dsh-tavern: finish queued Chat snapshots')
  const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: normalizeChat, now: Date.now })
  async function readChat(chatId) {
    const chat = await chatPersistence.read(chatId)
    return chat
  }
  async function readChatRevision(chatId, revision) { return await chatPersistence.readRevision(chatId, revision) }
  async function rawWriteChat(chat, metadata) {
    if (deletedChatIds.has(chat.id)) throw new Error('对话已删除')
    return await chatPersistence.write(chat, metadata)
  }
  async function rawUpdateChat(chatId, mutation, metadata) {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    return await chatPersistence.update(chatId, mutation, metadata)
  }
  let conversationRegistry
  async function syncChatSummary(chat) {
    if (!conversationRegistry || chat === undefined) return
    try { await conversationRegistry.sync(chat) }
    catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', str(error && error.message || error)) }
  }
  const deletedChatIds = new Set()
  async function writeChat(chat, metadata) {
    if (deletedChatIds.has(chat.id)) throw new Error('对话已删除')
    const saved = await rawWriteChat(chat, metadata)
    candidateWorldbookPreparation?.changed(saved,metadata)
    if (!str(metadata?.source).startsWith('candidate.mailbox.')) await syncChatSummary(saved)
    void coordinationEvents?.publish(saved.sessionId)
    scheduleTemplateSync(saved, metadata)
    if (!str(metadata?.source).startsWith('compaction.')) queueAutoCompaction(saved.sessionId)
    return saved
  }
  async function writeChatHeader(chat, baseline, metadata) {
    if (deletedChatIds.has(chat.id)) throw new Error('对话已删除')
    const saved = await chatPersistence.writeHeader(chat, baseline, metadata)
    candidateWorldbookPreparation?.changed(saved,metadata)
    await syncChatSummary(chat)
    void coordinationEvents?.publish(saved.sessionId)
    scheduleTemplateSync(saved, metadata)
    queueAutoCompaction(saved.sessionId)
    return saved
  }
  async function updateChat(chatId, mutation, metadata) {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    const saved = await rawUpdateChat(chatId, mutation, metadata)
    candidateWorldbookPreparation?.changed(saved,metadata)
    await syncChatSummary(saved)
    if (saved !== undefined) {
      void coordinationEvents?.publish(saved.sessionId)
      // A Skill switch changes future availability, not story/template data.
      // Do not let this settings write trigger maintenance that rewrites history.
      if (metadata?.source !== 'writing-skill.switch') {
        scheduleTemplateSync(saved, metadata)
        if (!str(metadata?.source).startsWith('compaction.')) queueAutoCompaction(saved.sessionId)
      }
    }
    return saved
  }
  async function patchChat(chatId, revision, changes, metadata) {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    const saved = await chatPersistence.patch(chatId, revision, changes, metadata)
    candidateWorldbookPreparation?.changed(saved,metadata)
    if (saved) {
      if (!str(metadata?.source).startsWith('candidate.mailbox.')) await syncChatSummary(saved)
      void coordinationEvents?.publish(saved.sessionId)
      scheduleTemplateSync(saved, metadata)
      queueAutoCompaction(saved.sessionId)
    }
    return saved
  }
  async function persistClearedBodyEdits(chat, cleared) {
    const drop = new Set(cleared || [])
    if (!chat?.id || !drop.size) return
    await updateChat(chat.id, current => {
      let changed = false
      for (const message of current.messages || []) {
        if (message.bodyEdit && drop.has(message.bodyEdit.id)) {
          delete message.bodyEdit
          changed = true
        }
      }
      return changed ? current : undefined
    }, { source: 'body-edit.stale-clear' })
  }
  conversationRegistry = createTavernConversationRegistry({
    store: {
      readAutomationOwner: async sessionId => readJson('automation/' + sessionId + '.json'),
      readLinks: async function () { return await readJson('sessions.json') },
      updateLinks: async function (updater) { return await profileData.updateJson('sessions.json', updater) },
      readIndex,
      writeIndex,
      readChat,
      readChatState: id => chatPersistence.readSessionState(id, {scoped:true}),
      readBackgroundConfig: chatPersistence.readBackgroundConfig,
      readSceneImageState: chatPersistence.readSceneImageState,
      writeChat: rawWriteChat,
      removeChat: async function (chatId) { await chatPersistence.remove(chatId) }
    }
  })
  async function readSessionMap() { return await conversationRegistry.links() }
  const sessionChats = createSessionChatReader({
    registry: conversationRegistry,
    needsAdoption: chat => groupOfMode(chat.mode) === 'play'
      && (chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1),
    adopt: async function (chat) {
      const legacyImageEnabled = sceneIllustrations ? (await sceneIllustrations.settings()).enabled === true : false
      return updateChat(chat.id, current => adoptConversationFeatures(adoptConversationBackground(current, tavernSettingsDocument), tavernSettingsDocument, legacyImageEnabled), { source: 'background-config.adopt' })
    }
  })
  function chatForSession(sessionId) { return sessionChats.read(sessionId) }
  function sessionStateForSession(sessionId) {
    return requestPerformance.stage('readSessionState', () => sessionChats.readState(sessionId))
  }
  function backgroundConfigForSession(sessionId) { return sessionChats.readBackgroundConfig(sessionId) }
  async function chatHeaderForSession(sessionId, fields) {
    const chatId = (await readSessionMap())[str(sessionId)]
    const selected = chatId && await chatPersistence.readSlice(chatId, [], [
      'id','sessionId','mode','backgroundConfigVersion','conversationFeaturesVersion', ...fields
    ])
    const chat = selected?.chat
    // Alias recovery and configuration adoption still require the original reader.
    if (chat && chat.sessionId === sessionId && chat.backgroundConfigVersion === 1 && chat.conversationFeaturesVersion === 1) return chat
    return chatForSession(sessionId)
  }
  const chatSliceForSession = createSessionSliceReader({ links: readSessionMap, readSlice: chatPersistence.readSlice })
  // Header plus floor count; null keeps the complete reader for legacy stories.
  async function openingStateForSession(sessionId) {
    const selected = await chatSliceForSession(sessionId, [], [...taskStateFields, 'preparedWorldBook'])
    if (!selected?.denseMessages || Object.values(selected.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) return null
    const first = selected.messageCount === 1 ? (await chatSliceForSession(sessionId, [0], ['_storageRevision']))?.chat.messages[0] : undefined
    return { chat: selected.chat, messageCount: selected.messageCount, firstGreeting: first?.greeting === true }
  }
  const taskStateReader = createTaskStateReader({
    readSlice: chatPersistence.readSlice, readState: chatPersistence.readSessionState,
    headerForSession: chatHeaderForSession, stateForSession: sessionStateForSession
  })
  const historyRecall = createHistoryRecall()
  const foregroundRecallScopes = new WeakMap()
  async function recallHistoryForSession(sessionId, args, scope, audience) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前 Session 没有对应的 Tavern Chat')
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('历史正文只能在游玩模式中检索')
    let result
    await updateChat(chat.id, current => {
      const previousCooldowns = current.historyRecallCooldowns
      result = historyRecall.recall(Object.assign({}, args || {}, { chat: current, scope, audience, trackCooldown: true }))
      return current.historyRecallCooldowns === previousCooldowns ? undefined : current
    }, { source: 'history-recall', touchUpdatedAt: false })
    return result
  }
  resourceGraph = createResourceGraph({
    cardOrganization,
    resources: fileResources,
    presets: runtimePresets,
    chats: { readIndex, writeIndex, readChat, writeChat },
    operations: {
      read: async function () { return await readJson('resource-graph-operation.json') },
      write: async function (operation) { await writeJson('resource-graph-operation.json', operation) },
      remove: async function () { await profileData.remove('resource-graph-operation.json') }
    }
  })
  async function readChatCard(chat) {
    if (chat.mode !== 'card' && chat.cardDefinitionSnapshot) return copyJsonTree(chat.cardDefinitionSnapshot)
    const card = await readCard(chat.cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + chat.cardPath)
    return card
  }
  async function importCard(payload) {
    const workspace = cardPreparation.create({ kind: 'import', payload: payload })
    const cardPath = await fileResources.importCard(payload, workspace)
    const card = cardPreparation.project(workspace)
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags }
  }
  const cardSummaries = createCardSummaryCache({
    absolute: cardPath => fileResources.absolute(cardPath),
    read: async cardPath => {
      const workspace = await readCardWorkspace(cardPath)
      return projectCardSummary(workspace)
    }
  })
  async function listCards() {
    const cardPaths = await fileResources.list('card')
    const scriptBindings = await fileResources.scriptBindingsForCards(cardPaths)
    const cards = await Promise.all(cardPaths.map(async function (cardPath) {
      try {
        const [card, hasImage] = await Promise.all([cardSummaries.read(cardPath), fileResources.hasCardImage(cardPath)])
        const scriptPath = scriptBindings[cardPath]
        return {
          path: cardPath,
          name: card.name,
          importedAt: card.importedAt,
          hasImage,
          script: scriptPath === undefined ? null : { path: scriptPath, title: scriptPath.split('/').pop() }
        }
      } catch {
        // A broken working file must not hide the remaining library. Keep its
        // identity visible; do not leak parser excerpts or overwrite evidence.
        return {
          path: cardPath, name: cardPath.split('/').pop().replace(/\.[^.]+$/, ''),
          importedAt: 0, hasImage: false, script: null,
          readError: '人物卡无法读取，请检查文件格式或访问权限：' + cardPath
        }
      }
    }))
    const gameCounts = countGamesByCard(await conversationRegistry.list().catch(() => []))
    return await cardOrganization.project(orderCardsForLibrary(cards, { gameCounts }))
  }
  async function resourceBindingProjection() {
    const cards = await listCards()
    return await Promise.all(cards.map(async function (card) {
      return {
        card: { path: card.path, name: card.name },
        script: card.script === null ? null : { path: card.script.path },
        worldbook: await fileResources.worldBookBindingForCard(card.path)
      }
    }))
  }
  async function resourceDiagnosticProjection(chat) {
    const references = Array.isArray(chat && chat.workspace && chat.workspace.mountedResources)
      ? chat.workspace.mountedResources.filter(function (item) { return item && item.kind === 'play-chat' })
      : []
    return await Promise.all(references.map(async function (reference) {
      try {
        const sourceChat = await readChat(reference.chatId)
        if (sourceChat === undefined) return { ref: reference.path, chatId: reference.chatId, turn: reference.turn, status: 'missing' }
        const overview = readPlayChatDebugTurn(chat, sourceChat, reference, { turn: reference.turn, layer: 'overview', limit: 6000 })
        return { ref: overview.ref, chatId: overview.chatId, turn: overview.turn, status: 'available', overview: overview.text,
          sourceUpdatedAt: Math.max(0, Number(reference.sourceUpdatedAt) || 0), cardSnapshotVersion: overview.cardSnapshotVersion, cardSnapshotDigest: overview.cardSnapshotDigest }
      } catch (error) {
        return { ref: str(reference && reference.path), chatId: str(reference && reference.chatId), turn: Math.max(0, Number(reference && reference.turn) || 0),
          status: 'unavailable', error: str(error && error.message || error).slice(0, 1000) }
      }
    }))
  }
  async function publishResourceWorkspace(sessionId, chat) {
    if (!chat || (chat.mode || 'story') !== 'card') return null
    return await resourceWorkspaceProjection.publish({
      sessionId,
      context: {
        chatId: str(chat.id), mode: 'card',
        card: str(chat.cardPath) === '' ? null : { path: str(chat.cardPath), name: str(chat.cardName) },
        // Only linked play records are session resources; files are addressed by path.
        playChats: (Array.isArray(chat.workspace && chat.workspace.mountedResources) ? chat.workspace.mountedResources : []).filter(item => item && item.kind === 'play-chat')
      },
      bindings: await resourceBindingProjection(),
      diagnostics: await resourceDiagnosticProjection(chat)
    })
  }
  const helperGenerationPreset = (name, snapshot) => resolveHelperGenerationPreset(name, snapshot, {
    catalog: () => presetLibrary.catalog(), read: readPreset, readDocument: readPresetDocument, selected: () => runtimePresets.state()
  })
  const openingPreparation = createOpeningPreparation({ readCard, worldBooks, extensionSettings: tavernExtensionSettings,
    readRuntimeExtensions: async cardPath => tavernRemoteAssets.pinExtensions(await readCardExtensions(cardPath)),
    generateRaw: (config, context) => generateHelperRaw(config, { ...context, callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) }),
    generate: async (config, context) => {
      validateHelperGenerateConfig(config)
      const presetSnapshot = await helperGenerationPreset(config.preset_name, context.presetSnapshot)
      const activeSnapshot = config.preset_name && config.preset_name !== 'in_use'
        ? await helperGenerationPreset('in_use', context.presetSnapshot) : presetSnapshot
      context.signal?.throwIfAborted()
      return generateHelper(config, { ...context, presetSnapshot, presetRegexScripts: activeSnapshot?.regexScripts || [], callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) })
    }
  })
  ctx.effect(() => () => openingPreparation.dispose())
  async function getCardOpenings(cardPath, userName, requestMode, previewTransport) {
    const startedAt = performance.now(), stages = {}
    let success = false
    async function timedStage(stage, operation) {
      const started = performance.now()
      try { return await requestPerformance.stage(stage, operation) } finally { stages[stage] = Math.round(performance.now() - started); performanceDiagnostics.opening({ stage, durationMs: stages[stage] }) }
    }
    try {
    const card = await timedStage('readCard', () => readCard(cardPath))
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const settings = await readTavernSettings()
    const cardExtensions = await timedStage('readExtensions', () => readCardExtensions(cardPath))
    const extensions = { ...cardExtensions, ...await timedStage('resources', () => tavernRemoteAssets.pinExtensions(cardExtensions)) }
    const preset = settings.compatibilityMode && requestMode === 'sillytavern'
      ? await runtimePresets.fullSnapshot()
      : null
    const previews = await timedStage('preview', () => projectCardOpeningPreviews({
      card,
      extensions,
      userName,
      presetRegexScripts: Array.isArray(preset && preset.regexScripts) ? preset.regexScripts : []
    }))
    const hasOpeningScript = opening => /<script\b/i.test(opening.projection.text) || opening.projection.parts.some(part => /<script\b/i.test(part.content || ''))
    const hasHelperScripts = projectTavernHelperScripts(extensions.helperScripts).scripts.length > 0
    const interactive = hasHelperScripts || previews.openings.some(hasOpeningScript)
    const preparation = interactive ? await timedStage('prepare', () => openingPreparation.create(cardPath, { card, extensions, runtime: (extensions.mvuResources || []).some(item => item.enabled !== false), userName })) : null
    if (preparation) {
      const choices = cardOpeningChoices(card)
      const swipes = choices.map(opening => opening.text)
      const openingIds = choices.map(opening => opening.id)
      for (const opening of previews.openings) if (hasHelperScripts || hasOpeningScript(opening)) {
        opening.openingPreview = { swipes, openingIds, selectedIndex: openingIds.indexOf(opening.id),
          messageHtml: opening.projection.parts.map(part => part.kind === 'markdown' ? marked.parse(str(part.text), { gfm: true }) : str(part.content)).join('\n'),
          preparationId: preparation.id, characterName: card.name, ...openingPreviewPayload(preparation, previewTransport) }
      }
    }
    success = true
    return {
      preparationId: preparation?.id || '',
      previewTransport: previewTransport === 'deferred-v1' ? previewTransport : undefined,
      openings: previews.openings,
      diagnostics: previews.diagnostics,
      trustedCardMode: settings.trustedCardMode
    }
    } finally {
      console.info('[dsh-tavern.opening]', JSON.stringify({ success, durationMs: Math.round(performance.now() - startedAt), stages }))
    }
  }
  function presentUserPreferenceProfile(value) {
    const confirmed = value && value.hasConfirmed && value.confirmed ? value.confirmed : null
    return {
      defaultProfileId: value?.defaultProfileId || '', profileId: value?.profileId, name: value?.name, profiles: value?.profiles || [],
      hasDraft: Boolean(value && value.hasDraft),
      draftRevision: value && value.hasDraft ? Number(value.draft && value.draft.revision) || 0 : 0,
      hasConfirmed: confirmed !== null,
      confirmedRevision: confirmed === null ? 0 : Number(confirmed.profileRevision) || 0,
      defaultEnabled: confirmed !== null && value.defaultEnabled === true,
      confirmed: confirmed === null ? null : {
        summary: str(confirmed.summary),
        injectionText: str(confirmed.injectionText),
        dimensions: Array.isArray(confirmed.dimensions) ? confirmed.dimensions : [],
        rawAnswers: Array.isArray(confirmed.rawAnswers) ? confirmed.rawAnswers : [],
        uncertainties: Array.isArray(confirmed.uncertainties) ? confirmed.uncertainties : [],
        confirmedAt: Number(confirmed.confirmedAt) || 0
      }
    }
  }
  async function listTavernResources() {
    const cards = await listCards()
    const sources = await listSources()
    return {
      cards,
      resources: sources.map(function (source) {
        const boundCards = cards.filter(function (card) { return card.script !== null && card.script.path === source.path }).map(function (card) { return { path: card.path, name: card.name } })
        return { path: source.path, previewPath: fileResources.absolute(source.path), title: source.title, sourceChars: Number(source.sourceChars) || 0, chunkCount: Number(source.chunkCount) || 0, boundCards }
      })
    }
  }
  async function updateCard(cardPath, patch, revision, rawOperations) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const change = cardPreparation.update({ kind: 'card', card: workspace, patch: patch, revision: revision, rawOperations: rawOperations })
    const savedWorkspace = change.card
    if (!change.changed) {
      const unchangedCard = change.view
      unchangedCard.path = cardPath
      unchangedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
      return Object.assign({}, change, { card: unchangedCard })
    }
    await fileResources.writeWorking(normalizeResourcePath(cardPath, 'card'), JSON.stringify(savedWorkspace, null, 2))
    await bumpCardProjectionRevision(cardPath)
    const savedCard = change.view
    savedCard.path = cardPath
    savedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
    if (change.nameChanged) await syncCardName(cardPath, savedCard.name)
    return Object.assign({}, change, { card: savedCard })
  }
  async function replaceCardVariables(cardPath, variables) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const raw = cardPreparation.present({ card: workspace, as: 'raw' })
    const root = raw && (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') && raw.data && typeof raw.data === 'object'
      ? '/data/extensions/tavern_helper/variables'
      : '/extensions/tavern_helper/variables'
    await updateCard(cardPath, {}, undefined, [{ op: 'set', path: root, value: variables }])
    return structuredClone(variables)
  }
  async function syncCardName(cardPath, cardName) {
    const idx = await readIndex()
    idx.chats = (idx.chats || []).map(function (item) { return item.cardPath === cardPath ? Object.assign({}, item, { cardName: cardName }) : item })
    await writeIndex(idx)
    for (const item of (idx.chats || []).filter(function (entry) { return entry.cardPath === cardPath })) {
      const linked = await readChat(item.id)
      if (linked !== undefined && linked.cardName !== cardName) {
        linked.cardName = cardName
        await writeChat(linked, { source: 'card-name.sync' })
      }
    }
  }
  async function restoreCurrentCard(sessionId) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') !== 'card') throw new Error('原版恢复只能在卡片模式中使用')
    const cardPath = str(chat.cardPath)
    if (cardPath === '') throw new Error('空白工作台没有可恢复的正式人物卡')
    const restored = await fileResources.restoreCard(cardPath, function (payload) {
      return cardPreparation.create({ kind: 'import', payload: payload })
    })
    const restoredCard = cardPreparation.project(restored.card)
    await bumpCardProjectionRevision(cardPath)
    await syncCardName(cardPath, restoredCard.name)
    return {
      path: cardPath,
      name: restoredCard.name,
      originalPath: restored.originalPath,
      backupPath: restored.backupPath
    }
  }
  async function deleteCard(cardPath) {
    const result = await cardDeletion.remove(cardPath)
    if (result.deleted) await cardOrganization.movePath(normalizeResourcePath(cardPath, 'card'), null)
    return result
  }
  const sessionInventory = createSessionInventory({
    persistence: ctx.get('sessionPersistence'), sessions: sessionStore, agents: agentRegistry,
    references: () => conversationRegistry.list(), archived: () => ctx.get('workspaceRegistry')?.archivedSessionIds
  })
  async function stopChatForDeletion(chatId) {
    const chat = await readChat(str(chatId))
    if (!chat) return
    const ids = new Set([chat.sessionId, ...Object.values(storyTimeline.inspect({ chat }).participants || {}).map(item => item.sessionId)])
    const workers = [...ids].map(id => agentRegistry.get(id)).filter(Boolean)
    for (const worker of workers) {
      if (typeof worker.cancel === 'function') worker.cancel({ kind: 'user' })
    }
    await cancelSettlement(chat.id)
    for (const worker of workers) {
      if (typeof worker.whenIdle === 'function') await worker.whenIdle()
    }
  }
  async function deleteChats(chatIds, prepareOnly = false) {
    if (!Array.isArray(chatIds) || chatIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效的对话')
    const results = []
    // Registry index updates must remain sequential.
    for (const chatId of new Set(chatIds)) {
      try {
        if (prepareOnly) await stopChatForDeletion(chatId)
        else await deleteChat(chatId)
        results.push({ chatId, ok: true })
      } catch (error) { results.push({ chatId, ok: false, error: String(error?.message || error) }) }
    }
    return { results }
  }
  // A background session is this game's only if its stored parent is this game's foreground
  // session and no other game still refers to it (imports used to keep foreign ids).
  async function ownsBackgroundSession(chat, sessionId) {
    const index = await readIndex()
    if ((index.chats || []).some(row => row.id !== chat.id && (row.backgroundSessionId === sessionId || (row.backgroundHistoryIds || []).includes(sessionId)))) return false
    try {
      const handle = await ctx.get('sessionPersistence').open(sessionId, 'read')
      try { return handle.header?.parentSession === chat.sessionId } finally { await handle.close() }
    } catch { return false }
  }
  async function deleteChat(chatId) {
    await stopChatForDeletion(chatId)
    const chat = await readChat(str(chatId))
    const footprint = chat ? await gameFootprint.describe(chat, { ownsSession: id => ownsBackgroundSession(chat, id) }) : null
    const result = await conversationRegistry.remove(chatId)
    deletedChatIds.add(chatId)
    await pluginMedia.removeChat(chatId).catch(() => console.warn('dsh-tavern: 插件媒体记录清理失败', chatId))
    pluginApi.gameRemoved(footprint?.foregroundSessionId || chat?.sessionId)
    if (footprint) {
      deletedSessionIds.add(footprint.foregroundSessionId)
      await apiDiagnostics.forget(footprint.foregroundSessionId).catch(() => {})
      await backgroundAgentRunner.releaseFor(footprint.foregroundSessionId)
      // A session DSH still holds loaded would be written back; delete it on the next start.
      const live = footprint.items.filter(item => item.category === 'subsession' && agentRegistry.get(item.sessionId))
      footprint.items = footprint.items.filter(item => !live.includes(item))
      await gameFootprint.deferSessionDeletion(live)
      const cleanup = await gameFootprint.removeLeftovers(footprint)
      if (cleanup.failures.length) console.warn('dsh-tavern: 删除游戏后有残留未清理', chatId, cleanup.failures.slice(0, 5))
    }
    return result
  }
  async function exportConversation(chatId, sessionId, title) {
    const chat = str(chatId) === '' ? await chatForSession(str(sessionId)) : await readChat(str(chatId))
    if (chat === undefined) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const full = (await readChat(chat.id)) || chat
    const pictures = sceneIllustrations && chat.sessionId ? await sceneIllustrations.exportImages(chat.sessionId, conversationStoryTurns(full)) : []
    const extension = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
    const images = new Map(pictures.map(image => [image.turn, 'images/' + String(image.turn).padStart(3, '0') + '.' + (extension[image.mediaType] || 'png')]))
    const exported = createConversationMarkdownExport(full, { title: str(title), images })
    if (exported.messageCount === 0) throw new Error('暂无可导出的对话')
    if (!pictures.length) return { filename: exported.filename, text: exported.text }
    // Pictures are linked from the Markdown, so the story and its images travel as one zip.
    const zip = writeZipEntries([{ path: exported.filename, content: exported.text },
      ...pictures.map(image => ({ path: images.get(image.turn), content: Buffer.from(image.data) }))])
    return { filename: exported.title + '.zip', base64: zip.toString('base64'), images: pictures.length }
  }
  // Attachment references inside saved JSON (scene image versions, images in messages).
  function attachmentRefs(value, found = new Map(), skip = new Set()) {
    if (!value || typeof value !== 'object') return found
    if (typeof value.attachmentId === 'string' && typeof value.mediaType === 'string' && value.mediaType.startsWith('image/')) found.set(value.attachmentId, value)
    for (const [key, child] of Object.entries(value)) if (!skip.has(key) && child && typeof child === 'object') attachmentRefs(child, found, skip)
    return found
  }
  async function exportGameSave(sessionId, options = {}) {
    const header = await chatForSession(str(sessionId))
    if (!header) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const chat = await readChat(header.id)
    if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('只有游玩对话可以导出存档')
    assertConversationForkable(chat, { agentRunning: agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' })
    const revisions = await collectSaveRevisions(chat, readChatRevision)
    const live = sessionStore.get(chat.sessionId)
    if (live) await sessionStore.flush(live)
    const handle = await ctx.get('sessionPersistence').open(chat.sessionId, 'read')
    let session
    try { session = { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events: (await handle.read(0)).events } }
    finally { await handle.close() }
    let cardPayload = null
    try { cardPayload = await fileResources.originalCardPayload(chat.cardPath) } catch {}
    if (!cardPayload && chat.cardDefinitionSnapshot?.raw) cardPayload = { kind: 'text', name: str(chat.cardName || 'card') + '.json', text: JSON.stringify(chat.cardDefinitionSnapshot.raw) }
    let script = null
    if ((chat.mode || 'story') === 'script') {
      const scriptPath = await fileResources.scriptForCard(chat.cardPath)
      const text = scriptPath ? await fileResources.readText(normalizeResourcePath(scriptPath, resourceKind(scriptPath))) : undefined
      if (text !== undefined) script = { path: scriptPath, text }
    }
    let scene = null
    const media = attachmentRefs(session.events)
    if (options.images !== false) {
      const files = await gameFootprint.readSceneFiles(chat.id)
      for (const file of files) attachmentRefs(JSON.parse(file.content.toString('utf8')), media, new Set(['deletedVersions']))
      const digest = chat.sceneOpeningWorldbook?.digest
      const book = digest ? await gameFootprint.readSceneWorldbook(digest) : null
      scene = { files, worldbooks: book ? [{ digest, content: book }] : [], attachments: [] }
    }
    const attachments = []
    for (const ref of media.values()) {
      try { const image = await ctx.get('attachments').readImage(ref); attachments.push({ attachmentId: ref.attachmentId, mediaType: ref.mediaType, data: Buffer.from(image.data) }) }
      catch { /* A missing picture must not block the save; the game keeps its reference. */ }
    }
    if (scene) scene.attachments = attachments
    else if (attachments.length) scene = { files: [], worldbooks: [], attachments }
    const buffer = buildGameSave({ chat, revisions, session, card: { path: chat.cardPath, payload: cardPayload }, script, scene,
      tavernVersion: TAVERN_PACKAGE_VERSION, exportedAt: Date.now() })
    const name = (sessionTitleOf(session.events) || str(chat.title) || str(chat.cardName) || 'game').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
    return { filename: name + '.dshsave', base64: buffer.toString('base64'), bytes: buffer.length, revisions: revisions.length, images: attachments.length }
  }
  // Imports always create a new game: new chat and session ids, the native session rebuilt
  // for this install's paths, the history re-numbered, background agents rebuilt on demand.
  const importingGameSaves = new Set()
  const sessionTitleOf = events => str([...(events || [])].reverse().find(event => event?.type === 'session/title')?.data?.title).trim()
  function assertImportableSave(save) {
    const states = [save.chat, ...save.revisions.map(item => item.state)]
    if (states.some(state => !state || typeof state !== 'object' || !Array.isArray(state.messages))) throw new Error('存档包已损坏：存档内容不完整')
    if (!['story', 'script'].includes(save.chat.mode || 'story')) throw new Error('存档包不是游玩对话')
    const events = save.session?.events
    if (!Array.isArray(events) || !events.some(event => event?.type === 'turn/end')) throw new Error('存档包已损坏：缺少模型会话记录')
    if (events.some((event, index) => event?.seq !== index)) throw new Error('存档包已损坏：模型会话记录不连续')
  }
  async function importGameSave(args) {
    if (typeof args?.fileB64 !== 'string' || !args.fileB64) throw new Error('请选择 .dshsave 存档文件')
    const save = readGameSave(Buffer.from(args.fileB64, 'base64'), { tavernVersion: TAVERN_PACKAGE_VERSION })
    assertImportableSave(save)
    if (!save.card?.payload && !save.chat.cardDefinitionSnapshot && !await readCard(str(save.chat.cardPath)).catch(() => undefined)) throw new Error('存档包里没有人物卡，本机也没有这张卡，无法导入')
    const sourceChatId = str(save.chat.id), sourceSessionId = str(save.session.header?.id || save.chat.sessionId)
    if (!/^[a-zA-Z0-9_-]+$/.test(sourceChatId) || !/^[a-zA-Z0-9_-]+$/.test(sourceSessionId)) throw new Error('存档包里的游戏编号无效')
    if (importingGameSaves.has(sourceChatId)) throw new Error('这份存档正在导入，请稍候')
    importingGameSaves.add(sourceChatId)
    try {
      const chatId = uid('chat'), sessionId = 'session-' + randomUUID()
      // 1. Card: reuse an identical local card; otherwise import the packaged one as a new card.
      let cardPath = str(save.chat.cardPath), importedCard = ''
      if (save.card?.payload) {
        let local = null
        try { local = await fileResources.originalCardPayload(cardPath) } catch {}
        if (!local || JSON.stringify(local) !== JSON.stringify(save.card.payload)) cardPath = importedCard = (await importCard(save.card.payload)).path
      }
      if (save.script && (save.chat.mode || 'story') === 'script' && !await fileResources.scriptForCard(cardPath)) {
        await importScript(cardPath, { name: str(save.script.path).split('/').pop() || '剧本.txt', text: str(save.script.text) })
      }
      // 2. Images: store each picture here, then point every reference at the stored copy.
      const replacedRefs = new Map()
      for (const attachment of save.scene?.attachments || []) {
        if (!attachment.data) continue
        try { replacedRefs.set(attachment.attachmentId, await ctx.get('attachments').saveImage({ data: new Uint8Array(attachment.data), mediaType: attachment.mediaType, name: 'imported-save' })) }
        catch { /* An unreadable picture stays a dangling reference, like a deleted file. */ }
      }
      const withRefs = value => {
        if (Array.isArray(value)) return value.map(withRefs)
        if (!value || typeof value !== 'object') return value
        if (typeof value.attachmentId === 'string' && replacedRefs.has(value.attachmentId)) return { ...value, ...replacedRefs.get(value.attachmentId) }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withRefs(child)]))
      }
      // 3. Scene image keys hash the chat id; map the current branch's keys to the new id.
      const keyMap = new Map()
      for (const message of save.chat.messages || []) {
        if (message?.role !== 'assistant') continue
        const turn = Number(message.turn || (message.greeting ? 1 : 0))
        try { keyMap.set(computeSceneTarget(save.chat, turn).key, computeSceneTarget({ ...save.chat, id: chatId }, turn).key) } catch {}
      }
      const rename = text => {
        let out = text.split(sourceChatId).join(chatId).split(sourceSessionId).join(sessionId)
        for (const [from, to] of keyMap) out = out.split(from).join(to)
        return out
      }
      const renameJson = value => JSON.parse(rename(JSON.stringify(withRefs(value))))
      // 4. Save: history first (in order, renumbered), then the current state. Unpublished until
      //    the native session exists, and removed again if anything later fails.
      const background = { role: 'background', lifetime: 'chat', status: 'needs-session', sessionId: '', boundary: null }
      const revisionMap = new Map()
      let latestRevision = 0
      const prepare = state => {
        const next = renameJson(state)
        next.id = chatId; next.sessionId = sessionId; next.cardPath = cardPath
        // Background agents, candidates and undo points name the source install's sessions.
        for (const key of ['forkedFrom', 'regenRecovery', 'regenInProgress', 'rollbackUndo', 'backgroundHistoryIds', 'candidateAgent']) delete next[key]
        const scrub = value => {
          if (Array.isArray(value)) { value.forEach(scrub); return }
          if (!value || typeof value !== 'object') return
          for (const key of ['traceSessionId', 'traceSessionIds', 'startedSessionId']) delete value[key]
          Object.values(value).forEach(scrub)
        }
        scrub(next)
        next.timeline = { ...(next.timeline || {}), participants: { background }, operations: {} }
        next.timeline.checkpoints = (next.timeline.checkpoints || []).filter(checkpoint => revisionMap.has(Number(checkpoint.beforeRevision)))
          .map(checkpoint => ({ ...checkpoint, beforeRevision: revisionMap.get(Number(checkpoint.beforeRevision)), ...(checkpoint.participants ? { participants: { background } } : {}) }))
        next._storageRevision = latestRevision
        return next
      }
      let written = false, created = false, saved
      const cwd = path.join(dataRoot, 'resources')
      try {
        for (const { revision, state } of save.revisions) {
          const historyState = await rawWriteChat(prepare(state), { source: 'game-save.import.history' })
          written = true
          latestRevision = historyState._storageRevision
          revisionMap.set(revision, latestRevision)
        }
        const current = prepare(save.chat)
        current.title = (sessionTitleOf(save.session.events) || str(save.chat.title) || str(save.chat.cardName) || '游戏') + '（导入）'
        current.lastOpenedAt = Date.now()
        current.importedSave = { sourceChatId, exportedAt: save.manifest.exportedAt, tavernVersion: save.manifest.tavernVersion }
        saved = await rawWriteChat(current, { source: 'game-save.import' })
        written = true
        // 5. Native session: same events and sequence numbers under the new id and this install's cwd.
        const events = renameJson(save.session.events)
        const selection = agentDefaultModel?.currentSelection?.() || {}
        let handle
        try {
          handle = await ctx.get('agents').create({ sessionId, seed: events, inheritedEventCount: events.length,
            meta: { cwd, isSeeded: true, agentPreset: str(save.session.header?.agentPreset) || 'tavern' },
            agentOptions: { provider: selection.provider, model: selection.model } })
        } catch (error) { throw new Error('存档包已损坏：模型会话记录无法恢复（' + str(error?.message || error).slice(0, 200) + '）') }
        created = true
        await sessionStore.flush(handle.agent.session)
        await handle.dispose()
        const workspace = await ctx.get('workspaceRegistry')?.resolveByPath(cwd)
        if (workspace) await workspace.attachSession(sessionId)
        // 6. Scene image records under the new chat.
        if (save.scene) {
          for (const file of save.scene.files) await profileData.writeBytes('scene-images/' + createHash('sha256').update(chatId).digest('hex') + '/' + rename(file.path),
            Buffer.from(JSON.stringify(renameJson(JSON.parse(file.content.toString('utf8'))))))
          for (const book of save.scene.worldbooks) if (/^[a-zA-Z0-9_-]+$/.test(book.digest)) await profileData.writeBytes('scene-images/worldbooks/' + book.digest + '.json', book.content)
        }
      } catch (error) {
        if (created) {
          try { await (await ctx.get('workspaceRegistry')?.resolveByPath(cwd))?.detachSession(sessionId) } catch {}
          try { await rm(path.dirname(ctx.get('sessionPersistence').locate({ id: sessionId, cwd }).path), { recursive: true, force: true }) } catch {}
        }
        if (written) try { await conversationRegistry.remove(chatId) } catch {}
        if (importedCard) try { await fileResources.remove(importedCard) } catch {}
        try { await rm(path.join(dataRoot, 'scene-images', createHash('sha256').update(chatId).digest('hex')), { recursive: true, force: true }) } catch {}
        throw error
      }
      await conversationRegistry.publish(saved)
      return { chatId, sessionId, cardPath, title: saved.title, revisions: save.revisions.length, images: replacedRefs.size }
    } finally { importingGameSaves.delete(sourceChatId) }
  }
  async function exportTavernLogs(sessionId) {
    const chat = await chatForSession(str(sessionId))
    if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const diagnostic = await mvuDiagnostics.read(sessionId)
    const backgroundSessionIds = [...new Set(diagnostic.records.map(record => record.traceSessionId).filter(Boolean))]
    let imageDiagnostic
    try { imageDiagnostic = sceneDiagnostics === null ? { version: 1, records: [] } : await sceneDiagnostics.read(chat.id) }
    catch { imageDiagnostic = { version: 1, records: [], error: '生图诊断读取失败，仍导出 Session 与 MVU 日志。' } }
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
    const exported = await createMvuDiagnosticExport({ presetDiagnostics, cardDiagnostics, performanceDiagnostics: { ...performanceDiagnostics.read(), requests: requestPerformance.read(), replyProjection: incrementalReplyView.stats() }, updateDiagnostics: applicationUpdater.diagnostics(), sessionId, backgroundSessionIds, displayDiagnostics: { version: 1, frames: (chat.messages || []).filter(message => message.displayRuntime).slice(-20).flatMap(message => (message.displayRuntime.frames || []).map(frame => ({ turn: message.turn, partIndex: frame.partIndex, panelId: frame.panelId, placement: frame.placement, capturedAt: frame.capturedAt, console: frame.console, errors: frame.errors, network: frame.network }))) }, apiDiagnostics: await apiDiagnostics.read(sessionId).catch(() => null), compatibilityDiagnostics: compatibilityDiagnostic, store: mvuDiagnostics, sceneDiagnostics: imageDiagnostic, sessions: sessionStore, persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery'), attachments: ctx.get('attachments'), environment: { templateRuntime: await fullTemplateRuntime.inspect(sessionId), mvu: OFFICIAL_MVU_VERSION, mvuAsset: inspectOfficialMvuAsset(), runtime: { hostCompatibility, sessionPatch: sessionPatch.view(), generation: runtimeGeneration, platform: process.platform, arch: process.arch, nodeVersion: process.version } } })
    return { filename: exported.filename, base64: exported.buffer.toString('base64') }
  }
  async function attachPlayChatDebug(targetSessionId, sourceSessionId, turn) {
    const editorChat = await chatForSession(str(targetSessionId))
    const sourceChat = await chatForSession(str(sourceSessionId))
    if (editorChat === undefined) throw new Error('卡片工作台对话不存在')
    if (sourceChat === undefined) throw new Error('游玩对话不存在')
    const reference = createPlayChatDebugReference(editorChat, sourceChat, turn)
    const mounted = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources) ? editorChat.workspace.mountedResources : []
    editorChat.workspace.mountedResources = mounted.filter(function (item) {
      return !item || item.kind !== 'play-chat' || item.path !== reference.path
    }).concat([reference])
    await writeChat(editorChat, { source: 'play-chat.attach' })
    return reference
  }

  function cleanRuntimeUrl(value) {
    return str(value).split(/[?#]/)[0].replace(/\/\/[^/@\s]+@/, '//').slice(0, 1000)
  }

  function sanitizeFrameLayout(value) {
    if (!value || typeof value !== 'object') return null
    const number = n => typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1000000, n))) : null
    return {
      mode: ['legacy', 'content', 'viewport', 'fixed'].includes(value.mode) ? value.mode : 'legacy',
      source: ['template', 'panel', 'card'].includes(value.source) ? value.source : 'legacy',
      reason: value.reason === 'container' ? 'container' : 'content',
      phase: ['loading', 'interactive', 'complete'].includes(value.phase) ? value.phase : null,
      width: number(value.width), height: number(value.height), availableHeight: number(value.availableHeight),
      minHeight: number(value.minHeight), maxHeight: number(value.maxHeight),
      roots: (Array.isArray(value.roots) ? value.roots : []).slice(0, 3).map(node => ({
        tag: str(node?.tag).slice(0, 16), id: str(node?.id).slice(0, 80),
        width: number(node?.width), height: number(node?.height), clientHeight: number(node?.clientHeight), scrollHeight: number(node?.scrollHeight),
        position: str(node?.position).slice(0, 24), overflowY: str(node?.overflowY).slice(0, 24),
        cssHeight: str(node?.cssHeight).slice(0, 32), minHeight: str(node?.minHeight).slice(0, 32)
      }))
    }
  }

  function sanitizeDisplayRuntime(value) {
    const input = value && typeof value === 'object' ? value : {}
    function scalar(item, limit = 4000) {
      if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') return item
      if (typeof item === 'string') return item.slice(0, limit)
      try { return JSON.parse(JSON.stringify(item).slice(0, limit)) } catch { return str(item).slice(0, limit) }
    }
    return {
      capturedAt: Math.max(0, Number(input.capturedAt) || Date.now()),
      mvuViewUsed: input.mvuViewUsed === true,
      panelId: str(input.panelId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
      placement: input.placement === "sidebar" ? "sidebar" : "message",
      dom: str(input.dom).slice(0, 100000),
      layout: sanitizeFrameLayout(input.layout),
      console: (Array.isArray(input.console) ? input.console : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), level: ['log', 'info', 'warn', 'error'].includes(item && item.level) ? item.level : 'log', args: scalar(item && item.args, 12000) }
      }),
      network: (Array.isArray(input.network) ? input.network : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: item && item.kind === 'xhr' ? 'xhr' : 'fetch', method: str(item && item.method).slice(0, 16), url: cleanRuntimeUrl(item && item.url), status: Math.max(0, Number(item && item.status) || 0), durationMs: Math.max(0, Number(item && item.durationMs) || 0), failed: item && item.failed === true, error: str(item && item.error).slice(0, 1000) }
      }),
      errors: (Array.isArray(input.errors) ? input.errors : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: str(item && item.kind).slice(0, 32), message: str(item && item.message).slice(0, 4000), tag: str(item && item.tag).slice(0, 32), url: cleanRuntimeUrl(item && item.url || item && item.source), line: Math.max(0, Number(item && item.line) || 0), column: Math.max(0, Number(item && item.column) || 0) }
      })
    }
  }

  function comparableDisplayRuntime(value) {
    const runtime = value && typeof value === 'object' ? value : {}
    return {
      mvuViewUsed: runtime.mvuViewUsed === true,
      panelId: str(runtime.panelId),
      placement: runtime.placement,
      dom: str(runtime.dom),
      layout: runtime.layout || null,
      console: (Array.isArray(runtime.console) ? runtime.console : []).map(function (item) {
        return { level: item && item.level, args: item && item.args }
      }),
      network: (Array.isArray(runtime.network) ? runtime.network : []).map(function (item) {
        return { kind: item && item.kind, method: item && item.method, url: item && item.url, status: item && item.status, failed: item && item.failed, error: item && item.error }
      }),
      errors: (Array.isArray(runtime.errors) ? runtime.errors : []).map(function (item) {
        return { kind: item && item.kind, message: item && item.message, tag: item && item.tag, url: item && item.url, line: item && item.line, column: item && item.column }
      })
    }
  }

  function sameDisplayRuntimeCapture(left, right) {
    return JSON.stringify(comparableDisplayRuntime(left)) === JSON.stringify(comparableDisplayRuntime(right))
  }

  async function captureDisplayRuntime(sessionId, requestedTurn, partIndex, runtime) {
    const turn = Math.max(1, Number(requestedTurn) || 0)
    for (let attempt = 0; attempt < 5; attempt++) {
      const chatId = (await readSessionMap())[str(sessionId)]
      let chat = chatId ? await chatPersistence.readDisplayRuntimeState(chatId, turn) : undefined
      // Preserve registry recovery, aliases and one-time legacy adoption.
      if (!chat || chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1) {
        const full = await chatForSession(str(sessionId))
        chat = full ? projectDisplayRuntimeState(full, turn) : undefined
      }
      if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('当前 Session 没有绑定游玩对话')
      if (chat.messageIndex < 0) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
      const index = Math.max(0, Math.min(100, Number(partIndex) || 0))
      let capture = sanitizeDisplayRuntime(runtime)
      const existingRuntime = chat.displayRuntime && typeof chat.displayRuntime === 'object' ? chat.displayRuntime : null
      const sourceActivityAt = Math.max(0, Number(existingRuntime && existingRuntime.sourceActivityAt) || Number(chat.updatedAt) || 0)
      const latestTurn = chat.latestTurn
      capture.captureKind = turn === latestTurn && Date.now() - sourceActivityAt < 300000 ? 'live' : 'replay'
      const current = existingRuntime || { frames: [] }
      const currentFrames = Array.isArray(current.frames) ? current.frames : []
      const existingFrame = currentFrames.find(function (item) { return Number(item && item.partIndex) === index && str(item.panelId) === capture.panelId })
      if (existingFrame && existingFrame.mvuViewUsed === true) capture.mvuViewUsed = true
      if (existingFrame && capture.mvuViewUsed === true && capture.dom === '' && capture.console.length === 0 && capture.network.length === 0 && capture.errors.length === 0) {
        capture = Object.assign({}, existingFrame, {
          capturedAt: capture.capturedAt,
          captureKind: capture.captureKind,
          mvuViewUsed: true
        })
      }
      if (existingFrame && sameDisplayRuntimeCapture(existingFrame, capture)) return { captured: false, turn, partIndex: index, captureKind: capture.captureKind }
      const frames = currentFrames.filter(function (item) { return Number(item && item.partIndex) !== index || str(item.panelId) !== capture.panelId })
      frames.push(Object.assign({ partIndex: index }, capture))
      const changes = [{ op: 'set', path: ['messages', chat.messageIndex, 'displayRuntime'],
        value: { version: 1, sourceActivityAt, frames: frames.sort(function (a, b) { return a.partIndex - b.partIndex }) } }]
      // Diagnostic captures preserve a valid undo point, never revive a stale one.
      if (chat.rollbackUndo?.ready && chat.rollbackUndo.storageRevision === chat._storageRevision) {
        changes.push({ op: 'set', path: ['rollbackUndo', 'storageRevision'], value: chat._storageRevision + 1 })
      }
      const saved = await patchChat(chat.id, chat._storageRevision, changes, { source: 'display.capture', touchUpdatedAt: false })
      if (saved) return { captured: true, turn, partIndex: index, captureKind: capture.captureKind }
    }
    throw new Error('状态栏诊断保存时对话持续变化，请稍后重试')
  }
  const tavernScriptHostAdapter = createTavernScriptHostAdapter({
    recordResourceSave: (sessionId, summary) => apiDiagnostics.recordResourceSave(sessionId, summary),
    publishCreatedMessages: async function (chat, targets) {
      const session = sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      appendHelperUserSessionContext(session, chat, targets)
      await sessionStore.flush(session)
    },
    resolveChat: chatForSession,
    resolveHelperWindow: async sessionId => {
      const window = await readOpeningWindow(sessionId)
      if (!window) return undefined
      const projected = await projectOpeningWindow(window)
      return projected.tavernHelper ? { historyWindow: projected.historyWindow, tavernHelper: projected.tavernHelper } : undefined
    },
    resolveHelperContext: async sessionId => {
      const chatId = (await readSessionMap())[sessionId]
      if (!chatId) return undefined
      const selected = await chatPersistence.readHelperContext(chatId)
      if (!selected || selected.chat.sessionId !== sessionId || selected.chat.backgroundConfigVersion !== 1 || selected.chat.conversationFeaturesVersion !== 1) return undefined
      return selected
    },
    resolveSettlementBase: async sessionId => {
      const chatId = (await readSessionMap())[sessionId]
      if (!chatId) return undefined
      const selected = await chatPersistence.readSettlementBase(chatId)
      if (!selected || selected.chat.sessionId !== sessionId || selected.chat.backgroundConfigVersion !== 1 || selected.chat.conversationFeaturesVersion !== 1) return undefined
      return selected
    },
    resolveTemplateWindow: createTemplateWindowReader({ links: readSessionMap, readWindow: chatPersistence.readWindow, access: { issue: input => helperHistoryAccess.issue(input) }, historyFrom: sessionId => templateHistoryFrom.get(sessionId) }),
    resolveChatSlice: createSessionSliceReader({links:readSessionMap, readSlice:chatPersistence.readSlice}),
    resolveChatSliceAt: async (sessionId,revision,indices) => {
      const chatId=(await readSessionMap())[sessionId]
      const selected=chatId && await readRowsAt(chatPersistence.readWindow,chatId,revision,indices)
      if(!selected || selected.chat.sessionId!==sessionId || selected.chat.backgroundConfigVersion!==1 || selected.chat.conversationFeaturesVersion!==1)return undefined
      return {...selected,chat:normalizeChat(selected.chat)}
    },
    resolveChangedIndices: async (sessionId,revision) => {
      const chatId=(await readSessionMap())[sessionId]
      return chatId ? await chatPersistence.readChangedIndices(chatId,revision) : undefined
    },
    resolveChatMetadataSlice: async sessionId => {
      const chatId=(await readSessionMap())[sessionId]
      if(!chatId)return undefined
      const selected=await chatPersistence.readSlice(chatId,[],templateStateFields)
      if(!selected || selected.chat.sessionId!==sessionId || selected.chat.backgroundConfigVersion!==1 || selected.chat.conversationFeaturesVersion!==1)return undefined
      return selected
    },
    resolveChangedChatSlice: async (sessionId,revision,fields) => {
      const chatId=(await readSessionMap())[sessionId]
      if(!chatId)return undefined
      const selected=await chatPersistence.readChangedSlice(chatId,revision,fields)
      if(!selected || selected.chat.sessionId!==sessionId || selected.chat.backgroundConfigVersion!==1 || selected.chat.conversationFeaturesVersion!==1)return undefined
      return selected
    },
    patchChat,
    writeChat,
    updateChat,
    readChatRevision,
    synchronizeTemplateHistory: async chat => {
      const session = sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      if (session) await synchronizeTemplateHistory(session, chat, session => sessionStore.flush(session))
    },
    prepareTemplateHistory: (before, after) => {
      const session = sessionStore.get(before.sessionId) || agentRegistry.get(before.sessionId)?.session
      return session ? prepareTemplateHistory(session, before, after) : after
    },
    readCard: readChatCard,
    modelFor: chat => modelSelection(chat.sessionId)?.model || '',
    worldBooks,
    scriptDispatch: tavernScriptDispatch,
    extensionSettings: tavernExtensionSettings,
    fullExtensionSettings: createTavernExtensionSettings(profileData),
    extensionSettingsChanged: async function (sessionId) {
      sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'extension-settings:' + await profileData.version('tavern-extension-settings.json') })
    },
    globalVariables: promptTemplateGlobalVariables,
    characterVariables: {
      save: async function (cardPath, variables, sessionId) {
        const saved = await replaceCardVariables(cardPath, variables)
        sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'character-variables:' + Date.now() })
        return saved
      }
    },
    diagnostics: mvuDiagnostics,
    hasScripts: async function (chat) { return hasTavernScriptRuntime(chat, (await readCardExtensions(chat.cardPath, chat))?.helperScripts) },
    isPlayChat: function (chat) { return groupOfMode(chat.mode) === 'play' }
  })

  function sessionDebugEvidence(sessionId, includeSession = false) {
    const id = str(sessionId)
    if (id === '') return { sessionId: '', loaded: false, events: [] }
    let session = null
    try {
      const sessions = ctx.get('sessions')
      session = sessions && typeof sessions.get === 'function' ? sessions.get(id) : null
    } catch {}
    if (!session) {
      try {
        const agent = agentRegistry.get(id)
        session = agent && agent.session
      } catch {}
    }
    return { sessionId: id, loaded: Boolean(session && (typeof session.snapshotEvents === 'function' || Array.isArray(session.events))), events: sessionEvents(session), ...(includeSession ? {session} : {}) }
  }

  const readBackgroundSuppression = createBackgroundSuppressionReader(id => sessionDebugEvidence(id, true))

  // ---------- 聊天 ----------
  function cardViewOf(card, chat) {
    if (card === null || card === undefined) {
      const draft = chat.workspace && chat.workspace.draft ? chat.workspace.draft : {}
      return {
        path: '',
        name: str(draft.name) || '卡片工作台',
        description: str(draft.description),
        personality: str(draft.personality),
        scenario: str(draft.scenario),
        first_mes: str(draft.first_mes),
        mes_example: str(draft.mes_example),
        system_prompt: str(draft.system_prompt),
        post_history_instructions: str(draft.post_history_instructions),
        creator_notes: '',
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        alternate_greetings: [],
        character_book: null
      }
    }
    return Object.assign(cardPreparation.present({ card: card, as: 'view' }), { path: str(card.path || chat.cardPath) })
  }
  async function cardUpdateStatus(chat) {
    try { return await playCardSnapshots.updateStatus(chat, await readCard(chat.cardPath)) }
    catch (error) { return {available:true,error:String(error.message || error)} }
  }
  const liveCardUpdate = createLiveCardUpdate({readGlobals:readPromptTemplateGlobalVariables})
  ctx.effect(() => () => liveCardUpdate.dispose())
  const inputFieldsProjection = createInputFieldsProjection()
  const incrementalReplyView = createIncrementalReplyView({ readChanges: (id, revision) => chatPersistence.readChangedSlice(id, revision, 'settlement') })
  const sessionResources = createSessionResourceAccess({ read: async ({chatId, revision, kind}) => {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    const chat = await readChatRevision(chatId, revision)
    if (!chat) return undefined
    const card = await readChatCard(chat)
    if (kind === 'card') return cardViewOf(card, chat)
    const record = await worldBooks.bound(chat.cardPath, card, chat)
    return record ? projectTavernHelperWorldbook(record.view) : null
  } })
  async function view(chat, card, persistedProjection = false, options = {}) {
    const resourceRevision = options.resourceRevision ?? chat._storageRevision
    const deferResources = options.deferResources === true && chat.mode !== 'card'
      && Number.isSafeInteger(resourceRevision) && !!chat.cardDefinitionSnapshot
      && chat.openingWorldbookSnapshot?.version === 1

    if (!options.openingWindow) scheduleTemplateSync(chat)
    else void candidateWorldbookPreparation?.warm(chat.sessionId)
    const runtimeSettings = await requestPerformance.stage('settings', () => readTavernSettings())
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await readScript(chat.cardPath)
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    const activePresetSnapshot = groupOfMode(chat.mode) === 'play' && chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object'
      ? chat.runtimePresetSnapshot
      : null
    let replyDisplay = { projections: replyProjectionsOf(chat), presentation: null, latestSourceBacked: false }
    let cardExtensions = { regexScripts: [], helperScripts: [] }
    if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
      cardExtensions = await requestPerformance.stage('cardExtensions', () => readCardExtensions(chat.cardPath, chat)) || cardExtensions
      const pinnedExtensions = await requestPerformance.stage('remoteAssets', () => tavernRemoteAssets.pinExtensions(cardExtensions))
      cardExtensions = Object.assign({}, cardExtensions, {
        helperScripts: pinnedExtensions.helperScripts,
        regexScripts: pinnedExtensions.regexScripts,
        remoteAssetDiagnostics: pinnedExtensions.diagnostics,
        remoteAssetPins: pinnedExtensions.pins
      })
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      replyDisplay = await requestPerformance.stage('historyProjection', () => incrementalReplyView.project(persistedProjection ? chat : { ...chat, _storageRevision: undefined }, {
        charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(cardExtensions, presetRegexScripts),
        placement: 2, isMarkdown: true, isEdit: false, depth: 0
      }, { charName: chat.cardName, macroState: chat.macroState, regexScripts: cardExtensions.regexScripts }, {shared:true}))
      replyDisplay = await liveCardUpdate.project(chat, card, replyDisplay, {charName:chat.cardName,macroState:chat.macroState,regexScripts:cardExtensions.regexScripts})
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
    }
    const activity = backgroundTasks.activity(chat)
    const debugTurns = []
    for (const message of Array.isArray(chat.messages) ? chat.messages : []) {
      if (!message || message.role !== 'assistant') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const source = (str(message.sourceText) || str(message.text)).replace(/\s+/g, ' ').trim()
      debugTurns.push({ turn, preview: source.slice(0, 90), chars: source.length })
    }
    const latestStoryTurn = Number(debugTurns[debugTurns.length - 1]?.turn) || 0
    const liveSession = sessionStore.get(str(chat.sessionId)) || agentRegistry.get(str(chat.sessionId))?.session
    const latestAssistant = latestStoryTurn > 0 ? assistantResultForTurn(liveSession, latestStoryTurn) : null
    const latestAssistantMessageId = str(latestAssistant?.event?.data?.message?.id)
    const forkTurnsByMessageId = forkTurnsForChat(chat)
    const {inputSources,inputTemplateDisplays}=inputFieldsProjection.project(persistedProjection ? chat : {...chat,_storageRevision:undefined}, options.inputChanges)
    const cardUpdate = ['story', 'script'].includes(chat.mode || 'story') && chat.requestMode !== 'sillytavern'
      ? await cardUpdateStatus(chat) : { available: false }
    const helperEnabled = hasTavernScriptRuntime(chat, cardExtensions.helperScripts)
    const helperRuntime = helperEnabled
      ? projectTavernHelperScripts(cardExtensions.helperScripts, chat.tavernHelperScriptVariables)
      : { scripts: [], diagnostics: [] }
    helperRuntime.diagnostics.push(...(Array.isArray(cardExtensions.remoteAssetDiagnostics) ? cardExtensions.remoteAssetDiagnostics : []))
    let helperWorldbook = null
    if (helperEnabled && str(chat.cardPath) !== '') {
      try {
        if (deferResources) {
          const document = chat.openingWorldbookSnapshot.document
          helperWorldbook = document === null ? null : {
            name: worldBookDisplayName(document), resourceAccess: sessionResources.issue(chat.id, resourceRevision, 'worldbook')
          }
        } else {
          const record = await worldBooks.bound(chat.cardPath, card, chat)
          if (record !== null) helperWorldbook = projectTavernHelperWorldbook(record.view)
        }
      } catch (error) {
        helperRuntime.diagnostics.push({ scriptId: '', name: '世界书', status: 'unavailable', message: str(error && error.message || error) })
      }
    }
    const messageCount = Array.isArray(chat.messages) ? chat.messages.length : 0
    const skeletonUntil = options.skeletonUntil === true
      ? Math.max(0, messageCount - HELPER_MESSAGE_COLD_WINDOW)
      : (Number.isSafeInteger(options.skeletonUntil) ? Math.max(0, options.skeletonUntil) : 0)
    const helperContext = helperEnabled
      ? await requestPerformance.stage('helperMessagesProjection', () => projectTavernHelperContext(chat, { skeletonUntil, indexed:true }))
      : null
    const rollbackEvidence = sessionDebugEvidence(chat.sessionId, true)
    const rollbackFields = rollbackViewFields(chat, rollbackEvidence, options.inputChanges)
    return {
      chatId: chat.id,
      contextCompaction: chat.contextCompaction || null,
      mode: chat.mode || 'story',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      playerName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      userProfile: {
        enabled: chat.userProfileEnabled === true,
        revision: Math.max(0, Number(chat.userProfileRevision) || 0)
      },
      bypassPlan: null,
      runtimePreset: activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName },
      card: deferResources ? {path: str(card.path || chat.cardPath), name: card.name, tags: card.tags || []} : cardViewOf(card, chat),
      ...(deferResources ? {cardResourceAccess:sessionResources.issue(chat.id, resourceRevision, 'card')} : {}),
      cardUpdate,
      statusBarPlacement: chat.statusBarPlacement === 'body' ? 'body' : 'sidebar',
      posture: chat.posture || '',
      ledger: readLedger(chat.ledger),
      ledgerTask: manualLedger.project(chat),
      characterDesigns: projectCharacterDesignDocument(chat.characterDesignDocument),
      characterDesignTask: manualCharacterDesign.project(chat),
      phoneChat: phoneChat.project(chat, card),
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      debugTurns: debugTurns.slice(-12).reverse(),
      latestAssistantMessageId,
      forkTurnsByMessageId,
      latestAssistantTurn: latestStoryTurn,
      inputSources,
      inputTemplateDisplays,
      ...rollbackFields,
      presentation: null,
      replyProjections: replyDisplay.projections,
      // tavernStatusView duplicated tavernStatusViews[0] in every read; clients use the list.
      tavernStatusViews: replyDisplay.statusViews || [],
      mvuReceipts: mvuReceiptsOf(chat),
      tavernHelper: helperContext ? { ...helperContext, playerName: str(chat.macroState?.userName).trim() || '你', characterName: str(card?.name || chat.cardName), character: {name:str(card?.name || chat.cardName), path:str(chat.cardPath)}, openingHost: sessionOpeningDescriptor(chat, card), worldbook: helperWorldbook, globalVariables: await readPromptTemplateGlobalVariables(), characterVariables: cardExtensions.variables || {}, compatibilityCapabilities: TAVERN_COMPATIBILITY_CAPABILITIES, extensionSettings: await tavernExtensionSettings.read(), regexScripts: { global: cardExtensions.globalRegexScripts || [], preset: activePresetSnapshot?.regexScripts || [], character: cardExtensions.characterRegexScripts || [] } } : null,
      tavernMvuRuntime: chat.mvu && chat.mvu.enabled === true ? {
        owner: chat.mvu.owner === 'official' ? 'official' : 'legacy',
        commit: OFFICIAL_MVU_VERSION.commit,
        assetUrl: OFFICIAL_MVU_VERSION.assetUrl
      } : null,
      tavernHelperScripts: helperRuntime.scripts,
      tavernHelperScriptDiagnostics: helperRuntime.diagnostics,
      tavernRemoteAssetPins: Array.isArray(cardExtensions.remoteAssetPins) ? cardExtensions.remoteAssetPins : [],
      tavernHelperWorldbook: helperWorldbook,
      tavernRuntimePolicy: { trustedCardMode: runtimeSettings.trustedCardMode, frameSizing: cardExtensions.frameSizing },
      releaseCapabilities: TAVERN_RELEASE_CAPABILITIES,
      presentationWarnings: (Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : []).concat(
        chat.importHistory?.rescue ? [rescueHistoryNotice(chat.importHistory.rescue)] : [],
        chat.importHistory?.contextPreparation?.status === 'trimmed'
          ? ['导入记录较长：已保留开头和最近完整轮次，中间 ' + chat.importHistory.contextPreparation.droppedRounds + ' 轮暂不随模型请求发送，历史正文仍可召回。'] : []),
      worldBookError: chat.worldBookError || null,
      foregroundError: chat.foregroundError || null,
      lastWorldBookRecall: chat.lastWorldBookRecall || null,
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      settleError: activity.reason === 'interrupted' ? '后台结算已中断，请重试结算。' : (chat.settleError || null),
      settlementTurn: settlementTurn(chat),
      scriptProgress: scriptProgress,
      updatedAt: chat.updatedAt || 0
    }
  }
  function replyProjectionsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const projections = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant') continue
      const displayText = Object.prototype.hasOwnProperty.call(message, 'displayText') ? str(message.displayText) : str(message.text)
      const mode = str(message.displayMode) || 'markdown'
      if (displayText === str(message.text) && mode !== 'html' && mode !== 'rich') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      projections.push({
        version: Math.max(1, Number(message.projectionVersion) || 1),
        turn,
        text: displayText,
        mode,
        warnings: Array.isArray(message.projectionWarnings) ? message.projectionWarnings : []
      })
    }
    return projections
  }
  function withLegacyPresentationProjection(chat, projections) {
    const legacy = chat && chat.presentation
    if (!legacy || typeof legacy !== 'object' || str(legacy.html) === '') return Array.isArray(projections) ? projections : []
    const result = Array.isArray(projections) ? projections.slice() : []
    const turn = Math.max(1, Number(legacy.turn) || (legacy.source === 'opening' ? 1 : 0))
    if (result.some(function (projection) { return Number(projection.turn) === turn })) return result
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant' || Object.prototype.hasOwnProperty.call(message, 'sourceText')) continue
      const messageTurn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (messageTurn === turn || (turn > 1 && target === null)) target = message
      if (messageTurn === turn) break
    }
    if (target === null) return result
    const projected = projectRuntimeReply(str(target.text) + '\n\n' + str(legacy.html))
    result.push({
      version: 2,
      turn,
      text: projected.displayText,
      mode: projected.displayMode,
      parts: projected.displayParts,
      warnings: ['旧会话兼容：正文与历史人物卡界面已在原消息位置合并显示。'].concat(projected.warnings)
    })
    return result.sort(function (left, right) { return Number(left.turn) - Number(right.turn) })
  }
  async function startChat(cardPath, sessionId, mode, openingId, userName, requestMode, preparationId, cardTask) {
    // Plain greetings have no interactive preview draft, but need the same
    // game-local worldbook snapshot as scripted openings.
    if (!preparationId && groupOfMode(mode || 'story') === 'play') {
      preparationId = (await requestPerformance.stage('openingDraft', () => openingPreparation.create(cardPath, { userName }))).id
    }
    const preparation = preparationId ? openingPreparation.resolve(preparationId, cardPath, openingId) : undefined
    if (preparation?.sourceSessionId) {
      const source = await chatForSession(preparation.sourceSessionId)
      if (!source || !sessionOpeningDescriptor(source, await readChatCard(source)) || Number(source.tavernHelperLifecycleRevision || 0) !== preparation.sourceLifecycleRevision) throw new Error('原对话已变化，请重新选择开场')
    }
    return await requestPerformance.stage('initializeConversation', () => conversationInitialization.start({ cardPath, sessionId, mode, openingId, userName, requestMode, preparation, cardTask }))
  }

  async function scriptPreviewOf(chat) {
    if ((chat.mode || 'story') !== 'script') return null
    const script = await readScript(chat.cardPath)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  async function sessionActivity(sessionId) {
    const chat = await taskStateReader.forSession(sessionId)
    if (chat === undefined) return null
    return sessionStateView.status(chat)
  }

  async function sessionOperation(sessionId, operationId) {
    const chat = await taskStateReader.forSession(sessionId)
    if (chat === undefined) return null
    const operation = backgroundTasks.operation(chat, operationId)
    if (operation === null || operation.role !== 'candidate' || operation.successful !== true) return operation
    const candidates = await candidateGenerator.find({ sessionId, messageId: chat.candidates && chat.candidates.messageId })
    if (candidates === null || candidates.operationId !== operation.operationId || candidates.requestId !== operation.requestId) return operation
    return Object.assign({}, operation, { result: { candidates } })
  }
  const sessionStateView = createSessionStateView({
    sharedReceipts: true, sharedMappings: true,
    activity: chat => backgroundTasks.activity(chat),
    evidence: sessionId => sessionDebugEvidence(sessionId, true)
  })
  function mvuReceiptsOf(chat, changes) { return sessionStateView.receipts(chat, changes) }
  function rollbackViewFields(chat, evidence, changes) { return sessionStateView.rollback(chat, evidence, changes) }
  // Derived from live session events, which change without a chat revision (see conversation-fork-targets.js).
  function forkTurnsForChat(chat) {
    const session = sessionStore.get(str(chat?.sessionId)) || agentRegistry.get(str(chat?.sessionId))?.session
    return forkTargetsFromSession(session, chat?.regeneratedDshTurns)
  }
  function volatileSessionViewFields(chat, activity, changes) {
    return { ...sessionStateView.volatile(chat, activity, changes), forkTurnsByMessageId: forkTurnsForChat(chat) }
  }

  async function projectCachedSessionView(chat, previous, activity) {
    const mode = chat.mode || 'story'
    const reused = Object.assign({}, previous, volatileSessionViewFields(chat, activity, {baseRevision:chat._storageRevision,indices:[],layoutChanged:false}))
    if (mode === 'script') {
      reused.scriptProgress = await requestPerformance.stage('scriptProgress', async () => {
        const script = await readScript(chat.cardPath)
        return script !== undefined && Array.isArray(script.chunks)
          ? scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
          : null
      })
    }
    return reused
  }
  async function projectDirtySessionView(chat, previous, dirtyMessageIndices, activity, {layoutChanged,layoutFrom,changedHeaderFields,runtimeInputChanges} = {}) {
    const card = await readChatCard(chat)
    const mode = chat.mode || 'story'
    const previousMessages = previous.tavernHelper.messages
    const changes = {baseRevision:previous.tavernHelper.stateRevision,indices:[...dirtyMessageIndices],layoutChanged,changedHeaderFields}
    const next = Object.assign({}, previous, volatileSessionViewFields(chat, activity, changes), {
      posture: chat.posture || '',
      guides: Array.isArray(chat.guides) ? chat.guides : []
    })
    Object.assign(next,inputFieldsProjection.project(chat,{baseRevision:changes.baseRevision,indices:dirtyMessageIndices,changedHeaderFields,runtimeInputChanges}))
    const helperCore = await requestPerformance.stage('helperMessagesProjection', () => projectTavernHelperContext(chat, {
      previousMessages, previousContext:previous.tavernHelper, indexed:true, layoutChanged, layoutFrom,
      dirtyIndices: dirtyMessageIndices
    }))
    next.tavernHelper = Object.assign({}, previous.tavernHelper, helperCore, {
      openingHost: previous.tavernHelper.openingHost,
      worldbook: previous.tavernHelper.worldbook,
      globalVariables: previous.tavernHelper.globalVariables,
      characterVariables: previous.tavernHelper.characterVariables,
      compatibilityCapabilities: previous.tavernHelper.compatibilityCapabilities,
      extensionSettings: previous.tavernHelper.extensionSettings,
      regexScripts: previous.tavernHelper.regexScripts
    })
    delete next.tavernHelper.messagesPending
    if (mode === 'story' || mode === 'script') {
      let cardExtensions = { regexScripts: [], helperScripts: [] }
      try { cardExtensions = await readCardExtensions(chat.cardPath, chat) || cardExtensions } catch (_error) { cardExtensions = { regexScripts: [], helperScripts: [] } }
      const activePresetSnapshot = groupOfMode(chat.mode) === 'play' && chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object'
        ? chat.runtimePresetSnapshot : null
      next.runtimePreset = activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName }
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      let replyDisplay = await requestPerformance.stage('historyProjection', () => incrementalReplyView.project(chat, {
        charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(cardExtensions, presetRegexScripts),
        placement: 2, isMarkdown: true, isEdit: false, depth: 0
      }, { charName: chat.cardName, macroState: chat.macroState, regexScripts: cardExtensions.regexScripts }, {shared:true}))
      const renderChat = {...chat,messages:createScopedMessages(chat.messages.length,[],index=>{const message=chat.messages[index];return message.variables ? message : {...message,variables:helperCore.messages[index]?.swipes_data || []}})}
      replyDisplay = await liveCardUpdate.project(renderChat, card, replyDisplay, {charName:chat.cardName,macroState:chat.macroState,regexScripts:cardExtensions.regexScripts})
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
      next.replyProjections = replyDisplay.projections
      next.tavernStatusViews = replyDisplay.statusViews || []
    }
    return next
  }
  async function projectFullSessionView(chat, { windowHelperMessages = false, inputChanges, deferResources } = {}) {
    const mode = chat.mode || 'story', isCard = mode === 'card', cardPath = str(chat.cardPath)
    let card = null, cardReadError = null
    try { card = isCard && cardPath === '' ? null : await requestPerformance.stage('readCard', () => readChatCard(chat)) }
    catch (error) {
      if (!isCard) throw error
      cardReadError = '人物卡暂时无法读取，请在工作台校验并修复：' + chat.cardPath
      card = { name: chat.cardName || chat.cardPath }
    }
    const result = await requestPerformance.stage('projectView', () => view(chat, card, true, {
      skeletonUntil: windowHelperMessages === true, inputChanges, deferResources
    }))
    if (cardReadError) result.cardReadError = cardReadError
    if (isCard) result.workspace = workspaceViewOf(chat)
    if (mode === 'script') result.scriptPreview = await requestPerformance.stage('scriptPreview', () => scriptPreviewOf(chat))
    return result
  }
  const helperHistoryAccess = createHelperHistoryAccess({read: (id,args) => chatPersistence.readHelperContext(id,args)})
  // `historyFrom`: the oldest floor the browser has scrolled to; the window grows
  // to cover it instead of switching the whole session to a complete view.
  async function readOpeningWindow(sessionId, historyFrom) {
    const chatId = (await readSessionMap())[str(sessionId)]
    if (!chatId) return null
    const window = await readRecentWindow(chatPersistence.readWindow,chatId,{limit:HELPER_MESSAGE_COLD_WINDOW,from:historyFrom,requirePartial:true})
    if (!window || window.from===0 || window.chat.sessionId!==sessionId
      || window.chat.backgroundConfigVersion!==1 || window.chat.conversationFeaturesVersion!==1
      || !['story','script'].includes(window.chat.mode || 'story')
      || window.chat.messages.some(message=>message.role==='assistant' && !Number.isSafeInteger(message.turn))) return null
    return window
  }
  // Results of story operations: the same bounded window the browser keeps in
  // sync, never a complete-history view. Short and old saves keep view().
  async function presentStory(chat) {
    const window = chat?.sessionId ? await readOpeningWindow(chat.sessionId, templateHistoryFrom.get(chat.sessionId)) : null
    if (window) return projectOpeningWindow(window)
    const full = Array.isArray(chat?.messages) && !isScopedMessages(chat.messages) ? chat : await readChat(chat.id)
    return view(full, await readChatCard(full))
  }
  async function projectOpeningWindow(window, options = {}) {
    // Disable revision caches for this partial input. It must never replace a
    // full history projection or be used as an editable Chat baseline.
    // The undo point still compares against the window's real revision.
    const chat={...window.chat,_storageRevision:undefined,windowRevision:window.revision}
    const card=await readChatCard(chat)
    const result=await view(chat,card,false,{openingWindow:true,deferResources:options.deferResources,resourceRevision:window.revision})
    result.historyWindow={onDemand:true,from:window.from,to:window.to,messageCount:window.messageCount,revision:window.revision}
    if(result.tavernHelper){
      const helper=result.tavernHelper
      // Transport only loaded rows; the client adapts absolute ids at the
      // legacy synchronous Helper boundary without sending N placeholders.
      const messages=helper.messages.map((row,index)=>({...row,message_id:window.from+index}))
      result.tavernHelper={...helper,stateRevision:window.revision,messages,
        turnMessageIds:Object.fromEntries(Object.entries(helper.turnMessageIds).map(([turn,index])=>[turn,window.from+index])),
        historyAccess:helperHistoryAccess.issue({chatId:chat.id,revision:window.revision,messageCount:window.messageCount})}
    }
    return result
  }
  const sessionViews = createSessionViewReader({
    readState: sessionStateForSession, readChat: chatForSession, readOpeningWindow,
    resourceVersion: async chat => {
      if (!chat.cardPath || chat.mode === 'card') return ''
      const binding = await fileResources.worldBookBindingForCard(chat.cardPath)
      const paths = new Set([chat.cardPath])
      for (const source of binding.sources || [binding]) if (source.path || source.cardPath) paths.add(source.path || source.cardPath)
      const versions = await Promise.all([...paths].map(path => profileData.version('resources/' + path)))
      return JSON.stringify([binding, versions, await profileData.version('tavern-extension-settings.json'), await profileData.version('prompt-template-variables.json')])
    },
    readChanges: chatPersistence.readChangedIndices,
    readViewDelta: chatPersistence.readViewDelta,
    project: { cached: projectCachedSessionView, dirty: projectDirtySessionView, full: projectFullSessionView, opening:projectOpeningWindow },
    activity: chat => backgroundTasks.activity(chat), trace: requestPerformance,
    foregroundRunning: sessionId => agentRegistry.get(str(sessionId))?.phase?.kind === 'running',
    synchronize: createSessionViewSync()
  })
  function sessionView(sessionId, options) { return sessionViews.read(sessionId, options) }
  async function ensureNativeOpening(sessionId) {
    return await conversationInitialization.ensureOpening(sessionId)
  }
  const contextPlanner = createContextPlanner({ prompt: runtimePrompt, callModel: callModel, now: Date.now, logger: console })
  const playCardSnapshots = createPlayCardSnapshots({ worldBooks, planner: contextPlanner, readCard: readChatCard, writeChat, captureSceneWorldbook, userPreferenceProfile })
  const ensurePlayCardSnapshot = playCardSnapshots.ensure
  async function ensureNativeSystemPrefix(session, chat) {
    // Rebuilding the snapshot persists the complete Chat; a bounded history cannot.
    if (isScopedMessages(chat?.messages) && playCardSnapshots.settled(chat) === undefined) chat = await chatForSession(session.id)
    const before = readSessionStablePrefix(session)
    const revision = Number(chat.cardContextRevision) || 0
    const cardAgent = chat.mode === 'card' && chat.cardEditContext?.version !== 1
    const text = !cardAgent && before?.version === 3 && revision <= before.revision ? '' : await ensurePlayCardSnapshot(chat)
    const prefix = await ensureSessionStablePrefix(session, text, stablePrefixStorage, revision)
    const directory = cardAgent ? false : ensureSessionVariableDirectory(session, chat)
    if (directory || prefix && prefix.event !== before?.event) await sessionStore.flush(session)
    return prefix
  }
  async function ensureNativeCardWorkspace(session, chat) {
    const projection = await publishResourceWorkspace(session.id, chat)
    const text = resourceWorkspaceContext(session.header?.cwd, projection, runtimePrompt('card-workspace'))
    const message = ensureCardWorkspaceMessage(session, text)
    await sessionStore.flush(session)
    return message.data.content[0].text
  }
  const conversationInitialization = createConversationInitialization({
    cards: { read: readCard, readChat: readChatCard, script: readScript, extensions: readCardExtensions },
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, write: writeChat },
    timeline: storyTimeline,
    snapshots: playCardSnapshots,
    userPreferenceProfile,
    presets: runtimePresets,
    settings: readTavernSettings,
    emptyCardWorkspace,
    id: uid,
    native: {
      wait: function (sessionId) { return waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }) },
      ensurePrefix: function (session, text) { return ensureSessionStablePrefix(session, text, stablePrefixStorage) },
      ensureCardWorkspace: ensureNativeCardWorkspace,
      flush: function (session) { return sessionStore.flush(session) },
      selection: modelSelection,
      async selectModel(target, selection) {
        const controller = ctx.get('sessionController')
        if (!target.agent || typeof controller?.agents?.selectForNextRequest !== 'function') throw new Error('无法设置新游戏默认前台模型')
        const resolved = await llm.resolveCallConfig(selection)
        controller.agents.selectForNextRequest(target.agent, { provider: resolved.provider, model: resolved.model, ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}) })
        await sessionStore.flush(target.session)
      }
    },
    present: async function (chat, card) {
      const result = await view(chat, card)
      if (chat.mode === 'card') result.workspace = workspaceViewOf(chat)
      return result
    }
  })
  const projectForegroundWorldbook = createForegroundWorldbook({
    bound: (...args) => worldBooks.bound(...args),
    runtime: promptTemplateRuntime,
    globalVariables: readPromptTemplateGlobalVariables,
    scanText: scriptPromptScanText,
    filterCandidates: input => worldbookFilter(input)
  })
  const searchWorldbook = createWorldbookSearch({
    load: async sessionId => {
      const chat = await chatForSession(sessionId)
      if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('世界书查询仅用于当前游玩对话')
      const card = await readChatCard(chat)
      return { chat, card, worldBook: await worldBooks.bound(chat.cardPath, card, chat) }
    },
    render: async ({ chat, card, worldBook }, selected) => {
      const runtime = await promptTemplateRuntime(chat.sessionId)
      const globalVariables = await readPromptTemplateGlobalVariables()
      worldBook = await prepareTemplateWorldbook(worldBook, runtime, chat, globalVariables)
      const refs = new Set(selected.map(entry => entry.ref))
      return projectWorldBookTemplates({ worldBook, runtime, globalVariables, chat, card, includeConstants: true,
        selectedEntries: worldBook.view.entries.filter(entry => entry.constant || refs.has(entry.ref)),
        randomSeed: chat.worldBookRandomState?.seed, randomOutputs: chat.worldBookRandomState?.outputs })
    }
  })
  const chatHistoryImporter = createChatHistoryImportService({
    projectWorldBookTemplates: nativeWorldBookTemplateContext,
    projectForegroundWorldbook,
    planner: contextPlanner,
    initialization: conversationInitialization,
    cards: { read: readCard }, worldBooks, store: profileData,
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, read: readChat, readRevision: readChatRevision, write: rawWriteChat },
    native: {
      wait: sessionId => waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }),
      ensurePrefix: (session, text) => ensureSessionStablePrefix(session, text, stablePrefixStorage),
      flush: session => sessionStore.flush(session)
    }
  })
  async function prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn) {
    const source = str(sourceChatId) === '' ? await chatForSession(str(sourceSessionId)) : await readChat(str(sourceChatId))
    if (!source) throw new Error('找不到要分叉的源对话')
    assertConversationForkable(source, { agentRunning: agentRegistry.get(source.sessionId)?.phase?.kind === 'running' })
    const { state, turn } = await conversationStateAtTurn(source, requestedTurn, readChatRevision)
    let handle
    let session = sessionStore.get(source.sessionId) || agentRegistry.get(source.sessionId)?.session
    if (!session) { handle = await agentRegistry.resume({ resumeSessionId: source.sessionId }); session = handle.agent.session }
    try {
      return { source, state, turn, atSeq: conversationForkBoundary(session, state, turn) }
    } finally { if (handle) await handle.dispose() }
  }
  async function forkChat(sourceChatId, sourceSessionId, targetSessionId, requestedTurn, expectedRevision, expectedAtSeq) {
    const { source, state, turn, atSeq } = await prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn)
    if (expectedRevision !== source._storageRevision || expectedAtSeq !== atSeq) throw new Error('源对话已变化，请重新选择分叉回合')
    const targetId = str(targetSessionId)
    if (targetId === '' || await chatForSession(targetId) !== undefined) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
    const target = sessionStore.get(targetId) || agentRegistry.get(targetId)?.session
    const targetEnd = sessionEvents(target).findLast(event => event.type === 'turn/end')
    if (!targetEnd || targetEnd.seq !== atSeq) throw new Error('原生分叉没有停在指定回合，已拒绝绑定游戏状态')
    const fork = forkConversationChat(state, { chatId: uid('chat'), sessionId: targetId, id: uid, now: Date.now })
    fork.forkedFrom = { ...fork.forkedFrom, chatId: source.id, sessionId: source.sessionId, storageRevision: source._storageRevision,
      stateChatId: state.id, stateRevision: state._storageRevision, turn, atSeq }
    await conversationRegistry.publish(fork)
    return conversationForkReceipt(fork, { lastTurn: turn, messageCount: fork.messages.length })
  }

  const backgroundRetirement = createBackgroundSessionRetirement(profileData, { readState: taskStateReader.forSession, isRunning: id => agentRegistry.get(id)?.status === 'running' })
  ctx.effect(() => installRetiredBackgroundFilter(ctx.get('subagents'), backgroundRetirement, ctx.get('sessionQuery')))
  const runtimePresetSnapshots = new Map()
  const backgroundAgentRunner = createBackgroundAgentRunner({
    retirement: backgroundRetirement,
    systemAppend: () => runtimePrompt('system-append'),
    imageSystemPrompt: () => runtimePrompt('scene-image-system'),
    resolveModelSelection: async input => backgroundModelSelection(await backgroundConfigForSession(input.sessionId)) || input.selection,
    resolveWebSearch: async input => (await backgroundConfigForSession(input.sessionId))?.webSearchEnabled === true,
    backgroundTools: [...WORLD_BOOK_FILTER_TOOLS, POSTURE_SUBMIT_TOOL, CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_REUSE_TOOL, MVU_SUBMIT_UPDATE_TOOL, CANDIDATE_SUBMIT_TOOL, SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL, LEDGER_SUBMIT_TOOL],
    sharedTools: [sharedWorldbookSearch(searchWorldbook), {
      tool: HISTORY_RECALL_TOOL,
      async execute({ input, args }) {
        return renderHistoryRecall(await recallHistoryForSession(input.sessionId, args, input, 'background'))
      }
    }],
    stablePrefixStorage,
    agents: agentRegistry,
    agentPreset: 'tavern-background',
    needsNewBackgroundSession: async sessionId => {
      const chat = await backgroundConfigForSession(sessionId)
      return chat?.backgroundSessionStatus === 'needs-session'
    },
    resolveForegroundWorldbookReads: async input => {
      if (!['settlement', 'candidate', 'character-design'].includes(input.task)) return ''
      const chat = await sessionStateForSession(input.sessionId)
      const session = agentRegistry.get(input.sessionId)?.session || sessionStore.get(input.sessionId)
      return foregroundWorldbookReads(chat, session)
    },
    resolveCurrentWorldbook: async function (input) {
      if (input.preparedWorldbook !== undefined) return input.preparedWorldbook
      if (input.task === 'image') return undefined
      // The server template engine owns absolute history and reads old floors
      // on demand. Only its variable scope needs a proven latest snapshot here.
      const recent = await readOpeningWindow(input.sessionId)
      const chat = recent && (recent.chat.promptTemplateInput?.message || lastTavernHelperVariables(recent.chat.messages) !== undefined)
        ? recent.chat : await chatForSession(input.sessionId)
      return chat ? await nativeWorldBookTemplateContext(chat, await readChatCard(chat)) : undefined
    },
    resolveStablePrefixRevision: async input => Number((await backgroundConfigForSession(input.sessionId))?.cardContextRevision) || 0,
    resolveStablePrefix: async function (input) {
      // Image tasks share the opening snapshot; current-worldbook replacement stays disabled above
      // because a requested illustration may target an earlier story turn.
      const header = await chatHeaderForSession(input.sessionId, ['cardContextSnapshot', 'cardContextSnapshotVersion', 'cardEditContext', 'cardReferenceContext'])
      const settled = header ? playCardSnapshots.settled(header) : undefined
      if (settled !== undefined) return settled
      const chat = await chatForSession(input.sessionId)
      return chat ? await ensurePlayCardSnapshot(chat) : ''
    },
    setupAgent: async function (childCtx) {
      await agentPresets.mount(childCtx, 'tavern-background')
    },
    compactAgent: executeBackgroundCompaction,
    flushSession: async function (session) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) throw new Error('dsh-tavern: 缺少 sessions 服务')
      await sessions.flush(session)
    },
    resolveRuntimePresetSnapshot: async function (input) {
      // 外部 Tavern 预设只投影到前台正文请求。后台 Agent 有自己的结构化任务协议，
      // 继承整份预设可能破坏候选生成和状态结算的输出契约。
      return null
    },
    stageRuntimePresetSnapshot: function (input) {
      runtimePresetSnapshots.set(str(input.sessionId), {
        turn: Math.max(0, Number(input.turn) || 0),
        step: Math.max(1, Number(input.step) || 1),
        scope: 'background',
        snapshot: input.snapshot || null
      })
    }
  })
  const worldbookFilter = createWorldbookFilter({
    runAgent: input => backgroundAgentRunner.run(input), selection: backgroundModelSelection,
    beginTask: chat => backgroundTasks.begin(chat, 'worldbook-filter')
  })
  // After each reply, judge the worldbook pool that reply brings into the next turn, so
  // sending never waits for a model. Usually below the threshold: no request at all.
  const worldbookPrefilter = createWorldbookPrefilter({
    async run(chatId, signal) {
      const chat = await storyContext({ chatId })
      if (!chat || !['story', 'script'].includes(chat.mode || 'story') || chat.requestMode === 'sillytavern' || chat.regenInProgress) return
      const latest = chat.messages?.at(-1)
      if (latest?.role !== 'assistant' || latest.greeting === true || backgroundTasks.activity(chat).busy) return
      if (backgroundModelSelection(chat) === null) return
      const card = await readChatCard(chat)
      signal.throwIfAborted()
      await projectForegroundWorldbook({ chat, card, userText: '', purpose: 'prefilter', signal })
    }
  })
  ctx.effect(() => () => worldbookPrefilter.dispose())
  const publishCharacterDesign = createCharacterDesignPublisher({ worldBooks, readCard })
  const characterDesignDocuments = createCharacterDesignDocumentTools({
    publishWorldbook: publishCharacterDesign,
    store: { readChat, updateChat },
    readWorldBook: async chat => worldBooks.bound(chat.cardPath, await readChatCard(chat), chat),
    now: Date.now
  })
  const manualLedger = createManualLedger({
    store: { chatForSession, updateChat },
    runAgent: input => backgroundAgentRunner.run(input), selection: backgroundModelSelection,
    beginTask: async (chat, sessionId) => {
      if (agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw new Error('前台正在生成，请完成后再整理台账。')
      return await backgroundTasks.begin(chat, 'ledger')
    },
    ensureSession: async sessionId => {
      if (!agentRegistry.get(sessionId)?.session) await agentRegistry.resume({ resumeSessionId: sessionId })
    }
  })
  const manualCharacterDesign = createManualCharacterDesign({
    publishWorldbook: publishCharacterDesign,
    store: { chatForSession, updateChat, readCard: readChatCard,
      readWorldBook: (chat, card) => worldBooks.bound(chat.cardPath, card, chat) },
    runAgent: input => backgroundAgentRunner.run(input), selection: backgroundModelSelection,
    beginTask: async (chat, sessionId) => {
      if (agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw new Error('前台正在生成，请完成后再设计人物。')
      return await backgroundTasks.begin(chat, 'character-design')
    },
    ensureSession: async sessionId => {
      if (!agentRegistry.get(sessionId)?.session) await agentRegistry.resume({ resumeSessionId: sessionId })
    }
  })
  const phoneChat = createPhoneChat({
    store: { chatForSession, readCard, updateChat },
    runAgent: function (input) { return backgroundAgentRunner.run(input) },
    selection: backgroundModelSelection,
    now: Date.now,
    id: function () { return uid('phone-message') }
  })
  const mvuSettlement = createMvuSettlementModule({
    model: backgroundAgentRunner,
    runtime: tavernScriptHostAdapter,
    diagnostics: mvuDiagnostics,
    characterDesign: characterDesignDocuments
  })
  ctx.effect(() => () => backgroundAgentRunner.dispose(), 'dsh-tavern: dispose resident background agents')
  const sceneIllustrations = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneIllustrations({
    prompt: runtimePrompt,
    onDiagnostic: imageHostDiagnostic,
    readLegacyConfiguration: legacyImageConfigurationReader(ctx.get('settings')?.documentPath),
    store: profileData, diagnostics: sceneDiagnostics, chatForSession, backgroundConfigForSession, sceneStateForSession: sessionChats.readSceneImageState, selection: modelSelection,
    worldbookAtTarget: async (chat, target) => {
      try { return await sceneWorldbooks.read(sceneWorldbookBinding(chat, target)) }
      catch (_error) { return { unavailable: '历史世界书快照读取失败，未读取当前世界书。' } }
    },
    isRunning: sessionId => ctx.get('agents')?.get(sessionId)?.phase?.kind === 'running',
    stateAtTarget: async (chat, target) => {
      // The next turn's beforeRevision contains the settled state of this turn.
      const next = (chat.timeline?.checkpoints || []).find(item => Number(item.turn) > target.turn && Number.isSafeInteger(item.beforeRevision))
      if (!next) return undefined
      const historical = await readChatRevision(chat.id, next.beforeRevision)
      if (!historical) return undefined
      const last = [...(historical.messages || [])].reverse().find(item => item.role === 'assistant')
      const lastTurn = Number(last?.turn || (last?.greeting ? 1 : 0))
      if (lastTurn !== target.turn || historical.settleStatus !== 'done') return undefined
      const original = sceneTarget(historical, target.turn)
      return original.key === target.key ? historical : undefined
    },
    credentials: () => ctx.get('credentials'), attachments: () => ctx.get('attachments'),
    runAgent: input => backgroundAgentRunner.run(input),
    onStorageError: () => console.error('dsh-tavern: 生图状态保存失败，请检查数据目录权限')
  }) : null
  if (sceneIllustrations !== null) ctx.effect(() => () => sceneIllustrations.dispose(), 'dsh-tavern: dispose scene image agents')
  // Public extension service for third-party DSH plugins (docs/plugin-api.md).
  const pluginMedia = createPluginMedia({ store: profileData })
  const pluginTurns = createPluginTurnReader({
    sessionState: sessionStateForSession,
    sceneState: (sessionId, turns) => sessionChats.readSceneImageState(sessionId, { turns }),
    header: chatHeaderForSession,
    slice: (sessionId, indices) => chatSliceForSession(sessionId, indices, []),
    fullChat: chatForSession,
    readChatCard,
    worldbooks: sceneWorldbooks
  })
  const pluginApi = createTavernPluginApi({
    ctx,
    logger: console,
    media: pluginMedia,
    ...pluginTurns,
    backgroundModel: async sessionId => backgroundModelSelection(await backgroundConfigForSession(sessionId)),
    publish: sessionId => sessionSignals.publish(sessionId, { kind: 'plugin-media', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
  })
  ctx.provide('tavern', pluginApi.service)
  // Bytes of one item, only while it belongs to the text version on screen.
  async function readPluginMediaFile(sessionId, itemId) {
    const missing = () => Object.assign(new Error('媒体不存在或不属于当前正文版本'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    const game = await pluginTurns.resolveGame(str(sessionId))
    const item = game ? await pluginMedia.find(game.chatId, str(itemId)) : null
    if (!item || !item.attachment || await pluginTurns.currentKey(game.sessionId, item.turn) !== item.key) throw missing()
    const attachments = ctx.get('attachments')
    if (!attachments) throw missing()
    if (item.attachment.mediaType) {
      const image = await attachments.readImage(item.attachment)
      return { mediaType: item.attachment.mediaType, data: image.data, length: image.data.byteLength }
    }
    return { mediaType: pluginFileMediaType(item.attachment.name), length: Number(item.attachment.bytes) || 0, name: item.attachment.name, stream: signal => attachments.readFileStream(item.attachment, signal) }
  }
  // Turns that hold any plugin item, so the browser asks only those turns.
  async function pluginMediaTurns(sessionId) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!game) return { turns: [] }
    return { turns: [...new Set((await pluginMedia.list({ chatId: game.chatId })).map(item => item.turn))].sort((a, b) => a - b) }
  }
  async function pluginMediaForTurn(sessionId, turn) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!game) return { key: null, items: [] }
    const key = await pluginTurns.currentKey(game.sessionId, Number(turn))
    if (!key) return { key: null, items: [] }
    const items = (await pluginMedia.list({ chatId: game.chatId, turn: Number(turn) })).filter(item => item.key === key)
    return { key, items: items.map(item => publicPluginMedia(item)) }
  }
  function enabledSceneIllustrations() {
    if (sceneIllustrations === null) throw new Error('当前版本未开放场景生图')
    return sceneIllustrations
  }
  const backgroundTasks = createBackgroundTaskCoordinator({
    store: { readChat, writeChat, updateChat, patchChat, readState: chatPersistence.readSessionState, readRecoveryState: taskStateReader.read, readSlice: chatPersistence.readSlice, readSettlementCheckpoint: chatPersistence.readSettlementCheckpoint },
    timeline: storyTimeline,
    blocked: function (chat) { return Boolean(autoCompaction?.blocked(chat)) },
    preempt: async (chatId, role) => { if (role !== 'worldbook-filter') await worldbookPrefilter.cancel(chatId) }
  })
  const configuredCompactionEngines = new WeakSet()
  const overflowingCompactions = new Set()
  // Rounds kept verbatim after a story summary, bounded by a share of the model window.
  async function storyRetention({ sessionId, provider, model, signal }) {
    // Provider-confirmed overflow must shrink as far as possible; it keeps no extra rounds.
    const rounds = overflowingCompactions.has(sessionId) ? 0 : (await readTavernSettings()).contextCompaction.retainRounds
    const info = provider && model ? await Promise.resolve(ctx.llm.resolveModelInfo?.(provider, model, signal)).catch(() => undefined) : undefined
    const window = info?.context?.contextWindow
    const meter = ctx.get('tokenMeter')
    return {
      rounds,
      budget: Number.isFinite(window) && window > 0 ? Math.floor(window * RETAINED_ROUNDS_WINDOW_SHARE) : Infinity,
      estimate: text => meter?.estimateMessage ? meter.estimateMessage({ role: 'user', content: [{ type: 'text', text }] }) : Math.ceil(text.length / 4)
    }
  }
  const pendingCompactionMessages = new WeakMap()
  const checkedCompactionPressure = new WeakSet()
  const compactionDisposers = new Set()
  const collectedCompactionEngines = new FinalizationRegistry(dispose => compactionDisposers.delete(dispose))
  ctx.effect(() => () => {
    for (const dispose of compactionDisposers) { collectedCompactionEngines.unregister(dispose); dispose() }
    compactionDisposers.clear()
  })
  const agentCompaction = agent => resolveAgentCompaction(ctx, agent)
  async function withCompactionSession(id, work) {
    const live = agentRegistry.get(id)
    if (live) return work(live)
    const handle = await agentRegistry.resume({ resumeSessionId: id })
    try { return await work(handle.agent) } finally { await handle.dispose() }
  }
  async function retireOldForegroundFrames(agent, keepTurn) {
    const count = retireForegroundFrames(agent.session, { keepTurn })
    if (count) await sessionStore.flush(agent.session)
    return count
  }
  autoCompaction = createAutoCompaction({
    readChat: chatForSession, readState: sessionStateForSession, readMetadata: taskStateReader.forSession, updateChat,
    policy: async () => (await readTavernSettings()).contextCompaction,
    activity: chat => backgroundTasks.activity(chat),
    exclusive: backgroundTasks.exclusive,
    settle: chat => queueSettlement(chat.id),
    pressure: (agent, signal, pendingMessages = [], sessionId) => {
      const measure = target => measureForegroundPressure({
        agent: target, signal, pendingMessages, projections: ctx.get('sessionProjections'),
        defaultModel: agentDefaultModel, llm: ctx.llm, meter: ctx.get('tokenMeter')
      })
      return agent ? measure(agent) : withCompactionSession(sessionId, measure)
    },
    checkpoint: id => withCompactionSession(id, agent => agent.session.seq),
    recover: (id, before) => withCompactionSession(id, agent => {
      const events = sessionEvents(agent.session).filter(event => event.seq >= before)
      const summary = events.find(event => event.type === 'compaction/summary')
      const completed = summary && events.some(event => event.type === 'compaction/end' && event.data?.compactionId === summary.data.compactionId && !event.data?.error)
      const replaced = summary && events.some(event => event.type === 'user/message' && event.surfaceOp?.op === 'replace' && event.data?.source?.compactionId === summary.data.compactionId)
      return completed && replaced ? 'succeeded' : 'unknown'
    }),
    markBackground: (id, target) => updateChat(id, chat => {
      const participant = chat.timeline?.participants?.background
      if (participant?.sessionId === target) { participant.requiresNewSessionOnRewind = true; participant.compactionPlannedAt = Date.now() }
      return chat
    }, { source: 'compaction.background' }),
    async compact(id, side, options, signal) {
      if (side === 'background') return backgroundAgentRunner.compact({ sessionId: id, signal })
      // Kept rounds stay verbatim, so a history they cover entirely has nothing to summarize.
      const covered = async session => {
        const header = session.requestHeader?.()?.config
        const retention = await storyRetention({ sessionId: id, provider: header?.provider, model: header?.model, signal })
        return storyHistoryFullyRetained(session, retention.rounds, retention) ? retention.rounds : 0
      }
      const retained = options.agent ? await covered(options.agent.session) : await withCompactionSession(id, agent => covered(agent.session))
      if (retained) return { message: `最近 ${retained} 轮剧情保留原文，暂无更早的历史需要压缩` }
      if (options.openTurnCompact) return options.openTurnCompact()
      return withCompactionSession(id, async agent => {
        await retireOldForegroundFrames(agent, agent.phase?.kind === 'running' ? agent.phase.turn : undefined)
        return (await agentCompaction(agent)).compactNow(agent, signal)
      })
    }
  })
  async function configureAgentCompaction(agent) {
    const engine = await agentCompaction(agent)
    if (configuredCompactionEngines.has(engine)) return engine
    configuredCompactionEngines.add(engine)
    const dispose = installCompactionPolicy(engine, async (target, trigger, signal, fallback, forced) => {
      if (trigger !== 'context-overflow') return compactionPolicyFor(target, trigger, signal, fallback, forced)
      overflowingCompactions.add(target.session.id)
      try { return await compactionPolicyFor(target, trigger, signal, fallback, forced) }
      finally { overflowingCompactions.delete(target.session.id) }
    }, { beforeRegion: compactionRegionGuard })
    async function compactionPolicyFor(target, trigger, signal, fallback, forced) {
      // Our early pre-step and the host hook share one pressure attempt. Overflow
      // recovery remains independent and retains the host request retry budget.
      if (trigger === 'pressure' && pendingCompactionMessages.has(target)) {
        if (checkedCompactionPressure.has(target)) return null
        checkedCompactionPressure.add(target)
      }
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (background && !['image', 'phone'].includes(background.task)) {
        return compactBackgroundIfNeeded({
          trigger, forced, native: fallback,
          pressure: () => measureBackgroundBudget({
            agent: target, background, signal, llm: ctx.llm, meter: ctx.get('tokenMeter'),
            pending: pendingCompactionMessages.get(target) || []
          })
        })
      }
      const chat = await sessionStateForSession(target.session.id)
      if (!chat || !['story', 'script'].includes(chat.mode)) return fallback()
      const pendingMessages = pendingCompactionMessages.get(target) || []
      return compactForegroundIfNeeded({
        trigger, native: fallback, forced,
        pressure: () => measureForegroundPressure({
          agent: target, signal, pendingMessages, projections: ctx.get('sessionProjections'),
          defaultModel: agentDefaultModel, llm: ctx.llm, meter: ctx.get('tokenMeter')
        }),
        record: () => autoCompaction.recordForeground(target.session.id),
        scheduled: () => autoCompaction.run(target.session.id, { agent: target, signal, openTurnCompact: forced, pendingMessages })
      })
    }
    async function compactionRegionGuard(target) {
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (!background || ['image', 'phone'].includes(background.task)) return
      const chat = await sessionStateForSession(background.parentSessionId)
      if (!chat) throw new Error('后台压缩找不到所属对话')
      await updateChat(chat.id, current => {
        const participant = current.timeline?.participants?.background
        if (participant?.sessionId !== target.session.id) throw new Error('后台会话已变更，取消旧会话压缩')
        participant.requiresNewSessionOnRewind = true
        participant.compactionPlannedAt = Date.now()
        return current
      }, { source: 'compaction.background' })
    }
    compactionDisposers.add(dispose)
    collectedCompactionEngines.register(engine, dispose, dispose)
    return engine
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    const id = payload.agent.session.id, background = backgroundAgentRunner.requestContext(id)
    const chat = background ? null : await sessionStateForSession(id)
    if (chat && ['story', 'script'].includes(chat.mode)) await retireOldForegroundFrames(payload.agent, payload.turn)
    if (background && ['image', 'phone'].includes(background.task)) return next()
    if (background || chat && ['story', 'script'].includes(chat.mode)) {
      const engine = await configureAgentCompaction(payload.agent)
      pendingCompactionMessages.set(payload.agent, payload.messages || [])
      try {
        try { await engine.compactIfNeeded(payload.agent, 'pressure', payload.signal) }
        catch (error) {
          payload.signal.throwIfAborted()
          // Match native pressure behavior: warn, then let the request proceed.
          // A provider-confirmed overflow still has its own bounded recovery.
          const warning = compactionFailureMessage(error)
          console.warn('dsh-tavern: 自动容量压缩未完成:', warning)
          if (chat) await updateChat(chat.id, current => {
            current.contextCompaction = { ...current.contextCompaction, warning }
            return current
          }, { source: 'compaction.pressure-failed' })
        }
        return await next()
      } finally {
        pendingCompactionMessages.delete(payload.agent)
        checkedCompactionPressure.delete(payload.agent)
      }
    }
    return next()
  }, { prepend: true })
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') queueAutoCompaction(agent.session.id) })
  async function nativeWorldBookTemplateContext(chat, card) {
    let worldBook
    try {
      worldBook = await worldBooks.bound(chat.cardPath, card, chat)
    } catch (error) {
      console.warn('dsh-tavern: 动态世界书读取失败，已跳过:', str(error && error.message || error))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'worldbook-read-failed' }] }
    }
    if (!worldBook || !worldBook.view) return { context: '', refs: [], diagnostics: [] }
    try {
      const runtime = await promptTemplateRuntime(chat.sessionId)
      worldBook = await prepareTemplateWorldbook(worldBook, runtime, chat, await readPromptTemplateGlobalVariables())
      return projectWorldBookTemplates({
        includeConstants: true,
        randomSeed: chat.worldBookRandomState?.seed,
        randomOutputs: chat.worldBookRandomState?.outputs,
        worldBook,
        runtime,
        globalVariables: await readPromptTemplateGlobalVariables(),
        card,
        chat
      })
    } catch (error) {
      if (error.code === 'FULL_TEMPLATE_UNAVAILABLE') throw error
      console.warn('dsh-tavern: 动态世界书解析失败，已跳过:', str(error && error.message || error))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'projection-failed' }] }
    }
  }
  const candidateContextReader = createCandidateContextReader({headerForSession:chatHeaderForSession,readWindow:chatPersistence.readWindow,readChat})
  candidateWorldbookPreparation=createCandidateWorldbookPreparation({
    ready:sessionId=>fullTemplateRuntime.forSession(sessionId).connect(),
    async version(sessionId){
      const [chat,globals,settings]=await Promise.all([
        chatHeaderForSession(sessionId,['id','sessionId','mode','requestMode','_storageRevision','settleStatus','regenInProgress',
          'cardDefinitionSnapshot.name','openingWorldbookSnapshot.version']),
        profileData.version('prompt-template-variables.json'),profileData.version('tavern-extension-settings.json')
      ])
      if(!chat || !['story','script'].includes(chat.mode) || chat.requestMode==='sillytavern' || chat.regenInProgress || ['pending','running'].includes(chat.settleStatus)
        || !chat.cardDefinitionSnapshot || chat.openingWorldbookSnapshot?.version!==1)return null
      return {revision:chat._storageRevision,resources:JSON.stringify([globals,settings,modelSelection(sessionId)?.model||''])}
    },
    async prepare(sessionId){
      const chat=await candidateContextReader.forSession(sessionId)
      if(!chat)throw Error('当前会话没有绑定人物卡')
      const result=await nativeWorldBookTemplateContext(chat,await readChatCard(chat))
      // A transient template failure is not a prepared empty worldbook.
      if(result.diagnostics?.some(item=>['worldbook-read-failed','projection-failed'].includes(item.code)))throw Error('候选世界书准备失败，请查看模板诊断')
      return result
    },
    onError:error=>console.warn('dsh-tavern: 候选上下文提前准备失败:',str(error.message||error))
  })
  ctx.effect(()=>()=>candidateWorldbookPreparation.dispose())
  const candidateGenerator = createCandidateGenerator({
    backgroundTasks: async chat => normalizeBackgroundTasks((await backgroundConfigForSession(chat.sessionId))?.backgroundTasks),
    store: {
      chatForSession: candidateContextReader.forSession,
      stateForSession: sessionStateForSession,
      readChat: candidateContextReader.read,
      readCard: (path, chat) => chat ? readChatCard(chat) : readCard(path),
      readCardExtensions: readCardExtensions,
      readScript: readScript,
      writeChat: writeChat
    },
    model: {
      selection: backgroundModelSelection,
      runCandidate: backgroundAgentRunner.run
    },
    planner: contextPlanner,
    worldBookContext: chat => candidateWorldbookPreparation.get(chat.sessionId),
    prompt: runtimePrompt,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    tasks: backgroundTasks,
    characterDesign: characterDesignDocuments,
    waitUntilSettled: async function (chat) {
      let current = chat
      if (current === undefined) return
      let shouldRun = false
      if (isOpeningAwaitingSettlement(current)) {
        current = await readChat(chat.id)
        current.settleStatus = 'running'
        current.settleError = null
        await writeChat(current, { source: 'settlement.opening-prepare' })
        shouldRun = true
      }
      const activity = backgroundTasks.activity(current)
      if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
      if (shouldRun) await queueSettlement(current.id)
    },
    sleep: sleep,
    now: Date.now,
    logger: console
  })
  const candidateTasks = createCandidateTasks({
    chats: { read: readChat, write: writeChat, patch: patchChat, forSession: chatForSession, stateForSession: taskStateReader.forSession, readState: taskStateReader.read },
    generator: candidateGenerator,
    backgroundTasks,
    sessions: {
      runtimeGeneration,
      isLive: function (sessionId) { return Boolean(agentRegistry.get(sessionId)?.session) },
      projectionRevision: cardProjectionRevision
    },
    prepareLegacy: pullBackgroundCycle
  })
  const ledgerEditor = createLedgerEditor({
    chats: { forSession: chatForSession, update: updateChat }, timeline: storyTimeline,
    isBusy: chat => backgroundTasks.activity(chat).busy || Boolean(chat.regenInProgress) || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running'
  })
  const scriptNavigation = createScriptNavigation({
    chats: { forSession: chatForSession, update: updateChat }, readScript, scripts: scriptContinuity,
    exclusive: backgroundTasks.exclusive,
    isBusy: chat => backgroundTasks.activity(chat).busy || Boolean(chat.regenInProgress)
      || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running'
      || autoCompaction?.blocked(chat)
  })
  async function listTavernSessions() {
    return await conversationRegistry.list()
  }
  const conversationGuides = createConversationGuides({ chats: { forSession: chatForSession, update: updateChat }, library: guideLibrary, isPlay: chat => groupOfMode(chat.mode) === 'play' })
  async function setPlayerName(sessionId, userName) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不使用玩家称呼')
    const name = str(userName).trim().slice(0, 80) || '你'
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: name, local: {}, global: {} }
    else chat.macroState.userName = name
    await writeChat(chat, { source: 'player-name.set' })
    return name
  }
  async function setRequestMode(sessionId, requestMode) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不能切换请求模式')
    chat.requestMode = requestMode === 'sillytavern' ? 'sillytavern' : 'dsh'
    await writeChat(chat)
    return chat.requestMode
  }

  // ---------- 后台结算 ----------
  // `knownPosture`: the posture the background history already shows; the block is
  // repeated only when that differs (new session, compaction, rewind).
  function settleUserText(chat, includePosture = true, knownPosture = '') {
    const msgs = (chat.messages || []).filter(function (message) {
      return message && (message.role === 'user' || message.role === 'assistant')
    }).slice(-2)
    const repeatPosture = includePosture && !(str(chat.posture).trim() !== '' && str(chat.posture).trim() === knownPosture)
    const lines = [
      ...(repeatPosture ? ['【上一轮结算姿势】',
      str(chat.posture) !== '' ? projectAgentContent(chat.posture, { charName: chat.cardName, macroState: chat.macroState }).agentText : '（无）'] : []),
      '【最新一轮对话】'
    ]
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      if (m === null || typeof m !== 'object') continue
      const text = projectAgentMessageText(m, { charName: chat.cardName, macroState: chat.macroState })
      if (text.trim() === '') continue
      lines.push((m.role === 'assistant' ? '正文' : '玩家') + ': ' + text)
    }
    return lines.join('\n')
  }
  function applySettlement(chat, result) {
    let postureUpdated = false
    const posture = str(result.posture).trim()
    if (posture !== '') {
      chat.posture = posture
      postureUpdated = true
    }
    return { postureUpdated: postureUpdated }
  }
  function pendingMvuTarget(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
      const message = messages[messageId]
      if (!message || message.role !== 'assistant' || !message.mvu || message.mvu.pending !== true) continue
      const swipeId = Math.max(0, Number(message.swipeId) || 0)
      const variables = message.mvuBaseline?.swipeId === swipeId ? message.mvuBaseline.variables : (Array.isArray(message.variables) ? message.variables[swipeId] : undefined)
      return {
        messageId,
        swipeId,
        message,
        variables: variables && typeof variables === 'object' ? structuredClone(variables) : {}
      }
    }
    return null
  }
  async function mvuUpdateRules(chat, card) {
    try {
      const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
      return mvuUpdateRulesFromWorldBook(worldBook).map(function (rule) {
        return projectAgentContent(rule, { charName: card && card.name, macroState: chat.macroState }).agentText
      })
    } catch (_error) {
      return []
    }
  }
  // An unreadable book has no known depth: callers then use the complete read.
  async function worldBookScanDepth(chat) {
    try { return historyScanDepth(await worldBooks.bound(chat.cardPath, await readChatCard(chat), chat)) }
    catch { return Infinity }
  }
  const boundedHistory = createBoundedHistory({ links: readSessionMap, readWindow: chatPersistence.readWindow })
  // A story request reads the header, every floor its world book scans (plus the
  // current input or latest body), the latest reply and the latest variable floor.
  // Card mode, old saves and unknown depths keep the complete Chat.
  // Request hooks: header, latest reply and variable floor, the two latest MVU
  // replies (variable feedback) and every floor changed since this process last
  // synchronized the session's native surface. The first hook per session in a
  // process, lost change coverage or card mode read the complete Chat.
  const surfaceSyncedRevisions = new Map()
  async function hookChatForSession(sessionId) {
    const chatId = (await readSessionMap())[str(sessionId)]
    const synced = chatId ? surfaceSyncedRevisions.get(str(sessionId)) : undefined
    const mvuReplies = rows => rows.filter(row => row?.role === 'assistant' && row.variables?.[Math.max(0, Number(row.swipeId) || 0)]?.stat_data !== undefined).length >= 2
    let selected
    // A write between the change record and the window read retries once.
    for (let attempt = 0; synced !== undefined && !selected && attempt < 2; attempt++) {
      const changed = await chatPersistence.readChangedIndices(chatId, synced)
      if (!changed?.indices) break
      selected = await boundedHistory.read(chatId, str(sessionId), { lastAssistant: true, lastVariables: true, enough: mvuReplies, include: changed.indices, revision: changed.revision })
    }
    const chat = selected && ['story', 'script'].includes(selected.chat.mode || 'story') && selected.chat.requestMode !== 'sillytavern'
      ? normalizeChat(selected.chat) : await chatForSession(sessionId)
    if (chat?._storageRevision !== undefined) surfaceSyncedRevisions.set(str(sessionId), chat._storageRevision)
    return chat
  }
  async function storyContext({ sessionId, chatId }) {
    const need = { storyRows: async header => (await worldBookScanDepth(header)) + 1, lastAssistant: true, lastVariables: true }
    const selected = chatId === undefined ? await boundedHistory.forSession(sessionId, need) : await boundedHistory.read(chatId, undefined, need)
    if (selected && ['story', 'script'].includes(selected.chat.mode || 'story') && selected.chat.requestMode !== 'sillytavern') return normalizeChat(selected.chat)
    return chatId === undefined ? chatForSession(sessionId) : readChat(chatId)
  }
  async function prepareNextWorldBookContext(snapshot, signal) {
    const turn = settlementTurn(snapshot)
    const inspected = storyTimeline.inspect({ chat: snapshot })
    if (snapshot.preparedWorldBook && Number(snapshot.preparedWorldBook.revision) === Number(inspected.revision)) return snapshot
    let prepared = null
    let error = null
    try {
      const card = await readChatCard(snapshot)
      const worldBook = await worldBooks.bound(snapshot.cardPath, card, snapshot)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card, worldBook })
    } catch (caught) {
      error = str(caught && caught.message || caught)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card: null, worldBook: null })
    }
    const context = error === null ? str(prepared.context).trim() : ''
    const preparedWorldBook = {
      schemaVersion: 2,
      diagnostics: compactRecallDiagnostics(prepared.diagnostics),
      ts: Date.now(),
      turn,
      branchId: inspected.branchId,
      revision: inspected.revision,
      mode: error === null ? str(prepared.kind) : 'error',
      refs: error === null ? prepared.refs : [],
      totalChars: Number(prepared.totalChars) || 0,
      contextChars: Array.from(context).length,
      empty: error !== null || context === '',
      failed: error !== null
    }
    const fields = { preparedWorldBookContext: context, preparedWorldBook, worldBookError: error, lastWorldBookRecall: { ...preparedWorldBook } }
    signal?.throwIfAborted()
    // Unchanged since the snapshot: patch only these header fields instead of
    // rewriting and diffing the complete history.
    const saved = Number.isSafeInteger(snapshot._storageRevision) && await patchChat(snapshot.id, snapshot._storageRevision,
      Object.entries(fields).map(([key, value]) => ({ op: 'set', path: [key], value })), { source: 'worldbook.projection' })
    if (saved) return Object.assign(snapshot, fields, { _storageRevision: saved._storageRevision, updatedAt: saved.updatedAt })
    const latest = await readChat(snapshot.id)
    if (latest === undefined) return null
    const current = storyTimeline.inspect({ chat: latest })
    if (current.branchId !== inspected.branchId || Number(current.revision) !== Number(inspected.revision)) return latest
    Object.assign(latest, structuredClone(fields))
    await writeChat(latest, { source: 'worldbook.projection' })
    return latest
  }
  async function runSettlement(chatId, signal) {
    const retryStale = createSettlementProgressGuard({ backgroundTasks, onStopped: ({ operationId, error }) => {
      console.error('dsh-tavern: 结算连续三次未能提交且剧情状态未前进，已停止，可重新结算', chatId, operationId, str(error?.message || error || '提交已过期'))
    } })
    while (true) {
      signal?.throwIfAborted()
      let snapshot = await readSettlementInput(chatId, {readWindow:chatPersistence.readWindow,readChat,scanDepth:worldBookScanDepth})
      signal?.throwIfAborted()
      if (snapshot === undefined) return
      snapshot = await prepareNextWorldBookContext(snapshot, signal)
      signal?.throwIfAborted()
      if (snapshot === null) return
      const taskRun = await backgroundTasks.begin(snapshot, 'settlement', { reuseSnapshot: true })
      snapshot = taskRun.chat
      let backgroundSessionId = str(taskRun.participantRequest.sessionId)
      let backgroundBoundary = null
      try {
        signal?.throwIfAborted()
        const card = await readChatCard(snapshot)
        signal?.throwIfAborted()
        const variableRetry = snapshot.messages?.some(message => message.mvu?.pending && message.mvu?.variableRetry === true)
        const backgroundTasksSettings = normalizeBackgroundTasks(variableRetry ? { variables: true, posture: false, characterDesign: false } : snapshot.backgroundTasks)
        const mvuTarget = snapshot.mvu && snapshot.mvu.enabled === true && snapshot.mvu.owner === 'official'
          ? pendingMvuTarget(snapshot)
          : null
        let text = ''
        let result = null
        let mvuResult = null
        if (mvuTarget !== null && (backgroundTasksSettings.variables !== false || mvuTarget.message.mvu.pendingSubmission)) {
          if (!mvuTarget.message.mvuBaseline || mvuTarget.message.mvuBaseline.swipeId !== mvuTarget.swipeId) {
            mvuTarget.message.mvuBaseline = { swipeId: mvuTarget.swipeId, variables: structuredClone(mvuTarget.variables) }
            await taskRun.checkpointMessage(mvuTarget.messageId, function (draft, target) {
              if (!target || Number(target.swipeId || 0) !== mvuTarget.swipeId
                || Number(draft.tavernHelperLifecycleRevision || 0) !== Number(snapshot.tavernHelperLifecycleRevision || 0)) throw new Error('MVU 任务目标已过期')
              target.mvuBaseline = structuredClone(mvuTarget.message.mvuBaseline)
            })
          }
          const saveDelivery = async function (submission, prepared) {
            signal?.throwIfAborted()
            await taskRun.checkpointMessage(mvuTarget.messageId, function (draft, target) {
              if (!target || Number(target.swipeId || 0) !== mvuTarget.swipeId
                || Number(draft.tavernHelperLifecycleRevision || 0) !== Number(snapshot.tavernHelperLifecycleRevision || 0)) throw new Error('MVU 任务目标已过期')
              target.mvu.pendingSubmission = structuredClone(submission)
              target.mvu.delivery = {
                version: 1, taskId: target.mvu.delivery?.taskId || taskRun.operationId, operationId: taskRun.operationId,
                branchId: taskRun.basedOn.branchId, revision: taskRun.basedOn.revision,
                lifecycleRevision: Number(snapshot.tavernHelperLifecycleRevision || 0),
                swipeId: mvuTarget.swipeId,
                posture: prepared?.posture ?? target.mvu.delivery?.posture,
                ...(prepared ? { prepared: structuredClone({ submission: prepared.submission, receipt: prepared.receipt, effect: prepared.effect, posture: prepared.posture }) } : {})
              }
            })
          }
          const settlementInput = {
            onSubmission: submission => saveDelivery(submission),
            onPrepared: prepared => saveDelivery(prepared.submission, prepared),
            guidance: mvuTarget.message.mvu.guidance || '',
            preserveForeground: variableRetry,
            onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
            backgroundTasks: backgroundTasksSettings,
            operationId: taskRun.operationId,
            chatId: snapshot.id,
            branchId: taskRun.basedOn.branchId,
            basedOnRevision: taskRun.basedOn.revision,
            sessionId: snapshot.sessionId,
            turn: settlementTurn(snapshot),
            messageId: mvuTarget.messageId,
            swipeId: mvuTarget.swipeId,
            expectedLifecycleRevision: Math.max(0, Number(snapshot.tavernHelperLifecycleRevision) || 0),
            storyText: projectAgentMessageText(mvuTarget.message, { charName: card && card.name, macroState: snapshot.macroState }),
            currentVariables: mvuTarget.variables,
            helperContext: collectMvuHelperContext(snapshot.messages, mvuTarget.messageId),
            guides: Array.isArray(snapshot.guides) ? snapshot.guides : [],
            variableSchema: mvuTarget.variables.schema,
            charName: card && card.name,
            macroState: snapshot.macroState,
            updateRules: await mvuUpdateRules(snapshot, card),
            webSearchEnabled: snapshot.webSearchEnabled === true
          }
          const pendingSubmission = mvuTarget.message.mvu && mvuTarget.message.mvu.pendingSubmission
          const delivery = mvuTarget.message.mvu?.delivery
          if (delivery && (delivery.branchId !== taskRun.basedOn.branchId || delivery.revision !== taskRun.basedOn.revision
            || delivery.lifecycleRevision !== Number(snapshot.tavernHelperLifecycleRevision || 0) || delivery.swipeId !== mvuTarget.swipeId)) throw new Error('MVU 任务目标已过期，旧任务未执行')
          if (delivery?.prepared) {
            mvuResult = structuredClone(delivery.prepared)
          } else if (pendingSubmission && typeof pendingSubmission === 'object') {
            mvuResult = await mvuSettlement.resumeVariables({ ...settlementInput, submission: pendingSubmission })
          } else {
            const selection = backgroundModelSelection(snapshot)
            if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
            mvuResult = await mvuSettlement.settleVariables({
              ...settlementInput,
              system: backgroundTasksSettings.posture ? runtimePrompt('posture-settlement') : '',
              selection,
              persistentSessionId: backgroundSessionId,
              signal
            })
          }
          if (mvuResult.posture === undefined && delivery?.posture !== undefined) mvuResult.posture = delivery.posture
          text = str(mvuResult.text) || JSON.stringify({ posture: mvuResult.posture })
          backgroundSessionId = str(mvuResult.traceSessionId) || backgroundSessionId
          backgroundBoundary = Number.isSafeInteger(mvuResult.traceBoundary) ? mvuResult.traceBoundary : null
          if (mvuResult.receipt?.status === 'pending') {
            const runtimeState = tavernScriptDispatch.status(snapshot.sessionId)
            if (runtimeState.initializationError) throw new Error(runtimeState.initializationError)
            await taskRun.defer({
              participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary }),
              apply(draft) {
                const target = draft.messages[mvuTarget.messageId]
                target.mvu.pendingSubmission = structuredClone(mvuResult.submission || pendingSubmission)
                target.mvu.receipt = structuredClone(mvuResult.receipt)
                if (target.mvu.delivery && mvuResult.posture !== undefined) target.mvu.delivery.posture = mvuResult.posture
                draft.settleStatus = 'pending'
                draft.settleError = null
              }
            })
            return
          }
          if (['error', 'partial'].includes(mvuResult.receipt?.status)) {
            const error = new Error(mvuResult.receipt.summary || mvuResult.receipt.failures?.[0]?.message || '变量结算失败，请重试结算')
            error.mvuReceipt = mvuResult.receipt
            throw error
          }
          result = { posture: mvuResult.posture }
        } else if (!backgroundTasksSettings.posture && !backgroundTasksSettings.characterDesign) {
          result = {}
        } else {
          const selection = backgroundModelSelection(snapshot)
          if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
          let submittedPosture = null
          let settlementToolTail = Promise.resolve()
          const run = await backgroundAgentRunner.run({
            onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
            task: 'settlement',
            backgroundTasks: backgroundTasksSettings,
            persistent: true,
            persistentSessionId: backgroundSessionId,
            rewindTo: taskRun.participantRequest.rewindTo,
            selection,
            messages: [{
              id: 'settle-' + Date.now().toString(36),
              role: 'user',
              regexPlacement: 2,
              content: [{ type: 'text', text: settleUserText(snapshot, backgroundTasksSettings.posture, taskRun.participantRequest.rewindTo == null ? lastSubmittedPosture(backgroundSessionId && (agentRegistry.get(backgroundSessionId)?.session || sessionStore.get(backgroundSessionId))) : '') }],
              source: { kind: 'plugin', plugin: 'dsh-tavern' }
            }],
            system: [
              backgroundTasksSettings.posture ? runtimePrompt('posture-settlement') : '本轮不生成或提交姿势。完成启用的后台任务后简短回复完成。',
              ...(backgroundTasksSettings.characterDesign ? ['若发现重要人物需要建立、补全或修订长期设计，在当前后台 Agent 内调用 skill 加载 character-design，并按 Skill 读取或保存人物档案；无需也不得创建另一个 Agent。',
              '人物设计保存独立于姿势结算；完成设计后继续当前任务。'] : []),
              backgroundTasksSettings.posture ? 'posture_submit 是本任务最后一步。' : ''
            ].join('\n\n'),
            tools: [...(backgroundTasksSettings.posture ? [POSTURE_SUBMIT_TOOL] : []), ...(backgroundTasksSettings.characterDesign ? [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL] : [])],
            maxToolCalls: 12,
            temperature: 0.2,
            sessionId: snapshot.sessionId,
            webSearchEnabled: snapshot.webSearchEnabled === true,
            signal,
            stopToolsWhen: function () { return submittedPosture !== null },
            acceptWithoutText: function () { return submittedPosture !== null },
            onToolCall(call) {
              const pending = settlementToolTail.then(async function () {
                if (call && (call.name === CHARACTER_DESIGN_READ_TOOL.name || call.name === CHARACTER_DESIGN_SAVE_TOOL.name)) {
                  if (!backgroundTasksSettings.characterDesign) return JSON.stringify({ ok: false, error: '人物设计已关闭' })
                  if (submittedPosture !== null) return JSON.stringify({ ok: false, retryable: false, error: '姿势已经提交，本轮后台任务已结束' })
                  return await characterDesignDocuments.execute(snapshot.id, call)
                }
                if (!backgroundTasksSettings.posture || !call || call.name !== POSTURE_SUBMIT_TOOL_NAME) {
                  return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许调用人物设计工具和 posture_submit' })
                }
                try {
                  submittedPosture = normalizePostureSubmission(call.arguments, {
                    charName: card && card.name,
                    macroState: snapshot.macroState
                  })
                  return JSON.stringify({ ok: true })
                } catch (error) {
                  return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
                }
              })
              settlementToolTail = pending.catch(function () {})
              return pending
            }
          })
          await settlementToolTail
          if (backgroundTasksSettings.posture && submittedPosture === null) throw new Error('后台 Agent 未调用 posture_submit 提交有效姿势')
          result = { ...(submittedPosture || {}) }
          text = str(run.text) || JSON.stringify(result)
          backgroundSessionId = str(run.traceSessionId)
          backgroundBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
        }
        signal?.throwIfAborted()
        let stat = { postureUpdated: false }
        const completion = {
          ...(mvuTarget && (mvuResult?.effect?.changes || []).every(c => c.path[0] !== 'messages' || Number.isInteger(c.path[1]))
            ? {messageIndices:[mvuTarget.messageId,...(mvuResult?.effect?.changes || []).filter(c=>c.path[0]==='messages').map(c=>c.path[1])]} : {}),
          stateChanged: Boolean(mvuResult?.effect?.changes?.length) || Boolean(mvuResult && mvuResult.receipt && mvuResult.receipt.status === 'updated') ||
            str(result && result.posture).trim() !== '',
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary }),
          apply(draft, scope) {
            if (mvuResult && mvuResult.effect) applyMvuSettlementEffect(draft, mvuResult.effect, scope)
            stat = applySettlement(draft, result)
            if (mvuTarget && mvuResult === null && backgroundTasksSettings.variables === false) {
              const target = draft.messages[mvuTarget.messageId]
              if (target && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
                target.mvu = { ...target.mvu, pending: false, receipt: { version: 1, status: 'skipped', summary: '变量结算已关闭，本轮未更新变量。', changes: [], sideEffects: [], failures: [] } }
              }
            }
            if (mvuResult !== null) {
              const target = draft.messages[mvuTarget.messageId]
              if (target && target.role === 'assistant' && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
                const receipt = structuredClone(mvuResult.receipt)
                target.mvu = {
                  pending: false,
                  modified: receipt.status === 'updated',
                  diagnostics: receipt.status === 'stale' ? [{ message: receipt.summary }] : [],
                  events: receipt.status === 'stale' ? [] : ['MESSAGE_RECEIVED'],
                  receipt
                }
              }
            }
            draft.settleStatus = 'done'
            draft.settleError = null
            draft.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 200) }
          }
        }
        const completed = await taskRun.commit(completion)
        if (completed.status === 'missing') return
        if (completed.status === 'stale') {
          signal?.throwIfAborted()
          if (await retryStale(completed.chat)) continue
          return
        }
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 200))
        return
      } catch (err) {
        if (signal?.aborted) return
        const failedSessionId = str(err && err.traceSessionId)
        if (failedSessionId && failedSessionId !== backgroundSessionId) {
          backgroundSessionId = failedSessionId
          backgroundBoundary = null
        }
        if (backgroundBoundary === null && Number.isSafeInteger(err && err.traceBoundary)) backgroundBoundary = err.traceBoundary
        const failed = await taskRun.commit({
          status: 'failed',
          stateChanged: false,
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary })
        })
        if (failed.status === 'missing') return
        if (failed.status === 'stale') {
          signal?.throwIfAborted()
          console.warn('dsh-tavern: 结算失败结果已过期', chatId, str(err?.message || err))
          if (await retryStale(failed.chat, err)) continue
          return
        }
        const latest = await readChat(chatId)
        if (latest === undefined) return
        const target = pendingMvuTarget(latest)
        const message = str(err && err.message || err) || '后台结算失败'
        if (target !== null) {
          target.message.mvu = {
            pending: false,
            modified: false,
            diagnostics: [{ message }],
            events: [],
            receipt: err?.mvuReceipt ? structuredClone(err.mvuReceipt) : { version: 1, status: 'error', summary: '', changes: [], failures: [{ command: '', message }] }
          }
        }
        latest.settleStatus = 'failed'
        latest.settleError = message
        await writeChat(latest, { source: target === null ? 'settlement.posture-failed' : 'settlement.mvu-failed' })
        console.error('dsh-tavern: 结算失败', chatId, str(err && err.message || err))
        return
      }
    }
  }
  async function onSettlementSettled(chatId, signal) {
    try {
      const latest = await chatPersistence.readSessionState(chatId)
      if (!signal.aborted && latest) {
        void mvuSettlementReconciler.wake(latest.sessionId)
        void candidateWorldbookPreparation.warm(latest.sessionId)
        void worldbookPrefilter.start(chatId)
        void pluginApi.turnSettled(latest.sessionId).catch(error => console.warn('dsh-tavern: 插件轮次通知失败:', str(error?.message || error)))
      }
    } catch {
      if (!signal.aborted) void mvuSettlementReconciler.scan()
    }
  }
  function queueSettlement(chatId) { return settlementJobs.start(chatId) }
  function cancelSettlement(chatId, options) { return settlementJobs.cancel(chatId, options) }
  const mvuSettlementReconciler = createMvuSettlementReconciler({
    list: () => conversationRegistry.list(),
    resolve: async sessionId => {
      const state = await taskStateReader.forSession(sessionId)
      // Pending delivery may need old message receipts. Idle eligibility does not.
      return state && backgroundTasks.activity(state).phase === 'pending'
        ? sessionStateForSession(sessionId) : state
    },
    shouldResume: function (chat) {
      return Boolean(pendingMvuSettlementState(chat)?.hasSubmission
        && backgroundTasks.activity(chat).phase === 'pending')
    },
    isReady: function (sessionId, chat) {
      if (pendingMvuSettlementState(chat)?.prepared) return true
      const state = tavernScriptDispatch.status(sessionId)
      return state.ready === true || Boolean(state.initializationError)
    },
    resume: chatId => queueSettlement(chatId),
    retryDelayMs: 10000,
    onError: function (error) {
      console.error('dsh-tavern: 接续等待中的 MVU 变量结算失败，将自动重试', str(error && error.message || error))
    }
  })
  const unsubscribeMvuRuntimeReady = tavernScriptDispatch.subscribeSettled(function (sessionId) {
    void mvuSettlementReconciler.wake(sessionId)
  })
  ctx.effect(() => function () {
    unsubscribeMvuRuntimeReady()
    mvuSettlementReconciler.dispose()
    settlementJobs.dispose()
  }, 'dsh-tavern: reconcile deferred MVU settlement')
  async function stopBackground(sessionId, operationId) {
    const chat = await chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    const activity = backgroundTasks.activity(chat)
    if (!operationId || activity.operationId !== operationId || (!activity.busy && activity.phase !== 'pending')) return view(chat, await readChatCard(chat))
    // Abort the provider request first; interrupted operations reject late commits.
    backgroundAgentRunner.cancel(chat.sessionId)
    await cancelSettlement(chat.id, { wait: false })
    const stopped = await backgroundTasks.recover(chat, { operationId })
    return view(stopped.chat, await readChatCard(stopped.chat))
  }

  async function retrySettlement(sessionId, turn, guidance) {
    for (let attempt=0;attempt<5;attempt++) {
      const recent = await readOpeningWindow(sessionId)
      const window = recent && recent.chat.timeline?.schemaVersion === 1
        && !Object.values(recent.chat.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
        && recent.chat.messages.some(message => message.role === 'assistant' && message.greeting !== true) ? recent : null
      const chat = window ? window.chat : await chatForSession(sessionId)
      if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
      const activity = backgroundTasks.activity(chat)
      if (activity.busy) throw new Error('后台 Agent 正在运行，请稍候')
      if (Object.values(storyTimeline.inspect({ chat }).operations || {}).some(operation => operation.kind === 'body' && operation.status === 'running')) {
        throw new Error('正文正在生成，请等待完成后再重新结算')
      }
      const messages = Array.isArray(chat.messages) ? chat.messages : []
      let target = null
      for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
        const message = messages[messageId]
        if (!message || message.role !== 'assistant' || message.greeting === true) continue
        target = { messageId: messageId + (window?.from || 0), message }
        break
      }
      if (target === null || Math.max(0, Number(target.message.turn) || 0) !== Math.max(0, Number(turn) || 0)) {
        throw new Error('只能重试当前最新正文的后台结算')
      }
      const officialMvu = chat.mvu && chat.mvu.enabled === true && chat.mvu.owner === 'official'
      if (officialMvu) {
        if (!target.message.mvu) throw new Error('当前最新正文没有可重试的变量结算')
        if (target.message.mvu.receipt?.status === 'pending') {
          if (str(guidance).trim()) throw new Error('等待中的任务只能重新投递，不能追加指导意见重新生成变量计划')
          if (!target.message.mvu.pendingSubmission && !target.message.mvu.delivery?.prepared) throw new Error('当前任务尚未保存可重新投递的变量操作，请等待或停止后台任务')
          if (activity.phase !== 'pending') throw new Error('等待中的结算状态已经变化，请刷新后重试')
          // Reuse the durable submission/effect and the existing per-chat job.
          // Never reset MVU state or request another model plan on redelivery.
          void queueSettlement(chat.id).catch(error => console.error('dsh-tavern: 重新投递变量结算失败', str(error?.message || error)))
          return window ? await projectOpeningWindow(window) : await view(chat, await readChatCard(chat))
        }
        const swipeId = Math.max(0, Number(target.message.swipeId) || 0)
        if (!target.message.mvuBaseline || target.message.mvuBaseline.swipeId !== swipeId) {
          if (['updated', 'unchanged', 'partial'].includes(target.message.mvu.receipt?.status)) {
            throw new Error('这轮旧记录没有结算前快照，无法安全重新结算变量')
          }
        }
        target.message.mvu = { pending: true, variableRetry: true, guidance: guidance === undefined ? str(target.message.mvu?.guidance).trim() : str(guidance).trim(), modified: false, diagnostics: [], events: [] }
      } else if (activity.phase !== 'failed' || activity.role !== 'settlement') {
        throw new Error('当前最新正文没有失败的后台结算')
      }
      chat.settleStatus = 'pending'
      chat.settleError = null
      chat.updatedAt = Date.now()
      // Historical display backfill must not turn a retry into a full-history
      // merge. CAS the requested fields; on conflict re-read and revalidate the
      // latest body, activity and MVU baseline before trying again.
      const saved = await patchChat(chat.id, chat._storageRevision, [
        ...(officialMvu ? [{op:'set',path:['messages',target.messageId,'mvu'],value:target.message.mvu}] : []),
        {op:'set',path:['settleStatus'],value:'pending'}, {op:'set',path:['settleError'],value:null}
      ], { source: 'settlement.retry' })
      if (!saved) continue
      chat._storageRevision = saved._storageRevision
      chat.updatedAt = saved.updatedAt
      if (window) window.revision = saved._storageRevision
      void queueSettlement(chat.id).catch(function (error) {
        console.error('dsh-tavern: 重试后台结算失败', str(error && error.message || error))
      })
      return window ? await projectOpeningWindow(window) : await view(chat, await readChatCard(chat))
    }
    throw new Error('对话正在被其他操作更新，请稍后重新结算')
  }
  async function pullBackgroundCycle(sessionId) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    let shouldRun = false
    if (isOpeningAwaitingSettlement(chat)) {
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat, { source: 'settlement.opening-prepare' })
      shouldRun = true
    }
    const activity = backgroundTasks.activity(chat)
    if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
    if (!shouldRun) return true
    void queueSettlement(chat.id)
    return false
  }
  // ---------- 卡片工作台：剧本素材与新卡创建 ----------
  async function sourceWindowOf(chat) {
    const out = []
    for (const sourcePath of (chat.workspace && chat.workspace.sourcePaths) || []) {
      const src = await readSource(sourcePath)
      if (src === undefined || !Array.isArray(src.chunks)) continue
      const title = str(src.title) || '剧本'
      for (const chunk of src.chunks) {
        out.push({ chunkId: sourcePath + '/' + chunk.id, title: title, order: chunk.order, text: chunk.text })
      }
    }
    return out
  }
  async function prepareWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') throw new Error('卡片工作台状态不存在')
    if (state.prepared !== null && typeof state.prepared === 'object' && Number(state.prepared.nativeTurn) === Number(nativeTurn)) return state.prepared
    const all = await sourceWindowOf(chat)
    const cursor = Math.max(0, Number(state.cursor) || 0)
    const window = all.slice(cursor, cursor + 6)
    state.prepared = { nativeTurn: Number(nativeTurn) || 0, window: window, cursorBefore: cursor, total: all.length }
    return state.prepared
  }
  function commitWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') return
    const prepared = state.prepared
    if (prepared !== null && typeof prepared === 'object' && Number(prepared.nativeTurn) === Number(nativeTurn)) {
      state.cursor = Math.min(prepared.total, (Number(prepared.cursorBefore) || 0) + prepared.window.length)
      state.prepared = null
    }
  }
  function workspaceViewOf(chat) {
    const state = chat.workspace || {}
    return {
      mountedResources: Array.isArray(state.mountedResources) ? state.mountedResources : []
    }
  }
  async function createWorkspaceCard(chat, state) {
    const draft = state.draft !== null && typeof state.draft === 'object' ? state.draft : {}
    if (str(draft.name).trim() === '') throw new Error('新人物卡还没有角色名，请先在对话中确认')
    const player = str(state.player)
    if (player === '') throw new Error('玩家（{{user}}）身份还没有确认。请先在对话中告诉助手“玩家是XX”。')
    const workspace = cardPreparation.create({ kind: 'draft', draft: draft, player: player, sourcePaths: state.sourcePaths || state.sourceIds || [] })
    const card = cardPreparation.project(workspace)
    const cardPath = await fileResources.importCard({ name: card.name + '.json', text: JSON.stringify(workspace.raw, null, 2) }, workspace)
    card.path = cardPath
    const idx = await readIndex()
    for (const row of idx.chats || []) {
      if (row.id === chat.id) { row.cardPath = cardPath; row.cardName = card.name }
    }
    await writeIndex(idx)
    return { path: cardPath, card }
  }
  const foregroundFrameBuilder = createForegroundFrameBuilder()
  const foregroundFrameSessionAdapter = createForegroundFrameSessionAdapter({ id: randomUUID })
  const turnOrchestrator = createTurnOrchestrator({
    captureSceneWorldbook,
    store: {
      chatForSession,
      storyContextForSession: sessionId => storyContext({ sessionId }),
      stateForSession: sessionStateForSession,
      readCard,
      readCardExtensions,
      readScript,
      writeChat,
      writeChatHeader,
      updateChat,
      readChatSlice: chatSliceForSession,
      patchChat,
      updateCard,
      createCard: createWorkspaceCard
    },
    planner: contextPlanner,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    frameBuilder: foregroundFrameBuilder,
    cards: cardPreparation,
    workspace: {
      prepare: prepareWorkspace,
      commit: commitWorkspace
    },
    renderMacros: function (text, chat) {
      return renderCardText(text, { name: chat.cardName }, chat.macroState)
    },
    projectUserTemplate: async ({chat,text}) => {
      const global = await readPromptTemplateGlobalVariables()
      const result = await fullTemplateRuntime.forSession(chat.sessionId).renderInput(text, {userName:chat.macroState?.userName || '你',scopes:{global,local:chat.variables || {},initial:chat.promptTemplateInitialVariables || {},message:lastTavernHelperVariables(chat.messages) || {}}})
      const row = result.message
      await tavernScriptHostAdapter.saveFullPromptTemplateGlobals(chat.sessionId, result.scopes.global, global)
      return {scopes:result.scopes,message:{role:'user',text:row.mes,sourceText:row.mes,swipeId:row.swipe_id,swipes:row.swipes,variables:row.variables,tavernPluginData:Object.fromEntries(['is_ejs_processed','variables_initialized','template_display'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))}}
    },
    projectReply: projectRuntimeReply,
    projectWorldBookTemplates: input => nativeWorldBookTemplateContext(input.chat, input.card),
    projectForegroundWorldbook,
    recordWorldbookRecall: worldbookRecallLog.record,
    projectScriptPromptWorldbook: async function ({ chat, card, turn }) {
      const text = scriptPromptScanText(chat)
      if (!text.trim()) return null
      const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
      return prepareWorldBookRecall({ chat, card, turn, worldBook, latestBody: text })
    },
    resolvePresetRegexScripts: async function (chat) {
      if (!chat || groupOfMode(chat.mode) !== 'play') return []
      const snapshot = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : null
      return Array.isArray(snapshot && snapshot.regexScripts) ? snapshot.regexScripts : []
    },
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    prepareOpeningWorldBook: prepareNextWorldBookContext,
    store: { chatForSession, readChat, readState: taskStateReader.read, stateForSession: taskStateReader.forSession, openingStateForSession },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    prefilterWorldbook: chatId => worldbookPrefilter.start(chatId),
    cancelPrefilter: chatId => worldbookPrefilter.cancel(chatId),
    cleanupFailedTurn: async function (input) {
      const mode = await turnOrchestrator.modeFor(input.sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      const liveAgent = agentRegistry.get(input.sessionId)
      const liveSession = sessionStore.get(input.sessionId) || (liveAgent && liveAgent.session)
      return clearFailedTurnSurface({ session: liveSession, turn: input.turn })
    },
    logger: console
  })

  let settleRuntimeReadiness
  const runtimeReadiness = new Promise(function (resolve) { settleRuntimeReadiness = resolve })
  async function initializeRuntimeState() {
    await fileResources.migrateLegacy(await readIndex(), readJson, writeIndex, readChat, writeChat)
    await presetLibrary.migrate()
    await resourceGraph.recover()
    return await readIndex()
  }
  async function recoverRuntimeHistory(recoveredIndex) {
    const activeChatIds = []
    for (const row of recoveredIndex.chats || []) {
      try { await recoverRegeneration(row.id) }
      catch (error) { console.error('dsh-tavern: 恢复正文重新生成失败', row.id, error?.message || error) }
      // Startup needs header metadata, not every historical message. The window
      // is read-only: only materialize a writable Chat when it is bound to a
      // retired bypass plan. Never write this partial projection back to storage.
      const window = await chatPersistence.readWindow(row.id, { limit: 1, includeCheckpoints: true })
      let chat = window ? window.chat : await readChat(row.id)
      if (chat === undefined) continue
      activeChatIds.push(row.id)
      try {
        if (str(chat.bypassPlanId) !== '') {
          if (window) chat = await readChat(row.id)
          if (await presetLibrary.restoreChat(chat)) await writeChat(chat)
        }
      } catch (error) { console.warn('dsh-tavern: 对话预设恢复失败', chat.id, error) }
      await syncChatSummary(chat)
    }
    await foregroundHandoff.recover(activeChatIds)
    await candidateTasks.recover(activeChatIds)
    // Recovery must first convert durable running operations back to pending.
    void mvuSettlementReconciler.scan()
  }
  // ---------- 重新生成正文（生成即替换，无确认） ----------
  const { regenerate: regenBody, replayFailed: replayFailedTurn, recover: recoverRegeneration, rollback: rollbackTurn, undoRollback: undoRollbackTurn } = createRoundHistory({
    diagnostics: mvuDiagnostics,
    chats: { read: readChat, readState: taskStateReader.read, stateForSession: taskStateReader.forSession, forSession: chatForSession, readCard: readChatCard,
      readRevision: readChatRevision, write: writeChat, update: updateChat, patch: patchChat,
      readRecent: async chatId => {
        const selected = await boundedHistory.read(chatId, undefined, { storyRows: 2, lastAssistant: true })
        return selected && normalizeChat(selected.chat)
      },
      // Rare story operations may reach further back than per-request syncs.
      changedSince: (chatId, revision) => chatPersistence.readChangedIndices(chatId, revision, { limit: 2048 }),
      rowsAt: async (chatId, revision, indices) => {
        const selected = await readRowsAt(chatPersistence.readWindow, chatId, revision, indices)
        return selected && { ...selected, chat: normalizeChat(selected.chat) }
      } },
    sessions: { get: function (sessionId) { return ctx.get('agents')?.get(sessionId) },
      getSession: sessionId => sessionStore.get(sessionId),
      resume: sessionId => agentRegistry.resume({ resumeSessionId: sessionId }),
      flush: session => sessionStore.flush(session) },
    scripts: { read: readScript, continuity: scriptContinuity,
      dispatchEvent: function (event) { return tavernScriptHostAdapter.dispatchEvent(event) } },
    timeline: storyTimeline,
    queueSettlement,
    cancelSettlement,
    present: presentStory,
    sessionPatch,
  })

  const bodyEditor = createBodyEditor({
    chats: { forSession: hookChatForSession, update: updateChat, patch: patchChat },
    sessions: { get: id => ctx.get('agents')?.get(id), flush: session => sessionStore.flush(session) },
    timeline: storyTimeline,
    activity: chat => backgroundTasks.activity(chat),
    project: async (text, chat) => {
      const extensions = await readCardExtensions(chat.cardPath, chat)
      return projectRuntimeReply(text, { charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(extensions, chat.runtimePresetSnapshot?.regexScripts), placement: 2, isEdit: false, depth: 0 })
    },
    present: presentStory,
    sessionPatch,
  })

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args) {
    performanceDiagnostics.browser(args?._performance)
    const started = performance.now()
    // A deleted game's card frames may still call in; do not recreate its diagnostics.
    try { return await requestPerformance.run(method, args?._traceId, () => deletedSessionIds.has(args?.sessionId) ? dispatchMethod(method, args) : apiDiagnostics.observe(method, args, () => dispatchMethod(method, args))) }
    finally { performanceDiagnostics.record(method, performance.now() - started) }
  }

  const displayRuntimeCaptures = createDisplayRuntimeCoalescer({
    write: (sessionId, turn, partIndex, runtime) => captureDisplayRuntime(sessionId, turn, partIndex, runtime)
  })
  const gameplayApi = createGameplayApi({
    controller: () => ctx.get('sessionController'), registry: agentRegistry, llm, dataRoot,
    store: profileData, dispatch: (method, args) => dispatchMethod(method, args),
    chatForSession, listCards,
    requests: async chat => (await modelRequestLog.evidence(chat.id)).requests,
    requestIndex: async chat => chat ? await modelRequestLog.list(chat.id) : [],
    native: async id => {
      const live = sessionDebugEvidence(id)
      if (live.loaded) return live.events
      const handle = await agentRegistry.resume({ resumeSessionId: id })
      try { return sessionEvents(handle.agent.session) } finally { await handle.dispose() }
    },
    requiresBrowser: async chat => hasTavernScriptRuntime(chat, (await readCardExtensions(chat.cardPath, chat))?.helperScripts)
  })

  const cardResponseTest = createCardResponseTest({ api: gameplayApi, store: profileData, chatForSession })
  ctx.effect(() => () => cardResponseTest.dispose())

  const conversationMigration = createConversationMigration({
    store: chatJournalStore,
    assertIdle: chat => {
      if (chat.mode === 'card' || backgroundTasks.activity(chat).busy || chat.regenInProgress || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running') {
        throw new Error('请等待本轮游玩和后台结算完成后再迁移')
      }
    },
    notify: id => { void readSessionMap().then(map => {
      for (const [sessionId, chatId] of Object.entries(map)) if (chatId === id) sessionSignals.publish(sessionId, {kind:'tavern-state',version:'storage-migration:'+Date.now()})
    }).catch(error => console.warn('dsh-tavern: 迁移状态通知失败:', error.message)) }
  })
  ctx.effect(() => () => conversationMigration.dispose())

  async function dispatchMethod(method, args, serverTemplate = false) {
    if (method.startsWith('gameplay.')) return await gameplayApi.call(method.slice(9), args || {})
    switch (method) {
      case 'getStorageMigration':
      case 'migrateStorage': {
        const chatId = (await readSessionMap())[str(args?.sessionId)]
        if (!chatId) throw new Error('找不到当前存档')
        return method === 'getStorageMigration' ? conversationMigration.status(chatId) : conversationMigration.start(chatId)
      }
      case 'getCardOrganization': return { groups: (await cardOrganization.read()).groups }
      case 'organizeCards': return { groups: (await cardOrganization.update(args || {}, await fileResources.list('card'))).groups }
      case 'listCards': return { cards: await listCards() }
      case 'getHostCompatibility': return { compatibility: hostCompatibility }
      case 'getSessionPatchStatus': return { patch: sessionPatch.view() }
      case 'getSessionPatchClient': return sessionPatch.serverReady
        ? { source: sessionPatch.clientSource }
        : { source: '', skipped: sessionPatch.status === 'skipped', reason: sessionPatch.reason }
      case 'confirmSessionPatch': {
        sessionPatch.confirmClient(args || {})
        return { patch: sessionPatch.view() }
      }
      case 'getUpdateStatus': return { status: await applicationUpdater.status() }
      case 'checkUpdate': return { status: await applicationUpdater.check() }
      case 'startUpdate': return { status: await applicationUpdater.start() }
      case 'cancelUpdate': return { status: await applicationUpdater.cancel() }
      case 'prepareSessionOpening': {
        const chat = await chatForSession(args && args.sessionId)
        if (!chat) throw new Error('找不到原对话')
        return await prepareSessionOpening({ chat, card: await readChatCard(chat), swipeId: args.swipeId, message: args.message, preparation: openingPreparation })
      }
      case 'generateTavernHelper':
      case 'generateTavernHelperRaw': {
        return await helperGenerationTasks.run(args?.sessionId, args?.config?.generation_id, async signal => {
          const chat = await chatForSession(args?.sessionId)
          if (!chat) throw new Error('找不到当前游戏')
          signal.throwIfAborted()
          const backgroundCall = opts => callModel({ ...opts, background: true, signal })
          if (method === 'generateTavernHelperRaw' && args.completion) return { text: await generateHelperCompletion(args.completion, { callModel: backgroundCall, sessionId: chat.sessionId }) }
          const context = { callModel: backgroundCall, sessionId: chat.sessionId, history: helperGenerationHistory(chat) }
          if (method === 'generateTavernHelperRaw') return { text: await generateHelperRaw(args.config, context) }
          validateHelperGenerateConfig(args.config)
          const card = await readChatCard(chat)
          const presetSnapshot = await helperGenerationPreset(args.config.preset_name, chat.runtimePresetSnapshot || null)
          const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
          const extensions = await readCardExtensions(chat.cardPath, chat)
          signal.throwIfAborted()
          return { text: await generateHelper(args.config, { ...context, chat, card, worldBook, presetSnapshot, extensions,
            presetRegexScripts: chat.runtimePresetSnapshot?.regexScripts || [], characterVariables: extensions?.variables || {} }) }
        }, args?.generationToken)
      }
      case 'stopTavernHelperGeneration': return { stopped: helperGenerationTasks.stop(args?.sessionId, args?.generationId, { generationToken: args?.generationToken, pending: args?.pending }) }
      case 'stopAllTavernHelperGeneration': return { stopped: true, generationIds: helperGenerationTasks.stopAll(args?.sessionId, args?.pendingGenerations) }
      case 'callOpeningRuntime': return await openingPreparation.callRuntime(args && args.id, args && args.method, args && args.args)
      case 'saveOpeningSelection': return openingPreparation.select(args && args.id, args && args.openingId)
      case 'initializeOpeningTemplate': try { return openingInitializationPayload(await openingPreparation.applyTemplateInitial(args.id, await requestPerformance.stage('templateInitialize', () => fullTemplateRuntime.forSession('opening:' + args.id).initializeVariables([]))), args.compact) } finally { fullTemplateRuntime.cancel('opening:' + args.id) }
      case 'createOpeningPreparation': return await openingPreparation.create(args && args.path)
      case 'getOpeningPreparation': return args?.touchOnly === true ? openingPreparation.retain(args.id) : openingPreparation.get(args && args.id)
      case 'retainOpeningPreparation': return openingPreparation.retain(args && args.id)
      case 'releaseOpeningPreparation': fullTemplateRuntime.cancel('opening:' + args.id); return openingPreparation.release(args && args.id)
      case 'replaceOpeningWorldbook': return await openingPreparation.replaceWorldbook(args && args.id, args && args.entries, args && args.expectedEntries)
      case 'getCardOpenings': return await getCardOpenings(args && args.path, args && args.userName, args && args.requestMode, args && args.previewTransport)
      case 'preparePlayStart': {
        await requestPerformance.stage('preparePreset', () => runtimePresets.prepareFullSnapshot())
        return { prepared: true }
      }
      case 'getUserPreferenceProfile': {
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
      }
      case 'manageUserPreferenceProfile': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.manage(args)) }
      case 'updateUserPreferenceProfile': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.updateConfirmed(args)) }
      case 'setConversationUserProfileEnabled': {
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
      }
      case 'setUserPreferenceProfileDefaultEnabled': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.setDefaultEnabled(args && args.enabled === true, args?.profileId)) }
      case 'getCard': {
        const cardPath = normalizeResourcePath(args && args.path, 'card')
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
        return { card: Object.assign(cardPreparation.present({ card: workspace, as: 'detail' }), { path: cardPath }) }
      }
      case 'getCardTaskPrompt': {
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
      }
      case 'getCardMemory': {
        const chat = await chatForSession(args?.sessionId)
        if (!chat) return { enabled: false }
        return { enabled: true, ...await cardMemory.search(chat, args?.query, { manual: true }) }
      }
      case 'changeCardMemoryPreference': return await cardMemory.preference(await chatForSession(args?.sessionId), args || {}, { manual: true })
      case 'changeCardMemoryExperience': return await cardMemory.experience(await chatForSession(args?.sessionId), args || {}, { manual: true })
      case 'getResourceWorkspace': return { path: dataRoot + '/resources' }
      case 'listResources': return await listTavernResources()
      case 'getResource': {
        const resourcePath = normalizeResourcePath(args && args.path, 'source')
        const text = await fileResources.readText(resourcePath)
        if (text === undefined) throw new Error('剧本不存在: ' + resourcePath)
        return { path: resourcePath, text }
      }
      case 'setGlobalWorldBook': return await worldBooks.setGlobal(args && args.source, args && args.enabled)
      case 'listWorldBooks': return await worldBooks.catalog()
      case 'getWorldBook': return await worldBooks.get(args && args.source)
      case 'getWorldBookBinding': return { binding: await worldBooks.binding(args && args.cardPath) }
      case 'getWorldBookAssociations': return { associations: await worldBooks.associations(args && args.source) }
      case 'bindWorldBook': return { binding: await worldBooks.bind(args && args.cardPath, args && args.source) }
      case 'setWorldBookBindings': return { binding: await worldBooks.setBindings(args && args.cardPath, args && args.sources) }
      case 'unbindWorldBook': return { binding: await worldBooks.unbind(args && args.cardPath, args && args.source) }
      case 'importWorldBook': return { worldBook: await worldBooks.import(args && args.payload) }
      case 'updateWorldBook': return await worldBooks.update(args && args.source, args && args.update)
      case 'exportWorldBook': return { worldBook: await worldBooks.export(args && args.source) }
      case 'deleteWorldBook': return await worldBooks.remove(args && (args.source || args.path))
      case 'listPresets': return await presetLibrary.catalog()
      case 'selectPreset': return await presetLibrary.select(args && args.path)
      case 'applyConversationPreset': {
        const sessionId = str(args?.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        if (typeof args.path !== 'string') throw new Error('请选择预设')
        if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用预设')
        const snapshot = args.path === '' ? null : await runtimePresets.fullSnapshot(args.path)
        const saved = await updateChat(chat.id, current => {
          if (current._storageRevision !== chat._storageRevision) throw new Error('当前游戏已变化，请刷新后重试')
          current.runtimePresetSnapshot = snapshot
          return current
        }, { source: 'preset.apply-conversation' })
        return { runtimePreset: saved.runtimePresetSnapshot === null ? null : { id: saved.runtimePresetSnapshot.presetPath, name: saved.runtimePresetSnapshot.presetName } }
      }
      case 'getPreset': return { preset: await presetLibrary.detail(args && args.path) }
      case 'exportPreset': return await presetLibrary.export(args && args.path)
      case 'movePresetEntry': return { preset: await presetLibrary.moveEntry(args?.path, args?.entryKey, args?.phase, args?.beforeEntryKey, args?.revision) }
      case 'updatePresetEntry': return { preset: await presetLibrary.updateEntry(args && args.path, args && args.entryKey, args && args.patch) }
      case 'updatePresetRegex': return { preset: await presetLibrary.updateRegex(args && args.path, args && args.regexKey, args && args.patch !== undefined ? args.patch : args && args.enabled) }
      case 'previewPresetConversion': {
        const preview = await previewPreset(args && args.path, args && args.orderGroupIndex)
        if (preview === undefined) throw new Error('预设不存在: ' + (args && args.path))
        return { preview }
      }
      case 'renameResource': return { resource: await renameResource(args && args.path, args && args.name) }
      case 'deleteResource': return await deleteResource(args && args.path)
      case 'deletePreset': return await deletePreset(args && args.path)
      case 'getDefaultWritingSkills': {
        const settings = await readTavernSettings()
        return { skills: (await tavernSkills.list()).filter(skill => skill.agents.includes('foreground')).map(skill => ({ name: skill.name, description: skill.description, enabled: !settings.defaultDisabledWritingSkills.includes(skill.name) })) }
      }
      case 'setDefaultWritingSkill': {
        const skill = await tavernSkills.read(args?.name)
        if (!skill?.agents.includes('foreground') || typeof args?.enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
        await updateTavernSettings({ defaultWritingSkill: { name: skill.name, enabled: args.enabled } })
        return { saved: true }
      }
      case 'getConversationWritingSkills': {
        const chat = await chatHeaderForSession(str(args?.sessionId), ['disabledWritingSkills'])
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        return { skills: (await tavernSkills.list()).filter(skill => skill.agents.includes('foreground')).map(skill => ({ name: skill.name, description: skill.description, enabled: !(chat.disabledWritingSkills || []).map(canonicalTavernSkillName).includes(skill.name) })) }
      }
      case 'setConversationWritingSkill': {
        const chat = await chatHeaderForSession(str(args?.sessionId), ['disabledWritingSkills'])
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        const skill = await tavernSkills.read(args.name)
        if (!skill?.agents.includes('foreground') || typeof args.enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
        await updateChat(chat.id, current => ({ ...current, disabledWritingSkills: args.enabled ? (current.disabledWritingSkills || []).map(canonicalTavernSkillName).filter(name => name !== skill.name) : [...new Set([...(current.disabledWritingSkills || []).map(canonicalTavernSkillName), skill.name])] }), { source: 'writing-skill.switch' })
        invalidateTavernSkills()
        return { saved: true }
      }
      case 'getLatestRequestContext': {
        const sessionId = str(args?.sessionId)
        const background = backgroundAgentRunner.requestContext(sessionId)
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        const ownerId = background?.parentSessionId || session?.header?.parentSession || sessionId
        const chat = await sessionStateForSession(ownerId)
        return { record: await modelRequestLog.latestForSession(sessionId, str(args?.knownId), chat?.id) }
      }
      case 'listSkills': return { skills: (await tavernSkills.list()).map(({ content, path, ...summary }) => summary) }
      case 'editSkill': return { skill: await tavernSkills.edit(args) }
      case 'getSkill': return { skill: await tavernSkills.read(args.name), references: await tavernSkills.referenceFiles(args.name) }
      case 'assignSkill': return { skill: await tavernSkills.assign(args.name, args.agents) }
      case 'deleteSkill': await tavernSkills.remove(args.name); return { deleted: true }
      case 'importSkill': return await tavernSkills.importBundle({ files: skillImportFiles(args), overwrite: args.overwrite === true })
      case 'getScriptInfo': {
        const script = await readScript(args && args.path)
        const info = scriptContinuity.inspect({ script: script, state: null, request: { kind: 'info' } })
        return { script: script === undefined ? info : Object.assign({}, info, { path: script.path }) }
      }
      case 'importScript': return { script: await importScript(args && args.cardPath, args && args.payload) }
      case 'bindScript': return { script: await bindScript(args && args.cardPath, args && args.path) }
      case 'deleteScript': return await deleteScript(args && (args.cardPath || args.path))
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'importPreset': return { preset: await importPreset(args && args.payload) }
      case 'updateCard': {
        const change = await updateCard(args && args.path, args && args.patch)
        return { card: change.card, changed: change.changed }
      }
      case 'getConversationBackgroundModel':
      case 'getConversationBackgroundConfig': {
        const chat = await backgroundConfigForSession(str(args?.sessionId))
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        return { backgroundModel: chat.backgroundModelSelection || null, backgroundTasks: normalizeBackgroundTasks(chat.backgroundTasks), webSearchEnabled: chat.webSearchEnabled === true, sceneImagesEnabled: chat.sceneImagesEnabled === true, sceneImagesAvailable: TAVERN_RELEASE_CAPABILITIES.sceneImages, modelCatalog: await tavernModelCatalog() }
      }
      case 'setConversationBackgroundModel':
      case 'setConversationBackgroundConfig': {
        const sessionId = str(args?.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        const selection = normalizeBackgroundModel(args.backgroundModel)
        if (args.backgroundModel !== null && !selection) throw new Error('后台模型配置无效')
        if (selection) {
          const catalog = await tavernModelCatalog()
          if (!catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model))) throw new Error('所选后台模型不可用')
          const reasoning = await readBackgroundModelReasoning(llm, selection)
          if (selection.reasoningEffort && !reasoning?.efforts?.some(effort => effort.id === selection.reasoningEffort)) throw new Error('所选推理强度不可用')
        }
        const saved = await updateChat(chat.id, current => patchConversationBackground(current, args), { source: 'background-model.switch-conversation' })
        return { backgroundModel: saved.backgroundModelSelection || null, backgroundTasks: normalizeBackgroundTasks(saved.backgroundTasks), webSearchEnabled: saved.webSearchEnabled === true, sceneImagesEnabled: saved.sceneImagesEnabled === true }
      }
      case 'getBackgroundModelReasoning': return { reasoning: await readBackgroundModelReasoning(llm, args) }
      case 'getDisplayPreferences': return { hideContextAndReasoning: (await readTavernSettings()).hideContextAndReasoning }
      case 'getCandidatePreferences': return { candidateDismissMode: (await readTavernSettings()).candidateDismissMode }
      case 'getTavernSettings': return { settings: await readTavernSettings(), modelCatalog: await tavernModelCatalog(), releaseCapabilities: TAVERN_RELEASE_CAPABILITIES }
      case 'getSceneImageSettings': {
        const settings = await enabledSceneIllustrations().settings(args?.provider)
        if (args?.conversation === true) {
          const chat = await backgroundConfigForSession(str(args.sessionId))
          return { settings: { ...settings, enabled: chat?.sceneImagesEnabled === true } }
        }
        return { settings }
      }
      case 'saveSceneImageSettings': {
        if (Object.hasOwn(args || {}, 'enabled')) throw new Error('请在本局设置中开启或关闭场景生图')
        return { settings: await enabledSceneIllustrations().configure(args) }
      }
      case 'testSceneImageConnection': return await enabledSceneIllustrations().testConnection(args)
      case 'listSceneImageModels': return await enabledSceneIllustrations().listModels(args)
      case 'testSceneImageGeneration': return await enabledSceneIllustrations().testGenerate()
      case 'pluginMediaForTurn': return await pluginMediaForTurn(args && args.sessionId, args && args.turn)
      case 'pluginMediaTurns': return await pluginMediaTurns(args && args.sessionId)
      case 'sceneImageStatus': return { illustration: await enabledSceneIllustrations().status(args.sessionId, args.turn) }
      case 'recordSceneImageInteraction': {
        enabledSceneIllustrations()
        const chat = await backgroundConfigForSession(str(args.sessionId))
        if (chat) await recordSceneImageInteraction(sceneDiagnostics, chat.id, args).catch(() => {})
        return { recorded: Boolean(chat) }
      }
      case 'generateSceneImage': {
        const illustrations = enabledSceneIllustrations()
        const chat = await backgroundConfigForSession(str(args.sessionId))
        const record = (stage, reason) => recordSceneImageInteraction(sceneDiagnostics, chat?.id, { requestId: args.requestId, turn: args.turn, stage, reason }).catch(() => {})
        await record('received')
        try {
          const illustration = await illustrations.start(args.sessionId, args.turn, args.key, args)
          await record('returned')
          return { illustration }
        } catch (error) { await record('failed', 'start-error'); throw error }
      }
      case 'retrySceneImageSave': return { illustration: await enabledSceneIllustrations().retrySave(args.sessionId, args.turn, args.key, args.requestId) }
      case 'cancelSceneImage': return { illustration: await enabledSceneIllustrations().cancel(args.sessionId, args.turn, args.key, args.requestId) }
      case 'removeSceneImage': return { illustration: await enabledSceneIllustrations().removeImage(args.sessionId, args.turn, args.key, args.versionId) }
      case 'setSceneImageReference': return { illustration: await enabledSceneIllustrations().setReference(args.sessionId, args.turn, args.key, args.versionId, args.consent, args.enabled !== false, args.personId) }
      case 'updateTavernSettings': return { settings: await updateTavernSettings(args && args.patch) }
      case 'getSystemPrompts': return { systemPrompts: presentSystemPrompts(await readTavernSettings()) }
      case 'updateSystemPrompt': {
        const name = str(args && args.name)
        if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
        return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompt: { name, text: args && args.text } })) }
      }
      case 'resetSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ resetSystemPrompts: SYSTEM_PROMPT_NAMES })) }
      case 'importSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompts: importSystemPromptDocument(args && args.payload) })) }
      case 'exportSystemPrompts': {
        const current = presentSystemPrompts(await readTavernSettings())
        const document = { spec: current.spec, version: current.version, prompts: Object.fromEntries(current.prompts.map(function (item) { return [item.name, item.text] })) }
        return { name: 'dsh-tavern-system-prompts.json', text: JSON.stringify(document, null, 2) + '\n' }
      }
      case 'listSessions': {
        const settings = await readTavernSettings()
        return { sessions: (await listTavernSessions()).filter(chat => chat.requestMode !== 'sillytavern'), capabilities: { compatibilityMode: false, trustedCardMode: settings.trustedCardMode } }
      }
      case 'renameConversation': {
        const chat = await chatForSession(args && args.sessionId)
        if (!chat) throw new Error('当前会话没有绑定 Tavern 对话')
        const title = str(args && args.title)
        const saved = await updateChat(chat.id, current => ({ ...current, title }), { source: 'conversation.rename' })
        // Renaming must not report success while the sidebar still has an old title.
        // The normal updateChat summary sync is best effort; retry it strictly here.
        await conversationRegistry.sync(saved)
        return { title: saved.title }
      }
      case 'markConversationOpened': return await conversationRegistry.touch(args && args.sessionId, Date.now())
      case 'listMobileCardImports': return await mobileCardImport.list()
      case 'importMobileCard': return { card: await importCard(await mobileCardImport.read(args && args.id)) }
      case 'importCard': return { card: await importCard(args && args.payload) }
      case 'deleteCard': return await deleteCard(args && args.path)
      case 'prepareDeleteChats': return await deleteChats(args && args.chatIds, true)
      case 'deleteChats': return await deleteChats(args && args.chatIds)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'prepareConversationFork': {
        const plan = await prepareConversationFork(args?.chatId, args?.sessionId, args?.turn)
        return { turn: plan.turn, atSeq: plan.atSeq, sourceRevision: plan.source._storageRevision }
      }
      case 'forkChat': return { fork: await forkChat(args?.chatId, args?.sessionId, args?.targetSessionId, args?.turn, args?.sourceRevision, args?.atSeq) }
      case 'browseScript': return await scriptNavigation.browse(args?.sessionId, args?.position)
      case 'setScriptChunkSize': return await scriptNavigation.setChunkSize(args?.sessionId, args || {})
      case 'pointScript': return await scriptNavigation.point(args?.sessionId, args || {})
      case 'getSessionInventory': return await sessionInventory.read()
      case 'exportConversation': return await exportConversation(args && args.chatId, args && args.sessionId, args && args.title)
      case 'exportTavernLogs': return await exportTavernLogs(args && args.sessionId)
      case 'importGameSave': return await importGameSave(args)
      case 'exportGameSave': return await exportGameSave(args && args.sessionId, { images: args && args.images !== false })
      case 'recordTavernCompatibilityCalls': {
        const chat = await chatHeaderForSession(str(args && args.sessionId), [])
        if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
        await compatibilityDiagnostics.record(chat.sessionId, args && args.runtimeId, args && args.calls)
        return { recorded: true }
      }
      case 'recordMvuRuntimeDiagnostic': {
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
      }
      case 'getWorldBookRecallLog': {
        const chat = await chatForSession(args && args.sessionId)
        if (!chat) throw new Error('对话不存在')
        return await worldbookRecallLog.read(chat, args && args.turn)
      }
      case 'getPlayChatDebugTarget': {
        const sourceChat = await chatForSession(args && args.sessionId)
        if (sourceChat === undefined || ((sourceChat.mode || 'story') !== 'story' && (sourceChat.mode || 'story') !== 'script')) throw new Error('当前对话不是游玩对话')
        const card = await readChatCard(sourceChat)
        return { card: { path: sourceChat.cardPath, name: card.name }, chatId: sourceChat.id }
      }
      case 'attachPlayChatDebug': return { reference: await attachPlayChatDebug(args && args.targetSessionId, args && args.sourceSessionId, args && args.turn) }
      case 'captureDisplayRuntime': return await displayRuntimeCaptures.capture(args && args.sessionId, args && args.turn, args && args.partIndex, args && args.runtime)
	      case 'getTavernHelperContext': {
        if (!args?.eventId && args?.openingWindow === 1) {
          const window = await readOpeningWindow(args.sessionId)
          if (window) {
            const projected = await projectOpeningWindow(window)
            return { contextWindow: {historyWindow:projected.historyWindow,tavernHelper:projected.tavernHelper} }
          }
        }
        return { context: args?.eventId ? await tavernScriptHostAdapter.transactionContext(args.sessionId,args.eventId) : await tavernScriptHostAdapter.context(args && args.sessionId) }
      }
	      case 'updateTavernHelperPrompts': return await tavernScriptHostAdapter.updatePrompts(args && args.sessionId, args && args.operation, args && args.expectedLifecycleRevision, args && args.eventId)
	      case 'updateTavernHelperVariables': return await tavernScriptHostAdapter.updateVariables(args && args.sessionId, args && args.option, args && args.variables, args && args.expectedLifecycleRevision, args && args.eventId, args && args.contextBaseline)
	      case 'updateTavernHelperMessages': return await tavernScriptHostAdapter.updateMessages(args && args.sessionId, args && args.messages, args && args.expectedLifecycleRevision, args && args.eventId)
	      case 'createTavernHelperMessages': return await tavernScriptHostAdapter.createMessages(args && args.sessionId, args && args.messages, args && args.option, args && args.expectedLifecycleRevision, args && args.eventId)
      // Old pages must not create a second executor or receive server work.
      case 'releaseFullTemplateRuntime': return { released: false }
      case 'heartbeatFullTemplateRuntime': return { active: false, executor: 'server' }
      case 'claimFullTemplateWork': return { event: null, executor: 'server' }
      case 'startFullTemplateWork': return { started: false }
      case 'completeFullTemplateWork': return { completed: false }
      case 'executeTemplateHostCommand': {
        if (!serverTemplate) throw new Error('模板命令仅由服务端执行器调用')
        const text = str(args.text)
        const send = /^\/send\s+([\s\S]+)\|\s*\/trigger\s*$/.exec(text)
        if (send || /^\/trigger\s*$/.test(text)) {
          await ctx.get('sessionController').prompt({ sessionId: args.sessionId, requestId: randomUUID(),
            content: send ? [{ type: 'text', text: send[1].trim() }] : [], mode: 'followup' })
          return { pipe: '' }
        }
        if (/^\/setinput(?:\s|$)/.test(text)) throw new Error('服务端模板不能操作网页输入框，请使用 /send … | /trigger')
        const agent = agentRegistry.get(args.sessionId)
        if (!agent || !commands) throw new Error('当前会话没有可用的命令执行器')
        const result = await commands.execute(agent, text, [])
        if (!result || result.result?.kind === 'error') throw new Error(result?.result?.text || '未注册的模板命令')
        return { pipe: str(result.result?.text) }
      }
      case 'getFullTemplateWorldbook': return await tavernScriptHostAdapter.getWorldbook(args.sessionId, args.name, true)
      case 'replaceFullTemplateWorldbook': return await tavernScriptHostAdapter.replaceWorldbook(args.sessionId, args.name, args.entries, args.expectedEntries, true)
      case 'executeFullTemplateCommand': return await fullTemplateRuntime.forSession(args.sessionId).command(args.text)
      case 'countFullTemplateTokens': return { tokens: estimateWorldBookTokens(args.text), estimator: 'unicode-estimate' }
      case 'getGlobalPromptTemplateSettings': return await tavernScriptHostAdapter.readGlobalPromptTemplateSettings()
      case 'saveGlobalPromptTemplateSettings': return await tavernScriptHostAdapter.saveGlobalPromptTemplateSettings(args.settings, args.expectedSettings)
      case 'getFullPromptTemplateState': if (args.sessionId?.startsWith('opening:')) return openingPreparation.templateState(args.sessionId.slice(8)); return await tavernScriptHostAdapter.readFullPromptTemplateState(args && args.sessionId, args?.cursor, args?.openingWindow === 1)
      case 'getPromptTemplateHistory': {
        if (!serverTemplate) throw new Error('Template history is server-only')
        return await helperHistoryAccess.read(args.token,args.messageId,args.messageId)
      }
      case 'saveFullPromptTemplateGlobals': if (!serverTemplate) throw new Error('提示词模板已迁移到服务端，请刷新页面'); if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateGlobals(args.sessionId.slice(8), args.variables); return await tavernScriptHostAdapter.saveFullPromptTemplateGlobals(args && args.sessionId, args && args.variables, args && args.expectedVariables)
      case 'saveFullPromptTemplateSettings': if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateSettings(args.sessionId.slice(8), args.settings); return await tavernScriptHostAdapter.saveFullPromptTemplateSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
      case 'saveFullPromptTemplateState': if (!serverTemplate) throw new Error('提示词模板已迁移到服务端，请刷新页面'); if (args.sessionId?.startsWith('opening:')) return openingPreparation.saveTemplateState(args.sessionId.slice(8), args.state); return await tavernScriptHostAdapter.saveFullPromptTemplateState(args && args.sessionId, args && args.state)
      case 'saveTavernChatData': return await tavernScriptHostAdapter.saveChatData(args && args.sessionId, args && args.request)
      case 'saveTavernExtensionSettings': return await tavernScriptHostAdapter.saveExtensionSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
      case 'loadTavernWorldInfo': return await tavernScriptHostAdapter.loadWorldInfo(args && args.sessionId, args && args.name)
      case 'saveTavernWorldInfo': return await tavernScriptHostAdapter.saveWorldInfo(args && args.sessionId, args && args.name, args && args.worldInfo, args && args.expectedWorldInfo)
      case 'getTavernHelperWorldbook': return await tavernScriptHostAdapter.getWorldbook(args && args.sessionId, args && args.name)
      case 'replaceTavernHelperWorldbook': return await tavernScriptHostAdapter.replaceWorldbook(args && args.sessionId, args && args.name, args && args.entries, args && args.expectedEntries)
	  case 'claimTavernScriptWork': return tavernScriptHostAdapter.claimWork(args && args.sessionId, args && args.runtimeId, args && args.ready, args && args.initializationError, args && args.contextBaseline)
	  case 'startTavernScriptWork': return tavernScriptHostAdapter.startWork(args && args.sessionId, args && args.eventId, args && args.leaseToken, args && args.runtimeId)
	  case 'getTavernScriptWorkState': return tavernScriptHostAdapter.workState(args && args.sessionId, args && args.eventId, args && args.leaseToken, args && args.runtimeId, args && args.keepAlive)
	  case 'heartbeatTavernScriptRuntime': return tavernScriptHostAdapter.heartbeatRuntime(args && args.sessionId, args && args.runtimeId, args && args.ready, args && args.initializationError)
	  case 'completeTavernHelperEvent': return { completed: tavernScriptHostAdapter.completeEvent(args && args.sessionId, args && args.eventId, args && args.args, args && args.runtimeId, args && args.leaseToken, args && args.error, sanitizeRuntimeDiagnostics(args && args.diagnostics)) }
	  case 'releaseTavernHelperRuntime': return { released: tavernScriptHostAdapter.releaseRuntime(args && args.sessionId, args && args.runtimeId) }
      case 'previewChatImport': return await chatHistoryImporter.preview(args || {})
      case 'rescueChatHistory': return await chatHistoryImporter.rescue(args || {})
      case 'importChatHistory': return await chatHistoryImporter.import(args || {})
      case 'startChat': {
        try {
          return { view: await startChat(args && args.path, args && args.sessionId, args && args.mode, args && args.openingId, args && args.userName, args && args.requestMode, args && args.preparationId, args && args.cardTask) }
        } catch (error) {
          console.error('dsh-tavern: 创建对话失败', {
            cardPath: str(args && args.path),
            sessionId: str(args && args.sessionId),
            mode: str(args && args.mode),
            openingId: str(args && args.openingId),
            error: str(error && error.message || error)
          })
          throw error
        }
      }
      case 'getBackgroundSuppressedTurns': {
        const id = str(args && args.sessionId)
        if (!id.startsWith('background-')) return { turns: [] }
        return readBackgroundSuppression(id)
      }
      case 'getImageAgentUndo': {
        const available = sceneIllustrations !== null && await sceneIllustrations.isAgentSession(str(args && args.parentSessionId), str(args && args.agentSessionId))
        return { available }
      }
      case 'undoImageAgentTurn': {
        if (sceneIllustrations === null) throw new Error('场景生图不可用')
        return await sceneIllustrations.undoAgentTurn(str(args && args.parentSessionId), str(args && args.agentSessionId))
      }
      case 'applyUpdatedCard': {
        const sessionId = str(args && args.sessionId)
        if (typeof args.digest !== 'string' || !args.digest) throw new Error('请刷新后确认人物卡和世界书更新')
        const conflict = new Error('游戏状态已变化，未应用更新，请稍后重试')
        // Rebuild from the latest snapshot on a concurrent write. Never merge an
        // old prepared save over new state, or skip the exact revision check.
        for (let attempt = 0; attempt < 3; attempt++) {
          const chat = await chatForSession(sessionId)
          if (!chat || !['story', 'script'].includes(chat.mode || 'story') || chat.requestMode === 'sillytavern') throw new Error('仅支持当前游玩会话')
          if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用人物卡')
          const card = await readCard(chat.cardPath)
          if (!card) throw new Error('人物卡不存在')
          const patch = await playCardSnapshots.replacement(chat, card, args.digest)
          const prepared = await liveCardUpdate.prepare({...chat,...patch}, card, chat)
          const nativeSession = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
          if (nativeSession) prepareTemplateHistory(nativeSession, chat, prepared)
          prepared.tavernHelperLifecycleRevision = (Number(chat.tavernHelperLifecycleRevision) || 0) + 1
          const extensions = await readCardExtensions(chat.cardPath, prepared)
          await liveCardUpdate.project(prepared, card, {projections:[]}, {charName:card.name,macroState:chat.macroState,regexScripts:extensions.regexScripts})
          await playCardSnapshots.replacement(chat, await readCard(chat.cardPath), args.digest)
          try {
            const saved = await updateChat(chat.id, current => {
              if (current._storageRevision !== chat._storageRevision || agentRegistry.get(sessionId)?.phase?.kind === 'running' || ['pending','running','waiting-runtime'].includes(current.settleStatus)) throw conflict
              return prepared
            }, { source: 'card-context.apply-update' })
            if (nativeSession) await synchronizeTemplateHistory(nativeSession, saved, session => sessionStore.flush(session))
            return { view: await view(saved, card) }
          } catch (error) { if (error !== conflict) throw error }
        }
        throw conflict
      }
      case 'getFullTemplateRuntimeInfo': throw new Error('提示词模板已迁移到服务端，请刷新页面');
      case 'getSession': {
        if(args?.fullView === true)templateHistoryFrom.set(args.sessionId,0)
        else if(Number.isSafeInteger(args?.historyFrom) && args.historyFrom >= 0)templateHistoryFrom.set(args.sessionId,args.historyFrom)
        return sessionViews.response(args || {})
      }
      case 'hydrateTavernHelperMessages': {
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
      }
      case 'designCharacter': return await manualCharacterDesign.start(args || {})
      case 'consolidateLedger': return await manualLedger.start(args || {})
      case 'sendPhoneMessage': return { phoneChat: await phoneChat.send(args || {}) }
      case 'runCompaction': {
        const id = str(args && args.sessionId), chat = await chatForSession(id)
        if (chat && ['story', 'script'].includes(chat.mode)) return { result: await autoCompaction.run(id, { manual: true, signal: compactionAbort.signal }) }
        const result = await withCompactionSession(id, async agent => (await agentCompaction(agent)).compactNow(agent, compactionAbort.signal))
        return { result: { status: 'completed', foreground: { status: 'succeeded', message: result ? '压缩完成' : '没有可压缩的历史' }, background: { status: 'skipped' } } }
      }
      case 'compactionStatus': return { state: (await sessionStateForSession(args && args.sessionId))?.contextCompaction || null }
      case 'syncSession': {
        const sync = await requestPerformance.stage('candidateSync', () => candidateTasks.sync(args && args.sessionId, { requestId: args && args.requestId, kind: args && args.kind }))
        requestPerformance.state({ foregroundRunning: agentRegistry.get(str(args?.sessionId))?.phase?.kind === 'running', backgroundBusy: sync.activity?.busy, backgroundRole: sync.activity?.role })
        return { sync }
      }
      case 'submitTask': {
        if (str(args && args.kind) !== 'candidate') throw new Error('暂不支持的持久任务类型: ' + str(args && args.kind))
        return { sync: await candidateTasks.submit(args) }
      }
      case 'getSessionActivity': {
        const agent = agentRegistry.get(str(args && args.sessionId))
        return { activity: await sessionActivity(args && args.sessionId), runtimeGeneration, liveSession: Boolean(agent && agent.session) }
      }
      case 'getBackgroundOperation': return { operation: await sessionOperation(args && args.sessionId, args && args.operationId) }
      case 'setStatusBarPlacement': {
        if (!['sidebar', 'body'].includes(args?.placement)) throw new Error('无效的状态栏位置')
        const chat = await chatForSession(args.sessionId)
        if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先打开游玩会话')
        await updateChat(chat.id, current => ({ ...current, statusBarPlacement: args.placement }), { source: 'ui.status-bar-placement' })
        return { statusBarPlacement: args.placement }
      }
      case 'setPlayerName': return { playerName: await setPlayerName(args && args.sessionId, args && args.userName) }
      case 'setRequestMode': return { requestMode: await setRequestMode(args && args.sessionId, args && args.requestMode) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'getChoices': return { candidates: await candidateGenerator.find({ sessionId: args && args.sessionId, messageId: args && args.messageId }) }
      case 'startChoices': return await candidateTasks.startLegacy(args)
      case 'exportCard': {
        const cardPath = args && args.path
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + (args && args.path))
        const characterBook = await worldBooks.characterBookForCard(cardPath)
        return { document: cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook }) }
      }
      case 'editLedger': { await ledgerEditor(args || {}); return { view: await sessionView(args.sessionId) } }
      case 'updateGuideLibrary': return { item: await guideLibrary.update(args) }
      case 'deleteGuideLibrary': { await guideLibrary.remove(args); return { ok: true } }
      case 'listRegexLibrary': return { items: await regexLibrary.list() }
      case 'importRegexLibrary': return { items: await regexLibrary.importFile(args?.text, args?.fileName) }
      case 'deleteRegexLibrary': { await regexLibrary.remove(args); return { ok: true } }
      case 'listGuideLibrary': return { items: await guideLibrary.list() }
      case 'saveGuideLibrary': return { item: await conversationGuides.save(args?.sessionId, args?.name) }
      case 'loadGuideLibrary': return { guides: await conversationGuides.load(args?.sessionId, args?.id) }
      case 'addGuide': return { guides: await conversationGuides.add(args?.sessionId, args?.text) }
      case 'deleteGuide': return { guides: await conversationGuides.remove(args?.sessionId, args) }
      case 'getBodyEdit': return { edit: await bodyEditor.read(args && args.sessionId) }
      case 'saveBodyEdit': return { view: await bodyEditor.save(args && args.sessionId, args) }
      case 'regenBody': return { view: await regenBody(args && args.chatId, args && args.guidance, args && args.sessionId) }
      case 'replayTurn': return { view: await replayFailedTurn(args && args.chatId, args && args.sessionId) }
      case 'setAllFailedErrorVisibility': {
        const sessionId = str(args && args.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat) throw new Error('请先打开游玩会话')
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        if (!session) throw new Error('会话尚未就绪，请刷新后重试')
        const events = sessionEvents(session)
        let changedCount = 0
        await updateChat(chat.id, current => {
          const result = setAllFailedErrorVisibility(current, events, args.hidden)
          changedCount = result.changedCount
          return changedCount ? result.chat : undefined
        }, { source: 'ui.error-visibility.batch' })
        return { view: await sessionView(sessionId), changedCount }
      }
      case 'setFailedErrorVisibility': {
        const sessionId = str(args && args.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat) throw new Error('请先打开游玩会话')
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        if (!session) throw new Error('会话尚未就绪，请刷新后重试')
        const events = sessionEvents(session)
        await updateChat(chat.id, current => setFailedErrorVisibility(current, events, args.turn, args.hidden), { source: 'ui.error-visibility' })
        return { view: await sessionView(sessionId) }
      }
      case 'undoRollbackTurn': return { view: await undoRollbackTurn(args && args.sessionId, args && args.chatId) }
      case 'rollbackTurn': return { view: await rollbackTurn(args && args.sessionId, args && args.chatId, args && args.expectedTurn) }
      case 'getBackgroundProgress': return { progress: backgroundAgentRunner.progress(args && args.sessionId) }
      case 'stopBackground': return { view: await stopBackground(args && args.sessionId, args && args.operationId) }
      case 'retrySettlement': return { view: await retrySettlement(args && args.sessionId, args && args.turn, args && args.guidance) }
      case 'retryMvuSettlement': return { view: await retrySettlement(args && args.sessionId, args && args.turn, args && args.guidance) }
      default: throw new Error('未知方法: ' + method)
    }
  }

  async function coordinationVersion(sessionId) {
    const normalizedSessionId = str(sessionId)
    const links = await readSessionMap()
    const chatId = str(links && links[normalizedSessionId])
    const chatVersion = chatId === '' ? '' : await chatPersistence.version(chatId)
    const projectionVersion = await profileData.version('card-projection-revisions.json')
    return [runtimeGeneration, chatId, chatVersion, projectionVersion].join(':')
  }

  coordinationEvents = createCoordinationEventPublisher({
    readVersion: async function (sessionId) { return await coordinationVersion(sessionId) },
    load: async function (sessionId) { return await candidateTasks.sync(sessionId, { kind: 'candidate' }) },
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    fallbackIntervalMs: 5000,
    onError(error) { console.warn('dsh-tavern: 协调文件读取失败，将继续重试:', str(error && error.message || error)) }
  })

  ctx.provide('tavernSessionSignals', Object.freeze({
    async control(method, args, signal) {
      if (!['claimTavernScriptWork', 'startTavernScriptWork', 'getTavernScriptWorkState',
        'heartbeatTavernScriptRuntime', 'completeTavernHelperEvent', 'releaseTavernHelperRuntime'].includes(method)) {
        throw new Error('不支持的运行时控制请求')
      }
      signal?.throwIfAborted()
      // Keep the existing identities, ownership checks and receipt recovery semantics.
      const result = await dispatch(method, args)
      // Claim responses can carry an entire historical script context. Preserve
      // the HTTP JSON envelope without recursively walking it through Remote codecs.
      return JSON.stringify({ ok: true, ...result, runtimeGeneration })
    },
    async * follow(sessionIds, signal) {
      const ids = Array.from(new Set((Array.isArray(sessionIds) ? sessionIds : []).map(str).filter(Boolean)))
      const stops = ids.map(function (sessionId) { return coordinationEvents.watch(sessionId) })
      try {
        yield * sessionSignals.follow(signal, ids)
      } finally {
        stops.forEach(function (stop) { stop() })
      }
    }
  }))

  registerTavernHttpRoutes({
    ctx,
    dispatch,
    fileResources,
    helperHistoryAccess,
    mobileCardImport,
    performanceDiagnostics,
    runtimeGeneration,
    runtimeReadiness,
    sceneIllustrations,
    readPluginMediaFile: (...args) => readPluginMediaFile(...args),
    sessionResources,
    str,
    tavernRemoteAssets,
    tavernStaticResources,
  })

  function contentText(message) {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
    return message.content.map(function (block) { return block !== null && typeof block === 'object' && block.type === 'text' ? str(block.text) : '' }).filter(Boolean).join('\n').trim()
  }

  function isTurnInput(message) {
    const source = message && message.source
    return source && (source.kind === 'user' || (source.kind === 'plugin' && (source.plugin === 'dsh-tavern-regen' || source.plugin === 'dsh-tavern-replay')))
  }

  function activeTurnOf(exec) {
    const phase = exec && exec.agent ? exec.agent.phase : null
    return phase && phase.kind === 'running' ? Math.max(0, Number(phase.turn) || 0) : 0
  }

  function turnStartIndex(session, turn) {
    const events = sessionEvents(session)
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/start' && Number(event.data && event.data.turn) === Number(turn)) return index
    }
    return -1
  }

  function userMessageForTurn(session, turn) {
    const events = sessionEvents(session)
    const start = turnStartIndex(session, turn)
    if (start < 0) return ''
    for (let index = Math.max(0, start + 1); index < events.length; index++) {
      const event = events[index]
      if (!event || event.type !== 'user/message') continue
      if (isTurnInput(event.data)) return event.data
    }
    return ''
  }

  function requestIdOf(message) {
    const source = message && message.source
    return source && source.kind === 'user' ? str(source.rpcId).trim() : ''
  }

  function requestIdForTurn(session, turn) {
    const events = sessionEvents(session)
    const start = turnStartIndex(session, turn)
    if (start < 0) return ''
    for (let index = Math.max(0, start + 1); index < events.length; index++) {
      const event = events[index]
      if (!event || event.type !== 'user/message' || !isTurnInput(event.data)) continue
      return requestIdOf(event.data)
    }
    return ''
  }

  function requestIdForMessages(messages) {
    const list = Array.isArray(messages) ? messages : []
    for (let index = list.length - 1; index >= 0; index--) {
      if (isTurnInput(list[index])) return requestIdOf(list[index])
    }
    return ''
  }

  function replaceAssistantReply(session, result, bodyText) {
    if (result === null || result.text === bodyText) return
    const previous = result.event && result.event.data && result.event.data.message
    if (previous === null || typeof previous !== 'object') return
    replaceSessionSurface(session, 'assistant/message', {
      turn: Number(result.event.data && result.event.data.turn) || 0,
      step: Number(result.event.data && result.event.data.step) || 1,
      message: Object.assign({}, previous, {
        id: randomUUID(),
        source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' },
        content: [{ type: 'text', text: bodyText }]
      })
    }, { start: result.index, end: result.index, sourceEventSeqs: [result.index] })
  }

  // A game keeps a snapshot of its preset, but edits to that preset apply from the
  // next request: a changed preset file rebuilds and stores the snapshot. A missing
  // or unreadable file keeps the saved snapshot, so the game never loses its preset.
  async function resolveChatRuntimePreset(chat) {
    if (!chat || groupOfMode(chat.mode) !== 'play') return null
    const saved = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : null
    if (!saved?.presetPath || !chat.id) return saved
    let text
    try { text = await fileResources.readText(normalizeResourcePath(saved.presetPath, 'preset')) } catch { return saved }
    if (text === undefined || createHash('sha256').update(text).digest('hex') === saved.compatibilityPreset?.revision) return saved
    let fresh
    try { fresh = await runtimePresets.fullSnapshot(saved.presetPath) } catch { return saved }
    if (!fresh) return saved
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = (await chatPersistence.readSlice(chat.id, [], ['_storageRevision', 'runtimePresetSnapshot.presetPath']))?.chat
      // Applying another preset meanwhile wins over refreshing this one.
      if (!head || head.runtimePresetSnapshot?.presetPath !== saved.presetPath) return saved
      if (await patchChat(chat.id, head._storageRevision, [{ op: 'set', path: ['runtimePresetSnapshot'], value: fresh }], { source: 'preset.refresh', touchUpdatedAt: false })) break
    }
    chat.runtimePresetSnapshot = fresh
    return fresh
  }

  const compileCompatibilityTurn = createCompatibilityTurnCompiler({
    promptTemplateRuntime,
    readCardExtensions,
    readChatCard,
    readPromptTemplateGlobalVariables,
    resolveChatRuntimePreset,
    str,
    worldBooks,
  })

  // ---------- DSH 回合生命周期 ----------
  const requestCoordinates = new Map()
  const tavernRetryLimiter = createTavernRetryLimiter({
    owns: async function (agent) {
      const sessionId = agent && agent.session ? agent.session.id : ''
      if (sessionId === '') return false
      return backgroundAgentRunner.owns(sessionId) || await sessionStateForSession(sessionId) !== undefined
    }
  })

  function clearRuntimePresetRequestState(agent) {
    const session = agent && agent.session
    if (session === undefined) return 0
    const sessionId = session.id
    requestCoordinates.delete(sessionId)
    foregroundStrategies.clearRequestState(sessionId)
  }

  function compatibilityMessages(compiled) {
    return compiled.messages.map(function (item, index) {
      const label = str(item.source && (item.source.identifier || item.source.kind)) || 'message-' + (index + 1)
      return {
        id: randomUUID(),
        role: item.role,
        content: projectPlayerContent(item.inputAttachments, item.content, { fallback: false }),
        source: {
          kind: 'plugin', plugin: 'dsh-tavern', form: 'sillytavern-compatibility',
          sections: [{ name: 'tavern:sillytavern:' + label, text: item.content }],
          trace: item.source
        }
      }
    })
  }

  const controlledToolNames = new Set(['tavern_read_variables', ...CARD_MEMORY_TOOLS, 'bash', 'pwsh', ...dshFileToolNames, 'skill', 'tavern_read_skill_reference', 'web_search', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_user_profile_confirm', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_play_chat', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_copy_card', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response'])
  const foregroundStrategies = createForegroundOrchestrationStrategies({
    compatibility: {
      beforeTurn: async function (input) {
        if (!hasTavernScriptRuntime(input.chat, (await readCardExtensions(input.chat.cardPath, input.chat))?.helperScripts)) return
        const context = await tavernScriptHostAdapter.context(input.sessionId, input.chat, input.userText)
        const messageId = Math.max(0, context.messages.length - 1)
        await tavernScriptHostAdapter.dispatchEvent({ sessionId: input.sessionId, context, name: 'MESSAGE_SENT', args: [messageId] })
      },
      beginTurn: async function (input) { return await turnOrchestrator.beginCompatibility(input) },
      chatForSession,
      compileTurn: compileCompatibilityTurn,
      persistCompiled: async function (input) {
        const compiled = input.compiled
        await updateChat(input.chat.id, function (current) {
          if (!current || typeof current !== 'object') return current
          current.macroState = compiled.macroState
          if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
            const scopes = compiled.promptTemplateState.scopes || {}
            current.promptTemplateInitialVariables = scopes.initial && typeof scopes.initial === 'object' ? scopes.initial : {}
            current.variables = scopes.local && typeof scopes.local === 'object' ? scopes.local : {}
            if (Array.isArray(current.messages) && current.messages.length > 0) {
              replaceTavernHelperVariables(current, {
                option: { type: 'message', message_id: 'latest' },
                variables: scopes.message
              })
            }
          }
          if (!current.compatibilityTraces || typeof current.compatibilityTraces !== 'object') current.compatibilityTraces = {}
          current.compatibilityTraces[String(input.turn)] = Object.assign({ createdAt: Date.now() }, compiled.trace, { diagnostics: compiled.diagnostics })
          return current
        }, { source: 'compatibility.compile' })
        if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
          await writePromptTemplateGlobalVariables(compiled.promptTemplateState.scopes.global)
        }
      },
      projectMessages: compatibilityMessages
    },
    nativePlay: {
      systemAppend: () => runtimePrompt('system-append'),
      stagedRequests: runtimePresetSnapshots,
      modeFor: async function (sessionId) { return await turnOrchestrator.modeFor(sessionId) },
      filterMessages: appendWritingSkillState,
      resolvePreset: resolveChatRuntimePreset,
      prepareTurn: async function (input) { return await foregroundHandoff.prepare(input) },
      appendFrame: function (input) { return foregroundFrameSessionAdapter.append(input) },
      recordFrame: function (sessionId, frame, receipt) {
        requestCoordinates.set(sessionId, Object.assign({}, requestCoordinates.get(sessionId), {
          frame: {
            frameId: frame.frameId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            source: frame.source,
            append: receipt
          }
        }))
      },
      visibleTools: async function (sessionId) { return await turnOrchestrator.visibleTools(sessionId) },
      cardSystemPrompt: function () { return runtimePrompt('card-system') },
      cardReferencePrompt: function () { return runtimePrompt('card-reference') },
      workspaceContext: function (cwd, projection) { return resourceWorkspaceContext(cwd, projection, runtimePrompt('card-workspace')) },
      ensureSessionPrefix: async function (input) {
        return await ensureNativeSystemPrefix(input.payload.agent.session, input.chat)
      },
      controlledToolNames
    }
  })

  registerRequestHooks({
    backgroundAgentRunner,
    cardMemory,
    chatForSession: hookChatForSession,
    ctx,
    foregroundStrategies,
    persistClearedBodyEdits,
    requestCoordinates,
    requestIdForMessages,
    sessionStore,
    tavernRetryLimiter,
  })

  registerModelStreamHooks({
    agentRegistry,
    backgroundAgentRunner,
    chatForSession,
    chatHeaderForSession,
    ctx,
    foregroundStrategies,
    fullTemplateRuntime,
    modelRequestLog,
    requestCoordinates,
    runtimePrompt,
    sessionStateForSession,
    sessionStore,
    str,
    updateChat,
    worldbookRecallLog,
    storyRetention,
  })

  registerTurnLifecycleHooks({
    backgroundAgentRunner,
    hookChatForSession,
    clearRuntimePresetRequestState,
    contentText,
    ctx,
    ensureNativeSystemPrefix,
    foregroundHandoff,
    foregroundStrategies,
    fullTemplateRuntime,
    nativeWorldBookTemplateContext,
    persistClearedBodyEdits,
    pluginPromptSections: pluginApi.promptSections,
    publishResourceWorkspace,
    readChatCard,
    replaceAssistantReply,
    requestIdForTurn,
    runtimePrompt,
    sessionStore,
    turnOrchestrator,
    userMessageForTurn,
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    registerGameplayTools({
      activeTurnOf,
      cardResponseTest,
      foregroundRecallScopes,
      recallHistoryForSession,
      searchWorldbook,
      tools,
    })
    registerUserProfileTools({
      chatForSession,
      tools,
      userPreferenceProfile,
    })

    registerSkillTools({
      chatForSession,
      skillEnabledFor,
      skillRoleFor,
      tavernSkills,
      tools,
    })

    registerVariableReadTool({tools,defineTool,chatForSession})

    registerCardReadingTools({
      cardMemory,
      cardPreparation,
      chatForSession,
      fileResources,
      readCard,
      readCardWorkspace,
      readChatCard,
      str,
      tools,
    })

    registerPlayChatTool({
      chatForSession,
      modelRequestLog,
      readCardExtensions,
      readChat,
      sessionDebugEvidence,
      str,
      tools,
      worldbookRecallLog,
    })

    registerScriptTool({
      chatForSession,
      readScript,
      scriptContinuity,
      str,
      tools,
    })

    registerWorldbookTools({
      chatForSession,
      readChatCard,
      str,
      tools,
      worldBooks,
    })

    registerPresetTools({
      chatForSession,
      presetEditor,
      tools,
    })

    registerRegexLibraryTools({ chatForSession, regexLibrary, tools })

    registerCardEditingTools({
      activeTurnOf,
      restoreCurrentCard,
      str,
      tools,
      turnOrchestrator,
    })
  }

  try {
    const recoveredIndex = await initializeRuntimeState()
    settleRuntimeReadiness({ ok: true })
    setImmediate(function () {
      recoverRuntimeHistory(recoveredIndex).catch(function (error) {
        console.error('dsh-tavern: 后台恢复历史对话失败', error && error.message || error)
      })
    })
  } catch (error) {
    settleRuntimeReadiness({ ok: false, error })
    throw error
  }
}
