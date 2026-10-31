import {createExtensionRequests} from './domain/extension-requests.js'
import {createModelSlotRegistry} from './domain/model-slot-registry.js'
import {createPresentationObservers} from './domain/presentation-observers.js'
import { installPluginSettingsMigration } from './settings-config.js'
export { Config } from './settings-config.js'
import { CORE_MODEL_MANIFESTS, modelSlotRows, resolveModelSlotOffered } from './domain/model-slots.js'
import { isWorldBookTemplateEntry, projectWorldBookTemplates } from './domain/worldbook-recall.js'
import { createSkillTextContext } from './domain/skill-text-context.js'
import { resolveWorldbookSkillChat } from './domain/worldbook-skill-scope.js'
import { appendWorldbookSkillChanges } from './domain/worldbook-skill-changes.js'
// Must stay first: it has to run before anything loads jsdom.
import { createSessionViewProjection, sessionViewMessageFields } from './domain/session-view-projection.js'
import { createNetworkToolPolicy, installNetworkToolPolicy } from './domain/network-tools.js'
import { clearRetiredSearchProvider } from './domain/retired-search-provider.js'
import { createConversationBackgroundSettings } from './domain/conversation-background-settings.js'
import { createChatWrites } from './domain/chat-writes.js'
import { upgradeReferences, upgradedAnchor } from './domain/session-upgrade-references.js'
import { createGameSaveImporter } from './domain/game-save-import.js'
import { createGameSaveSnapshot } from './domain/game-save-snapshot.js'
import { createGameSaveResources } from './domain/game-save-resources.js'
import { createCardEditor, CARD_PROJECTION_REVISIONS, cardProjectionRevisionOf, bumpCardProjectionState } from './domain/card-editor.js'
import { ensureSessionVariableDirectory } from './domain/session-variable-directory.js'
import { registerTavernHttpRoutes } from './http/routes.js'
import { installChatAnswerBootPatch } from './domain/chat-answer-boot-patch.js'
import { registerRequestHooks } from './hooks/request.js'
import { createWholeReadGuard, scopeTurnHooks } from './domain/whole-read-guard.js'
import { createChatReads } from './domain/chat-reads.js'
import { diffJson } from './domain/json-mutation.js'
import { syncUserPlugins, watchUserPlugins, userPluginPaths } from './domain/user-plugins.js'
import { createUserPluginInstaller } from './domain/user-plugin-install.js'
import { createPluginDataStore } from './domain/plugin-data-store.js'
import { createPluginAssets } from './domain/plugin-assets.js'
import { registerModelStreamHooks } from './hooks/model-stream.js'
import { registerTurnLifecycleHooks } from './hooks/turn-lifecycle.js'
import { registerGameplayTools } from './tools/gameplay.js'
import { registerUserProfileTools } from './tools/user-profile.js'
import { registerSkillTools } from './tools/skills.js'
import { registerCardReadingTools } from './tools/card-reading.js'
import { registerCardCoverTools } from './tools/card-cover.js'
import { createCardValidationCheck } from './tools/card-validation-check.js'
import { createSkillGatedTools } from './domain/skill-gated-tools.js'
import { registerPlayChatTool } from './tools/play-chat.js'
import { registerRuntimeHealthTool } from './tools/runtime-health.js'
import { registerScriptTool } from './tools/script.js'
import { registerWorldbookTools } from './tools/worldbook.js'
import { registerPresetTools } from './tools/preset.js'
import { registerRegexLibraryTools } from './tools/regex-library.js'
import { registerCardEditingTools } from './tools/card-editing.js'
import { createConversationGuides } from './domain/conversation-guides.js'
import { createGuideLibrary } from './domain/guide-library.js'
import { createRegexLibrary } from './domain/regex-library.js'
import { createTavernRegexSettings } from './domain/regex-settings.js'
import { createRegexManager } from './domain/regex-manager.js'
import { copyJsonTree } from './domain/copy-json-tree.js'
import { createCandidateContextReader } from './domain/candidate-context-reader.js'
import { createCandidateWorldbookPreparation } from './domain/candidate-worldbook-preparation.js'
import { createPlayWorldBook } from './domain/play-world-book.js'
import { createTemplateWindowReader, templateStateFields } from './domain/template-window-reader.js'
import { createSessionResourceAccess } from './domain/session-resource-access.js'
import { createSaveUpgrade, detachSaveSessions, prepareSaveUpgrade, saveSessionIds, unreadySaveSessions } from './domain/save-upgrade.js'
import { storedSessionVersion } from './domain/session-upgrade.js'
import { createTaskStateReader, taskStateFields } from './domain/task-state-reader.js'
import { installHostProjectionReplay } from './domain/host-projection-replay.js'
import { installHostTurnRailFilter } from './domain/host-turn-rail.js'
import { createBoundedHistory, readRecentWindow, readRowsAt, storyContextMessageFields } from './domain/bounded-history.js'
import { createHelperHistoryAccess } from './domain/helper-history-access.js'
import { isScopedMessages } from './domain/scoped-messages.js'
import {registerVariableReadTool} from './domain/read-variables.js'
import { createBackgroundSessionRetirement, installRetiredBackgroundFilter, installRetiredCatalogView } from './domain/background-session-retirement.js'
import { createBackgroundCatalogBackfill } from './domain/background-catalog.js'
import { createBranchOriginRepair } from './domain/branch-origin-repair.js'
import { createGameTitles } from './domain/game-titles.js'
import { createCardMemory, CARD_MEMORY_TOOLS } from '../packages/dsh-tavern-card-memory/index.js'
import { installSkillCatalogSessionScope } from './domain/skill-catalog-session-scope.js'
import { projectCardSummary } from './domain/card-preparation.js'
import { createCardSummaryCache } from './domain/card-summary-cache.js'
import { openingPreviewPayload } from './domain/opening-transport.js'
import { createLiveCardUpdate } from './domain/live-card-update.js'
import { createSessionViewReader, createSessionChatReader } from './domain/session-view-reader.js'
import { createSettlementJobs } from './domain/settlement-jobs.js'
import { createStoryEvents } from './domain/story-events.js'
import { createWorkflow } from './domain/workflow.js'
import { BACKGROUND_TASK_CATALOG, registerBackgroundTasks } from './domain/background-tasks.js'
import { TIMELINE_MEMBERS, participantOf } from './domain/background-members.js'
import { createPluginSettlementProgress } from './domain/plugin-settlement-progress.js'
import { readHostCompatibility } from './domain/host-compatibility.js'
import { installHostSessionPatch } from './domain/host-session-patch.js'
import { installHostSubprocessPatch } from './domain/host-subprocess-patch.js'
import { installSessionLogAutoRepair, repairStoredSessionLog } from './domain/session-log-repair.js'
import { measureForegroundPressure } from './domain/foreground-context-pressure.js'
import { replaceSessionSurface } from './domain/session-surface-mutations.js'
import { createPresetDiagnostics } from './domain/preset-diagnostics.js'
import { createRequestPerformance } from './domain/request-performance.js'
import { createFrameStorage } from './domain/frame-storage.js'
import { createScriptReader } from './domain/script-reader.js'
import { createScriptNavigation } from './domain/script-navigation.js'
import { createSessionInventory } from './domain/session-inventory.js'
import { createSessionViewSync } from './domain/session-view-sync.js'
import { createCharacterDesignPublisher } from './domain/character-design-worldbook.js'
import { createManualCharacterDesign } from './domain/manual-character-design.js'
import { prepareTemplateHistory, synchronizeTemplateHistory } from './domain/template-history.js'
import { createServerTemplateSync } from './domain/server-template-sync.js'
import { createServerTemplateRuntime } from './domain/server-template-runtime.js'
import { createForegroundStyleReferenceTool, foregroundStyleReferencePrompt, rememberStyleReference } from './domain/style-reference.js'
import { adoptConversationFeatures, adoptConversationBackground } from './domain/conversation-background.js'
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
import { RETAINED_ROUNDS_WINDOW_SHARE, STORY_VOLUMES_WINDOW_SHARE, storyHistoryFullyRetained } from './domain/story-compaction.js'
import { createPerformanceDiagnostics } from './domain/performance-diagnostics.js'
import { createBackgroundSuppressionReader } from './domain/background-surface.js'
import { ensureCardWorkspaceMessage } from './domain/card-workspace-message.js'
import { createPromptTemplateGlobalVariables } from './domain/prompt-template-global-variables.js'
import { createTavernApiDiagnostics } from './domain/tavern-api-diagnostics.js'
import { generateHelper, generateHelperRaw, defaultOrderedRawConfig } from './domain/helper-generation.js'
import { validateHelperGenerateConfig, resolveHelperGenerationPreset } from './domain/helper-generation-prompts.js'
import { createHelperGenerationTasks } from './domain/helper-generation-tasks.js'
import { createBodyEditor } from './domain/body-editor.js'
import { appendHelperUserSessionContext } from './domain/helper-user-session-context.js'
import { userMessageForTurn, requestIdForTurn, requestIdForMessages } from './domain/session-turn-input.js'
import { createStoryReconciliation } from './domain/story-reconciliation.js'
import { sessionOpeningDescriptor } from './domain/session-opening.js'
import { scriptPromptScanText } from './domain/tavern-script-prompts.js'
import { createOpeningPreparation } from './domain/opening-preparation.js'
import { createChatHistoryImportService } from './domain/chat-history-import-service.js'
import { appendSessionEvent, sessionEvents } from './domain/session-events.js'
import { setAgentResolver } from './domain/agent-lookup.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner, executeBackgroundCompaction } from './background-agent-runner.js'
import { createApplicationUpdater } from './application-updater.js'
import { CANDIDATE_SUBMIT_TOOL, SCRIPT_POINT_TOOL, SCRIPT_READ_TOOL, createCandidateGenerator } from './domain/candidate-generation.js'
import { computeSceneTarget, projectedSceneText } from './domain/scene-illustration.js'
import { createPluginMedia } from './domain/plugin-media.js'
import { createPluginMediaViews } from './domain/plugin-media-views.js'
import { createAssetGeneration, assetGenerationResult } from './domain/asset-generation.js'
import { createPluginData } from './domain/plugin-data.js'
import { createPluginTurnReader, RECENT_FLOORS } from './domain/plugin-turns.js'
import { createPluginVariableWriter } from './domain/plugin-variables.js'
import { createTavernPluginApi } from './plugin-api.js'
import { createSceneWorldbooks } from './domain/scene-worldbook.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix } from './domain/session-stable-prefix.js'
import { waitForWritableSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { createCardOrganization } from './domain/card-organization.js'
import { countGamesByCard, orderCardsForLibrary } from './domain/card-list-order.js'
import { createCardPreparation,rawData } from './domain/card-preparation.js'
import { cardAssetWorkspaceRevision, hasCardAssetBindings } from './card-asset-bindings.js'
import { withoutPlayerChoices } from './card-bundle.js'
import { withGlobalRegexScripts, composeTavernRegexScripts } from './domain/card-extension-reading.js'
import { projectCardOpeningPreviews } from './domain/card-opening-previews.js'
import { createConversationInitialization } from './domain/conversation-initialization.js'
import { assertConversationForkable, conversationForkReceipt, forkConversationChat } from './domain/conversation-fork.js'
import { readBackgroundModelReasoning } from './domain/background-model-selection.js'
import { createModelCalls } from './domain/model-calls.js'
import { createPlayCardSnapshots } from './domain/play-card-snapshots.js'
import { createUserPreferenceProfile } from './domain/user-preference-profile.js'
import { createContextPlanner } from './domain/context-planner.js'
import { createConversationMarkdownExport } from './domain/conversation-text-export.js'
import { createCoordinationEventPublisher } from './domain/coordination-event-publisher.js'
import { createSessionSignalTransport } from './domain/session-signal-transport.js'
import { createCandidateTasks } from './domain/candidate-tasks.js'
import { createAutoChoices } from './domain/auto-choices.js'
import { assistantResultForTurn } from './domain/session-turn-result.js'
import { extractEpubText } from './domain/epub-text.js'
import { createFileResourceStore, normalizeResourcePath } from './domain/file-resources.js'
import { createMobileCardImport } from './domain/mobile-card-import.js'
import { createForegroundHandoff } from './domain/foreground-handoff.js'
import { createForegroundFrameBuilder, foregroundRequestContext } from './domain/agent-input-frame.js'
import { retireForegroundFrames } from './domain/foreground-frame-retirement.js'
import { compactionFailureMessage } from './domain/compaction-failure.js'
import { createForegroundFrameSessionAdapter } from './domain/foreground-frame-session-adapter.js'
import { HISTORY_RECALL_TOOL, createHistoryRecall, renderHistoryRecall } from './domain/history-recall.js'
import { createModelRequestLog } from './domain/model-request-log.js'
import { createDisplayRuntimeCoalescer } from './domain/display-runtime-coalescer.js'
import { MVU_SUBMIT_UPDATE_TOOL, createMvuSettlementModule } from './domain/mvu-background-settlement.js'
import { createMvuSettlementEngine } from './domain/mvu-settlement-engine.js'
import { createPlainSettlementEngine } from './domain/plain-settlement-engine.js'
import { createSettlementRun } from './domain/settlement-run.js'
import { createSettlementControls } from './domain/settlement-controls.js'
import { createMvuSettlementResume } from './domain/mvu-settlement-resume.js'
import {
  CHARACTER_DESIGN_READ_TOOL,
  CHARACTER_DESIGN_SAVE_TOOL,
  CHARACTER_DESIGN_REUSE_TOOL,
  createCharacterDesignDocumentTools,
  projectCharacterDesignDocument
} from './domain/character-design-document.js'
import { createLedgerEditor } from './domain/ledger-editor.js'
import { LEDGER_SUBMIT_TOOL } from './domain/story-ledger.js'
import { createManualLedger } from './domain/manual-ledger.js'
import { POSTURE_SUBMIT_TOOL } from './domain/posture-submission.js'
import { bubbleCastLines } from './domain/cast-annotation.js'
import { createPolishRecords } from './domain/polish-records.js'
import { createPolishPrereview, createPolishReviewer } from './domain/polish-run.js'
import { applyPolishEdits } from './domain/polish-review.js'
import { createCardAutoReload } from './domain/card-auto-reload.js'
import { createRuntimeLogBuffer, runtimeHealthReport } from './domain/runtime-health.js'
import { createCastAssets } from './domain/cast-assets.js'
import { createSpeech } from './domain/speech.js'
import { deploymentActivity } from './domain/deployment-activity.js'
import { buildCharx, cardImport, cardImportFromCard, pngCardTextChunk, pngWithTextChunks } from './domain/card-assets.js'
import { createAssetPacks } from './domain/asset-packs.js'
import { createMediaStore } from '../packages/dsh-asset-library/lib/pack-v2/media-store.js'
import { readCardArchive } from './domain/card-archive.js'
import { openZipFile } from './domain/zip-file.js'
import { createUploads } from './domain/uploads.js'
import { createCardPlugins } from './domain/card-plugins.js'
import { createCardFiles } from './domain/card-files.js'
import { createPostureItem, createSettlementItems } from './domain/background-pipeline.js'
import { createTavernCompatibilityDiagnosticStore } from './domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from './domain/mvu-diagnostics.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from './domain/play-chat-debug.js'
import { createSaveMaintenance } from './domain/save-maintenance.js'
import { createServerScriptExecutor } from './domain/server-script-executor.js'
import { createDisplayRuntimeStore, displayRuntimeReceipt } from './domain/display-runtime-store.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { createForegroundOrchestrationStrategies } from './domain/foreground-orchestration-strategies.js'
import { clearFailedTurnSurface, rollbackAvailability, reshadowRolledBackRounds, interruptedSurfaceTurns } from './domain/rollback-surface.js'
import { replyBody } from './domain/round-body.js'
import { createDisplayRuntimeCapture } from './domain/display-runtime-capture.js'
import { createStorySubmissionTool, foldStorySubmission, STORY_SUBMIT_TOOL_NAME } from './domain/story-tool-submission.js'
import { readHistoryLayoutFile } from './domain/history-tool-call.js'
import { createTavernRetryLimiter } from './domain/tavern-retry-limiter.js'
import { lastTavernHelperVariables, HELPER_MESSAGE_COLD_WINDOW } from './domain/tavern-helper-context.js'
import { projectTavernHelperWorldbook } from './domain/tavern-helper-worldbook.js'
import { projectTavernHelperScripts, hasTavernScriptRuntime } from './domain/tavern-helper-scripts.js'
import { createCardScripts } from './card-scripts.js'
import { projectCardStage } from './domain/card-stage.js'
import { createTavernScriptDispatch } from './domain/tavern-script-dispatch.js'
import { createTavernExtensionSettings } from './domain/tavern-extension-settings.js'
import { createDialogueBubblePresets, DEFAULT_BUBBLE_TEMPLATE } from './domain/dialogue-bubble-presets.js'
import { bubbleCharacter } from '../src/client/bubble-line.cjs'
import { normalizeBubbleConfig, bubbleVoiceSwitches, effectiveBubbleMoods, resolveBubbleMood, bubbleInstructionPreview, bubbleInjection, readDialogueBubblePlacement } from './domain/dialogue-bubbles.js'
import { watchFigureBubbleBooks } from './card-stage.js'
import { createCardStorage } from './card-storage.js'
import { isAbsolute, join as joinPath } from 'node:path'
import { readStageProjection } from './domain/stage-projection.js'
import { spineRuntimeAvailable, spineRuntimeStatus, importSpineRuntime } from './domain/tavern-runtime-assets.js'
import { createStageChatCache } from './domain/stage-chat-cache.js'
import { createStageReads, stageReadScope } from './domain/stage-read-projection.js'
import { readWidgetWindowProjection } from './domain/widget-window-projection.js'
import { STAGE_PLAYBACK_FIELD, saveStagePlayback, patchStagePlayback, addStageMeasurement } from './domain/stage-playback.js'
import {createOptionalStage} from './optional-stage.js'
import { STAGE_TIMER_FIELD } from '../mods/timer/stage-service.js'
import {readAudienceCorpus} from './danmaku-corpus.js'
import {cardAssetExtensionPointer} from './domain/card-asset-bindings.js'
import {ASSET_PACK_RECORD_FIELD} from './domain/stage-asset-pack-director.js'
import { stageModHistoryTurns } from './domain/stage-items.js'
// derived card gallery; only production paint acknowledgements write it.
import { describeOpeningScenes } from './domain/stage-opening-scene.js'
import { createTavernScriptHostAdapter } from './domain/tavern-script-host-adapter.js'
import { createTavernRemoteAssetPinStore } from './domain/tavern-remote-assets.js'
import { OFFICIAL_MVU_VERSION, inspectOfficialMvuAsset } from './domain/official-mvu-assets.js'
import { createTavernStaticResourceCache } from './domain/tavern-static-resource-cache.js'
import { SILLYTAVERN_CSS_COMPAT_URLS } from './domain/sillytavern-css-compatibility.js'
import { createRoundHistory } from './domain/round-history.js'
import { createResourceWorkspaceProjection } from './domain/resource-workspace-projection.js'
import { projectAgentContent, projectAgentMessageText, projectRuntimeReply } from './domain/runtime-content-projection.js'
import { plainReplyProse } from './domain/reply-prose.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { appendWritingSkillState } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { createTavernSkillProvider } from './domain/tavern-skill-provider.js'
import { canonicalTavernSkillName, createTavernSkillModule } from './domain/tavern-skills.js'
import { readZipEntries } from './domain/zip-entries.js'
import { createGameFootprint } from './domain/game-footprint.js'
import { createGameSaveExporter } from './domain/game-save-export.js'
import { readFileSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

const TAVERN_PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import { installTavernTokenMeter } from './domain/tavern-token-meter.js'
import { cordisToolNames, createTurnOrchestrator, dshFileToolNames } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { createWorldbookRecallLog } from './domain/worldbook-recall-log.js'
import { createForegroundWorldbook } from './domain/foreground-worldbook.js'
import { createWorldbookStrategies } from './domain/worldbook-strategies.js'
import { createWorldbookFiles } from './domain/worldbook-files.js'
import { registerWorldbookFileTools } from './tools/worldbook-files.js'
import { projectVirtualWorldbookPrefix } from './domain/worldbook-virtual-state.js'
import { installWorldbookSkillRead, nativeWorldbookReadAvailable } from './domain/worldbook-skill-read.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore } from './profile-data-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import { createChatJournalStore } from './domain/chat-journal-store.js'
import { createResourceGraph } from './domain/resource-graph.js'
import { normalizeBackgroundTasks, applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from './domain/tavern-settings.js'
import { createSettingsTransfer } from './domain/settings-transfer.js'
import { createSystemPromptDocuments } from './domain/system-prompt-documents.js'
// Runtime reads go through runtimePrompt() so panel overrides apply; the raw
// file catalog only supplies built-in defaults.
import { prompt as promptFile, SYSTEM_PROMPT_NAMES } from './prompt-catalog.js'
import { activeCardPersonaText } from './domain/card-personas.js'
import { createMaintenanceHandlers } from './rpc/maintenance.js'
import { createCardHandlers } from './rpc/cards.js'
import { createTemplateHandlers } from './rpc/template.js'
import { createOpeningHandlers } from './rpc/opening.js'
import { createWorldbookInspectorHandlers } from './rpc/worldbook-inspector.js'
import { createResourceHandlers } from './rpc/resources.js'
import { createRegexHandlers } from './rpc/regex.js'
import { createMediaHandlers } from './rpc/media.js'
import { createSettingsHandlers } from './rpc/settings.js'
import { createPluginHandlers } from './rpc/plugins.js'
import { createConversationHandlers } from './rpc/conversations.js'
import { createPlayHandlers } from './rpc/play.js'
import { createTransferHandlers } from './rpc/transfer.js'
import { createTransferExportStore } from './domain/transfer-store.js'
// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。

// 历史回放排列的实验开关：文件里一个词，按请求读取，一次重启即可切完所有分组。
// 没有这个文件时行为与发布版一致（story）。
function historyLayoutFile() {
  return path.join(process.env.DSH_HOME || path.join(process.env.HOME || '/', '.dsh'), 'tavern-history-layout.txt')
}

export async function apply(ctx, config = {}) {
  // 插件侧的联网请求（更新检查、插件市场、内置搜索）都走 fetch，
  // 而 Node 的 fetch 不认系统代理：启动时先应用一次，进程内所有请求生效。
  try {
    const { applySystemProxy, describeProxy } = await import('../../bin/system-proxy.mjs')
    const proxy = applySystemProxy()
    if (proxy?.source) console.log('dsh-tavern: ' + describeProxy(proxy))
  } catch (error) { console.warn('dsh-tavern: 系统代理未能应用：' + (error?.message || error)) }
  // Per-turn paths must not load a whole save; see whole-read-guard.js.
  const wholeReads = createWholeReadGuard({ mode: process.env.DSH_TAVERN_WHOLE_READ_GUARD || 'warn' })
  ctx = scopeTurnHooks(ctx, wholeReads)
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
  // Only the installed compatibility reader may publish a new generation.
  // Run before opening any foreground, background, or card-design Session.
  let saveUpgradePreparation
  if (sessionPatch.status === 'ready') {
    const open = (persistence?.tracker?.openHandles?.size || 0) + (persistence?.tracker?.writers?.size || 0)
    if (open) console.warn('dsh-tavern: 会话已经打开，旧档留到下次启动再升级')
    else saveUpgradePreparation = await prepareSaveUpgrade(resolveTavernDataRoot(), sessionPatch.loadSessionMigration)
  }
  // Older Agents numbered a turn twice; the host then refuses the whole log on every
  // read. Repair it where the read fails, so restoring after a restart heals it too.
  ctx.effect(() => installSessionLogAutoRepair({
    persistence,
    repair: sessionId => repairStoredSessionLog(resolveTavernDataRoot(), sessionId, sessionPatch.loadSessionCatalog),
  }))
  await clearLegacyTavernDefault(ctx.get('settings'))
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  const sessionStore = ctx.get('sessions')
  // New games are named after their card until the first turn (domain/game-titles.js).
  const gameTitles = createGameTitles({ sessionTitle: () => ctx.get('sessionTitle'), sessions: sessionStore })
  ctx.effect(() => installTavernTokenMeter(ctx.get('tokenMeter')))
  ctx.effect(() => installHostProjectionReplay(ctx.get('sessionProjections')))
  // 轮次导航只列表面里还有内容的轮次：重试留下的空 turn/start 不再各占一根刻度。
  ctx.effect(() => installHostTurnRailFilter(ctx.get('sessionProjections')))
  if (llm === undefined || agentRegistry === undefined || sessionStore === undefined) {
    console.error('dsh-tavern: 缺少 llm、agents 或 sessions 服务')
    return
  }
  // Surface rewrites that happen between rounds need the live Agent to publish
  // their edit turn as used (V4 numbers the next turn from phase.lastTurn).
  setAgentResolver(sessionId => agentRegistry.get(String(sessionId || '')))
  const agentDefaultModel = ctx.get('agentDefaultModel')
  let autoCompaction = null
  const compactionTimers = new Map()
  const compactionAbort = new AbortController()
  const sessionSignals = createSessionSignalTransport()
  let serverScripts = null, tavernHttpHandle = null
  // Sessions whose page last reported being visible, in front, on a desktop.
  const pagesInFront = new Map()
  const pageInFront = sessionId => Date.now() - (pagesInFront.get(String(sessionId || '')) || 0) < 25000
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
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    // A page in front of the player executes card scripts itself; otherwise
    // (closed, hidden, or a phone) the server runtime takes over.
    priority: (runtimeId, sessionId) => !serverScripts ? 0
      : String(runtimeId).startsWith('server-') ? (pageInFront(sessionId) ? 0 : 1) : (pageInFront(sessionId) ? 1 : 0)
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
  // Folders in <data>/plugins become profile patch entries, so both plugin halves load without editing Tavern.
  try { await syncUserPlugins({ dataRoot }) } catch (error) { console.warn('dsh-tavern: 同步用户插件失败', error?.message || error) }
  ctx.effect(() => watchUserPlugins({ dataRoot }))
  const cardMemory = createCardMemory({ dataRoot })
  const stablePrefixStorage = createSessionStablePrefixStorage(dataRoot + '/session-prefixes')
  const profileData = createProfileDataStore({ dataRoot })
  const frameStorage = createFrameStorage(profileData)
  const transferExports = createTransferExportStore({ root: dataRoot + '/tmp-exports' })
  const displayRuntimeStore = createDisplayRuntimeStore({ store: profileData })
  const gameFootprint = createGameFootprint({ dataRoot })
  const deletedSessionIds = new Set()
  try { const removed = await gameFootprint.processDeferredDeletions(); if (removed) console.log('dsh-tavern: 已清理已删除游戏的原生会话', removed) }
  catch (error) { console.warn('dsh-tavern: 清理已删除游戏的原生会话失败', error?.message || error) }
  void gameFootprint.sweepDeletedGameImages().then(removed => { if (removed) console.log('dsh-tavern: 已清理已删除游戏遗留的插图记录', removed) },
    error => console.warn('dsh-tavern: 清理已删除游戏遗留的插图记录失败', error?.message || error))
  // Oldest floor each browser session has viewed; the template window covers it.
  const templateHistoryFrom = new Map()
  const fullTemplateRuntime = createServerTemplateRuntime({ store: profileData,
    rpc: (method, args) => dispatchMethod(method, args, undefined, true),
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
    // Display work waits while a foreground turn runs: it shares the template queue with the
    // turn's own template work, which reads the latest state itself. The turn's end lets it run
    // at once, so the new reply's template display does not wait for settlement.
    templateSync.schedule(chat.sessionId, chat._storageRevision, {
      enabled: groupOfMode(chat.mode || 'story') === 'play',
      blocked: ['pending', 'running'].includes(chat.settleStatus) || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running'
    })
  }
  ctx.on('session/event', function (session, event) { if (event?.type === 'turn/end' && session?.id) templateSync.release(session.id) })
  ctx.effect(() => () => templateSync.dispose())
  ctx.effect(() => () => fullTemplateRuntime.dispose())
  const cardOrganization = createCardOrganization(profileData)
  const worldbookRecallLog = createWorldbookRecallLog({ store: profileData })
  const guideLibrary = createGuideLibrary({ store: profileData })
  const regexLibrary = createRegexLibrary({ store: profileData })
  const userPreferenceProfile = createUserPreferenceProfile({ store: profileData })
  // Per-turn worldbook snapshots old saves carry; kept so their export and import round-trip.
  const sceneWorldbookArchive = createSceneWorldbooks({ store: profileData })
  const tavernExtensionSettings = createTavernExtensionSettings(profileData)
  const dialogueBubblePresets = createDialogueBubblePresets(profileData)
  const cardStorage = createCardStorage({ dataRoot, profileData })
  const cardScripts = createCardScripts({ profileData, cardIdFor: cardStorage.resolve })
  const mvuDiagnostics = createMvuDiagnosticStore(profileData)
  ctx.effect(() => () => mvuDiagnostics.dispose(), 'dsh-tavern: flush diagnostic logs')
  const apiDiagnostics = createTavernApiDiagnostics(profileData)
  const compatibilityDiagnostics = createTavernCompatibilityDiagnosticStore(profileData)
  const requestPerformance = createRequestPerformance()
  // Tavern's own recent warnings and errors, for the debugging Agent's runtime health report.
  const runtimeLogs = createRuntimeLogBuffer()
  ctx.effect(() => runtimeLogs.install())
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
  // Import dedupe needs the stored overrides; the presented settings drop them for inactive sets.
  async function readRawTavernSettings() {
    tavernSettingsDocument = await profileData.readJson(settingsPath)
    return tavernSettingsDocument
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
  ctx.inject(['settings'], async sctx => { await clearRetiredSearchProvider(sctx.settings) })
  const promptDocuments = createSystemPromptDocuments()
  const presentSystemPrompts = promptDocuments.present
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
    remove: async function (path) { return await profileData.remove(path) },
    size: path => profileData.size(path)
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
  const skillTextContext = createSkillTextContext(ctx)
  const tavernSkills = createTavernSkillModule({
    directory: dataRoot + '/skills',
    builtInDirectory: sourceRoot + '/presets/tavern/skills',
    backgroundDirectory: sourceRoot + '/presets/tavern-background/skills'
  })

  async function skillRoleFor(agent) {
    const sessionId = agent?.session?.id
    if (!sessionId) return null
    if (backgroundAgentRunner.owns(sessionId)) return 'background'
    const chat = await backgroundConfigForSession(sessionId)
    return chat ? (chat.mode === 'card' ? 'card' : 'foreground') : null
  }
  async function skillEnabledFor(skill, agent) {
    if (await skillRoleFor(agent) !== 'foreground') return true
    const chat = await chatHeaderForSession(agent?.session?.id, ['disabledWritingSkills'])
    return !(chat?.disabledWritingSkills || []).map(canonicalTavernSkillName).includes(skill.name)
  }
  let invalidateTavernSkills = () => {}
  // 0.2.x 适配：官方桌面的宿主没有 sessionSkillCatalog 服务；DSH NEXT 有，但它的 scopeFor 改成
  // scopeFor(agentPreset) 返回可释放的 lease，installSkillCatalogSessionScope 认出后不安装（静默降级）。
  // tavern 的 Skill 来源仍由下方 host `skills` registry 的 registerProvider 提供；冷菜单查询
  // 在这个宿主上拿不到 session 身份，按角色过滤（enabledFor）只对活会话生效。
  // 若宿主后续给出等价接缝，改挂到那个服务上；在此之前保留注入与模块，避免留下孤儿模块。
  ctx.inject(['sessionSkillCatalog'], scope => {
    scope.effect(() => installSkillCatalogSessionScope(scope.get('sessionSkillCatalog')))
  })
  // Plugins' own skills directories (tavern.skillSource): one read-only file provider each.
  const pluginSkillRoots = new Set()
  const EMPTY_SKILL_PROVIDER = Object.freeze({ list: async () => [], get: async () => undefined, dispose: async () => {} })
  let skillHost = null
  function attachPluginSkillRoot(entry) {
    if (!skillHost || entry.slot !== undefined) return
    entry.slot = skillHost.providers.length
    skillHost.providers.push(new FileSystemSkillProvider(ctx, skillHost.control, { providerName: 'tavern-plugin-files-' + entry.slot, includeDefaultRoots: false, bundledSkillDir: entry.dir }))
  }
  function addPluginSkillRoot({ owner, dir, role }) {
    const entry = { owner, dir, role }
    pluginSkillRoots.add(entry)
    const dropRoot = tavernSkills.addRoot({ path: dir, role, owner })
    attachPluginSkillRoot(entry)
    skillHost?.control.invalidate()
    return () => {
      pluginSkillRoots.delete(entry)
      dropRoot()
      // Slots keep their index: candidates already listed locate their provider by it.
      if (skillHost && entry.slot !== undefined) { const provider = skillHost.providers[entry.slot]; skillHost.providers[entry.slot] = EMPTY_SKILL_PROVIDER; void provider.dispose?.() }
      skillHost?.control.invalidate()
    }
  }
  const skillRegistry = ctx.get('skills')
  if (!skillRegistry) throw new Error('dsh-tavern: 缺少原生 Skills 服务')
  skillRegistry.registerProvider(control => {
    invalidateTavernSkills = () => control.invalidate()
    const providers = [
      new FileSystemSkillProvider(skillTextContext, control, { providerName: 'tavern-interactive-files', includeDefaultRoots: false, customSkillDirs: [dataRoot + '/skills'], bundledSkillDir: sourceRoot + '/presets/tavern/skills' }),
      new FileSystemSkillProvider(ctx, control, { providerName: 'tavern-background-files', includeDefaultRoots: false, bundledSkillDir: sourceRoot + '/presets/tavern-background/skills' })
    ]
    skillHost = { control, providers }
    for (const entry of pluginSkillRoots) { entry.slot = undefined; attachPluginSkillRoot(entry) }
    ctx.effect(() => tavernSkills.subscribe(control.invalidate))
    ctx.effect(() => () => Promise.all(providers.map(provider => provider.dispose?.())))
    ctx.on('fs/observed', (target, _observation, actor) => {
      if (actor?.name === 'write' || actor?.name === 'edit') providers.forEach(provider => provider.observeHostMutation(target.displayPath))
    })
    return createTavernSkillProvider({ providers, library: tavernSkills, roleFor: skillRoleFor, enabledFor: skillEnabledFor })
  })

  // ---------- profile 私有 preset ----------
  // 0.2.0-rc.2 适配：宿主不再扫描 preset 目录——agentPresets 服务改由
  // @deepseek-ai/dsh-agent-preset-registry 提供，实例字段只有
  // owner/definitions/generations/bindings/switches，**没有 resolvedRoots**
  // （0.1.5 的 `agentPresets.resolvedRoots.unshift(...)` 会在这里 TypeError）。
  // preset 定义现在是 bundle patch 里的 @deepseek-ai/dsh-agent-preset 声明行
  // （见 tavern-plugin/cordis.patch.yml 的 preset-tavern / preset-tavern-background）。
  // 这里只保留服务句柄，供下方 agentPresets.mount(childCtx, 'tavern-background') 按 id 挂载。
  const agentPresetsProxy = ctx.get('agentPresets')
  if (agentPresetsProxy === undefined) throw new Error('dsh-tavern: 缺少 agentPresets 服务')
  const agentPresets = agentPresetsProxy[Symbol.for('cordis.original')] || agentPresetsProxy

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
  // Told after a card's working copy changed (plugins' onCardChanged).
  const cardRevisionListeners = new Set()
  const presentationObservers = createPresentationObservers({warn:({owner,phase,error}) => console.warn('dsh-tavern: presentation observer failed', owner, phase, error?.message || error)})
  ctx.effect(() => () => presentationObservers.dispose())
  async function cardProjectionRevision(cardPath) {
    return cardProjectionRevisionOf(await readJson(CARD_PROJECTION_REVISIONS), cardPath)
  }
  async function bumpCardProjectionRevision(cardPath) {
    void presentationObservers.cardChanged(cardPath)
    const normalized = normalizeResourcePath(cardPath, 'card')
    const saved = await profileData.updateJson(CARD_PROJECTION_REVISIONS, value => bumpCardProjectionState(value, normalized))
    void coordinationEvents?.publishAll()
    for (const listener of cardRevisionListeners) { try { listener(normalized, Number(saved?.cards?.[normalized]) || 0) } catch {} }
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

  const storyEvents = createStoryEvents()
  const workflow = createWorkflow({ events: storyEvents, tasks: BACKGROUND_TASK_CATALOG })
  const settlementJobs = createSettlementJobs({ run: (...args) => wholeReads.scope('结算', () => settlementRun.runCycle(...args)), onSettled: (...args) => settlementRun.onSettled(...args) })
  const scriptContinuity = createScriptContinuity()
  const storyTimeline = createStoryTimeline({ id: uid, now: Date.now })
  const cardPreparation = createCardPreparation({ id: function () { return uid('card') }, now: Date.now })
  installPluginSettingsMigration(ctx)
  // 舞台的素材与判断（stage-module.js）。
  const modelSlots = createModelSlotRegistry({warn:error => console.warn('dsh-tavern: 模型槽读取失败',error?.message)})
  ctx.effect(() => modelSlots.register('core',{rows:() => modelSlotRows(CORE_MODEL_MANIFESTS,CORE_MODEL_MANIFESTS.map(row=>row.id))}))
  const stageRuntime = await createOptionalStage({ctx, cardStorage, measure:(name,run)=>requestPerformance.stage(name,run), modelSlots, presentationObservers, resolveSlot, readCardWorkspace, coordinationEvents}, {enabled:config.stage !== false})
  const {dialogueBubbles} = stageRuntime.assets

  // ---------- 模型调用 ----------
  const helperGenerationTasks = createHelperGenerationTasks()
  ctx.effect(() => () => helperGenerationTasks.dispose())
  const { modelSelection, backgroundModelSelection, tavernModelCatalog, callModel } = createModelCalls({
    llm, agentDefaultModel, agents: () => ctx.get('agents'), sessionProjections: () => ctx.get('sessionProjections'), backgroundConfigForSession
  })
  function scoringCatalog() {return [modelSlots.scoring()].filter(config => config && config.provider !== 'unset').map(({provider,model}) => ({provider,model}))}
  async function slotDeclarations() {
    return modelSlots.rows()
  }
  async function resolveSlot(modId, slotId, sessionId, declaration) {
    const slot = declaration || (await modelSlots.rows()).find(row => row.modId === modId && row.id === slotId)
    if (!slot) throw new Error('模型槽未启用')
    const settings = await readTavernSettings(), chat = sessionId ? await backgroundConfigForSession(sessionId) || {} : {}
    return resolveModelSlotOffered({slot,modId,chat,settings,foreground:sessionId ? modelSelection(sessionId, false) : null,defaultModel:slot.kind === 'scoring' ? null : modelSelection(),scoringConfig:modelSlots.scoring()},
      async selection => (await readBackgroundModelReasoning(llm, selection))?.efforts)
  }
  async function checkSlotSelection({modId,slotId,selection}) {
    const slot = (await modelSlots.rows()).find(row=>row.modId===modId && row.id===slotId)
    if (!slot) throw new Error('模型槽未启用')
    if (selection === null) return
    if (slot.kind === 'scoring') {
      const config = modelSlots.scoring()
      if (!config || selection.provider !== config.provider || selection.model !== config.model) throw new Error('请选择已配置的概率判断模型')
    } else { const {reasoningEffort, ...route} = selection; await llm.resolveCallConfig(reasoningEffort === null ? route : selection) }
  }

  // ---------- 角色卡 ----------
  async function readIndex() {
    const idx = await readJson('index.json')
    return (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
  }
  async function writeIndex(idx) { await writeJson('index.json', idx) }
  async function updateIndex(updater) { return await profileData.updateJson('index.json', value => updater(value || { cards: [], chats: [] })) }
  const fileResources = createFileResourceStore({ dataRoot })
  const updateCard = createCardEditor({ readCardWorkspace, cardPreparation, fileResources, bumpCardProjectionRevision, syncCardName,
    cardRevision: path => cardProjectionRevision(normalizeResourcePath(path, 'card')),
    withCardLock: (id, edit) => cardStorage.withCardLock(id, edit), cardAssetWorkspaceRevision })
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
  let assetCardsActive = true
  ctx.effect(() => () => { assetCardsActive = false })
  const {cardZipTargets} = stageRuntime.cards({
    fileResources,readCardWorkspace,updateCard,
    syncBubbles:path => dialogueBubbles.sync(worldBooks,path),readCharacterBook:path => worldBooks.characterBookForCard(path),
    readSessionMap, persistence:() => chatPersistence,cardId:() => uid('card'),cardPreparation,cardStorage,bumpCardProjectionRevision,syncCardName
  })
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
  async function readLiveCardStage(cardPath) {
    try {
      const workspace = await readCardWorkspace(cardPath)
      const raw = workspace && (workspace.raw?.data || workspace.raw)
      return projectCardStage(raw && raw.extensions)
    } catch (_error) { return null }
  }
  // The card on disk for update checks on every read of a playing game: read again only when its
  // file changed (any way of editing a card writes that file). Shared and read-only.
  const latestCards = new Map()
  async function readLatestCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const stamp = normalized ? (await fileResources.metadata(normalized).catch(() => null))?.updatedAt : 0
    const cached = latestCards.get(normalized)
    if (stamp && cached?.stamp === stamp) return cached.card
    const card = await readCard(normalized)
    latestCards.delete(normalized)
    if (stamp && card) {
      latestCards.set(normalized, { stamp, card })
      while (latestCards.size > 8) latestCards.delete(latestCards.keys().next().value)
    }
    return card
  }
  async function readCardExtensionSources(cardPath, chat) {
    const workspace = chat?.cardDefinitionSnapshot || await readCardWorkspace(cardPath)
    if (workspace === undefined) return undefined
    return cardPreparation.present({ card: workspace, as: 'card-extensions' })
  }
  async function readCardExtensions(cardPath, chat, settings) {
    const extensions = await readCardExtensionSources(cardPath, chat)
    if (extensions === undefined) return undefined
    return withGlobalRegexScripts(extensions, settings ?? await tavernExtensionSettings.read(), chat && chat.regexOverrides)
  }
  function presetRegexScripts(chat) {
    if (!chat || groupOfMode(chat.mode) !== 'play') return []
    const snapshot = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : null
    return Array.isArray(snapshot && snapshot.regexScripts) ? snapshot.regexScripts : []
  }
  // The regex a story/script round's text was projected with when it was saved (reply-prose.js).
  async function replyRegexScripts(chat) {
    if (!['story', 'script'].includes(chat?.mode || 'story')) return []
    return composeTavernRegexScripts(await readCardExtensions(chat.cardPath || chat.cardId, chat), presetRegexScripts(chat), chat && chat.regexOverrides && chat.regexOverrides.preset)
  }
  const readScript = createScriptReader({ resources: fileResources, version: path => profileData.version('resources/' + path) })
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
    await fileResources.importBoundScript(cardPath, prepared)
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
    return readScript(normalizeResourcePath(sourcePath, 'source'))
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
  const { exportSettingsBundle, importSettingsBundle } = createSettingsTransfer({
    importPreset, presetLibrary, readTavernSettings, updateTavernSettings,
    userPreferenceProfile, prepareTextImport, promptDocuments
  })
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
  // pack edits also update writer instructions, not just browser media leases.
  ctx.inject(['assetLibrary'], child => {
    const books = watchFigureBubbleBooks({service:child.get('assetLibrary'), packSettings:ctx.get('assetPackSettings'),
      listCards:() => fileResources.list('card'), readWorkspace:readCardWorkspace,
      sync:path => dialogueBubbles.sync(worldBooks, path),
      onError:(error, path) => console.warn('dsh-tavern: figure writer sync failed', path || '', error.message)})
    child.effect(() => () => books.dispose())
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
  const chatJournalStore = createChatJournalStore({ dataRoot, legacyData: profileData, now: Date.now, logger: console, backgroundSnapshots: true, newConversations: true, wholeReadGuard: wholeReads, migrateLegacy: process.env.DSH_TAVERN_COMPATIBLE_STORAGE === '1' })
  ctx.effect(() => () => chatJournalStore.flushMaintenance(), 'dsh-tavern: finish queued Chat snapshots')
  const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: normalizeChat, now: Date.now })
  async function readChat(chatId) {
    const chat = await chatPersistence.read(chatId)
    return chat
  }
  async function readChatRevision(chatId, revision) { return await chatPersistence.readRevision(chatId, revision) }
  async function rawUpdateChat(chatId, mutation, metadata) {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    return await chatPersistence.update(chatId, mutation, metadata)
  }
  // Stage, director and mods ride on core paths (startup, every save, turn start). Their failure
  // is logged and skipped there: it must never fail a save that committed, a turn or the plugin's load.
  function containStage(label, run, fallback) {
    const skip = error => { console.warn('dsh-tavern: 舞台/mod 出错，已跳过（不影响游玩）:', label, str(error && error.message || error)); return fallback }
    try {
      const value = run()
      return typeof value?.then === 'function' ? value.catch(skip) : value
    } catch (error) { return skip(error) }
  }
  let conversationRegistry
  async function syncChatSummary(chat, metadata) {
    if (chat) presentationObservers.saved(chat, metadata)
    if (!conversationRegistry || chat === undefined) return
    try { await conversationRegistry.sync(chat) }
    catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', str(error && error.message || error)) }
  }
  const deletedChatIds = new Set()
  const { write: writeChat, writeHeader: writeChatHeader, update: updateChat, patch: patchChat, writeRaw: rawWriteChat } = createChatWrites({
    persistence: chatPersistence,
    isDeleted: id => deletedChatIds.has(id),
    candidatesChanged: (saved, metadata) => candidateWorldbookPreparation?.changed(saved, metadata),
    syncSummary: syncChatSummary,
    publish: sessionId => coordinationEvents?.publish(sessionId),
    syncTemplates: scheduleTemplateSync,
    queueCompaction: queueAutoCompaction,
    observePatch: presentationObservers.patched
  })
  // Header fields only: `mutate` gets and returns those fields; the difference is patched,
  // never the history. A concurrent write retries; storage without slices, a write outside
  // `fields` or a lasting race falls back to the whole-Chat update.
  async function updateChatHeader(chatId, fields, mutate, metadata) {
    const pick = chat => Object.fromEntries(fields.filter(field => Object.hasOwn(chat, field)).map(field => [field, chat[field]]))
    for (let attempt = 0; attempt < 10; attempt++) {
      const head = (await chatPersistence.readSlice(chatId, [], ['_storageRevision', ...fields]))?.chat
      if (!head || !Number.isSafeInteger(head._storageRevision)) break
      const before = pick(head), changes = diffJson(before, await mutate(structuredClone(before)))
      if (!changes.length) return head
      if (changes.some(change => !fields.includes(String(change.path[0])))) break
      const saved = await patchChat(chatId, head._storageRevision, changes, { ...metadata, returnProjection: fields })
      if (saved) return saved
    }
    return updateChat(chatId, async current => Object.assign(current, await mutate(structuredClone(pick(current)))), metadata)
  }
  // One message's own fields, patched against a one-row read: the history is not read whole.
  async function updateChatMessage(chatId, index, mutate, metadata) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const selected = (await chatPersistence.readSlice(chatId, [index]))?.chat
      const before = selected?.messages?.[0]
      if (!before || !Number.isSafeInteger(selected._storageRevision)) break
      const after = structuredClone(before)
      mutate(after)
      const changes = diffJson(before, after).map(change => ({ ...change, path: ['messages', index, ...change.path] }))
      if (!changes.length) return true
      if (await patchChat(chatId, selected._storageRevision, changes, metadata)) return true
    }
    let written = false
    await rawUpdateChat(chatId, current => {
      if (!current.messages?.[index]) return undefined
      mutate(current.messages[index])
      written = true
      return current
    }, metadata)
    return written
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
      updateIndex,
      readChat,
      readChatState: id => chatPersistence.readSessionState(id, {scoped:true}),
      readBackgroundConfig: chatPersistence.readBackgroundConfig,
      readSceneImageState: chatPersistence.readSceneImageState,
      writeChat: rawWriteChat,
      removeChat: async function (chatId) { await chatPersistence.remove(chatId) }
    }
  })
  async function readSessionMap() { return await conversationRegistry.links() }
  try {
    const stored = await profileData.list('chats')
    const chatIds = [...new Set(stored.map(entry => entry.directory ? entry.name : (entry.name.match(/^(chat-[^.]+)\.json$/) || [])[1]).filter(name => /^chat-[^.]+$/.test(name || '')))]
    const recovered = await conversationRegistry.recoverUnlisted(chatIds)
    if (recovered.length) console.warn('dsh-tavern: 找回 ' + recovered.length + ' 局未登记的存档：' + recovered.join('、'))
  } catch (error) { console.warn('dsh-tavern: 核对存档登记失败', error?.message || error) }
  const sessionChats = createSessionChatReader({
    registry: conversationRegistry,
    needsAdoption: chat => groupOfMode(chat.mode) === 'play'
      && (chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1),
    adopt: async function (chat) {
      return updateChat(chat.id, current => adoptConversationFeatures(adoptConversationBackground(current, tavernSettingsDocument), tavernSettingsDocument), { source: 'background-config.adopt' })
    }
  })
  // Plugin/extra tools last seen in a play request, per game. The settings
  // switches need the real model-facing tools; a game shows them after its
  // first request.
  const foregroundExtraTools = new Map()
  function extraToolEntry(tool) {
    return { name: tool.name, label: tool.name,
      description: String(tool.description || '').replace(/\s+/g, ' ').trim().slice(0, 240) || '插件注册的前台工具。' }
  }
  function chatForSession(sessionId) { return sessionChats.read(sessionId) }
  const tavernRegexSettings = createTavernRegexSettings({ extensionSettings: tavernExtensionSettings })
  const regexManager = createRegexManager({
    regexSettings: tavernRegexSettings,
    legacyLibrary: regexLibrary,
    chatForSession,
    groupOfMode,
    readCardSources: readCardExtensionSources,
    updateChat
  })
  function sessionStateForSession(sessionId) {
    return requestPerformance.stage('readSessionState', () => sessionChats.readState(sessionId))
  }
  function backgroundConfigForSession(sessionId) { return sessionChats.readBackgroundConfig(sessionId) }
  // By what the caller needs; see chat-reads.js for which reader a path should use.
  const chatReads = createChatReads({ links: readSessionMap, persistence: chatPersistence, whole: chatForSession, allow: wholeReads.allow })
  const { header: chatHeaderForSession, recentSummaries: recentStateForSession, latestFloors: chatHeaderWithLatestFloors, floors: chatSliceForSession } = chatReads
  // The stage's turn views, read on storage's pinned snapshots (stage-read-projection.js).
  const stageReads = createStageReads({ open: chatJournalStore.openSnapshot, whole: chatJournalStore.read })
  const readStageChat = createStageChatCache({
    trace:requestPerformance,
    readHeader:sessionId => chatHeaderForSession(sessionId,['_storageRevision']),
    readChat:chatForSession, readChanges:chatPersistence.readChangedSlice, readView:stageReads.readView, readFloors:stageReads.readFloors
  })
  // A stage page's round view: earlier floors carry their record identity; a consumer
  // of earlier rounds names them (`rounds`, turns) and only those floors carry their records. Turn 0 is the latest round.
  const readRoundView = (sessionId, turn, rounds) => readStageChat.view(sessionId,{turn:Number(turn) || 0,chainOnly:true,...(rounds?.length ? {rounds} : {})})
  // The beat ops of the earlier rounds among the latest `count` through that round view, by turn (`records`), where a
  // consumer looks for its marks, and `view(rounds)`, that round view naming the rounds it found them in.
  const readRoundOps = (sessionId, turn, count) => readStageChat.ops(sessionId,{turn:Number(turn) || 0,chainOnly:true},count)
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
  const saveMaintenance = createSaveMaintenance({
    chats: chatJournalStore, requestLog: modelRequestLog, recallLog: worldbookRecallLog, store: profileData,
    listChatIds: async () => [...new Set((await readdir(path.join(dataRoot, 'chats'), { withFileTypes: true }).catch(() => []))
      .map(entry => entry.isDirectory() ? entry.name : entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '')
      .filter(id => id.startsWith('chat-') && !deletedChatIds.has(id)))],
    isIdle: async chatId => {
      if (deletedChatIds.has(chatId)) return false
      const state = await taskStateReader.read(chatId).catch(() => null)
      if (!state || state.regenInProgress) return false
      if (agentRegistry.get(state.sessionId)?.phase?.kind === 'running') return false
      const activity = backgroundTasks.activity(state)
      return !activity.busy && !['pending', 'running'].includes(activity.phase)
    }
  })
  ctx.effect(() => () => saveMaintenance.dispose(), 'dsh-tavern: save maintenance')
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
  const castAssets = createCastAssets({ store: profileData })
  // DSH cards (Wiki「设计：dsh-card-format」): asset packs stored once by content; big files uploaded to disk.
  const mediaStore = createMediaStore({ root: path.join(dataRoot, 'asset-packs') })
  ctx.provide('tavernMediaStore', mediaStore)
  const assetPacks = createAssetPacks({ store: profileData, mediaStore })
  const uploads = createUploads({ root: dataRoot })
  const pluginDataStore = createPluginDataStore({ dataRoot })
  const userPluginInstaller = createUserPluginInstaller({ dataRoot, sync: () => syncUserPlugins({ dataRoot }) })
  const cardPlugins = createCardPlugins({ dataRoot, pluginsDir: userPluginPaths(dataRoot).plugins, keyOf: castAssets.keyOf })
  void uploads.sweep().catch(() => {})
  // Voiced dialogue: channels are Tavern's and the plugins' (pluginApi is created later; read lazily).
  const speech = createSpeech({ store: profileData, credentials: () => ctx.get('credentials'), plugins: () => pluginApi.speechProviders() })
  resourceGraph = createResourceGraph({
    castAssets,
    cardPlugins,
    cardOrganization,
    resources: fileResources,
    presets: runtimePresets,
    chats: { readIndex, updateIndex, updateRefs: (chatId, mutate) => updateChatHeader(chatId, ['cardPath', 'runtimePresetPath', 'runtimePresetSnapshot', 'workspace'], mutate, { source: 'resource-graph' }) },
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
  const cardSummaries = createCardSummaryCache({
    absolute: cardPath => fileResources.absolute(cardPath),
    read: async cardPath => {
      // the boundPackIds summary field only fed getPackBindingCounts, which is gone.
      return projectCardSummary(await readCardWorkspace(cardPath))
    }
  })
  // Card files in and out: imports (JSON, PNG, CHARX, DSH card, plugin formats) and exports.
  const { importCard, importCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile } = createCardFiles({
    cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset,
    readCardWorkspace, worldBooks, pluginApi: () => pluginApi, assetLibrary: () => ctx.get('assetLibrary')
  })
  async function listCards() {
    const cardPaths = await fileResources.list('card')
    const scriptBindings = await fileResources.scriptBindingsForCards(cardPaths)
    // One listing per originals directory for the whole library; asking per card made
    // this N listings of N entries. A failure here (e.g. a duplicated original name)
    // falls back to the per-card read so one broken card cannot hide the library.
    const originals = await fileResources.originalCardNames(cardPaths).catch(() => null)
    const cards = await Promise.all(cardPaths.map(async function (cardPath) {
      try {
        const [card, hasImage] = await Promise.all([cardSummaries.read(cardPath), fileResources.hasCardImage(cardPath, originals)])
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
  const openingPreparation = createOpeningPreparation({ readCard, worldBooks, extensionSettings: tavernExtensionSettings, trace: requestPerformance,
    readRuntimeExtensions: async cardPath => tavernRemoteAssets.pinExtensions(await readCardExtensions(cardPath)),
    generateRaw: (config, context) => defaultOrderedRawConfig(config) ? openingGenerate(defaultOrderedRawConfig(config), context)
      : generateHelperRaw(config, { ...context, callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) }),
    generate: (config, context) => openingGenerate(config, context)
  })
  async function openingGenerate(config, context) {
    validateHelperGenerateConfig(config)
    const presetSnapshot = await helperGenerationPreset(config.preset_name, context.presetSnapshot)
    const activeSnapshot = config.preset_name && config.preset_name !== 'in_use'
      ? await helperGenerationPreset('in_use', context.presetSnapshot) : presetSnapshot
    context.signal?.throwIfAborted()
    return generateHelper(config, { ...context, presetSnapshot, presetRegexScripts: activeSnapshot?.regexScripts || [], callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) })
  }
  ctx.effect(() => () => openingPreparation.dispose())
  async function getCardOpenings(cardPath, userName, previewTransport) {
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
    const previews = await timedStage('preview', () => projectCardOpeningPreviews({
      card,
      extensions,
      userName,
      presetRegexScripts: []
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
    const idx = await updateIndex(current => ({ ...current,
      chats: (current.chats || []).map(item => item.cardPath === cardPath ? { ...item, cardName } : item)
    }))
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
  // Turn a card's own plugins on or off (Wiki「设计：dsh-card-format」): they then load like user plugins, confined to this card.
  async function setCardPlugins(input, enabled) {
    const cardPath = normalizeResourcePath(input, 'card')
    const plugins = (await castAssets.read(cardPath)).plugins || []
    if (!plugins.length) throw new Error('这张人物卡没有卡内插件')
    const cardKey = castAssets.keyOf(cardPath)
    if (enabled) await cardPlugins.enable({ cardKey, cardPath, plugins })
    else await cardPlugins.disable({ cardPath, plugins })
    const next = await castAssets.setPlugins(cardPath, plugins.map(plugin => ({ ...plugin, enabled: enabled === true })))
    return next.plugins
  }
  async function deleteCard(cardPath) {
    const plugins = (await castAssets.read(normalizeResourcePath(cardPath, 'card')).catch(() => null))?.plugins || []
    const result = await cardDeletion.remove(cardPath)
    if (result.deleted && plugins.length) await cardPlugins.remove({ cardKey: castAssets.keyOf(normalizeResourcePath(cardPath, 'card')), cardPath: normalizeResourcePath(cardPath, 'card'), plugins }).catch(error => console.warn('dsh-tavern: 删除卡内插件失败', error?.message || error))
    if (result.deleted) await cardOrganization.movePath(normalizeResourcePath(cardPath, 'card'), null)
    return result
  }
  // 人物卡库「复制」：与卡片工作台的 tavern_copy_card 同一份复制（工作数据与封面，换新的人物卡身份，
  // 否则 mod 设置会跟错卡）。默认名「原名 副本」，重名时依次编号；副本放进原卡所在的分组。
  async function duplicateCard(cardPath, name) {
    const source = normalizeResourcePath(cardPath, 'card')
    const workspace = await fileResources.readCard(source)
    if (!workspace) throw new Error('人物卡不存在: ' + source)
    const chosen = str(name).trim()
    const base = chosen || (cardPreparation.isWorkspace(workspace) ? cardPreparation.project(workspace).name : path.basename(source, '.json')) + ' 副本'
    for (let attempt = 1; ; attempt++) {
      try {
        const copied = await fileResources.copyCard(source, attempt === 1 ? base : base + ' ' + attempt)
        const group = (await cardOrganization.read()).cards[source]?.group
        if (group) await cardOrganization.update({ action: 'cards', paths: [copied.path], group }, [copied.path])
        return { path: copied.path, sourcePath: source, imageCopied: copied.imageCopied }
      } catch (error) {
        if (chosen || attempt >= 50 || !str(error?.message).startsWith('副本名称已存在')) throw error
      }
    }
  }
  const sessionInventory = createSessionInventory({
    persistence: ctx.get('sessionPersistence'), sessions: sessionStore, agents: agentRegistry,
    references: () => conversationRegistry.list(), archived: () => ctx.get('workspaceRegistry')?.archivedSessionIds
  })
  async function stopChatForDeletion(chatId) {
    const chat = await readChat(str(chatId))
    if (!chat) return undefined
    const ids = new Set([chat.sessionId, ...Object.values(storyTimeline.inspect({ chat }).participants || {}).map(item => item.sessionId)])
    const workers = [...ids].map(id => agentRegistry.get(id)).filter(Boolean)
    for (const worker of workers) {
      if (typeof worker.cancel === 'function') worker.cancel({ kind: 'user' })
    }
    await cancelSettlement(chat.id)
    for (const worker of workers) {
      if (typeof worker.whenIdle === 'function') await worker.whenIdle()
    }
    return chat
  }
  // Deleting a batch stops every game first, describes the whole batch in one disk
  // scan, then removes them one by one. Each game used to repeat all three phases,
  // re-reading the same index and re-listing the same sessions tree per game.
  async function deleteChats(chatIds, prepareOnly = false) {
    if (!Array.isArray(chatIds) || chatIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效的对话')
    const unique = [...new Set(chatIds)]
    const outcomes = new Map()
    if (prepareOnly) {
      for (const chatId of unique) {
        try { await stopChatForDeletion(chatId); outcomes.set(chatId, { chatId, ok: true }) }
        catch (error) { outcomes.set(chatId, { chatId, ok: false, error: String(error?.message || error) }) }
      }
      return { results: unique.map(chatId => outcomes.get(chatId)) }
    }
    const prepared = []
    for (const chatId of unique) {
      try { prepared.push({ chatId, chat: await stopChatForDeletion(chatId) }) }
      catch (error) { outcomes.set(chatId, { chatId, ok: false, error: String(error?.message || error) }) }
    }
    const known = prepared.filter(item => item.chat !== undefined)
    const footprints = new Map()
    let described = null
    let indexSnapshot
    const readChatIndex = async function () {
      if (indexSnapshot === undefined) indexSnapshot = await readIndex()
      return indexSnapshot
    }
    try {
      described = typeof gameFootprint.describeMany === 'function'
        ? await gameFootprint.describeMany(known.map(item => item.chat), { ownsSession: (id, chat) => ownsBackgroundSession(chat || {}, id, readChatIndex) })
        : await Promise.all(known.map(item => gameFootprint.describe(item.chat, { ownsSession: id => ownsBackgroundSession(item.chat, id, readChatIndex) })))
    } catch (error) { described = null }
    for (let index = 0; described !== null && index < known.length; index++) footprints.set(known[index].chatId, described[index])
    // A batch-wide description can fail on one damaged save; retry per game so the rest still go.
    if (described === null) {
      for (const item of known) {
        try { footprints.set(item.chatId, await gameFootprint.describe(item.chat, { ownsSession: id => ownsBackgroundSession(item.chat, id, readChatIndex) })) }
        catch (error) { outcomes.set(item.chatId, { chatId: item.chatId, ok: false, error: String(error?.message || error) }) }
      }
    }
    const deferred = []
    for (const item of prepared) {
      if (outcomes.has(item.chatId)) continue
      try {
        await finishChatDeletion(item.chatId, item.chat, footprints.get(item.chatId) || null, deferred)
        outcomes.set(item.chatId, { chatId: item.chatId, ok: true })
      } catch (error) { outcomes.set(item.chatId, { chatId: item.chatId, ok: false, error: String(error?.message || error) }) }
    }
    // Two games can name the same loaded session; queue each directory once.
    const pendingDeletions = [...new Map(deferred.map(item => [item.path, item])).values()]
    if (pendingDeletions.length) await gameFootprint.deferSessionDeletion(pendingDeletions).catch(error => console.warn('dsh-tavern: 延迟删除队列写入失败', error?.message || error))
    return { results: unique.map(chatId => outcomes.get(chatId)) }
  }
  // A background session is this game's only if its stored parent is this game's foreground
  // session and no other game still refers to it (imports used to keep foreign ids).
  async function ownsBackgroundSession(chat, sessionId, readIndexOnce) {
    const index = readIndexOnce ? await readIndexOnce() : await readIndex()
    if ((index.chats || []).some(row => row.id !== chat.id && (row.backgroundSessionId === sessionId || (row.backgroundHistoryIds || []).includes(sessionId)))) return false
    try {
      const handle = await ctx.get('sessionPersistence').open(sessionId, 'read')
      try { return handle.header?.parentSession === chat.sessionId } finally { await handle.close() }
    } catch { return false }
  }
  // A batch hands every loaded session to one deferred queue write instead of one per game.
  async function finishChatDeletion(chatId, chat, footprint, deferred) {
    const result = await conversationRegistry.remove(chatId)
    await worldbookSkillProvider?.removeChat(chat)
    deletedChatIds.add(chatId)
    await pluginMedia.removeChat(chatId).catch(() => console.warn('dsh-tavern: 插件媒体记录清理失败', chatId))
    await pluginData.removeChat(chatId).catch(() => console.warn('dsh-tavern: 插件数据清理失败', chatId))
    await displayRuntimeStore.remove(chatId).catch(() => {})
    await sceneWorldbookArchive.forgetChat(chatId).catch(() => {})
    pluginApi.gameRemoved(footprint?.foregroundSessionId || chat?.sessionId)
    if (footprint) {
      deletedSessionIds.add(footprint.foregroundSessionId)
      await apiDiagnostics.forget(footprint.foregroundSessionId).catch(() => {})
      await backgroundAgentRunner.releaseFor(footprint.foregroundSessionId)
      // A session DSH still holds loaded would be written back; delete it on the next start.
      const live = footprint.items.filter(item => item.category === 'subsession' && agentRegistry.get(item.sessionId))
      footprint.items = footprint.items.filter(item => !live.includes(item))
      if (deferred) deferred.push(...live)
      else await gameFootprint.deferSessionDeletion(live)
      const cleanup = await gameFootprint.removeLeftovers(footprint)
      if (cleanup.failures.length) console.warn('dsh-tavern: 删除游戏后有残留未清理', chatId, cleanup.failures.slice(0, 5))
    }
    return result
  }
  async function deleteChat(chatId) {
    const chat = await stopChatForDeletion(chatId)
    let indexSnapshot
    const readChatIndex = async function () {
      if (indexSnapshot === undefined) indexSnapshot = await readIndex()
      return indexSnapshot
    }
    const footprint = chat ? await gameFootprint.describe(chat, { ownsSession: id => ownsBackgroundSession(chat, id, readChatIndex) }) : null
    return await finishChatDeletion(chatId, chat, footprint)
  }
  async function exportConversation(chatId, sessionId, title) {
    const chat = str(chatId) === '' ? await chatForSession(str(sessionId)) : await readChat(str(chatId))
    if (chat === undefined) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const full = (await readChat(chat.id)) || chat
    const exported = createConversationMarkdownExport(full, { title: str(title), images: new Map() })
    if (exported.messageCount === 0) throw new Error('暂无可导出的对话')
    return { filename: exported.filename, text: exported.text }
  }
  const gameSaveSnapshot = createGameSaveSnapshot({
    readChat,
    assertIdle: chat => assertConversationForkable(chat, { agentRunning: agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' }),
    readSession: async sessionId => {
      const live = sessionStore.get(sessionId)
      if (live) await sessionStore.flush(live)
      const handle = await ctx.get('sessionPersistence').open(sessionId, 'read')
      try { return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events: (await handle.read(0)).events } }
      finally { await handle.close() }
    }
  })
  const exportGameSave = createGameSaveExporter({
    chatForSession, gameSaveSnapshot, readChatRevision, fileResources, gameFootprint, sceneWorldbookArchive,
    getAttachments: () => ctx.get('attachments'),
    exportPluginData: chatId => pluginApi.exportGame(chatId),
    // 没有绑定世界书的局只能靠自己那份快照，所以只有卡确实绑着世界书时才允许省略。
    hasBoundWorldbook: async cardPath => {
      if (str(cardPath) === '') return false
      try { return (await worldBooks.bound(cardPath)) !== null } catch { return false }
    },
    tavernVersion: TAVERN_PACKAGE_VERSION
  })
  const importGameSave = createGameSaveImporter({
    tavernVersion: TAVERN_PACKAGE_VERSION, dataRoot, readCard,
    prepareGameSaveResources: createGameSaveResources({ resources: fileResources, cardPreparation }),
    getAttachments: () => ctx.get('attachments'), newChatId: () => uid('chat'),
    rawWriteChat, conversationRegistry, profileData, sceneWorldbookArchive,
    // 导出时可以不带预设快照（同包已带预设），导入时按这局记下的预设重新冻结一份：
    // 目标机刚装回来的就是它，渲染路径照旧只读快照。
    restorePresetSnapshot: async function (chat) {
      if (!chat || chat.runtimePresetSnapshot !== undefined) return chat
      const presetPath = str(chat.runtimePresetPath)
      if (presetPath === '') return chat
      try {
        const snapshot = await runtimePresets.fullSnapshot(presetPath)
        if (snapshot) return { ...chat, runtimePresetSnapshot: snapshot }
      } catch (error) {
        // 这局记下的预设没跟着来（或被改名）：宁可改用当前预设，也不要让正文在无预设下渲染。
        try {
          const fallback = await runtimePresets.fullSnapshot()
          console.warn('dsh-tavern: 存档的预设「' + presetPath + '」不可用（' + str(error?.message || error) + '），改按当前预设渲染')
          if (fallback) return { ...chat, runtimePresetSnapshot: fallback, runtimePresetPath: str(fallback.presetPath) || presetPath }
        } catch (fallbackError) {
          console.warn('dsh-tavern: 导入的存档缺少预设快照，按当前预设重建失败：' + str(fallbackError?.message || fallbackError))
        }
        return chat
      }
      return chat
    },
    pluginApi: { importGame: input => pluginApi.importGame(input) },
    sessions: {
      create: ({ sessionId, events, cwd, preset }) => {
        const selection = agentDefaultModel?.currentSelection?.() || {}
        return ctx.get('agents').create({ sessionId, seed: events, inheritedEventCount: events.length,
          meta: { cwd, isSeeded: true, agentPreset: preset },
          agentOptions: { provider: selection.provider, model: selection.model }, setup: tavernPresetSetup(preset) })
      },
      flush: session => sessionStore.flush(session),
      attach: async (sessionId, cwd) => (await ctx.get('workspaceRegistry')?.resolveByPath(cwd))?.attachSession(sessionId),
      detach: async (sessionId, cwd) => (await ctx.get('workspaceRegistry')?.resolveByPath(cwd))?.detachSession(sessionId),
      remove: (sessionId, cwd) => rm(path.dirname(ctx.get('sessionPersistence').locate({ id: sessionId, cwd }).path), { recursive: true, force: true }),
    }
  })
  async function exportTavernLogs(requestedSessionId) {
    let sessionId = str(requestedSessionId)
    let chat = await chatForSession(sessionId)
    // Opened from a background session: export its game's logs, which include this session.
    if (!chat) {
      let header = (sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session)?.header
      if (!header && sessionId) {
        try {
          const handle = await ctx.get('sessionPersistence').open(sessionId, 'read')
          try { header = handle.header } finally { await handle.close() }
        } catch {}
      }
      const parentId = str(backgroundAgentRunner.requestContext(sessionId)?.parentSessionId || header?.parentSession)
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
    const exported = await createMvuDiagnosticExport({ presetDiagnostics, cardDiagnostics, performanceDiagnostics: { ...performanceDiagnostics.read(), requests: requestPerformance.read(), replyProjection: sessionProjection.stats() }, updateDiagnostics: applicationUpdater.diagnostics(), sessionId, backgroundSessionIds, displayDiagnostics: { version: 1, frames: await displayDiagnosticFrames(chat) }, apiDiagnostics: await apiDiagnostics.read(sessionId).catch(() => null), compatibilityDiagnostics: compatibilityDiagnostic, store: mvuDiagnostics, sessions: sessionStore, persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery'), attachments: ctx.get('attachments'), environment: { templateRuntime: await fullTemplateRuntime.inspect(sessionId), mvu: OFFICIAL_MVU_VERSION, mvuAsset: inspectOfficialMvuAsset(), runtime: { hostCompatibility, sessionPatch: sessionPatch.view(), generation: runtimeGeneration, platform: process.platform, arch: process.arch, nodeVersion: process.version } } })
    return { filename: exported.filename, base64: exported.buffer.toString('base64') }
  }
  // Captures from the diagnostics store, falling back to ones old saves kept inline.
  async function displayDiagnosticFrames(chat) {
    const stored = await displayRuntimeStore.recent(chat.id).catch(() => ({}))
    return (chat.messages || []).filter(message => message.displayRuntime).slice(-20).flatMap(message => {
      const runtime = message.displayRuntime.version === 2 ? stored[String(message.turn)] : message.displayRuntime
      return (runtime?.frames || []).map(frame => ({ turn: message.turn, partIndex: frame.partIndex, panelId: frame.panelId, placement: frame.placement, capturedAt: frame.capturedAt, console: frame.console, errors: frame.errors, network: frame.network }))
    })
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

  const captureDisplayRuntime = createDisplayRuntimeCapture({ readSessionMap, chatPersistence, chatForSession, displayRuntimeStore, patchChat })
  // A history import builds its frames before the draft Chat is published, so the
  // template runtime cannot find that Session on disk yet. The import service holds
  // the draft here while frames are built and releases it on success or failure.
  const importDrafts = new Map()
  const tavernScriptHostAdapter = createTavernScriptHostAdapter({
    replyRegexScripts,
    presetRegexScripts,
    recordResourceSave: (sessionId, summary) => apiDiagnostics.recordResourceSave(sessionId, summary),
    publishCreatedMessages: async function (chat, targets) {
      const session = sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      appendHelperUserSessionContext(session, chat, targets)
      await sessionStore.flush(session)
    },
    resolveChat: async function (sessionId) {
      const id = str(sessionId)
      return importDrafts.get(id) ?? await chatForSession(id)
    },
    resolveTemplateChat: readStageChat.template,
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
    resolveChatSlice: chatSliceForSession,
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
  // Automatic world book updates land here: any idle read of a playing session
  // lets a library edit enter this game without the explicit reload button.
  async function cardUpdateStatus(chat, context = {}) {
    try {
      // A game just opened plays the card it was given, which is the card on disk.
      if (context.fresh === true) return playCardSnapshots.libraryBoundStatus(chat, context.card)
      const status = await playCardSnapshots.currentStatus(chat, { busy: context.busy === true })
      // An edited card or world book enters an idle game by itself; the page only hears about it.
      if (context.busy !== true) cardAutoReload.schedule(chat.sessionId, status)
      return { ...status, autoReloading: cardAutoReload.running(chat.sessionId), autoReloadError: cardAutoReload.failure(chat.sessionId) }
    } catch (error) { return {available:true,error:String(error.message || error)} }
  }
  const cardAutoReload = createCardAutoReload({
    apply: (sessionId, digest) => applyCardUpdate(sessionId, digest, { auto: true }),
    published: sessionId => sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'card-reload:' + Date.now() })
  })
  /** Replace a game's card and world book with the latest ones (what the old reload button did). */
  async function applyCardUpdate(sessionId, digest, { auto = false } = {}) {
    if (typeof digest !== 'string' || !digest) throw new Error('请刷新后确认人物卡和世界书更新')
    const conflict = new Error('游戏状态已变化，未应用更新，请稍后重试')
    // Rebuild from the latest snapshot on a concurrent write. Never merge an
    // old prepared save over new state, or skip the exact revision check.
    for (let attempt = 0; attempt < 3; attempt++) {
      const chat = await chatForSession(sessionId)
      if (!chat || !['story', 'script'].includes(chat.mode || 'story') || chat.requestMode === 'sillytavern') throw new Error('仅支持当前游玩会话')
      if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用人物卡')
      // Applying the card restarts the card scripts; a regeneration left in progress could then never be restored.
      if (chat.regenInProgress) throw new Error('上一次正文重新生成尚未完成：请先点「重新生成正文」完成或恢复它，再应用人物卡')
      const card = await readCard(chat.cardPath)
      if (!card) throw new Error('人物卡不存在')
      const patch = await playCardSnapshots.replacement(chat, card, digest)
      const prepared = await liveCardUpdate.prepare({...chat,...patch}, card, chat)
      const nativeSession = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      if (nativeSession) prepareTemplateHistory(nativeSession, chat, prepared)
      prepared.tavernHelperLifecycleRevision = (Number(chat.tavernHelperLifecycleRevision) || 0) + 1
      // The page says so until the next turn.
      if (auto) prepared.cardAutoReload = { at: Date.now(), turn: latestReplyTurn(chat) }
      const extensions = await readCardExtensions(chat.cardPath, prepared)
      await liveCardUpdate.project(prepared, card, {projections:[]}, {charName:card.name,macroState:chat.macroState,regexScripts:extensions.regexScripts})
      await playCardSnapshots.replacement(chat, await readCard(chat.cardPath), digest)
      try {
        const saved = await updateChat(chat.id, current => {
          if (current._storageRevision !== chat._storageRevision || agentRegistry.get(sessionId)?.phase?.kind === 'running' || ['pending','running','waiting-runtime'].includes(current.settleStatus)) throw conflict
          return prepared
        }, { source: auto ? 'card-context.auto-reload' : 'card-context.apply-update' })
        if (nativeSession) await synchronizeTemplateHistory(nativeSession, saved, session => sessionStore.flush(session))
        return await view(saved, card)
      } catch (error) { if (error !== conflict) throw error }
    }
    throw conflict
  }
  function latestReplyTurn(chat) {
    const messages = chat.messages || []
    for (let index = messages.length - 1; index >= 0; index--) if (messages[index]?.role === 'assistant') return Number(messages[index].turn) || 0
    return 0
  }
  const liveCardUpdate = createLiveCardUpdate({readGlobals:readPromptTemplateGlobalVariables,
    // Games without their own copy still preview against the book they play with.
    readWorldBook: (chat, card) => worldBooks.bound(chat.cardPath, card, chat)})
  ctx.effect(() => () => liveCardUpdate.dispose())
  const sessionResources = createSessionResourceAccess({ read: async ({chatId, revision, kind}) => {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    const chat = await readChatRevision(chatId, revision)
    if (!chat) return undefined
    const card = await readChatCard(chat)
    if (kind === 'card') return cardViewOf(card, chat)
    const record = await worldBooks.bound(chat.cardPath, card, chat)
    return record ? projectTavernHelperWorldbook(record.view) : null
  } })
  const activeRoundBodies = new Map()
  function replyDisplayForChat(...args) { return sessionProjection.replyDisplay(...args) }
  async function startChat(cardPath, sessionId, mode, openingId, userName, requestMode, preparationId, cardTask) {
    // Plain greetings have no interactive preview draft, but need the same
    // game-local worldbook snapshot as scripted openings.
    const ownsDraft = !preparationId
    if (ownsDraft && groupOfMode(mode || 'story') === 'play') {
      preparationId = (await requestPerformance.stage('openingDraft', () => openingPreparation.begin(cardPath, { userName }))).id
    }
    let preparation
    try { preparation = preparationId ? openingPreparation.resolve(preparationId, cardPath, openingId) : undefined }
    // The draft keeps the whole resolved book; a plain start never reads it again.
    finally { if (ownsDraft && preparationId) openingPreparation.release(preparationId) }
    if (preparation?.sourceSessionId) {
      const source = await chatForSession(preparation.sourceSessionId)
      if (!source || !sessionOpeningDescriptor(source, await readChatCard(source)) || Number(source.tavernHelperLifecycleRevision || 0) !== preparation.sourceLifecycleRevision) throw new Error('原对话已变化，请重新选择开场')
    }
    const started = await requestPerformance.stage('initializeConversation', () => conversationInitialization.start({ cardPath, sessionId, mode, openingId, userName, requestMode, preparation, cardTask }))
    if (groupOfMode(mode || 'story') === 'play') {
      const chat = await chatForSession(sessionId).catch(() => null)
      gameTitles.name(sessionId, chat?.cardName)
    }
    return started
  }

  async function sessionActivity(sessionId) {
    const chat = await taskStateReader.forSession(sessionId)
    if (chat === undefined) return null
    return sessionProjection.status(chat)
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
  const helperHistoryAccess = createHelperHistoryAccess({read: (id,args) => chatPersistence.readHelperContext(id,args)})
  const sessionProjection = createSessionViewProjection({
    readChanges: (id, revision) => chatPersistence.readChangedSlice(id, revision, 'settlement'),
    scheduleTemplateSync,
    warmCandidates: sessionId => candidateWorldbookPreparation?.warm(sessionId),
    requestPerformance,
    readTavernSettings,
    readScript,
    scriptContinuity,
    groupOfMode,
    tavernExtensionSettings,
    readCardExtensions: (cardPath, chat, settings) => readCardExtensions(cardPath, chat, false, settings),
    readLiveCardStage, stageReadScope, readStageChat,
    tavernRemoteAssets,
    liveCardUpdate,
    activityOf: chat => backgroundTasks.activity(chat),
    cardUpdateStatus,
    agentRegistry,
    str,
    sessionResources,
    worldBooks,
    sessionDebugEvidence,
    cardViewOf,
    projectLedgerTask: chat => manualLedger.project(chat),
    projectCharacterDesignTask: chat => manualCharacterDesign.project(chat),

    readPromptTemplateGlobalVariables,
    sessionStore,
    readChatCard,
    workspaceViewOf,
    helperHistoryAccess,
  })
  function view(...args) { return sessionProjection.view(...args) }
  function projectOpeningWindow(...args) { return sessionProjection.project.opening(...args) }
  // `historyFrom`: the oldest floor the browser has scrolled to; the window grows
  // to cover it instead of switching the whole session to a complete view.
  async function readOpeningWindow(sessionId, historyFrom) {
    const chatId = (await readSessionMap())[str(sessionId)]
    if (!chatId) return null
    // Scrolled back to the first floor: the window would be the whole history, read page by
    // page only to be refused. The complete view refreshes from changed floors instead.
    if (historyFrom === 0) return null
    const window = await readRecentWindow(chatPersistence.readWindow,chatId,{limit:HELPER_MESSAGE_COLD_WINDOW,from:historyFrom,requirePartial:true,messageFields:sessionViewMessageFields})
    if (!window || window.from===0 || window.chat.sessionId!==sessionId
      || window.chat.backgroundConfigVersion!==1 || window.chat.conversationFeaturesVersion!==1
      || !['story','script'].includes(window.chat.mode || 'story')
      || window.chat.messages.some(message=>message.role==='assistant' && !Number.isSafeInteger(message.turn))) return null
    return window
  }
  // Results of story operations: the same bounded window the browser keeps in
  // sync, never a complete-history view. Short and old saves keep view().
  async function presentStory(chat) {
    // Workbench retries may still be blank, or have just created/bound a card.
    if (chat?.mode === 'card') return sessionProjection.project.full(chat)
    const window = chat?.sessionId ? await readOpeningWindow(chat.sessionId, templateHistoryFrom.get(chat.sessionId)) : null
    if (window) return projectOpeningWindow(window)
    const full = Array.isArray(chat?.messages) && !isScopedMessages(chat.messages) ? chat : await readChat(chat.id)
    return view(full, await readChatCard(full))
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
    project: sessionProjection.project,
    activity: chat => backgroundTasks.activity(chat), trace: requestPerformance,
    foregroundRunning: sessionId => agentRegistry.get(str(sessionId))?.phase?.kind === 'running',
    synchronize: createSessionViewSync()
  })
  function sessionView(sessionId, options) { return sessionViews.read(sessionId, options) }
  async function ensureNativeOpening(sessionId) {
    return await conversationInitialization.ensureOpening(sessionId)
  }
  const contextPlanner = createContextPlanner({ prompt: runtimePrompt, callModel: callModel, now: Date.now, logger: console })
  const foregroundCapabilities = stageRuntime.foreground({
    session: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
    readConfig: cardPath => dialogueBubbles.read(cardPath, {requireAvailable:true}),
    render: async (chat, worldBook) => {
      if (stageReadScope(chat) && worldBook.view.entries.some(isWorldBookTemplateEntry)) chat = await readStageChat(chat.sessionId)
      return projectWorldBookTemplates({worldBook,includeConstants:true,
        runtime:await promptTemplateRuntime(chat.sessionId),globalVariables:await readPromptTemplateGlobalVariables(),chat,card:{name:chat.cardName}})
    },
    save: (chat, snapshot, options) => updateChat(chat.id, draft => {
      if(options && Object.hasOwn(options,'expected') && JSON.stringify(draft.foregroundCapabilities)!==JSON.stringify(options.expected))
        throw Object.assign(new Error('Foreground prompt changed'),{code:'REVISION_CONFLICT'})
      draft.foregroundCapabilities=snapshot;return draft
    }, {source:'foreground.capabilities',touchUpdatedAt:false,assertCurrent:options?.assertCurrent})
  })
  const playCardSnapshots = createPlayCardSnapshots({ worldBooks, planner: contextPlanner, readCard: readChatCard, readLatestCard, writeChat, updateChat, userPreferenceProfile })
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
    cards: { read: readCard, readChat: readChatCard, script: readScript, extensions: readCardExtensions,
      startDefaults: async cardPath => (await castAssets.read(normalizeResourcePath(cardPath, 'card'))).startDefaults || null },
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, write: writeChat },
    trace: requestPerformance,
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
    present: async function (chat, card, options) {
      const result = await view(chat, card, false, options)
      if (chat.mode === 'card') result.workspace = workspaceViewOf(chat)
      return result
    }
  })
  const projectBuiltinWorldbook = createForegroundWorldbook({
    bound: (cardPath, card, chat) => playWorldBook(chat, card),
    runtime: promptTemplateRuntime,
    globalVariables: readPromptTemplateGlobalVariables,
    scanText: scriptPromptScanText
  })
  ctx.effect(() => () => projectBuiltinWorldbook.dispose())
  const worldbookStrategies = createWorldbookStrategies({
    nativeSkills: projectBuiltinWorldbook
  })
  const projectForegroundWorldbook = async input => {
    const projected = await worldbookStrategies.project(input)
    return projected
  }
  const worldbookSkillProvider = createWorldbookFiles({
    directory: path.join(dataRoot, 'worldbook-files'),
    resourcesAvailable: scope => nativeWorldbookReadAvailable(ctx.get('tools'), scope),
    async load(agent) {
      const binding = await resolveWorldbookSkillChat(agent, { background: backgroundAgentRunner, readChat: chatForSession })
      if (!binding) return null
      const { chat } = binding
      try {
        const card = await readChatCard(chat)
        return { ...binding, card, worldBook: await playWorldBook(chat, card) }
      } catch (error) {
        console.warn('dsh-tavern: 本局世界书文件不可用:', str(error?.message || error))
        return null
      }
    }
  })
  // Like the other model tools (「模型可选工具」 below): a host without the tool service has none to add.
  if (ctx.get('tools') !== undefined) registerWorldbookFileTools(ctx.get('tools'), worldbookSkillProvider)
  installWorldbookSkillRead(ctx, worldbookSkillProvider, {
    async virtualOnly(agent) {
      // Background read is never a general filesystem capability, even when its lease ends.
      if (backgroundAgentRunner.owns(agent?.session?.id)) return true
      return Boolean(await resolveWorldbookSkillChat(agent, { background: backgroundAgentRunner, readChat: chatForSession }))
    }
  })
  // Observe source changes before each step; tools also revalidate every access.
  ctx.on('agent/pre-step', async (payload, next) => {
    await worldbookSkillProvider.refresh(payload.agent, { signal: payload.signal })
    const snapshot = worldbookSkillProvider.changeSnapshot(payload.agent)
    if (snapshot && (snapshot.entries.length || sessionEvents(payload.agent.session).some(event => event.data?.source?.worldbookSkills))) {
      if (appendWorldbookSkillChanges(payload, snapshot)) await sessionStore.flush(payload.agent.session)
    }
    return next()
  }, { prepend: true })
  const chatHistoryImporter = createChatHistoryImportService({
    projectWorldBookTemplates: nativeWorldBookTemplateContext,
    projectForegroundWorldbook,
    drafts: {
      hold: function (sessionId, chat) { importDrafts.set(str(sessionId), chat) },
      // The worker was initialized from the draft; the published Chat starts a fresh one.
      clear: function (sessionId) { importDrafts.delete(str(sessionId)); fullTemplateRuntime.cancel(str(sessionId)) }
    },
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
  // Agents Tavern creates or resumes itself get the Tavern preset's plugins (the compaction
  // engine among them), as DSH's session controller mounts them for the page's sessions.
  function tavernPresetSetup(presetId = 'tavern') {
    return async agentCtx => {
      const presets = ctx.get('agentPresets')
      if (presets) await presets.mount(agentCtx, (await presets.resolve(presetId)).id)
    }
  }
  // The same import as 「导入聊天记录」, for tools: the page creates the new Session through the
  // host, here the server creates it (as importGameSave does) and imports into it.
  async function importChatHistoryText(args) {
    if (typeof args?.text !== 'string' || !args.text.trim()) throw new Error('缺少聊天记录内容')
    const cardPath = str(args.cardPath)
    if (!await readCard(cardPath).catch(() => undefined)) throw new Error('找不到人物卡：' + cardPath)
    const sessionId = 'session-' + randomUUID(), cwd = path.join(dataRoot, 'resources')
    const selection = agentDefaultModel?.currentSelection?.() || {}
    const handle = await ctx.get('agents').create({ sessionId, meta: { cwd, agentPreset: 'tavern' },
      agentOptions: { provider: selection.provider, model: selection.model }, setup: tavernPresetSetup() })
    try {
      const workspace = await ctx.get('workspaceRegistry')?.resolveByPath(cwd)
      if (workspace) await workspace.attachSession(sessionId)
      return await chatHistoryImporter.import({ operationId: randomUUID(), sessionId, cardPath, text: args.text,
        fileName: str(args.fileName) || 'import.jsonl', ...(args.userName ? { userName: str(args.userName) } : {}) })
    } finally { await handle.dispose() }
  }
  // For long-run tests (bin/eval-compaction-memory.mjs --grow): append finished rounds to a game
  // as if they had been played, without a model, so the same story can be compacted again later.
  async function appendStoryRounds(args) {
    const sessionId = str(args?.sessionId)
    const rounds = Array.isArray(args?.rounds) ? args.rounds.filter(round => str(round?.assistant).trim()) : []
    const chat = await chatForSession(sessionId)
    if (!chat || !rounds.length) throw new Error('缺少对话或要追加的轮次')
    const appended = await withCompactionSession(sessionId, async agent => {
      if (agent.phase?.kind === 'running') throw new Error('这一局正在生成，请稍后再追加')
      const session = agent.session, now = Date.now()
      let turn = Math.max(0, ...sessionEvents(session).filter(event => event.type === 'turn/start').map(event => event.data.turn))
      const messages = []
      for (const round of rounds) {
        turn++
        const user = str(round.user).trim() || '继续', body = str(round.assistant)
        appendSessionEvent(session, 'turn/start', { turn })
        appendSessionEvent(session, 'step/start', { turn, step: 1 })
        appendSessionEvent(session, 'user/message', { id: `tavern-appended:${turn}:user`, role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'user' } }, { surfaceOp: 'append' })
        const input = sessionEvents(session).at(-1).seq
        appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: `tavern-appended:${turn}:body`, role: 'assistant', content: [{ type: 'text', text: body }],
          source: { kind: 'model', provider: 'dsh-tavern', model: 'appended-rounds' } } }, { surfaceOp: 'append' })
        // The anchor ties the saved round to its native events, so reconcile does not rewrite it.
        const nativeAnchor = { turn, input, reply: sessionEvents(session).at(-1).seq }
        appendSessionEvent(session, 'step/end', { turn, step: 1 })
        appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
        messages.push({ role: 'user', text: user, ts: now }, { role: 'assistant', turn, ...plainReplyProse(body),
          ts: now, native: true, swipeId: 0, swipes: [body], nativeAnchor })
      }
      await sessionStore.flush(session)
      return { messages, lastTurn: turn }
    })
    // Write the save only after the native rounds are flushed and released, so the reconcile
    // that follows a save write reads them instead of a stale Session.
    await updateChat(chat.id, current => { current.messages = [...(current.messages || []), ...appended.messages]; return current }, { source: 'test.append-rounds' })
    return { appended: rounds.length, lastTurn: appended.lastTurn }
  }
  async function prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn) {
    const source = str(sourceChatId) === '' ? await chatForSession(str(sourceSessionId)) : await readChat(str(sourceChatId))
    if (!source) throw new Error('找不到要分叉的源对话')
    assertConversationForkable(source, { agentRunning: agentRegistry.get(source.sessionId)?.phase?.kind === 'running' })
    const { state, turn } = await conversationStateAtTurn(source, requestedTurn, readChatRevision)
    let handle
    let session = sessionStore.get(source.sessionId) || agentRegistry.get(source.sessionId)?.session
    if (!session) { handle = await agentRegistry.resume({ resumeSessionId: source.sessionId }); session = handle.agent.session }
    try {
      const references = upgradeReferences(sessionEvents(session))
      const mapped = structuredClone(state)
      for (const message of mapped.messages || []) {
        if (message.nativeAnchor) message.nativeAnchor = upgradedAnchor(message.nativeAnchor, references)
        if (message.bodyEdit) message.bodyEdit = { ...message.bodyEdit, seq: references.sequence(message.bodyEdit.seq, message.bodyEdit.formatVersion), formatVersion: 4 }
      }
      return { source, state: mapped, turn, atSeq: conversationForkBoundary(session, state, turn) }
    } finally { if (handle) await handle.dispose() }
  }
  // Plugin data and media are bound to text versions, whose keys hash the game id:
  // map the fork's visible turns to the new game's keys. A failure never undoes the fork.
  async function forkPluginState(source, state, fork, lastTurn) {
    try {
      const keyMap = new Map()
      for (const turn of await pluginApi.forkTurns(source.id)) {
        if (turn > lastTurn) continue
        try { keyMap.set(turn + '\u0000' + computeSceneTarget({ ...state, id: source.id }, turn).key, computeSceneTarget(fork, turn).key) } catch {}
      }
      await pluginApi.gameForked({ sourceChatId: source.id, targetChatId: fork.id, targetSessionId: fork.sessionId, keyMap })
      pluginApi.timelineChanged(fork.sessionId, { kind: 'fork', turn: lastTurn, fromGameId: source.sessionId })
    } catch (error) { console.warn('dsh-tavern: 分叉时处理插件数据失败:', str(error?.message || error)) }
  }

  async function forkChat(sourceChatId, sourceSessionId, targetSessionId, requestedTurn, expectedRevision, expectedAtSeq) {
    const { source, state, turn, atSeq } = await prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn)
    if (expectedRevision !== source._storageRevision || expectedAtSeq !== atSeq) throw new Error('源对话已变化，请重新选择分叉回合')
    const targetId = str(targetSessionId)
    if (targetId === '' || await chatForSession(targetId) !== undefined) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
    const target = sessionStore.get(targetId) || agentRegistry.get(targetId)?.session
    const targetEnd = sessionEvents(target).findLast(event => event.type === 'turn/end')
    if (!targetEnd || targetEnd.seq !== atSeq) throw new Error('原生分叉没有停在指定回合，已拒绝绑定游戏状态')
    const lastNativeTurn = Number(sessionEvents(target).findLast(event => event.type === 'turn/start')?.data?.turn) || 0
    const fork = forkConversationChat(state, { chatId: uid('chat'), sessionId: targetId, id: uid, now: Date.now, lastNativeTurn })
    fork.forkedFrom = { ...fork.forkedFrom, chatId: source.id, sessionId: source.sessionId, storageRevision: source._storageRevision,
      stateChatId: state.id, stateRevision: state._storageRevision, turn, atSeq }
    await conversationRegistry.publish(fork)
    await saveMaintenance.recordFork(fork).catch(error => console.warn('dsh-tavern: 记录分叉来源失败', str(error?.message || error)))
    await sceneWorldbookArchive.copyRefs(state.id, fork.id, turn).catch(() => {})
    await forkPluginState(source, state, fork, turn)
    return conversationForkReceipt(fork, { lastTurn: turn, messageCount: fork.messages.length })
  }

  const backgroundRetirement = createBackgroundSessionRetirement(profileData, { readState: taskStateReader.forSession, isRunning: id => agentRegistry.get(id)?.status === 'running' })
  ctx.effect(() => installRetiredBackgroundFilter(ctx.get('subagents'), backgroundRetirement, ctx.get('sessionQuery')))
  void backgroundRetirement.load().catch(error => console.warn('dsh-tavern: 读取已退休后台会话失败', str(error?.message || error)))
  ctx.effect(() => installRetiredCatalogView(ctx.get('sessionProjections'), backgroundRetirement, { isRunning: id => agentRegistry.get(id)?.status === 'running' }))
  // Games whose background agents predate their catalog entry get them listed when opened.
  const backgroundCatalog = createBackgroundCatalogBackfill({ agents: agentRegistry, sessionQuery: ctx.get('sessionQuery'),
    onListed: parentId => sessionSignals.publish(parentId, { kind: 'subagents', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) }) })
  // Branches an older Tavern forked as subagent children have no subagent descriptor, so
  // DSH 0.2.1 refuses their whole history ("subagent descriptor is corrupt"). Repair the
  // header once at startup, while nothing is loaded, and again before a page reads one.
  const branchOrigin = createBranchOriginRepair({
    dataRoot: resolveTavernDataRoot(),
    loadCatalog: sessionPatch.loadSessionCatalog,
    isLive: id => Boolean(sessionStore.get(id) || agentRegistry.get(id)),
    // Ownership is the save's header; the page's windowed read must not load the whole save first.
    ownsChat: async id => Boolean(await chatHeaderForSession(id, [])),
    listSessions: () => ctx.get('sessionQuery')?.listSessions?.() ?? []
  })
  void branchOrigin.sweep().catch(error => console.warn('dsh-tavern: 检查旧分支会话头部失败', error?.message || error))
  const runtimePresetSnapshots = new Map()
  const BACKGROUND_TOOLS = [POSTURE_SUBMIT_TOOL, CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_REUSE_TOOL, MVU_SUBMIT_UPDATE_TOOL, CANDIDATE_SUBMIT_TOOL, SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL, LEDGER_SUBMIT_TOOL]
  // What a background task asks of the runner beyond the game's background defaults, declared by the task's owner:
  // ownModel (keep the selection it brings), webSearch: false, cardContext: false (no card/worldbook injection),
  // frozenContext(input) → a frozen shared context {worldbook, stablePrefix, stablePrefixRevision} or null.
  // The stage module declares its director's; 精修 brings its own model.
  const backgroundTaskPolicies = new Map([['polish', { ownModel: true }]])
  const taskPolicy = input => backgroundTaskPolicies.get(input?.task) || {}
  const frozenContext = input => taskPolicy(input).frozenContext?.(input) || null
  const backgroundAgentRunner = createBackgroundAgentRunner({
    retirement: backgroundRetirement,
    onRunFinished: run => { try { storyEvents.emit('task-finished', run) } catch (error) { console.warn('dsh-tavern: 任务完成通知失败', str(error?.message || error)) } },
    // The browser's session list keeps a disposed subagent as an idle row until the list is
    // reloaded; tell the game's page so its header count drops the retired worker at once.
    onRetired: (_id, parentId) => sessionSignals.publish(parentId, { kind: 'subagents', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) }),
    // Nor does it learn of a new one; the same signal reloads the list so the header counts it.
    onCreated: (_id, parentId) => sessionSignals.publish(parentId, { kind: 'subagents', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) }),
    systemAppend: () => runtimePrompt('system-append'),
    resolveModelSelection: async input => taskPolicy(input).ownModel ? input.selection : backgroundModelSelection(await backgroundConfigForSession(input.sessionId)) || input.selection,
    resolveWebSearch: async input => taskPolicy(input).webSearch !== false && (await backgroundConfigForSession(input.sessionId))?.webSearchEnabled === true,
    resolveWorldbookSkills: async () => true,
    backgroundTools: BACKGROUND_TOOLS,
    // Set up after the runner: plugin tools are read when a background Session is set up.
    settlementItems: () => settlementItems,
    pluginCandidate: () => pluginApi.candidate,
    sharedTools: [{
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
    resolveCurrentWorldbook: async function (input) {
      const frozen = frozenContext(input)
      if (frozen) return frozen.worldbook
      if (input.preparedWorldbook !== undefined) return input.preparedWorldbook
      if (taskPolicy(input).cardContext === false) return undefined
      // The server template engine owns absolute history and reads old floors
      // on demand. Only its variable scope needs a proven latest snapshot here.
      const recent = await readOpeningWindow(input.sessionId)
      const chat = recent && (recent.chat.promptTemplateInput?.message || lastTavernHelperVariables(recent.chat.messages) !== undefined)
        ? recent.chat : await chatForSession(input.sessionId)
      return chat ? await nativeWorldBookTemplateContext(chat, await readChatCard(chat)) : undefined
    },
    resolveStablePrefixRevision: async input => {
      const frozen = frozenContext(input)
      return frozen ? frozen.stablePrefixRevision : Number((await backgroundConfigForSession(input.sessionId))?.cardContextRevision) || 0
    },
    resolveStablePrefix: async function (input) {
      const frozen = frozenContext(input)
      if (frozen) return frozen.stablePrefix
      // A task whose prompt is whole without the card (the director preview) gets no card/worldbook injection.
      if (taskPolicy(input).cardContext === false) return ''
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

  // A new player input still cancels any optional independent polish pre-review.
  ctx.on('session/event', function (session, event) {
    if (event?.type !== 'user/message' || event.surfaceOp !== 'append' || event.data?.source?.kind !== 'user' || event.data.source.repair) return
    if (!session?.id || backgroundAgentRunner.owns(session.id)) return
    polishPrereview.cancel(session.id)
  })
  // Store a preference; the foreground chooses its reference when it next writes.
  async function retryStyleReference(sessionId, { guidance = '' } = {}) {
    const chat = await chatForSession(str(sessionId))
    if (!chat || (chat.mode || 'story') !== 'story' || chat.backgroundTasks?.styleReference !== true) throw Error('请先开启本局文风联想')
    if (agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw Error('前台正在生成，请完成后再修改文风要求')
    await updateChatHeader(chat.id, ['styleReferenceGuidance'], current => ({ ...current, styleReferenceGuidance: str(guidance).slice(0, 500) || '请换一种贴合当前场景的笔调参考。' }), { source: 'foreground.style-guidance' })
    return null
  }
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
    beginTask: async (chat, sessionId, onQueued) => {
      if (agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw new Error('前台正在生成，请完成后再整理台账。')
      return await backgroundTasks.begin(chat, 'ledger', { queue: true, onQueued })
    },
    ensureSession: async sessionId => {
      if (!agentRegistry.get(sessionId)?.session) await agentRegistry.resume({ resumeSessionId: sessionId })
    },
    replaceLedger: input => pluginApi.replaceLedger(input)
  })
  const manualCharacterDesign = createManualCharacterDesign({
    publishWorldbook: publishCharacterDesign,
    store: { chatForSession, updateChat, readCard: readChatCard,
      readWorldBook: (chat, card) => worldBooks.bound(chat.cardPath, card, chat) },
    runAgent: input => backgroundAgentRunner.run(input), selection: backgroundModelSelection,
    beginTask: async (chat, sessionId, onQueued) => {
      if (agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat.regenInProgress) throw new Error('前台正在生成，请完成后再设计人物。')
      return await backgroundTasks.begin(chat, 'character-design', { queue: true, onQueued })
    },
    ensureSession: async sessionId => {
      if (!agentRegistry.get(sessionId)?.session) await agentRegistry.resume({ resumeSessionId: sessionId })
    }
  })
  // 舞台、导演与 mod（stage-module.js）。
  // Work other modules report as busy to the deployment gate (getDeploymentActivity).
  const deploymentWork = []
  await stageRuntime.start({dataRoot,
    presentationObservers, workflow, modelSlots, chatHeaderForSession, dialogueBubbles, activeRoundBodies,
    readReplyPrefix:(sessionId,turn) => assistantResultForTurn(sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session,turn)?.text || '',
 containStage, cardsActive: () => assetCardsActive, llm, requestPerformance, sessionSignals, coordinationEvents, fileResources, cardPreparation, cardStorage, cardPlugins, bumpCardProjectionRevision, syncCardName, readChat, readChatCard, readStageChat, stageReads, readRoundView, storyEvents, deploymentWork, backgroundTaskPolicies, chatForSession, chatPersistence, chatJournalStore, rawUpdateChat, updateChat, updateChatMessage, patchChat, storyTimeline, replyDisplayForChat, sessionActivity, modelSelection, resolveSlot, readTavernSettings, callModel, modelRequestLog, backgroundAgentRunner, tavernScriptHostAdapter, tavernScriptDispatch})
  const mvuSettlement = createMvuSettlementModule({
    model: backgroundAgentRunner,
    runtime: tavernScriptHostAdapter,
    diagnostics: mvuDiagnostics,
    characterDesign: characterDesignDocuments
  })
  ctx.effect(() => () => backgroundAgentRunner.dispose(), 'dsh-tavern: dispose resident background agents')
  // Asset pictures come from an image plugin (tavern.imageProvider); Tavern keeps no image channels.
  const assetGeneration = createAssetGeneration({store:profileData, imageProvider:() => pluginApi.imageProviders()[0], getLibrary:() => ctx.get('assetLibrary')})
  ctx.effect(() => () => assetGeneration.dispose(), 'dsh-tavern: dispose asset generation')
  // Public extension service for third-party DSH plugins (docs/plugin-api.md).
  const pluginMedia = createPluginMedia({ store: profileData })
  const pluginData = createPluginData({ store: profileData })
  const pluginTurns = createPluginTurnReader({
    sessionState: sessionStateForSession,
    recentState: recentStateForSession,
    sceneState: (sessionId, turns) => sessionChats.readSceneImageState(sessionId, { turns }),
    header: chatHeaderForSession,
    slice: (sessionId, indices) => chatSliceForSession(sessionId, indices, []),
    fullChat: chatForSession,
    readChatCard
  })
  const pluginSettlementProgress = createPluginSettlementProgress()
  // What each 精修 changed, shown on the 精修对比 page.
  const polishRecords = createPolishRecords({ data: pluginData, turns: pluginTurns })
  const polishReviewer = createPolishReviewer({ latestFloors: (sessionId, count) => chatHeaderWithLatestFloors(sessionId, count, { includePosition: true }), readCard, prompt: runtimePrompt, runAgent: input => backgroundAgentRunner.run(input), selection: async sessionId => {
    // 精修模型 (setting polishModel): one model for every game's 精修; unset, or a model no longer
    // offered, follows the game's own story model.
    const chosen = (await readTavernSettings()).polishModel
    if (chosen && (await tavernModelCatalog()).some(group => group.provider === chosen.provider && group.models.some(model => model.id === chosen.model))) return chosen
    if (!agentRegistry.get(sessionId)?.session) await agentRegistry.resume({ resumeSessionId: sessionId })
    const selected = modelSelection(sessionId)
    if (!selected) throw new Error('没有可用的模型配置，请先选择模型')
    return selected
  }, data: pluginData })
  // 自动精修 (setting polishPrereview, off by default): each reply is reviewed as soon as it is
  // written, beside settlement, and the review is written back into the reply in place.
  const polishPrereview = createPolishPrereview({
    enabled: async () => (await readTavernSettings()).polishPrereview === true,
    // Read-only: the review runs beside settlement, which holds the editing lock.
    readTexts: sessionId => bodyEditor.peek(sessionId),
    review: (sessionId, texts, signal) => polishReviewer.review(sessionId, texts, signal),
    apply: autoPolish
  })
  // A reworded reply (body.polish) keeps its settlement, choices and stage. The write waits
  // for this turn's background work, which writes the same reply; a new message cancels it.
  async function autoPolish(sessionId, texts, review, signal) {
    const started = Date.now()
    const edits = (review?.edits || []).filter(item => item.status === 'ok')
    if (review?.fallback || !edits.length) return polishPrereview.settle(sessionId, texts)
    for (let waited = 0; ; waited += 1000) {
      signal.throwIfAborted()
      const chat = await chatHeaderForSession(sessionId, ['timeline', 'settleStatus', 'regenInProgress'])
      if (!chat) return
      const busy = agentRegistry.get(sessionId)?.phase?.kind === 'running' || chat.regenInProgress ||
        ['pending', 'running'].includes(chat.settleStatus) || backgroundTasks.activity(chat).busy
      if (!busy) break
      if (waited > 300000) throw new Error('后台任务一直未结束，本轮不写回')
      await sleep(1000)
    }
    const edit = await bodyEditor.read(sessionId)
    const current = edit.parts.filter(part => part.kind === 'text').map(part => part.text)
    // The reply changed meanwhile (an edit, a regeneration, a 精修): this review is not for it.
    if (JSON.stringify(current) !== JSON.stringify(texts)) return
    signal.throwIfAborted()
    const polished = applyPolishEdits(texts, edits)
    // Settled before the write: writing the reply announces 正文写完 again, and the polished
    // text must not start a review of itself.
    polishPrereview.settle(sessionId, texts, polished)
    await bodyEditor.polish(sessionId, { token: edit.token, texts: polished })
    notifyPluginTimeline(sessionId, 'edit', { settled: true })
    sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'auto-polish:' + Date.now() })
    await polishRecords.save(sessionId, edit.turn, { original: texts, edits, seconds: Math.round((Date.now() - started) / 1000), auto: true })
      .catch(error => console.warn('dsh-tavern: 自动精修记录保存失败', error))
  }
  // Work riding on the main settlement call: the plugins' tools and notes.
  const settlementItems = createSettlementItems({ plugins: () => pluginApi.settlement })
  const postureItem = createPostureItem({ prompt: () => runtimePrompt('posture-settlement'), tool: POSTURE_SUBMIT_TOOL })
  function castAssetView(cardPath, manifest) {
    const key = castAssets.keyOf(cardPath)
    const url = file => file ? '/api/dsh-tavern/cast-asset?' + new URLSearchParams({ card: key, file }).toString() : ''
    return manifest.characters.map(character => ({ name: character.name, aliases: character.aliases || [], avatarUrl: url(character.avatar), avatars: {}, voices: character.voices || {},
      sprites: Object.fromEntries(Object.entries(character.sprites || {}).map(([emotion, file]) => [emotion, url(file)])) }))
  }
  // The cast as everyone sees it: the player's own assets, then what plugins offer (a DSH card's packs).
  // A character both have keeps the player's pictures and fills only what the player left empty.
  async function castView(sessionId, cardPath, manifest) {
    const own = castAssetView(cardPath, manifest)
    const offered = await pluginApi.castAssetSources({ gameId: str(sessionId) }).catch(() => [])
    const names = character => [character.name, ...character.aliases]
    for (const item of offered) {
      const match = own.find(character => names(character).some(name => names(item).includes(name)))
      if (!match) { own.push({ ...item, voices: {} }); continue }
      if (!match.avatarUrl) match.avatarUrl = item.avatarUrl
      match.avatars = { ...item.avatars, ...match.avatars }
      match.sprites = { ...item.sprites, ...match.sprites }
    }
    return own
  }
  async function castCardOf(sessionId) {
    const header = await chatHeaderForSession(str(sessionId), ['cardPath', 'cardName', 'mode', 'macroState'])
    if (!header || !header.cardPath || !['story', 'script'].includes(header.mode || 'story')) throw new Error('这一局没有绑定人物卡')
    return { path: str(header.cardPath), name: str(header.cardName), player: str(header.macroState && header.macroState.userName).trim() || '你' }
  }
  // Each turn's spoken lines (getCast, onCastAnnotated, getStage, registerTurnView): its round body's bubble paragraphs,
  // as the chat shows them (the read getRoundBody makes); the round view names the earlier turns so their floors carry their text.
  async function castLinesFor(sessionId, turns) {
    const last = Math.max(...turns)
    const chat = await readRoundView(sessionId, last, turns.filter(turn => turn !== last))
    const display = await replyDisplayForChat(chat, await readChatCard(chat), true)
    return new Map(turns.map(turn => [turn, bubbleCastLines(display.projections.find(row => row.turn === turn)?.body)]))
  }
  async function readCast(sessionId, turn) {
    const material = await pluginTurns.readTurn(sessionId, turn)
    const lines = material ? (await castLinesFor(material.sessionId, [material.turn])).get(material.turn) : []
    return lines.length ? { turn: material.turn, textVersion: material.key, lines } : null
  }
  // A settled or edited reply: its lines came with its text, so tell plugins they are there.
  async function announceCast(sessionId) {
    const material = await pluginTurns.readLatestSettledTurn(sessionId)
    const cast = material && !material.greeting ? await readCast(material.sessionId, material.turn) : null
    if (cast) pluginApi.castAnnotated(material.sessionId, cast)
  }
  // The stage reads the latest turns as plain text, with their spoken lines and the card's cast.
  async function castStage(sessionId, count) {
    const card = await castCardOf(sessionId)
    // At most ten turns: the latest floors hold them.
    const state = await recentStateForSession(str(sessionId), RECENT_FLOORS) || await sessionStateForSession(str(sessionId))
    const storyTurns = [...new Set((state?.messages || []).filter(message => message?.role === 'assistant').map(message => Number(message.turn || (message.greeting ? 1 : 0))).filter(turn => turn > 0))]
    const wanted = storyTurns.slice(-Math.max(1, Math.min(10, Number(count) || 5)))
    const turns = []
    for (const turn of wanted) {
      const material = await pluginTurns.readTurn(str(sessionId), turn).catch(() => null) || (turn === wanted.at(-1) ? await pluginTurns.readPendingTurn(str(sessionId)).catch(() => null) : null)
      if (material && material.turn === turn) turns.push({ turn, text: material.text })
    }
    const lines = turns.length ? await castLinesFor(str(sessionId), turns.map(item => item.turn)) : new Map()
    for (const item of turns) item.lines = lines.get(item.turn)
    const manifest = await castAssets.read(card.path)
    const background = (manifest.backgrounds || [])[0]
    // Whether this card's games show the stage: the player's 舞台 switch, for a card with bound packs.
    return { enabled: (await dialogueBubbles.read(card.path).catch(() => null))?.stage?.enabled === true, player: card.player, card: { name: card.name, imageUrl: '/api/dsh-tavern/card-image?path=' + encodeURIComponent(card.path) },
      background: background ? '/api/dsh-tavern/cast-asset?' + new URLSearchParams({ card: castAssets.keyOf(card.path), file: background.file }).toString() : '',
      cast: await castView(sessionId, card.path, manifest), turns }
  }
  // One line in its speaker's voice: its 配音来源 (cast-presentation.md 22/N), else the chosen channel; { skip } when voicing is
  // off or narration is silent.
  async function speakLine(sessionId, { speaker, text, emotion, narration } = {}) {
    const current = await speech.active()
    if (!current) return { skip: true, reason: 'off' }
    const card = await castCardOf(str(sessionId)).catch(() => null)
    const name = str(speaker).trim()
    const character = card && name ? (await castAssets.read(card.path)).characters.find(item => item.name === name || (item.aliases || []).includes(name)) : null
    const channel = narration === true ? current : await speech.channelFor({ character, current })
    const voice = speech.voiceFor({ character, provider: channel.provider, config: channel.config, narration: narration === true })
    if (voice === null) return { skip: true, reason: 'narration' }
    // A clone sends the character's own clips inline (cast-presentation.md 22/N).
    const references = speech.referencesFor({ character, provider: channel.provider, narration: narration === true })
    return speechReply(await speech.synthesize({ provider: channel.provider.id, text, voice, emotion, gameId: str(sessionId), speaker: name, narration: narration === true,
      ...(references.length ? { references, readReference: file => castAssets.readFile(card.path, file) } : {}) }))
  }
  // The stage opening with 配音 on: the voices its cast speaks with on the channel in use, readied when the service offers it
  // (cast-presentation.md 21/N). Never awaited by a line; a voice that fails to warm is still said when its line comes.
  async function prepareVoices(sessionId) {
    const current = await speech.active()
    if (!current?.provider.prepare) return { prepared: 0 }
    const card = await castCardOf(str(sessionId)).catch(() => null)
    const characters = card ? (await castAssets.read(card.path)).characters : []
    // Only who speaks with this channel's voices: a clone (its own inline clips) has no reference_id to warm.
    const voices = new Set([...characters.filter(character => (character.voiceSource?.provider || current.provider.id) === current.provider.id && !character.voiceSource?.clone)
      .map(character => speech.voiceFor({ character, ...current })), current.config.narratorVoice].filter(Boolean))
    let prepared = 0
    for (const voice of voices) if (await speech.prepare({ voice }).catch(() => false)) prepared++
    return { prepared }
  }
  function speechReply(result) {
    return result.browser ? result : { url: '/api/dsh-tavern/speech-audio?id=' + result.id, mediaType: result.mediaType }
  }
  // The asset packs this game's card carries, with the base address of their files.
  async function cardPacksOf(sessionId) {
    const card = await castCardOf(str(sessionId))
    return ((await castAssets.read(card.path)).packs || []).map(pack => ({ ...pack,
      baseUrl: '/api/dsh-tavern/pack-file?' + new URLSearchParams({ pack: pack.id, v: pack.contentHash }).toString() + '&path=' }))
  }
  // A card's cast or packs changed outside the stage page: games of that card re-read them.
  async function castAssetsChanged(cardPath) {
    for (const item of await conversationRegistry.list().catch(() => [])) {
      if (item && item.cardPath === cardPath && item.sessionId) sessionSignals.publish(item.sessionId, { kind: 'cast', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
    }
  }
  async function castEdit(sessionId, edit) {
    const card = await castCardOf(sessionId)
    const result = await edit(card.path, card)
    const manifest = result?.cast || result
    return { ...(result?.cast ? { imported: result.imported, skipped: result.skipped, characters: result.characters } : {}), cast: await castView(sessionId, card.path, manifest) }
  }
  // ---------- 插件接口：读人物卡与历史、改变量、后台任务（docs/plugin-api.md） ----------
  const pluginStoryTurn = message => Number(message?.turn || (message?.greeting ? 1 : 0))
  const pluginSource = message => str(message?.projectionText ?? message?.sourceText ?? message?.text)
  async function readPluginCard(sessionId) {
    const header = await chatHeaderForSession(sessionId, ['cardPath', 'cardName', 'cardDefinitionSnapshot'])
    return header ? await readChatCard(header) : null
  }
  async function readPluginHistory(sessionId, first, last) {
    const state = await sessionStateForSession(sessionId)
    const rows = Array.isArray(state?.messages) ? state.messages : []
    let latest = 0
    for (const row of rows) if (row?.role === 'assistant') latest = Math.max(latest, pluginStoryTurn(row))
    // The latest turn joins once its settlement is over, like getTurn.
    const cap = (await pluginTurns.readLatestSettledTurn(sessionId))?.turn ?? latest - 1
    const picks = []
    rows.forEach((row, index) => {
      const turn = row?.role === 'assistant' ? pluginStoryTurn(row) : 0
      if (turn < first || turn > Math.min(last, cap)) return
      let input = -1
      for (let back = index - 1; back >= 0 && rows[back]?.role !== 'assistant'; back--) if (rows[back]?.role === 'user') { input = back; break }
      picks.push({ turn, index, input })
    })
    if (!picks.length) return []
    const indices = [...new Set(picks.flatMap(pick => pick.input >= 0 ? [pick.input, pick.index] : [pick.index]))]
    const selected = await chatSliceForSession(sessionId, indices, ['macroState'])
    const byIndex = selected?.chat?.messages ? new Map(indices.map((index, at) => [index, selected.chat.messages[at]]))
      : new Map(((await chatForSession(sessionId))?.messages || []).map((row, index) => [index, row]))
    const macroState = selected?.chat?.macroState
    return picks.map(pick => {
      const row = byIndex.get(pick.index), source = pluginSource(row)
      return { turn: pick.turn, input: pick.input >= 0 ? str(byIndex.get(pick.input)?.sourceText ?? byIndex.get(pick.input)?.text) : '',
        text: projectedSceneText(source, macroState), rawText: source }
    })
  }
  const writePluginVariables = createPluginVariableWriter({
    readState: sessionStateForSession,
    readSlice: chatSliceForSession,
    activity: state => backgroundTasks.activity(state),
    generating: sessionId => agentRegistry.get(sessionId)?.phase?.kind === 'running',
    currentKey: (sessionId, turn) => pluginTurns.currentKey(sessionId, turn),
    patch: patchChat
  })
  // A plugin's one-off task: a fresh background Session, never the resident one settlement uses.
  // A member with a prefix of its own (`system`): that prefix, and the prompt as the task's one
  // message; the plugin hands it whatever story it needs.
  async function runPluginTask({ gameId, owner, prompt, tools, call, signal, member = '', system }) {
    const selection = backgroundModelSelection(await backgroundConfigForSession(gameId))
    if (!selection) throw new Error('这局没有可用的后台模型')
    const chat = await storyContext({ sessionId: gameId })
    const recent = (chat?.messages || []).filter(message => message && !message.greeting && ['user', 'assistant'].includes(message.role)).slice(-2)
      .map(message => ({ role: message.role, content: [{ type: 'text', text: pluginSource(message).slice(-2400) }] }))
    // With a plugin member, its resident Session (one per game) instead of a fresh one.
    const own = system !== undefined ? { ownPrefix: true, system, taskText: prompt, messages: [] } : { system: prompt, messages: recent }
    return await backgroundAgentRunner.run({ task: 'plugin', pluginName: owner, member, persistent: Boolean(member), sessionId: gameId, selection, signal,
      turn: Number(chat?.messages?.at(-1)?.turn) || 0, ...own, tools, maxToolCalls: 16,
      onToolCall: request => call(request.name, typeof request.arguments === 'string' ? JSON.parse(request.arguments || '{}') : request.arguments) })
  }
  const pluginApi = createTavernPluginApi({
    ctx,get modHost() {return ctx.get('tavernManagedModules')},
    logger: console,
    storyEvents,
    workflow,
    // A plugin's settings changed in a game: its page side re-reads them (tavernUi.watchGameSettings).
    settingsChanged: (gameId, plugin) => sessionSignals.publish(gameId, { kind: 'plugin-settings', version: plugin + ':' + Date.now() + ':' + Math.random().toString(36).slice(2) }),
    // A plugin published new state for its page side (tavernUi.watchState re-reads it).
    publishState: (gameId, plugin, name) => sessionSignals.publish(gameId, { kind: 'plugin-state:' + plugin + ':' + name, version: Date.now() + ':' + Math.random().toString(36).slice(2) }),
    reservedToolNames: [...BACKGROUND_TOOLS, HISTORY_RECALL_TOOL].map(tool => tool?.name).concat(['style_reference_submit', STORY_SUBMIT_TOOL_NAME, 'character_design_finish', 'worldbook_search', 'web_search', 'web_fetch', 'skill']).filter(Boolean),
    media: pluginMedia,
    data: pluginData,
    pluginData: pluginDataStore,
    ...pluginTurns,
    backgroundModel: async sessionId => backgroundModelSelection(await backgroundConfigForSession(sessionId)),
    readCard: readPluginCard,
    readCharacterDesigns: async sessionId => projectCharacterDesignDocument((await chatForSession(sessionId))?.characterDesignDocument),
    saveCharacterDesign: async (sessionId, input) => {
      const chat = await chatForSession(sessionId)
      if (!chat) throw Object.assign(new Error('这一局不存在'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return JSON.parse(await characterDesignDocuments.execute(chat.id, { name: CHARACTER_DESIGN_SAVE_TOOL.name, arguments: input }))
    },
    listCards,
    readCardRaw: async card => {
      const cardPath = normalizeResourcePath(card, 'card')
      const workspace = await readCardWorkspace(cardPath)
      return workspace === undefined ? null : cardPreparation.present({ card: workspace, as: 'raw' })
    },
    updateCardRaw: async (card, operations, owner, options = {}) => {
      const cardPath = normalizeResourcePath(card, 'card')
      if (await readCardWorkspace(cardPath) === undefined) throw Object.assign(new Error('人物卡不存在：' + card), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      const changed = (await updateCard(cardPath, {}, { ts: Date.now(), summary: '插件 ' + owner + ' 修改' }, operations, options)).changed === true
      return { changed, revision: await cardProjectionRevision(cardPath) }
    },
    // Plugins writing a card's cast and packs: the same store and checks as the player's stage page.
    editCast: async (card, change) => {
      const cardPath = normalizeResourcePath(card, 'card')
      if (await readCardWorkspace(cardPath) === undefined) throw Object.assign(new Error('人物卡不存在：' + card), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      await change(castAssets, cardPath)
      await castAssetsChanged(cardPath)
    },
    saveCardPack: async (card, { id, format, title, files }) => {
      const cardPath = normalizeResourcePath(card, 'card')
      if (await readCardWorkspace(cardPath) === undefined) throw Object.assign(new Error('人物卡不存在：' + card), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      const { pack } = await assetPacks.importFiles(files, { id, format, title })
      const current = (await castAssets.read(cardPath)).packs || []
      await castAssets.bindPacks(cardPath, current.filter(item => item.id !== pack.id).concat([{ id: pack.id, contentHash: pack.contentHash, format: pack.format, title: pack.title, name: '' }]))
      await castAssetsChanged(cardPath)
      return { id: pack.id, contentHash: pack.contentHash }
    },
    removeCardPack: async (card, id) => {
      const cardPath = normalizeResourcePath(card, 'card')
      const current = (await castAssets.read(cardPath)).packs || []
      if (!current.some(item => item.id === id)) return false
      await castAssets.bindPacks(cardPath, current.filter(item => item.id !== id))
      await castAssetsChanged(cardPath)
      return true
    },
    cardRevision: async card => {
      const cardPath = normalizeResourcePath(card, 'card')
      if (await readCardWorkspace(cardPath) === undefined) throw Object.assign(new Error('人物卡不存在：' + card), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return await cardProjectionRevision(cardPath)
    },
    // Tavern decides where its own tools show; a plugin may only scope the tools it registered.
    isControlledTool: name => controlledToolNames.has(name),
    skills: tavernSkills,
    addSkillRoot: addPluginSkillRoot,
    worldbookStrategies,
    worldbookStrategyEntries: input => input.worldBook || playWorldBook(input.chat, input.card),
    projectWorldbookSelection: (input, refs) => projectBuiltinWorldbook({ ...input,
      selectedRefs: refs || [] }),
    readCardImage: async sessionId => {
      const header = await chatHeaderForSession(sessionId, ['cardPath'])
      const cardPath = str(header?.cardPath)
      if (!cardPath || !await fileResources.hasCardImage(cardPath).catch(() => false)) return null
      return { url: '/api/dsh-tavern/card-image?path=' + encodeURIComponent(cardPath), mediaType: 'image/png' }
    },
    readHistory: readPluginHistory,
    readCast,
    readRequestContext: async (sessionId, turn) => foregroundRequestContext(await chatHeaderForSession(sessionId, ['foregroundFrames', 'timeline']), turn),
    listCardPacks: sessionId => cardPacksOf(sessionId),
    cardScope: () => cardPlugins.scope(),
    cardPathOf: async sessionId => str((await chatHeaderForSession(str(sessionId), ['cardPath']))?.cardPath) || null,
    readCardPackFile: async (sessionId, packId, file) => {
      const pack = (await cardPacksOf(sessionId)).find(item => item.id === packId)
      const found = pack ? await assetPacks.file(pack.id, pack.contentHash, file) : undefined
      if (!found) throw Object.assign(new Error('素材包里没有这个文件：' + file), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return { data: await readFile(found.path), mediaType: found.mediaType, size: found.size }
    },
    synthesizeSpeech: (sessionId, line) => speakLine(sessionId, line),
    readCastAssets: async sessionId => {
      const card = await castCardOf(sessionId)
      return { player: card.player, card: { name: card.name, imageUrl: '/api/dsh-tavern/card-image?path=' + encodeURIComponent(card.path) },
        characters: await castView(sessionId, card.path, await castAssets.read(card.path)) }
    },
    readActivity: async sessionId => {
      const chat = await taskStateReader.forSession(sessionId)
      const activity = chat ? backgroundTasks.activity(chat) : null
      return { generating: agentRegistry.get(str(sessionId))?.phase?.kind === 'running',
        settling: !!activity && (activity.busy === true || activity.phase === 'pending') }
    },
    writeVariables: writePluginVariables,
    editText: async (material, text) => {
      await bodyEditor.replaceText(material.sessionId, text)
      notifyPluginTimeline(material.sessionId, 'edit', { settled: true })
    },
    runTask: runPluginTask,
    startManualTask: ({ gameId, key, input }) => startPluginTask(gameId, key, input),
    publish: sessionId => sessionSignals.publish(sessionId, { kind: 'plugin-media', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
  })
  ctx.provide('tavern', pluginApi.service)
  cardRevisionListeners.add((cardPath, revision) => pluginApi.cardChanged(cardPath, revision))
  // Tell plugins the story line changed (informational: their turn data follows text versions
  // by itself). After an edit or an undone rollback the visible version may be new to them.
  function notifyPluginTimeline(sessionId, kind, { turn, settled = false } = {}) {
    const id = str(sessionId)
    if (!id) return
    pluginApi.timelineChanged(id, { kind, turn })
    storyEvents.emit('story-rewound', { sessionId: id, kind, turn })
    if (!settled) return
    void pluginApi.turnSettled(id).catch(error => console.warn('dsh-tavern: 插件轮次通知失败:', str(error?.message || error)))
    void announceCast(id).catch(error => console.warn('dsh-tavern: 台词通知失败', str(error?.message || error)))
  }
  const { readPluginMediaFile, removePluginMediaVersion, pluginMediaTurns, pluginMediaForTurn, pluginGalleryItems, removePluginGalleryItems } =
    createPluginMediaViews({ pluginMedia, pluginTurns, sessionSignals, attachments: () => ctx.get('attachments'), mediaRemoved: pluginApi.mediaRemoved })
  const backgroundTasks = createBackgroundTaskCoordinator({
    presentationActivity: chat => presentationObservers.activity(chat),
    store: { readChat, writeChat, updateChat, patchChat, readState: chatPersistence.readSessionState, readRecoveryState: taskStateReader.read, readSlice: chatPersistence.readSlice, readSettlementCheckpoint: chatPersistence.readSettlementCheckpoint },
    timeline: storyTimeline,
    blocked: function (chat) { return Boolean(autoCompaction?.blocked(chat)) },
    discarded: target => backgroundAgentRunner.discardRun(target),
    lockEvent: event => backgroundAgentRunner.noteLock(event)
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
      // An unknown window still merges old volumes eventually rather than letting them grow without end.
      // DSH_TAVERN_STORY_VOLUME_BUDGET (tokens) overrides it, to test the merge on a large-window model.
      volumeBudget: Number(process.env.DSH_TAVERN_STORY_VOLUME_BUDGET) > 0 ? Number(process.env.DSH_TAVERN_STORY_VOLUME_BUDGET)
        : Number.isFinite(window) && window > 0 ? Math.floor(window * STORY_VOLUMES_WINDOW_SHARE) : 30000,
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
    // The compaction engine comes from the preset and needs a model: resume as DSH's session controller does.
    const selection = agentDefaultModel?.currentSelection?.() || {}
    const handle = await agentRegistry.resume({ resumeSessionId: id, setup: tavernPresetSetup(),
      agentOptions: { provider: selection.provider, model: selection.model } })
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
    markBackground: (id, target, member = 'background') => updateChat(id, chat => {
      const participant = chat.timeline?.participants?.[member]
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
      if (background && background.task !== 'phone') {
        return compactBackgroundIfNeeded({
          trigger, forced, native: fallback,
          pressure: () => measureBackgroundBudget({
            agent: target, background, signal, llm: ctx.llm, meter: ctx.get('tokenMeter'),
            pending: pendingCompactionMessages.get(target) || []
          })
        })
      }
      const chat = await chatHeaderForSession(target.session.id, ['mode'])
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
      if (!background || background.task === 'phone') return
      const chat = await chatHeaderForSession(background.parentSessionId, [])
      if (!chat) throw new Error('后台压缩找不到所属对话')
      // The Session belongs to its task's member (书记 for a task without a timeline member).
      const member = TIMELINE_MEMBERS.includes(participantOf(background.task)) ? participantOf(background.task) : 'background'
      await updateChat(chat.id, current => {
        const participant = current.timeline?.participants?.[member]
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
    // Every model step asks: the header's mode answers it.
    const chat = background ? null : await chatHeaderForSession(id, [])
    // Keep historical turn frames byte-stable during normal generation. Retire
    // scaffolding only at an explicit compaction boundary, never before each step.
    if (background && background.task === 'phone') return next()
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
          if (chat) await updateChatHeader(chat.id, ['contextCompaction'], header => {
            header.contextCompaction = { ...header.contextCompaction, warning }
            return header
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
  async function nativeWorldBookTemplateContext(chat, card, options = {}) {
    let worldBook
    try {
      worldBook = await playWorldBook(chat, card)
    } catch (error) {
      console.warn('dsh-tavern: 动态世界书读取失败，已跳过:', str(error && error.message || error))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'worldbook-read-failed' }] }
    }
    if (!worldBook || !worldBook.view) return { context: '', refs: [], diagnostics: [] }
    return projectVirtualWorldbookPrefix(worldBook, chat, options)
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
      if (shouldRun) await queueSettlement(current.id)
      else await workflow.needs('candidate', current)
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
    prepareLegacy: sessionId => pullBackgroundCycle(sessionId)
  })
  // 自动生成候选项: fed by live turn ends only, submitting through candidateTasks like the button.
  const autoChoices = createAutoChoices({
    preferences: readTavernSettings,
    async read(sessionId) {
      const chat = await chatForSession(sessionId)
      const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      const turn = chat?.messages?.findLast(message => message?.role === 'assistant')?.turn
      return { chat, messageId: str(assistantResultForTurn(session, turn)?.event?.data?.message?.id) }
    },
    activity: chat => backgroundTasks.activity(chat),
    submit: args => candidateTasks.submit(args)
  })
  ctx.effect(() => () => autoChoices.dispose())
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
  // ---------- 后台结算 ----------
  const { playWorldBook, worldBookScanDepth, mvuUpdateRules } = createPlayWorldBook({ worldBooks, readChatCard, pluginApi, runtime: promptTemplateRuntime, globalVariables: readPromptTemplateGlobalVariables })
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
      ? normalizeChat(selected.chat)
      : synced === undefined ? await wholeReads.allow('本进程首次同步', () => chatForSession(sessionId)) : await chatForSession(sessionId)
    if (chat?._storageRevision !== undefined) surfaceSyncedRevisions.set(str(sessionId), chat._storageRevision)
    return chat
  }
  async function storyContext({ sessionId, chatId }) {
    const need = { storyRows: async header => (await worldBookScanDepth(header)) + 1, lastAssistant: true, lastVariables: true }
    const selected = chatId === undefined ? await boundedHistory.forSession(sessionId, need) : await boundedHistory.read(chatId, undefined, need)
    if (selected && ['story', 'script'].includes(selected.chat.mode || 'story') && selected.chat.requestMode !== 'sillytavern') return normalizeChat(selected.chat)
    return chatId === undefined ? chatForSession(sessionId) : readChat(chatId)
  }
  const mvuSettlementEngine = createMvuSettlementEngine({ mvuSettlement, mvuUpdateRules, backgroundModelSelection, postureItem, tavernScriptDispatch,
    pluginApi, readPendingTurn: gameId => pluginTurns.readPendingTurn(gameId) })
  const plainSettlementEngine = createPlainSettlementEngine({ pluginApi, pluginSettlementProgress, settlementItems, backgroundModelSelection, postureItem, backgroundAgentRunner, agentRegistry, sessionStore })
  const settlementRun = createSettlementRun({
    backgroundTasks, chatPersistence, readChat, writeChat, readChatCard, taskStateReader, worldBookScanDepth,
    mvuSettlementEngine, plainSettlementEngine, pluginApi, pluginSettlementProgress, agentRegistry, storyEvents
  })
  const { startPluginTask } = settlementRun
  function queueSettlement(chatId) {
    void presentationObservers.settlementQueued(chatId)
    return settlementJobs.start(chatId)
  }
  function cancelSettlement(chatId, options) { return settlementJobs.cancel(chatId, options) }
  const mvuSettlementReconciler = createMvuSettlementResume({
    conversationRegistry, taskStateReader, sessionStateForSession, backgroundTasks, tavernScriptDispatch, pageInFront, queueSettlement, storyEvents,
    get serverScripts() { return serverScripts }
  })
  ctx.effect(() => function () {
    mvuSettlementReconciler.dispose()
    settlementJobs.dispose()
  }, 'dsh-tavern: reconcile deferred MVU settlement')
  const { stopBackground, retrySettlement, pullBackgroundCycle } = createSettlementControls({
    chatForSession, readOpeningWindow, projectOpeningWindow, view, readChatCard, backgroundTasks, storyTimeline,
    patchChat, writeChat, queueSettlement, cancelSettlement, mvuSettlementEngine, pluginApi, backgroundAgentRunner
  })
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
    await updateIndex(current => ({ ...current,
      chats: (current.chats || []).map(row => row.id === chat.id ? { ...row, cardPath, cardName: card.name } : row)
    }))
    return { path: cardPath, card }
  }
  const foregroundFrameBuilder = createForegroundFrameBuilder()
  const foregroundFrameSessionAdapter = createForegroundFrameSessionAdapter({ id: randomUUID })
  const turnOrchestrator = createTurnOrchestrator({
    // Either direction needs submit_story declared: output to submit this turn,
    // input because the replayed history calls name that tool.
    storyToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
    storyInputToolCall: async () => (await readTavernSettings()).storyInputToolCall,
    modEnabled: (modId, cardPath) => cardPath ? ctx.get('tavernManagedModules')?.enabled({modId,cardPath}) ?? false : false,
    store: {
      chatForSession,
      storyContextForSession: sessionId => storyContext({ sessionId }),
      stateForSession: sessionStateForSession,
      headerForSession: chatHeaderForSession,
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
    // Beside this turn's input: the plugins' sections, then (文风联想 on) a short reminder to make the
    // style_reference_submit call first. The full instructions stay in the stable system prompt; the
    // reminder is what the model reads last, so the call is not skipped.
    pluginTurnContext: async input => {
      const sections = await Promise.resolve(pluginApi.turnContext(input)).catch(() => [])
      const header = await chatHeaderForSession(str(input.gameId), ['mode', 'backgroundTasks']).catch(() => null)
      if ((header?.mode || 'story') !== 'story' || header?.backgroundTasks?.styleReference !== true) return sections
      return [...(sections || []), { owner: 'dsh-tavern', name: 'style-reference', position: 'after',
        text: '【本轮先做文风联想】写正文之前，先按「前台文风联想」的要求调用 style_reference_submit，记下一段贴合本轮场景的范文；调用成功后再写本轮正文。' }]
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
    foregroundRosterAddendum: ({chat,userText}) => foregroundCapabilities.rosterAddendum(chat,{userText}),
    recordWorldbookRecall: worldbookRecallLog.record,
    resolvePresetRegexScripts: async chat => presetRegexScripts(chat),
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  const storyReconciliation = createStoryReconciliation({
    agentRegistry, sessionStore, chatForSession, chatSliceForSession, updateChat, turns: turnOrchestrator
  })
  const { reconcileStory, reconcileWhenIdle, repairNativeStory } = storyReconciliation
  // 任务表 (domain/background-tasks.js): every background task is declared there once; this
  // hands it the services its tasks run on.
  registerBackgroundTasks(workflow, { readTavernSettings, polishPrereview, announceCast,
    gameTitles, saveMaintenance, pluginApi, candidateWorldbookPreparation, backgroundTasks, queueSettlement, settlementJobs, settlementRun })
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    store: { chatForSession, readChat, readState: taskStateReader.read, stateForSession: taskStateReader.forSession, openingStateForSession },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    replyCommitted: sessionId => storyEvents.emit('reply-committed', { sessionId }),
    turnDiscarded: (sessionId, turn) => storyEvents.emit('turn-discarded', { sessionId, turn }),
    cancelPresentation: sessionId => {void presentationObservers.cancelled(sessionId)},
    beforeNextTurn: chat => workflow.beforeNextTurn(chat),
    waitReconcile: storyReconciliation.waitReconcile,
    syncWorldBook: async function (chat) {
      if (!['story', 'script'].includes(chat.mode || 'story')) return
      try {
        // The opening-window slice carries only task fields. Adoption reads the header
        // (snapshot, card context) and the latest floor (its turn keys plugin world book
        // entries), never the history.
        const full = chat.openingWorldbookSnapshot ? chat : await chatHeaderWithLatestFloors(chat.sessionId)
        if (full) await playCardSnapshots.autoSync(full, undefined, { busy: false })
      } catch (error) { console.warn('dsh-tavern: 世界书自动更新失败，本轮沿用本局快照：', str(error && error.message || error)) }
    },
    clearFailedTurns: async function (sessionId) {
      const mode = await turnOrchestrator.modeFor(sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      // A failed tail sits after the save's latest round, and the walk stops there: the
      // header and the latest floors (that round's input and reply) are all it reads.
      const chat = session && await chatHeaderWithLatestFloors(sessionId, 3)
      if (!chat) return 0
      const availability = rollbackAvailability(chat, { events: sessionEvents(session), nodes: session.surface?.nodes || [] })
      let cleared = 0
      // A turn the server stopped in the middle never ended, so nothing cleaned it up.
      const turns = new Set([...(availability.unclearedTurns || []), ...interruptedSurfaceTurns({ events: sessionEvents(session), nodes: session.surface?.nodes || [] })])
      for (const turn of turns) cleared += clearFailedTurnSurface({ session, turn })
      if (cleared) {
        await sessionStore.flush(session)
        const clearedTurns = [...turns]
        await updateChat(chat.id, current => {
          if (!current || !current.userInputEdits || typeof current.userInputEdits !== 'object') return undefined
          const next = { ...current.userInputEdits }
          let changed = false
          for (const turn of clearedTurns) {
            if (!Object.hasOwn(next, String(turn))) continue
            delete next[String(turn)]
            changed = true
          }
          if (!changed) return undefined
          current.userInputEdits = next
          return current
        }, { source: 'failed-turn.cleanup' })
      }
      else if (!availability.canRollback && availability.reason && /失败回合/.test(availability.reason)) console.warn('dsh-tavern: 上一次失败回合的残留无法清理，本轮请求可能带上它:', availability.reason)
      return cleared
    },
    cleanupFailedTurn: async function (input) {
      // Keep the failed turn (input and output) on the surface until the player
      // retries, withdraws or sends a new message. That keeps the input available
      // for an in-place edit; the next action clears the whole failed turn first.
      const mode = await turnOrchestrator.modeFor(input.sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      return 0
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
  async function recoverRuntimeHistory(recoveredIndex, startedBefore) {
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
    // Runs after the service is ready: work started since startup belongs to this process and is left alone.
    await foregroundHandoff.recover(activeChatIds, { startedBefore })
    await candidateTasks.recover(activeChatIds, { startedBefore })
    // Recovery must first convert durable running operations back to pending.
    void mvuSettlementReconciler.scan()
  }
  // ---------- 重新生成正文（生成即替换，无确认） ----------
  const { regenerate: regenBody, replayFailed: replayFailedTurn, recover: recoverRegeneration, rollback: rollbackTurn, rollbackTo: rollbackToTurn, interrupt: interruptTurn, undoRollback: undoRollbackTurn } = createRoundHistory({
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
    replyCommitted: sessionId => storyEvents.emit('reply-committed', { sessionId }),
    cancelSettlement,
    present: presentStory,
    sessionPatch,
    repairNative: (sessionId, session) => repairNativeStory(sessionId, session, '回退或重新生成时找不到原生位置'),
  })

  const bodyEditor = createBodyEditor({
    chats: { forSession: hookChatForSession, update: updateChat, patch: patchChat },
    sessions: { get: id => ctx.get('agents')?.get(id), flush: session => sessionStore.flush(session) },
    timeline: storyTimeline,
    activity: chat => backgroundTasks.activity(chat),
    project: async (text, chat) => {
      const extensions = await readCardExtensions(chat.cardPath, chat)
      return projectRuntimeReply(text, { charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(extensions, chat.runtimePresetSnapshot?.regexScripts, chat?.regexOverrides?.preset), placement: 2, isEdit: false, depth: 0 })
    },
    present: presentStory,
    sessionPatch,
    repairNative: (sessionId, session) => repairNativeStory(sessionId, session, '编辑正文时找不到原生位置'),
  })

  // 小组件变量、CG 图鉴、舞台计时器（stage-module.js）。
  stageRuntime.services({profileData, sessionSignals, conversationRegistry, tavernScriptDispatch, tavernScriptHostAdapter, readSessionMap, chatForSession, readRoundView, chatPersistence, storyTimeline, patchChat, cardStorage})

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args, authority) {
    performanceDiagnostics.browser(args?._performance)
    const started = performance.now()
    // A deleted game's card frames may still call in; do not recreate its diagnostics.
    try { return await requestPerformance.run(method, args?._traceId || args?.sessionId, () => deletedSessionIds.has(args?.sessionId) ? dispatchMethod(method, args, authority, false) : apiDiagnostics.observe(method, args, () => dispatchMethod(method, args, authority, false))) }
    finally { performanceDiagnostics.record(method, performance.now() - started) }
  }
  const displayRuntimeCaptures = createDisplayRuntimeCoalescer({
    write: (sessionId, turn, partIndex, runtime) => captureDisplayRuntime(sessionId, turn, partIndex, runtime)
  })
  const gameplayApi = createGameplayApi({
    controller: () => ctx.get('sessionController'), registry: agentRegistry, llm, dataRoot,
    store: profileData, dispatch: (method, args) => dispatchMethod(method, args, undefined, false),
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

  const preparedSaveSessions = new Map((saveUpgradePreparation?.sessions || []).map(session => [session.id, session]))
  const saveUpgrade = createSaveUpgrade({
    store: chatJournalStore,
    inspectSessions: async chat => {
      if (sessionPatch.status !== 'ready') return { ready: false, error: 'DSH 会话兼容模块未就绪，请重启酒馆后重试' }
      const failed = await unreadySaveSessions(saveSessionIds(chat), {
        live: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
        stored: id => storedSessionVersion(path.join(path.dirname(resolveTavernDataRoot()), 'sessions'), id),
        prepared: id => preparedSaveSessions.get(id),
      })
      // A log the upgrader refused fails the same way on every restart; only a skipped one waits for it.
      const refused = failed.filter(id => preparedSaveSessions.get(id)?.error)
      const reasons = ids => ids.map(id => id + '（' + preparedSaveSessions.get(id).error + '）').join('、')
      if (!failed.length) return { ready: true, version: 4 }
      if (refused.length !== failed.length) return { ready: false, error: '会话日志未完成升级，请重启酒馆后重试。原档保留：' + failed.join('、') }
      if (refused.includes(chat.sessionId)) return { ready: false, error: '会话日志无法升级，原档保留：' + reasons(refused) }
      return { ready: false, detachable: refused, error: '会话日志无法升级，原档保留：' + reasons(refused),
        warning: '本局有 ' + refused.length + ' 个后台或回退快照会话的旧日志无法升级，迁移时会跳过它们：剧情正文和变量不受影响；后台代理会换新会话，从当前剧情继续；上一次回退将不能撤销。原档保留。' }
    },
    detachSessions: (chatId, ids) => updateChat(chatId, chat => detachSaveSessions(chat, ids), { source: 'save-upgrade.detach-sessions' }),
    assertIdle: chat => {
      if (chat.mode === 'card' || backgroundTasks.activity(chat).busy || chat.regenInProgress || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running') {
        throw new Error('请等待本轮游玩和后台结算完成后再升级')
      }
    },
    notify: id => { void readSessionMap().then(map => {
      for (const [sessionId, chatId] of Object.entries(map)) if (chatId === id) sessionSignals.publish(sessionId, {kind:'tavern-state',version:'save-upgrade:'+Date.now()})
    }).catch(error => console.warn('dsh-tavern: 存档升级通知失败:', error.message)) }
  })
  ctx.effect(() => () => saveUpgrade.dispose())

  const conversationBackgroundSettings = createConversationBackgroundSettings({
    worldbookStrategies,
    readConfig: backgroundConfigForSession, readChat: chatForSession, updateChat,
    modelCatalog: tavernModelCatalog, modelReasoning: selection => readBackgroundModelReasoning(llm, selection),
    isPlayMode: mode => groupOfMode(mode) === 'play',
    presentExtras: chat => ({ modModels: chat.modModels || {} }),
    readExtras: async () => ({ modModelSlots: await slotDeclarations(), scoringCatalog: scoringCatalog() }),
    validatePatch: async args => { if (args.modModelSelection) await checkSlotSelection(args.modModelSelection) },
    extraTools: async sessionId => {
      const cached = foregroundExtraTools.get(String(sessionId))
      if (cached) return cached
      // Before this game's first request (or after a restart) fall back to the
      // host registry: plugin tools that opted into play, plus any other
      // non-Tavern tool currently registered.
      try {
        return (typeof ctx.tools?.schemas === 'function' ? ctx.tools.schemas() : [])
          .filter(tool => tool && typeof tool.name === 'string' && !controlledToolNames.has(tool.name))
          .filter(tool => { const modes = pluginApi.toolModesFor(tool.name); return !modes || modes.includes('play') })
          .map(extraToolEntry)
          .sort((left, right) => left.name.localeCompare(right.name))
      } catch { return [] }
    },
  })


  // Request handlers by area live in rpc/; bindings assigned later are read through getters.
  const rpcDeps = { frameStorage, worldbookSkillProvider, sessionDebugEvidence, TAVERN_PACKAGE_VERSION, agentCompaction, agentRegistry, appendStoryRounds,
    applicationUpdater, autoChoices, attachPlayChatDebug, backgroundAgentRunner, backgroundCatalog, storyEvents, workflow,
    backgroundConfigForSession, bindScript, bodyEditor, branchOrigin, callModel, candidateGenerator, candidateTasks, polishPrereview, polishRecords, polishReviewer, chatHeaderWithLatestFloors, applyCardUpdate, cardAutoReload,
    cardMemory, cardOrganization, cardPacksOf, cardPlugins, cardPreparation, cardSummaries, cardTaskPrompts, castAssets,
    castCardOf, castEdit, castStage, castView, chatForSession, chatHeaderForSession,
    chatHistoryImporter, chatPersistence, commands, compactionAbort, compatibilityDiagnostics,
    conversationBackgroundSettings, conversationGuides, ctx, dataRoot, deleteCard, deleteChat, deleteChats,
    deletePreset, deleteResource, deleteScript, displayRuntimeCaptures, ensureNativeCardWorkspace,
    ensureNativeOpening, exportConversation, exportGameSave, exportSettingsBundle, exportTavernLogs,
    fileResources, forkChat, fullTemplateRuntime, getCardOpenings, groupOfMode, guideLibrary,
    helperGenerationPreset, helperGenerationTasks, helperHistoryAccess, hostCompatibility, importCard,
    importCardArchiveFile, importChatHistoryText, importGameSave, importPluginCardFile, importPreset,
    importScript, importSettingsBundle, importSource, ledgerEditor, listCards, listTavernResources,
    listTavernSessions, liveCardUpdate, llm, manualCharacterDesign, manualLedger, mobileCardImport,
    modelRequestLog, mvuDiagnostics, notifyPluginTimeline, openingPreparation, pagesInFront,
    playCardSnapshots, pluginApi, pluginDataStore, pluginGalleryItems, pluginMediaForTurn, pluginMediaTurns,
    pluginSettlementProgress, prepareConversationFork, preparedSaveSessions, presentSystemPrompts, promptDocuments, transferExports,
    presentUserPreferenceProfile, presetLibrary, previewPreset, profileData, projectOpeningWindow,
    readBackgroundSuppression, readCard, readCardExtensions, readCardExtensionSources, readCardWorkspace, readChat, readChatCard,
    readOpeningWindow, readRawTavernSettings, readScript, readSessionMap, readTavernSettings, reconcileStory, reconcileWhenIdle,
    regenBody, regexLibrary, regexManager, removePluginGalleryItems, removePluginMediaVersion, renameResource,
    replayFailedTurn, requestPerformance, retrySettlement, retryStyleReference, rollbackTurn, rollbackToTurn,
    runtimeGeneration, runtimePresets, runtimePrompt, saveUpgrade, scriptContinuity,
    scriptNavigation, sessionActivity, sessionInventory, sessionOperation, sessionPatch,
    sessionStateForSession, sessionStore, sessionView, sessionViews, setCardPlugins, setPlayerName,
    skillImportFiles, sleep, speakLine, speech, speechReply, startChat, startPluginTask, stopBackground, str,
    tavernModelCatalog, tavernScriptHostAdapter, tavernSkills, templateHistoryFrom, undoRollbackTurn,
    updateCard, updateChat, updateTavernSettings, uploads, userPluginInstaller, userPreferenceProfile, view,
    withCompactionSession, worldBooks, worldbookRecallLog,
    get autoCompaction() { return autoCompaction },
    get conversationRegistry() { return conversationRegistry },
    get invalidateTavernSkills() { return invalidateTavernSkills },
    get serverScripts() { return serverScripts } }
  Object.defineProperties(rpcDeps, {
    DEFAULT_BUBBLE_TEMPLATE: { get: () => DEFAULT_BUBBLE_TEMPLATE },
    STAGE_PLAYBACK_FIELD: { get: () => STAGE_PLAYBACK_FIELD },
    STAGE_TIMER_FIELD: { get: () => STAGE_TIMER_FIELD },
    activeRoundBodies: { get: () => activeRoundBodies },
    activeTurnOf: { get: () => activeTurnOf },
    addStageMeasurement: { get: () => addStageMeasurement },
    agentRegistry: { get: () => agentRegistry },
    assetGeneration: { get: () => assetGeneration },
    assetGenerationResult: { get: () => assetGenerationResult },
    autoCompaction: { get: () => autoCompaction },
    backgroundAgentRunner: { get: () => backgroundAgentRunner },
    backgroundTasks: { get: () => backgroundTasks },
    bodyEditor: { get: () => bodyEditor },
    bubbleInjection: { get: () => bubbleInjection },
    bubbleInstructionPreview: { get: () => bubbleInstructionPreview },
    candidateTasks: { get: () => candidateTasks },
    cardPreparation: { get: () => cardPreparation },
    cardScripts: { get: () => cardScripts },
    resolveCardId: { get: () => cardStorage.resolve },
    cardZipTargets: { get: () => cardZipTargets },
    chatForSession: { get: () => chatForSession },
    chatPersistence: { get: () => chatPersistence },
    checkSlotSelection: { get: () => checkSlotSelection },
    compactionAbort: { get: () => compactionAbort },
    configureAgentCompaction: { get: () => configureAgentCompaction },
    deletedChatIds: { get: () => deletedChatIds },
    deploymentActivity: { get: () => deploymentActivity },
    deploymentWork: { get: () => deploymentWork },
    describeOpeningScenes: { get: () => describeOpeningScenes },
    dialogueBubblePresets: { get: () => dialogueBubblePresets },
    dialogueBubbles: { get: () => dialogueBubbles },
    duplicateCard: { get: () => duplicateCard },
    fileResources: { get: () => fileResources },
    foregroundCapabilities: { get: () => foregroundCapabilities },
    autoChoices: { get: () => autoChoices },
    hasCardAssetBindings: { get: () => hasCardAssetBindings },
    importPreset: { get: () => importPreset },
    importSpineRuntime: { get: () => importSpineRuntime },
    interruptTurn: { get: () => interruptTurn },
    listTavernSessions: { get: () => listTavernSessions },
    modelSelection: { get: () => modelSelection },
    normalizeBubbleConfig: { get: () => normalizeBubbleConfig },
    normalizeResourcePath: { get: () => normalizeResourcePath },
    notifyPluginTimeline: { get: () => notifyPluginTimeline },
    patchStagePlayback: { get: () => patchStagePlayback },
    path: { get: () => path },
    pluginApi: { get: () => pluginApi },
    pluginSettlementProgress: { get: () => pluginSettlementProgress },
    rawUpdateChat: { get: () => rawUpdateChat },
    readAudienceCorpus: { get: () => readAudienceCorpus },
    readCardExtensions: { get: () => readCardExtensions },
    readCardWorkspace: { get: () => readCardWorkspace },
    readChatCard: { get: () => readChatCard },
    readDialogueBubblePlacement: { get: () => readDialogueBubblePlacement },
    readStageChat: { get: () => readStageChat },
    readRoundView: { get: () => readRoundView },
    readRoundOps: { get: () => readRoundOps },
    readStageProjection: { get: () => readStageProjection },
    readTavernSettings: { get: () => readTavernSettings },
    readWidgetWindowProjection: { get: () => readWidgetWindowProjection },
    reconcileStory: { get: () => reconcileStory },
    regenBody: { get: () => regenBody },
    replyDisplayForChat: { get: () => replyDisplayForChat },
    requestPerformance: { get: () => requestPerformance },
    retryStyleReference: { get: () => retryStyleReference },
    rollbackTurn: { get: () => rollbackTurn },
    saveStagePlayback: { get: () => saveStagePlayback },
    slotDeclarations: { get: () => slotDeclarations },
    scoringCatalog: { get: () => scoringCatalog },
    modelSelectionChanged: { get: () => () => presentationObservers.modelChanged() },
    speech: { get: () => speech },
    spineRuntimeAvailable: { get: () => spineRuntimeAvailable },
    spineRuntimeStatus: { get: () => spineRuntimeStatus },
    stageModHistoryTurns: { get: () => stageModHistoryTurns },
    str: { get: () => str },
    taskStateReader: { get: () => taskStateReader },
    tavernModelCatalog: { get: () => tavernModelCatalog },
    updateCard: { get: () => updateCard },
    updateTavernSettings: { get: () => updateTavernSettings },
    view: { get: () => view },
    withCompactionSession: { get: () => withCompactionSession },
    withoutPlayerChoices: { get: () => withoutPlayerChoices },
    worldBooks: { get: () => worldBooks }
  })
  const rpcHandlers = Object.assign(Object.create(null),
    createMaintenanceHandlers(rpcDeps),
    createCardHandlers(rpcDeps),
    createTemplateHandlers(rpcDeps),
    createOpeningHandlers(rpcDeps),
    createResourceHandlers(rpcDeps),
    createWorldbookInspectorHandlers(rpcDeps),
    createRegexHandlers(rpcDeps),
    createMediaHandlers(rpcDeps),
    createSettingsHandlers(rpcDeps),
    createPluginHandlers(rpcDeps),
    createConversationHandlers(rpcDeps),
    createPlayHandlers(rpcDeps),
    createTransferHandlers(rpcDeps))
  rpcHandlers.getCardScripts = rpcHandlers.setCardScriptMuted
  const extensionRequests = createExtensionRequests({reserved:Object.keys(rpcHandlers)})
  stageRuntime.requests(rpcDeps, extensionRequests)
  ctx.provide('tavernStageControl',Object.freeze({enable:stageRuntime.enable,disable:stageRuntime.disable,status:stageRuntime.status}))
  ctx.effect(() => () => stageRuntime.dispose(), 'dsh-tavern: optional stage controller')

  async function dispatchMethod(method, args, authority, serverTemplate = false) {
    if (extensionRequests.handles(method)) return extensionRequests.call(method,args,authority,serverTemplate)
    if (method.startsWith('gameplay.')) return await gameplayApi.call(method.slice(9), args || {})
    const handler = rpcHandlers[method]
    if (!handler) throw new Error('未知方法: ' + method)
    return await handler(args, method, serverTemplate, authority)
  }

  async function coordinationVersion(sessionId) {
    const normalizedSessionId = str(sessionId)
    const links = await readSessionMap()
    const chatId = str(links && links[normalizedSessionId])
    const chatVersion = chatId === '' ? '' : await chatPersistence.version(chatId)
    const projectionVersion = await profileData.version('card-projection-revisions.json')
    return [runtimeGeneration, chatId, chatVersion, projectionVersion].join(':')
  }

  // An open game picks up an edit of its card file by itself. The page reads a game only on that
  // game's own events, and the automatic reload runs on such a read; an edit made while the game sits
  // idle (in the card workbench, the editor or the file) would otherwise wait for a page refresh.
  const watchedCardStamps = new Map()
  async function noticeCardEdit(sessionId) {
    const header = await chatHeaderForSession(sessionId, ['cardPath', 'mode', 'requestMode', 'settleStatus'])
    if (!header || !['story', 'script'].includes(header.mode || 'story') || header.requestMode === 'sillytavern' || str(header.cardPath) === '') return
    const stamp = (await fileResources.metadata(normalizeResourcePath(header.cardPath, 'card')).catch(() => null))?.updatedAt || 0
    const seen = watchedCardStamps.get(sessionId)
    if (seen === undefined) { watchedCardStamps.set(sessionId, stamp); return }
    if (seen === stamp) return
    // A busy game keeps the old stamp, so the edit is noticed again once it is idle.
    if ((await sessionActivity(sessionId))?.busy === true || ['pending', 'running', 'waiting-runtime'].includes(header.settleStatus)) return
    watchedCardStamps.set(sessionId, stamp)
    const chat = await chatForSession(sessionId)
    if (chat) await cardUpdateStatus(chat)
  }

  coordinationEvents = createCoordinationEventPublisher({
    readVersion: async function (sessionId) { return await coordinationVersion(sessionId) },
    onTick: noticeCardEdit,
    load: async function (sessionId) { return await candidateTasks.sync(sessionId, { kind: 'candidate' }) },
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    fallbackIntervalMs: 5000,
    onError(error) { console.warn('dsh-tavern: 协调文件读取失败，将继续重试:', str(error && error.message || error)) }
  })

  ctx.provide('tavernSessionSignals', Object.freeze({
    async control(method, args, signal) {
      const extensionRead = extensionRequests.remoteRead(method)
      if (!extensionRead && !['claimTavernScriptWork', 'startTavernScriptWork', 'getTavernScriptWorkState',
        'heartbeatTavernScriptRuntime', 'completeTavernHelperEvent', 'releaseTavernHelperRuntime'].includes(method)) {
        throw new Error('不支持的运行时控制请求')
      }
      signal?.throwIfAborted()
      // Only origin-independent reads join the authenticated Remote mux. Lease
      // projections retain HTTP's trusted origin; dispatch still owns all state.
      try {
        const result = await dispatch(method, args)
        return requestPerformance.serialize(method, args?.sessionId, { ok: true, ...result, runtimeGeneration })
      } catch (error) {
        if (!extensionRead) throw error
        return JSON.stringify({ok:false,error:str(error?.message || error),errorCode:typeof error?.code === 'string' ? error.code : undefined})
      }
    },
    async * follow(sessionIds, signal) {
      const ids = Array.from(new Set((Array.isArray(sessionIds) ? sessionIds : []).map(str).filter(Boolean)))
      const stops = ids.map(function (sessionId) { return coordinationEvents.watch(sessionId) })
      try {
        yield * sessionSignals.follow(signal, ids)
      } finally {
        stops.forEach(function (stop) { stop() })
        presentationObservers.disconnected(ids)
      }
    }
  }))

  registerTavernHttpRoutes({
    ctx,
    castAssets,
    speech,
    exportCardFile,
    assetPacks,
    uploads,
    transferExports,
    exposeHandler: handle => { tavernHttpHandle = handle },
    pluginAssets: createPluginAssets({ pluginsDir: userPluginPaths(dataRoot).plugins }),
    dispatch,
    fileResources,
    helperHistoryAccess,
    mobileCardImport,
    performanceDiagnostics,
    requestPerformance,
    runtimeGeneration,
    runtimeReadiness,
    readPluginMediaFile: (...args) => readPluginMediaFile(...args),
    sessionResources,
    str,
    tavernRemoteAssets,
    tavernStaticResources,
  })
  // A desktop host's chat view sits in a read-only app.asar: patch its answer step in the page.
  installChatAnswerBootPatch(ctx)
  // Card scripts run on the server by default; DSH_TAVERN_SERVER_SCRIPTS=0 leaves them to the page.
  if (process.env.DSH_TAVERN_SERVER_SCRIPTS !== '0') {
    serverScripts = createServerScriptExecutor({
      handle: (req, res) => tavernHttpHandle(req, res),
      // Keep the runtime through a whole settlement, not just one dispatched event.
      busy: async sessionId => {
        if (tavernScriptDispatch.status(sessionId)?.busy === true) return true
        // A reply still being written settles next: keep the runtime for it.
        if (agentRegistry.get(sessionId)?.phase?.kind === 'running') return true
        const state = await taskStateReader.forSession(sessionId).catch(() => null)
        const activity = state ? backgroundTasks.activity(state) : null
        return Boolean(activity && (activity.busy || activity.phase === 'pending' || activity.phase === 'running'))
      },
      subscribeSignals: (sessionId, listener) => sessionSignals.subscribe(sessionId, [], listener)
    })
    ctx.effect(() => () => serverScripts?.dispose(), 'dsh-tavern: server script runtime')
  }

  function contentText(message) {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
    return message.content.map(function (block) { return block !== null && typeof block === 'object' && block.type === 'text' ? str(block.text) : '' }).filter(Boolean).join('\n').trim()
  }

  function activeTurnOf(exec) {
    const phase = exec && exec.agent ? exec.agent.phase : null
    return phase && phase.kind === 'running' ? Math.max(0, Number(phase.turn) || 0) : 0
  }

  function replaceAssistantReply(session, result, bodyText) {
    if (result !== null && result.storyToolSubmission) return foldStorySubmission(session, result, bodyText)
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

  // ---------- DSH 回合生命周期 ----------
  const requestCoordinates = new Map()
  const tavernRetryLimiter = createTavernRetryLimiter({
    owns: async function (agent) {
      const sessionId = agent && agent.session ? agent.session.id : ''
      if (sessionId === '') return false
      return backgroundAgentRunner.owns(sessionId) || Boolean(await chatHeaderForSession(sessionId, []))
    }
  })

  function clearRuntimePresetRequestState(agent) {
    const session = agent && agent.session
    if (session === undefined) return 0
    const sessionId = session.id
    requestCoordinates.delete(sessionId)
    foregroundStrategies.clearRequestState(sessionId)
  }

  const skillGatedTools = createSkillGatedTools()
  const controlledToolNames = new Set(['tavern_roll', 'style_reference_submit', STORY_SUBMIT_TOOL_NAME, 'tavern_read_variables', 'worldbook_list', 'worldbook_grep', ...CARD_MEMORY_TOOLS, 'bash', 'pwsh', ...dshFileToolNames, 'skill', 'tavern_read_skill_reference', 'web_search', 'web_fetch', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_user_profile_confirm', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_search_card', 'tavern_replace_card_text', 'tavern_mvu_overview', 'tavern_apply_mvu', 'tavern_read_play_chat', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_copy_card', 'tavern_set_card_cover', 'tavern_export_card_png', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response'])
  const foregroundStrategies = createForegroundOrchestrationStrategies({
    nativePlay: {
      // Input side: replay past bodies as calls of the submission tool.
      styleReferencePrompt: chat => foregroundStyleReferencePrompt(chat, runtimePrompt('style-reference-recall'), runtimePrompt('style-reference')),
      historyToolCall: async () => (await readTavernSettings()).storyInputToolCall,
      // Output side: whether a new body must be submitted through the tool.
      storyOutputToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
      // Experiment switch for the replay layout: a word in a file, read per request
      // so one restart covers every arm. Absent or unreadable means the shipped one.
      historyLayout: async () => readHistoryLayoutFile(process.env.DSH_TAVERN_HISTORY_LAYOUT_FILE || historyLayoutFile()),
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
      visibleTools: async function (sessionId) {
        const names = await turnOrchestrator.visibleTools(sessionId)
        return skillGatedTools(names, sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session)
      },
      // Cache the plugin/extra tools that reached a play request. The settings
      // panel reads this map; Tavern's own tools come from the static catalog.
      recordTools: function (sessionId, tools) {
        const extra = tools
          .filter(tool => tool && typeof tool.name === 'string' && !controlledToolNames.has(tool.name))
          .map(extraToolEntry)
          .sort((left, right) => left.name.localeCompare(right.name))
        foregroundExtraTools.set(String(sessionId), extra)
        if (foregroundExtraTools.size > 300) foregroundExtraTools.delete(foregroundExtraTools.keys().next().value)
      },
      cardSystemPrompt: function () { return activeCardPersonaText(tavernSettingsDocument) },
      cardReferencePrompt: function () { return runtimePrompt('card-reference') },
      workspaceContext: function (cwd, projection) { return resourceWorkspaceContext(cwd, projection, runtimePrompt('card-workspace')) },
      ensureSessionPrefix: async function (input) {
        return await ensureNativeSystemPrefix(input.payload.agent.session, input.chat)
      },
      controlledToolNames,
      pluginToolModes: name => pluginApi.toolModesFor(name)
    }
  })

  registerRequestHooks({
    projectWorldbookRecovery: async (chat, options) => nativeWorldBookTemplateContext(chat, await readChatCard(chat), options),
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

  installNetworkToolPolicy(ctx, createNetworkToolPolicy({
    readHeader: chatHeaderForSession,
    backgroundContext: id => backgroundAgentRunner.requestContext(id),
    capabilityFor: name => pluginApi.toolNetworkFor(name)
  }))

  // 正文开始, once per turn: a reply makes several model requests (tool steps).
  const startedReplies = new Map()
  registerModelStreamHooks({
    replyStarted: (sessionId, turn) => {
      if (startedReplies.get(sessionId) === String(turn)) return
      startedReplies.set(sessionId, String(turn))
      storyEvents.emit('reply-started', { sessionId, turn })
    },
    agentRegistry,
    backgroundAgentRunner,
    chatForSession,
    chatHeaderForSession,
    ctx,
    foregroundStrategies,
    fullTemplateRuntime,
    modelRequestLog,
    modelSelection,
    pluginCompactionNotes: pluginApi.compactionNotes,
    pluginSettlementProgress,
    requestCoordinates,
    runtimePrompt,
    sessionStateForSession,
    recentStateForSession,
    sessionStore,
    str,
    updateChat,
    worldbookRecallLog,
    openReplyObservers: presentationObservers.openReply,
    storyRetention,
  })
  registerTurnLifecycleHooks({
    turnStarted: (sessionId, turn) => storyEvents.emit('turn-started', { sessionId, turn }),
    autoChoices,
    backgroundAgentRunner,
    hookChatForSession,
    clearRuntimePresetRequestState,
    contentText,
    ctx,
    ensureNativeSystemPrefix,
    foregroundHandoff,
    foregroundStrategies,
    nativeWorldBookTemplateContext,
    persistClearedBodyEdits,
    pluginPromptSections: pluginApi.promptSections,
    publishResourceWorkspace,
    readChatCard,
    replaceAssistantReply,
    reconcileWhenIdle,
    requestIdForTurn,
    runtimePrompt,
    sessionStore,
    storyOutputToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
    turnOrchestrator,
    userMessageForTurn,
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    tools.register(defineTool(createStorySubmissionTool({
      chatForSession,
      // Input-only requests still declare the tool for their replayed history;
      // accepting a real submission there is harmless.
      enabled: async () => {
        const settings = await readTavernSettings()
        return settings.storyInputToolCall === true || settings.storyOutputToolCall === true
      },
      isBackground: function (sessionId) { return backgroundAgentRunner.owns(sessionId) }
    })))
    tools.register(defineTool(createForegroundStyleReferenceTool({
      chatForSession,
      isBackground: sessionId => backgroundAgentRunner.owns(sessionId),
      save: (chat, reference, turn) => updateChatHeader(chat.id, ['styleReferences'], current => ({ ...current, styleReferences: rememberStyleReference(current.styleReferences, reference, turn) }), { source: 'foreground.style-reference' })
    })))
    registerGameplayTools({
      authorizeMod: (modId,chat)=>ctx.get('tavernManagedModules')?.enabled({modId,cardPath:chat.cardPath}) ?? false,
      markModToolUsed: chat => updateChatHeader(chat.id, ['usedModTools'], current => ({ ...current, usedModTools: [...new Set([...(current.usedModTools || []), 'tavern_roll'])] })),
      activeTurnOf,
      chatForSession,
      isBackground: sessionId => backgroundAgentRunner.owns(sessionId),
      cardResponseTest,
      foregroundRecallScopes,
      recallHistoryForSession,
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

    const checkCard = createCardValidationCheck({ cardMemory, fileResources })
    registerCardReadingTools({
      cardMemory,
      cardPreparation,
      checkCard,
      chatForSession,
      fileResources,
      readCard,
      readCardWorkspace,
      readChatCard,
      str,
      tools,
    })

    registerCardCoverTools({ chatForSession, exportCardPng, fileResources, presentCardText, str, tools })

    registerPlayChatTool({
      chatForSession,
      modelRequestLog,
      readCardExtensions,
      readChat,
      sessionDebugEvidence,
      str,
      tools,
      worldbookRecallLog,
      displayRuntimeStore,
    })

    registerRuntimeHealthTool({ chatForSession, tools,
      runtimeHealth: () => runtimeHealthReport({ version: TAVERN_PACKAGE_VERSION, performance: requestPerformance, logs: runtimeLogs }) })

    registerScriptTool({
      chatForSession,
      readScript,
      scriptContinuity,
      str,
      tools,
    })

    registerWorldbookTools({
      chatForSession,
      checkCard,
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

    registerRegexLibraryTools({ regexManager, tools })

    registerCardEditingTools({
      activeTurnOf,
      cardPreparation,
      chatForSession,
      checkCard,
      readCardWorkspace,
      restoreCurrentCard,
      str,
      tools,
      turnOrchestrator,
      worldBooks,
    })
  }

  try {
    const startedAt = Date.now()
    const recoveredIndex = await initializeRuntimeState()
    settleRuntimeReadiness({ ok: true })
    setImmediate(function () {
      recoverRuntimeHistory(recoveredIndex, startedAt).catch(function (error) {
        console.error('dsh-tavern: 后台恢复历史对话失败', error && error.message || error)
      })
    })
  } catch (error) {
    settleRuntimeReadiness({ ok: false, error })
    throw error
  }
}
