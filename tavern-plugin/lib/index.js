import { tavernStContract, projectPluginBody } from './domain/st-contract-service.js'
import playFeatures from '../shared/play-features.cjs'
import { postureForContext } from './domain/posture-context.js'
import {installHttpStreamPatch} from './domain/http-stream-patch.js'
import {selectSessionModel} from './domain/session-model-selection.js'
import { promptSection } from './domain/prompt-section.js'
import {createExtensionRequests} from './domain/extension-requests.js'
import {createModelSlotRegistry} from './domain/model-slot-registry.js'
import {mvuConditionHolds} from './domain/mvu-visibility.js'
import {createPresentationObservers} from './domain/presentation-observers.js'
import {createReplyStreamRewriters} from './domain/reply-stream-rewrite.js'
import {createSpeechRecognitionHost} from './speech-recognition-host.js'
import { installPluginSettingsMigration } from './settings-config.js'
export { Config } from './settings-config.js'
import { CORE_MODEL_MANIFESTS, modelSlotRows, resolveModelSlotOffered } from './domain/model-slots.js'
import { isWorldBookTemplateEntry, projectWorldBookTemplates } from './domain/worldbook-recall.js'
import { createSkillTextContext } from './domain/skill-text-context.js'
import { resolveWorldbookSkillChat } from './domain/worldbook-skill-scope.js'
import { appendWorldbookSkillChanges } from './domain/worldbook-skill-changes.js'
// Must stay first: it has to run before anything loads jsdom.
import { createSessionViewProjection, sessionViewMessageFields } from './domain/session-view-projection.js'
import { restoreGameModeForeground } from './domain/game-mode-foreground.js'
import { createNetworkToolPolicy, installNetworkToolPolicy } from './domain/network-tools.js'
import { clearRetiredSearchProvider } from './domain/retired-search-provider.js'
import { createConversationBackgroundSettings } from './domain/conversation-background-settings.js'
import { createChatWrites } from './domain/chat-writes.js'
import { upgradeReferences, upgradedAnchor } from './domain/session-upgrade-references.js'
import { createGameSaveImporter } from './domain/game-save-import.js'
import { assertGameSaveExportable, createGameSaveSnapshot } from './domain/game-save-snapshot.js'
import { createGameSaveResources } from './domain/game-save-resources.js'
import { createCardEditor, CARD_PROJECTION_REVISIONS, cardProjectionRevisionOf, bumpCardProjectionState } from './domain/card-editor.js'
import { ensureSessionVariableDirectory } from './domain/session-variable-directory.js'
import {createTavernClientAssets} from './domain/tavern-client-assets.js'
import { registerTavernHttpRoutes } from './http/routes.js'
import { verifyPublicHostname } from './http/public-hostname.js'
import { installChatAnswerBootPatch } from './domain/chat-answer-boot-patch.js'
import { installHostViewportPatch } from './domain/host-viewport-patch.js'
import { installGenerationStreamModeBootPatch } from './domain/generation-stream-mode-boot-patch.js'
import { createGenerationStreamModeStore, installGenerationStreamModeHook } from './domain/generation-stream-mode.js'
import { registerRequestHooks } from './hooks/request.js'
import { createWholeReadGuard, scopeTurnHooks } from './domain/whole-read-guard.js'
import { createChatReads } from './domain/chat-reads.js'
import { diffJson } from './domain/json-mutation.js'
import { DISABLED_FILE, runningUserPlugins, loaderOrigin, reconcileUserPluginsAtStartup, reloadUpdatedCardPlugins, loaderReload, readPatchedUserPlugins, syncUserPlugins, watchUserPlugins, userPluginPaths } from './domain/user-plugins.js'
import { createUserPluginInstaller } from './domain/user-plugin-install.js'
import { createPluginDataStore } from './domain/plugin-data-store.js'
import { createPluginAssets } from './domain/plugin-assets.js'
import { registerModelStreamHooks } from './hooks/model-stream.js'
import { registerTurnLifecycleHooks } from './hooks/turn-lifecycle.js'
import { createNarrativeDamper, readDamperStateSnapshot } from './domain/narrative-damper.js'
import { createDamperSettings } from './domain/damper-settings.js'
import { registerGameplayTools } from './tools/gameplay.js'
import { cardGoverns, cardOffer, modTools, withModHidden } from './mod-tools.js'
import { settleToolResults, toolResultTexts, toolSettlementContext } from './domain/tool-settlement-context.js'
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
import { withConversationReadLane } from './domain/conversation-read-lanes.js'
import {recoverRuntimeHistory as recoverHistory} from './domain/runtime-history-recovery.js'
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
import { createBoundedHistory, readRecentWindow, readRowsAt, storyContextMessageFields, windowCoversHistory } from './domain/bounded-history.js'
import { createStoryTranscriptReader, storyTranscriptMessageFields } from './domain/story-transcript-reader.js'
import { createHelperHistoryAccess } from './domain/helper-history-access.js'
import { isScopedMessages } from './domain/scoped-messages.js'
import {registerVariableReadTool} from './domain/read-variables.js'
import { createBackgroundSessionRetirement, installRetiredBackgroundFilter, installRetiredCatalogView } from './domain/background-session-retirement.js'
import { createBackgroundCatalogBackfill } from './domain/background-catalog.js'
import { createBranchOriginRepair } from './domain/branch-origin-repair.js'
import { createDirectorDescriptorRepair } from './domain/director-descriptor-repair.js'
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
import { materializeSnapshotDocuments } from './domain/preset-snapshot-pool.js'
import { createRequestPerformance } from './domain/request-performance.js'
import { createFrameStorage } from './domain/frame-storage.js'
import { createScriptReader } from './domain/script-reader.js'
import { createScriptNavigation } from './domain/script-navigation.js'
import { createSessionInventory } from './domain/session-inventory.js'
import { createSessionViewSync } from './domain/session-view-sync.js'
import { createCharacterDesignPublisher } from './domain/character-design-worldbook.js'
import { createManualCharacterDesign } from './domain/manual-character-design.js'
import { prepareTemplateHistory, synchronizeTemplateHistory } from './domain/template-history.js'
import { createServerTemplateSync, serverTemplateSyncState } from './domain/server-template-sync.js'
import { createServerTemplateRuntime } from './domain/server-template-runtime.js'
import { createForegroundStyleReferenceTool, foregroundStyleReferenceEnabled, foregroundStyleReferencePrompt, foregroundStyleReferenceTurnSection, rememberStyleReference } from './domain/style-reference.js'
import { STYLE_REFERENCE_TOOL_NAME } from './domain/style-reference-protocol.cjs'
import { adoptConversationFeatures, adoptConversationBackground } from './domain/conversation-background.js'
import { clearLegacyTavernDefault } from './domain/legacy-agent-default.js'
import { conversationStateAtMessage, conversationStateAtTurn, conversationForkBoundary, FORK_BOUNDARY_MISSING, FORK_BOUNDARY_UNSAFE } from './domain/conversation-fork-point.js'
import { legacyMessageUid } from './domain/message-uid.js'
import { createCardResponseTest } from './domain/card-response-test.js'
import { createGameplayApi } from './gameplay-api.js'
import { cardOpeningChoices } from './domain/card-openings.js'
import { projectCardPageOpening } from './domain/card-page-opening.js'
import { marked } from 'marked'
import { resolveAgentCompaction, compactNativePlayIfNeeded } from './agent-compaction.js'
import { warnCompactionPressureOnce } from './domain/compaction-pressure-guard.js'
import { compactForegroundIfNeeded } from './domain/foreground-compaction.js'
import { compactBackgroundIfNeeded, measureBackgroundBudget } from './domain/background-compaction.js'
import { createAutoCompaction, installCompactionPolicy } from './domain/auto-compaction.js'
import { RETAINED_ROUNDS_WINDOW_SHARE, STORY_VOLUMES_WINDOW_SHARE, storyHistoryFullyRetained, estimateStoryTokens } from './domain/story-compaction.js'
import { createPerformanceDiagnostics } from './domain/performance-diagnostics.js'
import { createBackgroundSuppressionReader } from './domain/background-surface.js'
import { ensureCardWorkspaceMessage } from './domain/card-workspace-message.js'
import { createPromptTemplateGlobalVariables } from './domain/prompt-template-global-variables.js'
import { createTavernApiDiagnostics } from './domain/tavern-api-diagnostics.js'
import { generateHelper, generateHelperRaw, defaultOrderedRawConfig } from './domain/helper-generation.js'
import { validateHelperGenerateConfig, resolveHelperGenerationPreset } from './domain/helper-generation-prompts.js'
import { createHelperGenerationTasks } from './domain/helper-generation-tasks.js'
import { createBodyEditor } from './domain/body-editor.js'
import { createMessageDeletion } from './domain/message-deletion.js'
import { appendHelperUserSessionContext } from './domain/helper-user-session-context.js'
import { userMessageForTurn, requestIdForTurn, requestIdForMessages } from './domain/session-turn-input.js'
import { createStoryReconciliation } from './domain/story-reconciliation.js'
import { sessionOpeningDescriptor } from './domain/session-opening.js'
import { scriptPromptScanText } from './domain/tavern-script-prompts.js'
import { createOpeningPreparation } from './domain/opening-preparation.js'
import { createChatHistoryImportService } from './domain/chat-history-import-service.js'
import { chatHistoryScriptText } from './domain/chat-history-import.js'
import { appendSessionEvent, sessionEvents } from './domain/session-events.js'
import { setAgentResolver } from './domain/agent-lookup.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { acquireHostSession, readHostSessionEvents, withHostAgent, withHostSession } from './host/sessions.js'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner, executeBackgroundCompaction } from './background-agent-runner.js'
import { resolveRuntimePresetMacros } from './domain/runtime-presets.js'
import { createApplicationUpdater } from './application-updater.js'
import { CANDIDATE_SUBMIT_TOOL, FOREGROUND_CHOICES_OPEN_TAG, SCRIPT_POINT_TOOL, SCRIPT_READ_TOOL, createCandidateGenerator, extractForegroundStoryChoices, foregroundCandidatePrompt } from './domain/candidate-generation.js'
import { computeSceneTarget, projectedSceneText } from './domain/scene-illustration.js'
import { createPluginMedia } from './domain/plugin-media.js'
import { createPluginMediaViews } from './domain/plugin-media-views.js'
import { createAssetGeneration, assetGenerationResult } from './domain/asset-generation.js'
import { createPluginData } from './domain/plugin-data.js'
import { createPluginTurnReader, RECENT_FLOORS } from './domain/plugin-turns.js'
import { createPluginVariableWriter } from './domain/plugin-variables.js'
import { createTavernPluginApi } from './plugin-api.js'
import { createWritingPreparationSources } from './domain/writing-preparation-sources.js'
import { createSceneWorldbooks } from './domain/scene-worldbook.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix } from './domain/session-stable-prefix.js'
import { waitForWritableSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { createCardOrganization } from './domain/card-organization.js'
import { countGamesByCard, lastPlayedByCard, orderCardsForLibrary } from './domain/card-list-order.js'
import { createCardPreparation,rawData } from './domain/card-preparation.js'
import { cardAssetWorkspaceRevision, hasCardAssetBindings } from './card-asset-bindings.js'
import { withoutPlayerChoices } from './domain/card-export-settings.js'
import { withGlobalRegexScripts, composeTavernRegexScripts } from './domain/card-extension-reading.js'
import { projectCardOpeningPreviews } from './domain/card-opening-previews.js'
import { createConversationInitialization } from './domain/conversation-initialization.js'
import { assertConversationExportable, assertConversationForkable, cardWorkbenchForkPoint, conversationForkReceipt, forkConversationChat } from './domain/conversation-fork.js'
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
import { wholeTurnCompactionRange } from './domain/context-turns.js'
import { compactWholeTurnsNow } from './domain/whole-turn-maintenance.js'
import { compactionFailureMessage } from './domain/compaction-failure.js'
import { createForegroundFrameSessionAdapter } from './domain/foreground-frame-session-adapter.js'
import { HISTORY_RECALL_TOOL, createHistoryRecall, renderHistoryRecall } from './domain/history-recall.js'
import { createModelRequestLog } from './domain/model-request-log.js'
import { createDisplayRuntimeCoalescer } from './domain/display-runtime-coalescer.js'
import { MVU_SUBMIT_UPDATE_TOOL, createMvuSettlementModule } from './domain/mvu-background-settlement.js'
import { createMvuSettlementEngine } from './domain/mvu-settlement-engine.js'
import { createPlainSettlementEngine } from './domain/plain-settlement-engine.js'
import { createSettlementRun } from './domain/settlement-run.js'
import { createSettlementParticipants } from './domain/settlement-participants.js'
import { createSettlementControls, installSettlementSubagentStop } from './domain/settlement-controls.js'
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
import { createPlayCardUpdate } from './domain/card-auto-reload.js'
import { createRuntimeLogBuffer, runtimeHealthReport } from './domain/runtime-health.js'
import { createCastAssets } from './domain/cast-assets.js'
import { createLineSpeech, createSpeechProviderBridge } from './domain/speech.js'
import { speechAudioToWav } from './speech-wav.js'
import { deploymentActivity } from './domain/deployment-activity.js'
import { buildCharx, cardImport, cardImportFromCard, pngCardTextChunk, pngWithTextChunks } from './domain/card-assets.js'
import { createAssetPacks } from './domain/asset-packs.js'
import { createMediaStore } from '../packages/dsh-asset-library/lib/pack-v2/media-store.js'
import { readCardArchive } from './domain/card-archive.js'
import { openZipFile } from './domain/zip-file.js'
import { createCardArchiveUploads, createUploads } from './domain/uploads.js'
import { createCardPlugins, createCardPluginUpdates } from './domain/card-plugins.js'
import { tmpdir } from 'node:os'
import { createCardFiles } from './domain/card-files.js'
import { createPostureItem, createSettlementItems } from './domain/background-pipeline.js'
import { createTavernCompatibilityDiagnosticStore } from './domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from './domain/mvu-diagnostics.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from './domain/play-chat-debug.js'
import { createSaveMaintenance } from './domain/save-maintenance.js'
import { blockVisits, RELAYOUT_COLD_VISITS } from './domain/conversation-page-store.js'
import { createServerScriptExecutor } from './domain/server-script-executor.js'
import { createDisplayRuntimeStore, displayRuntimeReceipt } from './domain/display-runtime-store.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { createForegroundOrchestrationStrategies } from './domain/foreground-orchestration-strategies.js'
import { clearFailedTurnSurface, rollbackAvailability, reshadowRolledBackRounds, interruptedSurfaceTurns, supersededTailPlayerInputIndices, pruneSupersededTailPlayerInputs } from './domain/rollback-surface.js'
import { replyBody, voiceBackfillLines, voiceBackfillKept } from './domain/round-body.js'
import { paragraphSpeech } from './domain/paragraph-speech.js'
import { createDisplayRuntimeCapture } from './domain/display-runtime-capture.js'
import { createPluginBodyGeneration, configuredBodyGeneration } from './domain/plugin-body-generation.js'
import { regenerationFrameKey } from './domain/regeneration-frame-cache.js'
import { STORY_CONTEXT_TOOL_NAME, STORY_GENERATE_TOOL_NAME, createStoryContextTool, createStorySubmissionTool, foldStorySubmission, STORY_SUBMIT_TOOL_NAME } from './domain/story-tool-submission.js'
import { readHistoryLayoutOverrideFile } from './domain/history-tool-call.js'
import { installToolCallIdleTimeoutPatch, installToolProtocolFetchPatch } from './domain/tool-protocol-enforcement.js'
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
import { modLibrary } from './mod-library.js'
import { normalizeBubbleConfig, bubbleVoiceSwitches, effectiveBubbleMoods, resolveBubbleMood, bubbleInstructionPreview, bubbleInjection, readDialogueBubblePlacement } from './domain/dialogue-bubbles.js'
import { createCardStorage } from './card-storage.js'
import { createCardLeftovers } from './card-leftovers.js'
import { isAbsolute, join as joinPath } from 'node:path'
import { createStageChatCache } from './domain/stage-chat-cache.js'
import { createStageReads, markStageRead, stageReadCarries, stageReadScope } from './domain/stage-read-projection.js'
import { modStageContributions } from './domain/mods/stage-contributions.js'
import {createOptionalStage} from './optional-stage.js'
import {createStageSwitch} from './stage-switch.js'
import {createAssetEngineSettings} from './asset-engine-settings-owner.js'
import {cardAssetExtensionPointer, readCardAssetExtension} from './domain/card-asset-bindings.js'
import {activeStageSkin} from './domain/card-stage-settings.js'
import { createTavernScriptHostAdapter } from './domain/tavern-script-host-adapter.js'
import { createTavernRemoteAssetPinStore } from './domain/tavern-remote-assets.js'
import { OFFICIAL_MVU_VERSION, inspectOfficialMvuAsset } from './domain/official-mvu-assets.js'
import { createTavernStaticResourceCache } from './domain/tavern-static-resource-cache.js'
import { createRoundHistory } from './domain/round-history.js'
import { buildBodyRegenerationMaterials } from './domain/body-regeneration-materials.js'
import { createResourceWorkspaceProjection } from './domain/resource-workspace-projection.js'
import { projectAgentContent, projectAgentMessageText, projectRuntimeReply } from './domain/runtime-content-projection.js'
import { plainReplyProse } from './domain/reply-prose.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { scriptForState } from './domain/script-layout.js'
import { appendWritingSkillState } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { createTavernSkillProvider } from './domain/tavern-skill-provider.js'
import { canonicalTavernSkillName, createTavernSkillModule } from './domain/tavern-skills.js'
import { readZipEntries } from './domain/zip-entries.js'
import { createGameFootprint } from './domain/game-footprint.js'
import { createConversationDeletion } from './domain/conversation-deletion.js'
import { createGameSaveExporter } from './domain/game-save-export.js'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, rm, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TAVERN_PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import {withConversationReadLane} from './domain/conversation-read-lanes.js'
import {recoverRuntimeHistory as recoverHistory} from './domain/runtime-history-recovery.js'
import { installTavernTokenMeter } from './domain/tavern-token-meter.js'
import { cordisToolNames, createTurnOrchestrator, dshFileToolNames } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { createWorldbookRecallLog } from './domain/worldbook-recall-log.js'
import { createForegroundWorldbook } from './domain/foreground-worldbook.js'
import { createWorldbookStrategies } from './domain/worldbook-strategies.js'
import { createWorldbookFiles } from './domain/worldbook-files.js'
import { recentWorldbookLookups } from './domain/worldbook-title-hints.js'
import { WORLDBOOK_ACCESS_TOOLS, WORKBENCH_READ_LOREBOOK_TOOL, WORKBENCH_UPDATE_LOREBOOK_TOOL } from './domain/foreground-tools.js'
import { registerWorldbookFileTools } from './tools/worldbook-files.js'
import { projectVirtualWorldbookPrefix } from './domain/worldbook-virtual-state.js'
import { installWorldbookSkillRead, nativeWorldbookReadAvailable } from './domain/worldbook-skill-read.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore, TAVERN_SETTINGS_PATH } from './profile-data-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import { createChatJournalStore } from './domain/chat-journal-store.js'
import { createResourceGraph } from './domain/resource-graph.js'
import { normalizeBackgroundTasks, applyTavernSettingsPatch, conversationUsesExpandedCandidates, presentTavernSettings, resolveSystemPrompt } from './domain/tavern-settings.js'
import { registerModelSamplingHook } from './hooks/model-sampling.js'
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
import { createGenerationStreamModeHandlers } from './rpc/generation-stream-mode.js'
import { createPluginHandlers } from './rpc/plugins.js'
import { createConversationHandlers } from './rpc/conversations.js'
import { createPlayHandlers, PLUGIN_REGENERATION_TARGET } from './rpc/play.js'
import { createTransferHandlers } from './rpc/transfer.js'
import { createImageCharacterHandlers } from './rpc/image-characters.js'
import { createFigureRecords } from './image-character-records.js'
import { createFigurePictures } from './image-character-pictures.js'
import { appearanceFromImageCharacter, figurePackPictures, findFigureImageCharacter, imageCharacterExtension, imageCharacterFromFigure } from './domain/image-character-appearance.js'
import { createTransferExportStore } from './domain/transfer-store.js'
// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。

// 历史回放排列的实验开关：文件里一个词，按请求读取，一次重启即可切完所有分组。
// 没有这个文件时行为与发布版一致（story）。
function historyLayoutFile() {
  return path.join(process.env.DSH_HOME || path.join(process.env.HOME || '/', '.dsh'), 'tavern-history-layout.txt')
}

// Keep the existing recall algorithm; only its visible input is projected.
export function projectContextHistory(chat, { anchor, scope }, display) {
  if (chat.id !== scope.chatId || chat.timeline?.branchId !== anchor.branchId || String(chat.timeline?.revision) !== anchor.textVersion) {
    throw Object.assign(new Error('History anchor is stale'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  }
  const end = chat.messages.findLastIndex(row => row.role === 'assistant' && Number(row.turn) === anchor.turn)
  if (end < 0) throw new Error('History anchor has no committed round')
  const messages = chat.messages.slice(0, end + 1).map(row => ({ ...row }))
  if (anchor.para !== undefined) {
    const body = display?.projections.find(row => row.turn === anchor.turn)?.body
    if (!body?.displayUnits) throw new Error('Bound paragraph projection is unavailable')
    messages[end].text = body.displayUnits.slice(0, anchor.para).map(unit => unit.text).join('\n\n')
  }
  return { ...chat, messages }
}
// Fork-only host binding. Declaration ownership remains in plugin-api; these are
// ephemeral consumer handles, not another source registry.
export function createContextHost({ pluginApi, chatForSession, recallHistoryForSession, callModel, runner }) {
  const bindings = new Map(), shared = new Map()
  let serial = 0, provider = null
  const prepared = new Map()
  function releasePrepared(sessionId) {
    prepared.get(sessionId)?.release()
    prepared.delete(sessionId)
  }
  function registerSharedProvider({ prepare }) {
    if (typeof prepare !== 'function') throw new TypeError('Shared provider requires prepare')
    if (provider) throw new Error('A shared provider is already registered')
    const entry = { prepare, controller: new AbortController() }
    provider = entry
    return () => {
      if (provider !== entry) return
      provider = null
      entry.controller.abort()
      for (const sessionId of prepared.keys()) releasePrepared(sessionId)
    }
  }
  async function prepareSharedContext(input) {
    if (input.persistent !== true || input.member || input.ownPrefix === true) return
    releasePrepared(input.sessionId)
    const entry = provider
    if (!entry || !input.requestAnchor) return
    const signal = input.signal ? AbortSignal.any([input.signal, entry.controller.signal]) : entry.controller.signal
    let removeAbort, bound
    try {
      signal.throwIfAborted()
      const requestAnchor = structuredClone(input.requestAnchor)
      const aborted = new Promise((_, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', abort)
      })
      const spec = await Promise.race([Promise.resolve().then(() => entry.prepare({ sessionId: input.sessionId, requestAnchor: structuredClone(requestAnchor), signal })), aborted])
      signal.throwIfAborted()
      if (spec == null) return
      // Creation authority is fixed by the producer, never by the provider or current chat.
      const installing = bind({ owner: spec.owner, name: spec.name, consumer: spec.consumer,
        scope: { ...spec.scope, chatId: requestAnchor.chatId }, sessionId: input.sessionId, shared: true, signal,
        anchor: { branchId: requestAnchor.branchId, turn: requestAnchor.turn, textVersion: String(requestAnchor.revision) } }).then(value => {
        if (signal.aborted) { value.release(); signal.throwIfAborted() }
        return value
      })
      bound = await Promise.race([installing, aborted])
      signal.throwIfAborted()
      prepared.set(input.sessionId, bound)
    } catch (error) {
      bound?.release()
      if (!signal.aborted) console.warn('dsh-tavern: 共享后台准备失败', String(error?.message || error))
      input.signal?.throwIfAborted()
    } finally { removeAbort?.() }
  }
  const unavailable = () => Object.assign(new Error('Context binding is unavailable or stale'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  async function current(binding) {
    if (!bindings.has(binding.token)) throw unavailable()
    const chat = await chatForSession(binding.sessionId)
    if (!chat || chat.id !== binding.scope.chatId || chat.timeline?.branchId !== binding.anchor.branchId ||
      String(chat.timeline?.revision) !== binding.anchor.textVersion) throw unavailable()
    return chat
  }
  async function view(binding) {
    await current(binding)
    const result = await pluginApi.resolveReadCapability({ ...binding, readHistory: async ({ args, signal }) => {
      if (!args || Object.keys(args).some(key => !Object.hasOwn(HISTORY_RECALL_TOOL.parameters.properties, key)) ||
        (args.turn !== undefined && (!Number.isSafeInteger(args.turn) || args.turn < 1 || args.turn > binding.anchor.turn))) {
        throw new Error('Query exceeds the bound history scope')
      }
      signal?.throwIfAborted()
      const value = await recallHistoryForSession(binding.sessionId, args, binding.scope, 'background', binding)
      signal?.throwIfAborted()
      return renderHistoryRecall(value)
    } })
    await current(binding)
    if (!result || (binding.generation !== undefined && binding.generation !== result.generation)) throw unavailable()
    binding.generation = result.generation
    const guard = reader => async context => {
      await view(binding)
      const result = await reader(context)
      await view(binding)
      return result
    }
    return { ...result, generation: binding.serial + ':' + result.generation,
      readHistory: guard(result.readHistory), readSource: guard(result.readSource) }
  }
  const get = token => { const binding = bindings.get(token); if (!binding) throw unavailable(); return binding }
  async function runSharedTask({ binding: token, instruction, signal }) {
    const binding = get(token)
    if (shared.get(binding.sessionId) !== binding) throw unavailable()
    await view(binding)
    const result = await runner().runSharedTask({ sessionId: binding.sessionId, anchor: binding.anchor, instruction, signal })
    await view(binding)
    return result
  }
  async function readHistory({ binding: token, args, signal }) {
    return (await view(get(token))).readHistory({ args, signal })
  }
  async function callWithTools({ binding: token, ...options }) {
    const binding = get(token), capability = await view(binding)
    const sourceTool = { name: 'tavern_read_source', description: 'Read an authorized source at or before the bound anchor.',
      parameters: { type: 'object', additionalProperties: false, required: ['sourceId', 'turn'], properties: {
        sourceId: { type: 'string', enum: capability.sources }, turn: { type: 'integer', minimum: 1 }, para: { type: 'integer', minimum: 0 }
      } } }
    const result = await callModel({ ...options, sessionId: binding.sessionId,
      tools: [HISTORY_RECALL_TOOL, ...(capability.sources.length ? [sourceTool] : [])],
      async onToolCall(call, { signal }) {
        const args = JSON.parse(call.arguments)
        const reader = call.name === HISTORY_RECALL_TOOL.name ? capability.readHistory
          : call.name === sourceTool.name ? capability.readSource : null
        if (!reader) throw new Error('Undeclared read tool')
        const value = await reader({ args, signal })
        return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
      } })
    await view(binding)
    return result
  }
  async function bind({ owner, name, sessionId, consumer, anchor, scope = {}, shared: useShared = false, signal }) {
    signal?.throwIfAborted()
    if (!owner || !name || !sessionId || !consumer || !anchor?.branchId || typeof anchor.textVersion !== 'string' ||
      !Number.isSafeInteger(anchor.turn) || anchor.turn < 1 ||
      (anchor.para !== undefined && (!Number.isSafeInteger(anchor.para) || anchor.para < 0))) throw new TypeError('Explicit consumer and anchor required')
    if (useShared && (shared.has(sessionId) || anchor.para !== undefined)) throw new Error('A shared binding must be unique and cover a full round')
    const chat = await chatForSession(sessionId)
    if (!chat || (scope.chatId !== undefined && scope.chatId !== chat.id) ||
      (scope.branchId !== undefined && scope.branchId !== anchor.branchId) ||
      anchor.turn > Number(chat.messages?.findLast(row => row.role === 'assistant')?.turn || 0)) throw unavailable()
    signal?.throwIfAborted()
    const token = Object.freeze({})
    const binding = { token, serial: ++serial, owner, name, sessionId, consumer: structuredClone(consumer), anchor: structuredClone(anchor),
      scope: { ...structuredClone(scope), chatId: chat.id, branchId: anchor.branchId, turn: anchor.turn, ...(anchor.para === undefined ? {} : { para: anchor.para }) } }
    bindings.set(token, binding)
    const release = () => { bindings.delete(token); if (shared.get(sessionId) === binding) shared.delete(sessionId) }
    signal?.addEventListener('abort', release, { once: true })
    try { await view(binding); signal?.throwIfAborted() } catch (error) { release(); throw error }
    finally { signal?.removeEventListener('abort', release) }
    if (useShared) shared.set(sessionId, binding)
    return Object.freeze({ release,
      runSharedTask: input => runSharedTask({ ...input, binding: token }),
      readHistory: input => readHistory({ ...input, binding: token }),
      callWithTools: input => callWithTools({ ...input, binding: token }) })
  }
  return Object.freeze({ bind, runSharedTask, readHistory, callWithTools, registerSharedProvider, prepareSharedContext,
    requestAnchor(snapshot, taskRun) {
      if (!provider && !shared.has(snapshot.sessionId)) return {}
      return { requestAnchor: { chatId: snapshot.id, branchId: taskRun.basedOn.branchId, revision: taskRun.basedOn.revision,
        turn: Number(snapshot.messages?.findLast(row => row.role === 'assistant')?.turn) || 0 } }
    },
    async resolveSharedTaskAnchor(input) {
      const binding = shared.get(input.sessionId)
      if (!binding) {
        await input.onSharedContextUnavailable?.()
        return null
      }
      const automatic = prepared.has(input.sessionId)
      try {
        await view(binding)
        const anchor = input.requestAnchor
        if (!anchor || anchor.chatId !== binding.scope.chatId || anchor.branchId !== binding.anchor.branchId ||
          String(anchor.revision) !== binding.anchor.textVersion || anchor.turn !== binding.anchor.turn) throw unavailable()
        return structuredClone(binding.anchor)
      } catch (error) {
        if (!automatic) throw error
        releasePrepared(input.sessionId)
        await input.onSharedContextUnavailable?.()
        console.warn('dsh-tavern: 共享后台绑定失效', String(error?.message || error))
        return null
      }
    },
    async resolveSharedReadTools({ sessionId }) {
      const binding = shared.get(sessionId)
      if (!binding) return null
      try { return await view(binding) } catch (error) {
        if (prepared.has(sessionId)) {
          releasePrepared(sessionId)
          console.warn('dsh-tavern: 共享后台绑定失效', String(error?.message || error))
          return null
        }
        if (error.code === 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE') return null
        throw error
      }
    },
    dispose() { provider?.controller.abort(); provider = null; prepared.clear(); bindings.clear(); shared.clear() }
  })
}
export async function apply(ctx) {
  const restoreHttpStreams = installHttpStreamPatch()
  ctx.effect(() => restoreHttpStreams)
  // 插件侧的联网请求（更新检查、插件市场、内置搜索）都走 fetch，
  // 而 Node 的 fetch 不认系统代理：启动时先应用一次，进程内所有请求生效。
  try {
    const { applySystemProxy, describeProxy } = await import('../../bin/system-proxy.mjs')
    const proxy = applySystemProxy()
    if (proxy?.source) console.log('dsh-tavern: ' + describeProxy(proxy))
  } catch (error) { console.warn('dsh-tavern: 系统代理未能应用：' + (error?.message || error)) }
  const restoreToolProtocolFetch = installToolProtocolFetchPatch()
  ctx.effect(() => restoreToolProtocolFetch)
  const restoreToolCallIdleTimeout = installToolCallIdleTimeoutPatch(ctx)
  ctx.effect(() => restoreToolCallIdleTimeout)
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
  registerModelSamplingHook(ctx)
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
  const sessionHost = { sessions: sessionStore, agents: agentRegistry, persistence }
  const foregroundSessionHost = { ...sessionHost, resume(sessionId) {
    // Cold foreground writers share the same preset, including its compaction engine.
    const selection = agentDefaultModel?.currentSelection?.() || {}
    return agentRegistry.resume({ resumeSessionId: sessionId, setup: tavernPresetSetup(),
      agentOptions: { provider: selection.provider, model: selection.model } })
  } }
  const withForegroundTaskAgent = (sessionId, work) => withHostAgent(foregroundSessionHost, sessionId, work, {
    onDisposeError: error => console.warn('dsh-tavern: 释放临时前台会话失败:', sessionId, str(error?.message || error))
  })
  const readNativeEvents = id => readHostSessionEvents(sessionHost, id)
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
  const cardPluginJournal = path.join(dataRoot, 'card-plugin-update.journal.json')
  let cardPluginTransactionActive = false, cardPluginTransactions = Promise.resolve()
  const cardPluginUpdatePending = () => cardPluginTransactionActive || existsSync(cardPluginJournal)
  // Folders in <data>/plugins become profile patch entries, so both plugin halves load without editing Tavern.
  // The entries DSH started with: a later sync that moves one (managed mods republished below) restarts it from its new
  // folder through the loader, or the old release's code would run against the new release's files until a restart.
  const loadedUserPlugins = await readPatchedUserPlugins({ dataRoot })
  const fileResources = createFileResourceStore({ dataRoot })
  const reloadUserPlugin = loaderReload(ctx.get('loader'), ctx.fiber)
  function queueCardPluginWork(work) {
    const next = cardPluginTransactions.catch(() => {}).then(() => work())
    cardPluginTransactions = next
    return next
  }
  const syncPlugins = beforePatch => syncUserPlugins({ dataRoot, cardPaths: () => fileResources.list('card'), pending: cardPluginUpdatePending, beforePatch })
  function commitCardPluginTransaction(write, after) {
    return queueCardPluginWork(async () => {
      cardPluginTransactionActive = true
      let committed
      try { committed = await write() } finally { cardPluginTransactionActive = false }
      return after(committed)
    })
  }
  async function syncCommittedCardPlugins(names) {
    let runtime = {reloaded: [], restartRequired: names}
    try {
      await syncPlugins(async result => {
        runtime = await reloadUpdatedCardPlugins({result, names, loaded: loadedUserPlugins, reload: reloadUserPlugin})
      })
    } catch (error) {
      console.warn('dsh-tavern: 同步已更新的人物卡插件失败', error?.message || error)
    }
    return runtime
  }
  try {
    const result = await syncPlugins()
    await reconcileUserPluginsAtStartup({ result, loaded: loadedUserPlugins, reload: reloadUserPlugin })
  } catch (error) { console.warn('dsh-tavern: 同步用户插件失败', error?.message || error) }
  ctx.effect(() => watchUserPlugins({ dataRoot, loaded: loadedUserPlugins, reload: reloadUserPlugin,
    sync: () => queueCardPluginWork(syncPlugins) }))
  const cardMemory = createCardMemory({ dataRoot })
  const stablePrefixStorage = createSessionStablePrefixStorage(dataRoot + '/session-prefixes')
  const profileData = createProfileDataStore({ dataRoot })
  const writingPreparationBindingPath = sessionId => 'writing-preparation-sessions/' + encodeURIComponent(sessionId) + '.json'
  const generationStreamModes = createGenerationStreamModeStore(profileData)
  ctx.effect(() => installGenerationStreamModeHook(ctx, () => generationStreamModes.get()))
  const frameStorage = createFrameStorage(profileData)
  const transferExports = createTransferExportStore({ root: dataRoot + '/tmp-exports' })
  const displayRuntimeStore = createDisplayRuntimeStore({ store: profileData })
  const gameFootprint = createGameFootprint({ dataRoot })
  const deletedSessionIds = new Set()
  // Maintenance: deleted games' sessions are never opened again, so their removal does not hold up host-ready.
  void gameFootprint.processDeferredDeletions().then(removed => { if (removed) console.log('dsh-tavern: 已清理已删除游戏的原生会话', removed) },
    error => console.warn('dsh-tavern: 清理已删除游戏的原生会话失败', error?.message || error))
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
    if (/^candidate\.mailbox\.|^background\.candidate\.(begin|bind)$|^variables\.edit\.(begin|cancel|recover)$/.test(str(metadata?.source))) {
      templateSync.unchanged(chat.sessionId,chat._storageRevision)
      return
    }
    // Display work waits while a foreground turn runs: it shares the template queue with the
    // turn's own template work, which reads the latest state itself. The turn's end lets it run
    // at once, so the new reply's template display does not wait for settlement.
    const state = serverTemplateSyncState(chat)
    templateSync.schedule(chat.sessionId, chat._storageRevision, { ...state,
      blocked: state.blocked || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' })
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
  const cardScripts = createCardScripts({ profileData, cardIdFor: cardStorage.findId })
  const mvuDiagnostics = createMvuDiagnosticStore(profileData)
  ctx.effect(() => () => mvuDiagnostics.dispose(), 'dsh-tavern: flush diagnostic logs')
  const apiDiagnostics = createTavernApiDiagnostics(profileData)
  const compatibilityDiagnostics = createTavernCompatibilityDiagnosticStore(profileData)
  // A traced stage request's pack visits per save, and every committed revision; save maintenance listens once it exists.
  let noteColdRead = () => {}, noteCommit = () => {}
  const requestPerformance = createRequestPerformance({onColdRead:row => {
    if (row.phase === 'end') for (const [chatId, visits] of blockVisits(row.reads)) noteColdRead(chatId, visits)
  }})
  ctx.effect(() => () => requestPerformance.dispose())
  // Tavern's own recent warnings and errors, for the debugging Agent's runtime health report.
  const runtimeLogs = createRuntimeLogBuffer()
  ctx.effect(() => runtimeLogs.install())
  const performanceDiagnostics = createPerformanceDiagnostics()
  const tavernRemoteAssets = createTavernRemoteAssetPinStore({
    onDiagnostic: row => performanceDiagnostics.opening(row),
    readJson: async function (path) { return await profileData.readJson(path) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
  let tavernSettingsDocument = await profileData.readJson(TAVERN_SETTINGS_PATH)
  const tavernStaticResources = createTavernStaticResourceCache({
    rootDir: dataRoot + '/cache/static-assets',
    verifyHostname(url) {
      const configured = tavernSettingsDocument?.allowCdnFakeIp
      return verifyPublicHostname(url, undefined, typeof configured === 'boolean' ? configured : undefined)
    }
  })
  const promptTemplateGlobalVariables = createPromptTemplateGlobalVariables(profileData)
  const readPromptTemplateGlobalVariables = promptTemplateGlobalVariables.read
  const writePromptTemplateGlobalVariables = promptTemplateGlobalVariables.save
  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(function (name) { return [name, promptFile(name)] }))
  }
  async function readTavernSettings() {
    return presentTavernSettings(await readRawTavernSettings(), promptDefaults())
  }
  // Import dedupe needs the stored overrides; the presented settings drop them for inactive sets.
  async function readRawTavernSettings() {
    tavernSettingsDocument = await profileData.readJson(TAVERN_SETTINGS_PATH)
    return tavernSettingsDocument
  }
  async function readExpandedCandidates(chat) {
    const legacy = typeof chat?.candidateTabs === 'boolean' ? undefined : (await readRawTavernSettings())?.candidateTabs
    return conversationUsesExpandedCandidates(chat, legacy)
  }
  async function extractConfiguredForegroundChoices(text, context) {
    const expanded = text.toLowerCase().includes(FOREGROUND_CHOICES_OPEN_TAG) && await readExpandedCandidates(context.chat)
    return extractForegroundStoryChoices(text, { ...context, expanded })
  }
  async function updateTavernSettings(patch, { beforeWrite } = {}) {
    if (patch && (Object.hasOwn(patch, 'backgroundModel') || Object.hasOwn(patch, 'backgroundTasks') || Object.hasOwn(patch, 'webSearchEnabled'))) throw new Error('后台配置已移至顶栏的本局设置')
    for (const name of ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel', 'defaultCompactionModel']) {
      if (patch?.[name] != null) await llm.resolveCallConfig(patch[name])
    }
    tavernSettingsDocument = await profileData.updateJson(TAVERN_SETTINGS_PATH, async function (current) {
      const next = applyTavernSettingsPatch(current, patch)
      await beforeWrite?.(current)
      return next
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
  const nativeProfile = ctx.get('desktopProfiles')?.current
  const desktopHost = process.versions.electron && typeof process.send === 'function'
  const applicationUpdater = createApplicationUpdater({
    dataRoot,
    sourceRoot,
    runtimeHost: nativeProfile?.dir && nativeProfile.dir === ctx.get('profileContext')?.dir ? 'next' : desktopHost ? 'desktop' : undefined,
    hostDependencyAnchor: fileURLToPath(import.meta.url),
  })
  if (process.env.DSH_TAVERN_RUNTIME_HOST === 'cli' && process.env.DSH_TAVERN_UPDATE_CHANNEL !== 'apk') {
    ctx.provide('tavernApplicationUpdater', applicationUpdater)
  }
  const modelRequestLog = createModelRequestLog({
    readJson: async function (path) { return await profileData.readJson(path) },
    writeJson: async function (path, value) { return await profileData.writeJson(path, value) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) },
    writeText: async function (path, text) { return await profileData.writeBytes(path, Buffer.from(text, 'utf8')) },
    remove: async function (path) { return await profileData.remove(path) },
    size: path => profileData.size(path),
    onChange: (sessionId, version) => sessionSignals.publish(sessionId, { kind: 'model-request', version })
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
  // 正文流式改写：外部插件（revnovel 润色等）注册改写器，正文 token 流经这里改写后再落库/显示。
  const replyStreamRewriters = createReplyStreamRewriters({warn:({owner,error}) => console.warn('dsh-tavern: 正文流式改写失败', owner, error?.message || error)})
  const settlementParticipants = createSettlementParticipants({warn:({owner,phase,error}) => console.warn('dsh-tavern: settlement participant failed', owner, phase, error?.code || error?.message || error)})
  ctx.effect(() => () => presentationObservers.dispose())
  ctx.effect(() => () => replyStreamRewriters.dispose())
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
  const clientAssets = createTavernClientAssets()
  ctx.provide('tavernClientAssets', clientAssets)
  // hostLibrary: the core helpers a mod may use (lib/mod-library.js holds their one list; a mod never imports core files).
  const hostLibrary = modLibrary
  const workbenchAuthority = Object.freeze({})
  const assetEngineSettings = createAssetEngineSettings(ctx)
  const stageRuntime = await createOptionalStage({ctx, cardStorage, measure:(name,run)=>requestPerformance.stage(name,run), modelSlots, presentationObservers, resolveSlot, readCardWorkspace:readSharedCardWorkspace, coordinationEvents, sessionSignals,
    assetEngineSettings, ensureStage:() => stageSwitch.ensure(),
    // The mods' stage contributions (their host extensions) and the stage reads a mod's stage service scopes its chat with.
    modStageContributions, stageReads:Object.freeze({readCarries:stageReadCarries, readScope:stageReadScope, markRead:markStageRead})}, {enabled:false,onStatus:status=>sessionSignals.publish('plugin:dsh-tavern-stage',{kind:'plugin-lifecycle',version:status+':'+Date.now()+':'+Math.random()})})
  const {dialogueBubbles} = stageRuntime.assets

  // ---------- 模型调用 ----------
  const helperGenerationTasks = createHelperGenerationTasks()
  ctx.effect(() => () => helperGenerationTasks.dispose())
  const { modelSelection, backgroundModelSelection, tavernModelCatalog, callModel } = createModelCalls({
    llm, agentDefaultModel, agents: () => ctx.get('agents'), sessionProjections: () => ctx.get('sessionProjections'), backgroundConfigForSession
  })
  function scoringCatalog() {return [modelSlots.scoring()].filter(config => config && config.provider !== 'unset').map(({provider,model}) => ({provider,model}))}
  async function slotDeclarations(context) {
    return modelSlots.rows(context)
  }
  async function resolveSlot(modId, slotId, sessionId, declaration) {
    const slot = declaration || (await modelSlots.rows()).find(row => row.modId === modId && row.id === slotId)
    if (!slot) throw new Error('模型槽未启用')
    const settings = await readTavernSettings(), chat = sessionId ? await backgroundConfigForSession(sessionId) || {} : {}
    return resolveModelSlotOffered({slot,modId,chat,settings,foreground:sessionId ? modelSelection(sessionId, false) : null,defaultModel:slot.kind === 'scoring' ? null : modelSelection(),scoringConfig:modelSlots.scoring()},
      async selection => (await readBackgroundModelReasoning(llm, selection))?.efforts)
  }
  async function checkSlotSelection({modId,slotId,selection}, context) {
    const slot = (await modelSlots.rows(context)).find(row=>row.modId===modId && row.id===slotId)
    if (!slot) throw new Error('模型槽未启用')
    if (selection === null) return
    if (slot.kind === 'scoring') {
      const config = modelSlots.scoring()
      if (!config || selection.provider !== config.provider || selection.model !== config.model) throw new Error('请选择已配置的概率判断模型')
    } else { const {reasoningEffort, ...route} = selection; await llm.resolveCallConfig(reasoningEffort === null ? route : selection) }
  }

  // ---------- 角色卡 ----------
  // 会话列表和资源图每次刷新都要这份索引：按文件版本缓存解析结果，命中时只花一次
  // stat。返回值带着自己的外层对象和两个数组，调用方的 filter/map/sort 改不到缓存
  // 里的那一份；行对象本身只读共享（现有调用方只读）。
  let indexCache
  function indexView(value) {
    return { ...value, cards: [...(Array.isArray(value.cards) ? value.cards : [])], chats: [...(Array.isArray(value.chats) ? value.chats : [])] }
  }
  async function readIndex() {
    const stamp = await profileData.version('index.json')
    if (indexCache !== undefined && indexCache.stamp === stamp) return indexView(indexCache.value)
    const idx = await readJson('index.json')
    const value = (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
    indexCache = { stamp, value }
    return indexView(value)
  }
  // 写入后立刻换成刚写下的那一份：下一次列表读取不必再解析一遍磁盘。
  async function cacheWrittenIndex(value) {
    indexCache = { stamp: await profileData.version('index.json'), value }
  }
  async function writeIndex(idx) {
    await writeJson('index.json', idx)
    await cacheWrittenIndex(idx)
  }
  async function updateIndex(updater) {
    const next = await profileData.updateJson('index.json', value => updater(value || { cards: [], chats: [] }))
    if (next !== undefined && typeof next === 'object') await cacheWrittenIndex(next)
    else indexCache = undefined
    return next
  }
  const updateCard = createCardEditor({ readCardWorkspace, cardPreparation, fileResources, bumpCardProjectionRevision, syncCardName,
    cardRevision: path => cardProjectionRevision(normalizeResourcePath(path, 'card')),
    withCardLock: (id, edit) => cardStorage.withCardLock(id, edit), cardAssetWorkspaceRevision })
  const resourceWorkspaceProjection = createResourceWorkspaceProjection({ root: dataRoot + '/resources' })
  const mobileCardImport = createMobileCardImport({ runtimeHost: process.env.DSH_TAVERN_RUNTIME_HOST })
  const cardDeletion = createCardDeletion({ resources: fileResources, cardStorage })
  const cardTaskPrompts = Object.freeze({
    edit: 'card-task-edit',
    extract: 'card-task-extract',
    script: 'card-task-script',
    material: 'card-task-script',
    worldbook: 'card-task-worldbook',
    preset: 'card-task-preset',
    'debug-play': 'card-task-debug-play'
  })
  // A card's stage extension (null without stage settings): the card layer of its narrator.
  async function cardStageExtension(cardPath) {
    const raw = (await readCardWorkspace(cardPath))?.raw
    return raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
  }
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
  // Readers that only look at a card share the card storage's frozen copy of its current file version (a hit costs a
  // stat, not a read and parse of the whole card); a card not yet in the workspace shape is migrated first.
  async function readSharedCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const shared = await cardStorage.readWorkspace(normalized)
    if (shared === undefined || cardPreparation.isWorkspace(shared)) return shared
    await readCardWorkspace(normalized)
    return cardStorage.readWorkspace(normalized)
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
    const workspace = chat?.cardDefinitionSnapshot || await readSharedCardWorkspace(cardPath)
    if (workspace === undefined) return undefined
    const extensions = cardPreparation.present({ card: workspace, as: 'card-extensions' })
    // A workspace holds the card under raw; a game's definition snapshot is the card itself.
    return { ...extensions, mvuVisibility: withModHidden(extensions.mvuVisibility, workspace.raw?.data || workspace.raw || workspace) }
  }
  async function readCardExtensions(cardPath, chat, includeMuted = false, settings) {
    let extensions = await readCardExtensionSources(cardPath, chat)
    if (extensions === undefined) return undefined
    // shared by views, opening previews and script-work eligibility; no snapshot writes.
    if (!includeMuted) extensions = { ...extensions, helperScripts: await cardScripts.filter(extensions.helperScripts, cardPath) }
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
  async function pluginTurnRegexScripts(sessionId, header) {
    if (!['story', 'script'].includes(header?.mode || 'story')) return []
    let extensions = await readCardExtensions(header.cardPath || header.cardId, header)
    if (extensions === undefined && !header?.cardDefinitionSnapshot) {
      const snapshot = (await chatHeaderForSession(sessionId, ['cardDefinitionSnapshot']).catch(() => null))?.cardDefinitionSnapshot
      if (snapshot) extensions = await readCardExtensions(header.cardPath || header.cardId, { ...header, cardDefinitionSnapshot: snapshot })
    }
    if (extensions === undefined) extensions = withGlobalRegexScripts({}, await tavernExtensionSettings.read(), header?.regexOverrides)
    return composeTavernRegexScripts(extensions, presetRegexScripts(header), header?.regexOverrides?.preset)
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
  function prepareScriptImport(payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    if (/\.jsonl$/i.test(prepared.name)) {
      return { ...prepared, text: chatHistoryScriptText(prepared.originalText ?? prepared.text) }
    }
    return prepared
  }
  async function importScript(cardPath, payload) {
    const prepared = prepareScriptImport(payload)
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
    const prepared = prepareScriptImport(payload)
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
  const chatJournalStore = createChatJournalStore({ dataRoot, legacyData: profileData, now: Date.now, logger: console, backgroundSnapshots: true, newConversations: true, wholeReadGuard: wholeReads, migrateLegacy: process.env.DSH_TAVERN_COMPATIBLE_STORAGE === '1',
    onCommit: (chatId, revision) => noteCommit(chatId, revision) })
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
  // Summary reads distinguish committed message changes from header-only projections.
  async function syncChatSummary(chat, metadata, summaryOptions) {
    if (chat) presentationObservers.saved(chat, metadata)
    if (!conversationRegistry || chat === undefined) return
    try { await conversationRegistry.sync(chat, summaryOptions || metadata) }
    catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', str(error && error.message || error)) }
  }
  const deletedChatIds = new Set()
  const { write: writeChat, writeHeader: writeChatHeader, update: updateChat, patch: patchChat, writeRaw: rawWriteChat, updateHeader: updateChatHeader } = createChatWrites({
    persistence: chatPersistence,
    isDeleted: id => deletedChatIds.has(id),
    candidatesChanged: (saved, metadata) => candidateWorldbookPreparation?.changed(saved, metadata),
    syncSummary: syncChatSummary,
    publish: sessionId => coordinationEvents?.publish(sessionId),
    syncTemplates: scheduleTemplateSync,
    queueCompaction: queueAutoCompaction,
    observePatch: presentationObservers.patched
  })
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
  // 缓存 sessions.json 的 stat 指纹与内容，避免每 5 秒协调轮询重复 readdir/读盘/解析。
  let sessionsLinksCache = null
  const sessionsLinksPath = path.join(dataRoot, 'sessions.json')
  function cloneLinks(value) {
    if (!value || typeof value !== 'object') return value
    return structuredClone(value)
  }
  conversationRegistry = createTavernConversationRegistry({
    trace: requestPerformance,
    // History lists each game under its card's current name (the cached catalogue summary).
    cardName: async cardPath => (await cardSummaries.read(cardPath)).name,
    isDeleted: chatId => deletedChatIds.has(chatId),
    onPreviewChange: summary => sessionSignals.publish(summary.sessionId, {
      kind: 'conversation-preview', version: String(summary.preview.storageRevision ?? summary.updatedAt)
    }),
    store: {
      readAutomationOwner: async sessionId => readJson('automation/' + sessionId + '.json'),
      readLinks: async function () {
        let info = null
        try { info = await stat(sessionsLinksPath) } catch { sessionsLinksCache = null }
        if (info && sessionsLinksCache && sessionsLinksCache.mtimeMs === info.mtimeMs && sessionsLinksCache.size === info.size) {
          return cloneLinks(sessionsLinksCache.value)
        }
        const value = await readJson('sessions.json')
        try {
          const after = info || await stat(sessionsLinksPath)
          sessionsLinksCache = { mtimeMs: after.mtimeMs, size: after.size, value: cloneLinks(value) }
        } catch { sessionsLinksCache = null }
        return value
      },
      updateLinks: async function (updater) {
        const result = await profileData.updateJson('sessions.json', updater)
        try {
          const info = await stat(sessionsLinksPath)
          sessionsLinksCache = { mtimeMs: info.mtimeMs, size: info.size, value: cloneLinks(result) }
        } catch { sessionsLinksCache = null }
        return result
      },
      readIndex,
      updateIndex,
      readChat,
      readChatSlice: chatPersistence.readSlice,
      readRecentSummaries: chatPersistence.readRecentSummaries,
      readChatState: id => chatPersistence.readSessionState(id, {scoped:true}),
      readBackgroundConfig: chatPersistence.readBackgroundConfig,
      readSceneImageState: chatPersistence.readSceneImageState,
      writeChat: rawWriteChat,
      removeChat: async function (chatId) { await chatPersistence.remove(chatId) }
    }
  })
  const conversationDeletion = createConversationDeletion({
    store: profileData, deletedChatIds, removeCore: conversationRegistry.remove, cleanup: cleanupDeletedChat
  })
  const pendingChatDeletions = await conversationDeletion.pendingIds().catch(error => {
    console.warn('dsh-tavern: 读取对话删除队列失败', error?.message || error)
    return []
  })
  for (const chatId of pendingChatDeletions) deletedChatIds.add(chatId)
  async function readSessionMap() { return await conversationRegistry.links() }
  // A game's session as its event log: the live one, else read from disk (a settlement resumed after a restart).
  async function readSessionLog(sessionId) {
    const live = sessionStore.get(sessionId)
    if (live) return live
    const handle = await ctx.get('sessionPersistence').open(sessionId, 'read')
    try { return { events: (await handle.read(0)).events } } finally { await handle.close() }
  }
  try {
    const stored = await profileData.list('chats')
    const chatIds = [...new Set(stored.map(entry => entry.directory ? entry.name : (entry.name.match(/^(chat-[^.]+)\.json$/) || [])[1]).filter(name => /^chat-[^.]+$/.test(name || '')))]
    const recovered = await conversationRegistry.recoverUnlisted(chatIds)
    if (recovered.length) console.warn('dsh-tavern: 找回 ' + recovered.length + ' 局未登记的存档：' + recovered.join('、'))
  } catch (error) { console.warn('dsh-tavern: 核对存档登记失败', error?.message || error) }
  // A play conversation takes this install's background and feature configuration once (reader adoption, save import).
  function adoptConversationConfiguration(chat) {
    return adoptConversationFeatures(adoptConversationBackground(chat, tavernSettingsDocument), tavernSettingsDocument)
  }
  const sessionChats = createSessionChatReader({
    registry: conversationRegistry,
    needsAdoption: chat => groupOfMode(chat.mode) === 'play'
      && (chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1),
    adopt: async function (chat) {
      return updateChat(chat.id, adoptConversationConfiguration, { source: 'background-config.adopt' })
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
    const selected = await chatSliceForSession(sessionId, [], [...taskStateFields, 'preparedWorldBook', 'mvu'])
    if (!selected?.denseMessages || Object.values(selected.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) return null
    const first = selected.messageCount === 1 ? (await chatSliceForSession(sessionId, [0], ['_storageRevision']))?.chat.messages[0] : undefined
    return { chat: selected.chat, messageCount: selected.messageCount, firstGreeting: first?.greeting === true }
  }
  const taskStateReader = createTaskStateReader({
    readSlice: chatPersistence.readSlice, readState: chatPersistence.readSessionState,
    headerForSession: chatHeaderForSession, stateForSession: sessionStateForSession
  })
  const saveMaintenance = createSaveMaintenance({
    chats: chatJournalStore, requestLog: modelRequestLog, recallLog: worldbookRecallLog, store: profileData, coldVisits: RELAYOUT_COLD_VISITS,
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
  noteColdRead = saveMaintenance.noteColdRead
  noteCommit = saveMaintenance.noteWrite
  saveMaintenance.catchUp()
  const historyRecall = createHistoryRecall()
  const foregroundRecallScopes = new WeakMap()
  async function recallHistoryForSession(sessionId, args, scope, audience, binding) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前 Session 没有对应的 Tavern Chat')
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('历史正文只能在游玩模式中检索')
    if (binding) {
      const display = binding.anchor.para === undefined ? null : await replyDisplayForChat(chat, await readChatCard(chat), true)
      return historyRecall.recall({ ...args, chat: projectContextHistory(chat, binding, display), scope, audience })
    }
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
  const cardArchiveUploads = createCardArchiveUploads({ root: dataRoot })
  ctx.effect(() => {
    const sweep = () => { void cardArchiveUploads.sweep().catch(() => {}) }
    sweep()
    const timer = setInterval(sweep, 60 * 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-tavern: card archive upload cleanup')
  const pluginDataStore = createPluginDataStore({ dataRoot })
  const userPluginInstaller = createUserPluginInstaller({
    dataRoot, cardPaths: () => fileResources.list('card'),
    sync: () => queueCardPluginWork(syncPlugins),
  })
  const cardPlugins = createCardPlugins({ dataRoot, cardPaths: () => fileResources.list('card'), pluginsDir: userPluginPaths(dataRoot).plugins, keyOf: castAssets.keyOf,
    journalPath: cardPluginJournal })
  const cardPluginUploads = createUploads({ root: path.join(tmpdir(), 'dsh-card-plugin-update', castAssets.keyOf(dataRoot)), maxAgeMs: 10 * 60 * 1000 })
  ctx.effect(() => {
    const timer = setInterval(() => { void cardPluginUploads.sweep().catch(() => {}) }, 60 * 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  })
  const cardPluginUpdates = createCardPluginUpdates({ cardPlugins: {
    ...cardPlugins,
    updateBoundPlugin: input => commitCardPluginTransaction(() => cardPlugins.updateBoundPlugin(input), async result => {
      if (!result.plugin.enabled || !result.restartRequired && runningUserPlugins.get(result.plugin.name)?.sha256 === result.plugin.sha256) return result
      const runtime = await syncCommittedCardPlugins([result.plugin.name])
      return {...result, reloaded:runtime.reloaded.length > 0, restartRequired:runtime.restartRequired.length > 0}
    }),
    recoverBoundPlugin: callbacks => commitCardPluginTransaction(() => cardPlugins.recoverBoundPlugin(callbacks), async result => {
      if (result.recovered) {
        const {plugins = []} = await castAssets.read(result.cardPath)
        await syncCommittedCardPlugins(plugins.filter(plugin => plugin.enabled === true).map(plugin => plugin.name))
      }
      return result
    })
  }, castAssets, backup: async cardPath => {
    const directory = path.join(dataRoot, '..', 'backups', 'card-plugin-update')
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, 'card-plugin-update-' + randomUUID() + '.json')
    const manifest = await readFile(path.join(dataRoot, 'cast-assets', castAssets.keyOf(cardPath), 'cast.json'), 'utf8')
    await writeFile(file, JSON.stringify({ cardPath, manifest }, null, 2) + '\n', { flag: 'wx' })
    return file
  } })
  // An update interrupted by a crash or restart finishes (or rolls back) before user plugins load again.
  void cardPluginUpdates.recover().catch(error => console.warn('dsh-tavern: 恢复中断的人物卡插件更新失败', error?.message || error))
  void uploads.sweep().catch(() => {})
  // 台词朗读 goes through the voice service; plugin speech providers join it as its providers (pluginApi is created later; read lazily).
  const voiceService = () => ctx.get('tts')
  const speech = createLineSpeech({ getTts: voiceService, getLibrary: () => ctx.get('assetLibrary') })
  const speechBridge = createSpeechProviderBridge({ providers: () => pluginApi.speechProviders(), toWav: speechAudioToWav, warn: error => ctx.logger.warn('dsh-tavern: 插件配音渠道无法接入语音服务 %s', error?.message || error) })
  ctx.inject(['tts'], child => { const detach = speechBridge.attach(voiceService()); child.effect(() => detach) })
  ctx.effect(() => () => speech.dispose())
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
    if (chat.mode === 'card' && str(chat.cardPath) === '') return null
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
  const { replaceCard: replaceCardFiles, revertCardUpdate: revertCardFiles, importCard, importCardArchiveFile, importPackArchiveFile, previewCardArchiveFile, discardCardArchivePreview, importPluginCardFile, presentCardText, exportCardPng, exportCardFile, listCardExportPacks, listCardReleases, addCardReleaseFromFile, estimateCardUpdate, recoverCardUpdates } = createCardFiles({
    cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset,
    readCardWorkspace, worldBooks, pluginApi: () => pluginApi, assetLibrary: () => ctx.get('assetLibrary'), prepareCardAssets: () => stageSwitch.ensure(),
    withCardBackup: (...args) => ctx.get('assetLibraryCardBackup')(...args), backupPack: (...args) => ctx.get('assetLibraryPackBackup')(...args), exportRoot: path.join(dataRoot, 'exports'), mediaStore,
    syncBubbles: path => dialogueBubbles.sync(worldBooks, path)
  })
  const replaceCard = (cardPath, input) => commitCardPluginTransaction(async () => {
    const before = (await castAssets.read(normalizeResourcePath(cardPath, 'card'))).plugins || []
    const card = await replaceCardFiles(cardPath, input)
    const after = (await castAssets.read(card.path)).plugins || []
    return {card, before, after}
  }, async ({card, before, after}) => {
    if (!before.length && !after.length) return card
    const existing = new Map(before.filter(plugin => plugin.enabled === true).map(plugin => [plugin.name, plugin.sha256]))
    const changed = after.filter(plugin => plugin.enabled === true && (existing.get(plugin.name) !== plugin.sha256
      || runningUserPlugins.get(plugin.name)?.sha256 !== plugin.sha256))
    return {...card, pluginRuntime:await syncCommittedCardPlugins(changed.map(plugin => plugin.name))}
  })
  const revertCardUpdate = updateId => commitCardPluginTransaction(() => revertCardFiles(updateId), async result => {
    const {plugins = []} = await castAssets.read(result.path)
    await syncCommittedCardPlugins(plugins.filter(plugin => plugin.enabled === true).map(plugin => plugin.name))
    return result
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
          hasOpeningForm: card.hasOpeningForm,
          ...(card.openingPage ? { openingPage: card.openingPage } : {}),
          ...(card.entryStart ? { entryStart: true } : {}),
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
    const conversations = await conversationRegistry.list().catch(() => [])
    const gameCounts = countGamesByCard(conversations), lastPlayed = lastPlayedByCard(conversations)
    return await cardOrganization.project(orderCardsForLibrary(cards, { gameCounts })
      .map(card => lastPlayed.has(card.path) ? { ...card, lastPlayedAt: lastPlayed.get(card.path) } : card))
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
  const helperGenerationPreset = async (name, snapshot) => {
    const resolved = await resolveHelperGenerationPreset(name, snapshot, {
      catalog: () => presetLibrary.catalog(), read: readPreset, readDocument: readPresetDocument, selected: () => runtimePresets.state()
    })
    // A saved game keeps only its snapshot digest; `generate` is the one reader of the
    // two compatibility documents, so they are reattached here instead of in every save.
    return await materializeSnapshotDocuments(resolved, {
      load: digest => presetLibrary.snapshotDocuments.load(digest), readPreset, readDocument: readPresetDocument
    })
  }
  const openingPreparation = createOpeningPreparation({ readCard, worldBooks, extensionSettings: tavernExtensionSettings, trace: requestPerformance,
    // the card's extensions with its remote script assets pinned, as getCardOpenings reads them (openingSetup included)
    readRuntimeExtensions: async cardPath => { const extensions = await readCardExtensions(cardPath); return { ...extensions, ...await tavernRemoteAssets.pinExtensions(extensions) } },
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
    const defaultPlayerName = settings.defaultPlaySettings.playerName
    const playerName = str(userName).trim().slice(0, 80) || defaultPlayerName
    const cardExtensions = await timedStage('readExtensions', () => readCardExtensions(cardPath))
    const extensions = { ...cardExtensions, ...await timedStage('resources', () => tavernRemoteAssets.pinExtensions(cardExtensions)) }
    const previews = await timedStage('preview', () => projectCardOpeningPreviews({
      card,
      extensions,
      userName: playerName,
      presetRegexScripts: []
    }))
    const hasOpeningScript = opening => /<script\b/i.test(opening.projection.text) || opening.projection.parts.some(part => /<script\b/i.test(part.content || ''))
    const hasHelperScripts = projectTavernHelperScripts(extensions.helperScripts).scripts.length > 0
    const interactive = hasHelperScripts || previews.openings.some(opening => opening.setup || hasOpeningScript(opening))
    const preparation = interactive ? await timedStage('prepare', () => openingPreparation.create(cardPath, { card, extensions, runtime: (extensions.mvuResources || []).some(item => item.enabled !== false), userName: playerName })) : null
    if (preparation) {
      const choices = cardOpeningChoices(card)
      const swipes = choices.map(opening => opening.text)
      const openingIds = choices.map(opening => opening.id)
      for (const opening of previews.openings) if (hasHelperScripts || opening.setup || hasOpeningScript(opening)) {
        opening.openingPreview = { swipes, openingIds, selectedIndex: openingIds.indexOf(opening.id),
          messageHtml: opening.projection.parts.map(part => part.kind === 'markdown' ? marked.parse(str(part.text), { gfm: true }) : str(part.content)).join('\n'),
          preparationId: preparation.id, characterName: card.name, playerName, ...openingPreviewPayload(preparation, previewTransport) }
      }
    }
    success = true
    return {
      preparationId: preparation?.id || '',
      defaultPlayerName,
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
  // 人物卡库「复制」/「另存副本」: a new file with a new meta.id (or mod settings would follow the wrong card); the stage
  // settings and pack bindings live in the card JSON (extensions.dsh_tavern) and come along. Without a name the copy
  // keeps the card's name and is numbered 「原名 (n)」. The world book binding is keyed by card path, so the copy gets the
  // same books (its own embedded book instead of the source's); it goes into the source's group. Chats, CG unlocks
  // and the bound script stay with the source card.
  async function duplicateCard(cardPath, name) {
    const source = normalizeResourcePath(cardPath, 'card')
    const chosen = str(name).trim()
    const copy = chosen ? await fileResources.copyCard(source, chosen) : await fileResources.copyCard(source, source.split('/').pop(), { keepName: true, numbered: true })
    const binding = await fileResources.worldBookBindingForCard(source)
    const own = item => item.cardPath === source ? copy.path : item.cardPath
    if (binding.kind === 'multiple') await fileResources.bindWorldBooks(copy.path, binding.sources.filter(item => item.available)
      .map(item => item.kind === 'embedded' ? { kind: 'embedded', cardPath: own(item) } : { kind: 'standalone', path: item.path }))
    else if (binding.kind === 'standalone' && binding.available) await fileResources.bindWorldBook(copy.path, binding.path)
    else if (binding.kind === 'embedded' && binding.available) await fileResources.bindWorldBook(copy.path, { kind: 'embedded', cardPath: own(binding) })
    else if (binding.kind === 'none') await fileResources.unbindWorldBook(copy.path)
    const tags = (await cardOrganization.read()).cards[source]?.tags
    if (tags?.length) await cardOrganization.update({ action: 'cards', paths: [copy.path], tags }, [copy.path])
    return { path: copy.path, sourcePath: source, imageCopied: copy.imageCopied }
  }
  async function deleteCard(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const plugins = (await castAssets.read(normalized)).plugins || []
    const cardId = await cardStorage.findId(normalized)
    const result = await cardDeletion.remove(normalized)
    if (result.deleted) {
      if (plugins.length) await cardPlugins.remove({ cardKey: castAssets.keyOf(normalized), cardPath: normalized, plugins })
      await cardOrganization.movePath(normalized, null)
      await cardLeftovers.remove({ cardPath: normalized, cardId })
    }
    return result
  }
  const sessionInventory = createSessionInventory({
    persistence: ctx.get('sessionPersistence'), sessions: sessionStore, agents: agentRegistry,
    references: () => conversationRegistry.list(), archived: () => ctx.get('workspaceRegistry')?.archivedSessionIds
  })
  async function stopChatForDeletion(chatId) {
    if (deletedChatIds.has(chatId)) return undefined
    const chat = await readChatForDeletion(str(chatId))
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
  // Stopping and deleting a game needs a handful of header fields, never the whole save.
  // A play save carries a ~1 MB preset snapshot and megabytes of foreground frames, so a
  // full readChat here decoded hundreds of blocks per deletion just to reach sessionId
  // and the timeline. Saves outside the current header layout still take the whole read,
  // which is what upgrades session aliases and configuration.
  const DELETION_HEADER_FIELDS = ['id', 'sessionId', 'mode', 'cardPath', 'timeline', 'candidates', 'candidateAgent',
    'backgroundSessionId', 'backgroundHistoryIds', 'importHistory', 'backgroundTasks',
    'backgroundConfigVersion', 'conversationFeaturesVersion']
  async function readChatForDeletion(chatId) {
    try {
      const chat = (await chatPersistence.readSlice(chatId, [], DELETION_HEADER_FIELDS))?.chat
      if (chat && chat.id === chatId && chat.sessionId !== undefined
        && chat.backgroundConfigVersion === 1 && chat.conversationFeaturesVersion === 1) return chat
    } catch { /* a damaged save reports the same failure through the whole read */ }
    return await readChat(chatId)
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
    for (const item of prepared) {
      if (outcomes.has(item.chatId)) continue
      try {
        await conversationDeletion.remove(item.chatId, footprints.get(item.chatId))
        outcomes.set(item.chatId, { chatId: item.chatId, ok: true })
      } catch (error) { outcomes.set(item.chatId, { chatId: item.chatId, ok: false, error: String(error?.message || error) }) }
    }
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
  async function cleanupDeletedChat(chatId, footprint) {
    const sessionId = footprint?.foregroundSessionId
    if (sessionId && !deletedSessionIds.has(sessionId)) {
      deletedSessionIds.add(sessionId)
      pluginApi.gameRemoved(sessionId)
    }
    async function cleanupFiles() {
      if (!footprint) return
      if (sessionId) {
        await apiDiagnostics.forget(sessionId)
        await backgroundAgentRunner.releaseFor(sessionId)
        await profileData.remove(writingPreparationBindingPath(sessionId))
      }
      // A session DSH still holds loaded would be written back; delete it on the next start.
      const live = footprint.items.filter(item => item.category === 'subsession' && agentRegistry.get(item.sessionId))
      if (live.length) await gameFootprint.deferSessionDeletion(live)
      const cleanup = await gameFootprint.removeLeftovers({ ...footprint, items: footprint.items.filter(item => !live.includes(item)) })
      if (cleanup.failures.length) throw new Error(cleanup.failures[0].error)
    }
    // These stores are independent. Attempt each even if another fails, keeping
    // the journal entry until every step has succeeded or been durably deferred.
    const results = await Promise.allSettled([
      pluginMedia.removeChat(chatId),
      pluginData.removeChat(chatId),
      displayRuntimeStore.remove(chatId),
      sceneWorldbookArchive.forgetChat(chatId),
      cleanupFiles()
    ])
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new Error(failures.map(({ reason }) => reason?.message || String(reason)).join('；'))
  }
  async function deleteChat(chatId) {
    const { results: [result] } = await deleteChats([chatId])
    if (!result.ok) throw new Error(result.error)
    return { deleted: true }
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
    readChat, readWorldSnapshot: chatPersistence.readWorldSnapshot,
    assertIdle: chat => assertGameSaveExportable(chat, {
      agentRunning: agentRegistry.get(chat.sessionId)?.phase?.kind === 'running',
      settlementRunning: Boolean(settlementJobs.pending(chat.id))
    }),
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
    rawWriteChat, conversationRegistry, profileData, sceneWorldbookArchive, adoptConfiguration: adoptConversationConfiguration,
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
    readLibraryCard: readCard,
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
  const liveCardUpdate = createLiveCardUpdate({readGlobals:readPromptTemplateGlobalVariables,
    // Games without their own copy still preview against the book they play with.
    readWorldBook: (chat, card) => worldBooks.bound(chat.cardPath, card, chat)})
  ctx.effect(() => () => liveCardUpdate.dispose())
  const cardUpdates = createPlayCardUpdate({
    chats: { header: chatHeaderForSession, forSession: chatForSession, update: updateChat },
    cards: {
      read: readCard, extensions: readCardExtensions,
      stamp: async cardPath => (await fileResources.metadata(normalizeResourcePath(cardPath, 'card')).catch(() => null))?.updatedAt || 0
    },
    snapshots: () => playCardSnapshots,
    liveUpdate: liveCardUpdate,
    native: {
      agent: sessionId => agentRegistry.get(sessionId),
      session: sessionId => sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session,
      flush: session => sessionStore.flush(session)
    },
    activity: { observed: sessionActivity, current: chat => backgroundTasks.activity(chat) },
    present: view,
    published: sessionId => sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'card-reload:' + Date.now() })
  })
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
    const playable = groupOfMode(mode || 'story') === 'play'
    if (playable) await stageRuntime.assets.cardStageMode(cardPath)
    // Plain greetings have no interactive preview draft, but need the same
    // game-local worldbook snapshot as scripted openings.
    const ownsDraft = !preparationId
    if (ownsDraft && playable) {
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
    if (playable) {
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
  async function readCardResourceVersions(chat) {
    if (!chat.cardPath || chat.mode === 'card') return null
    const [binding, scriptPath, scriptsVersion] = await Promise.all([
      fileResources.worldBookBindingForCard(chat.cardPath),
      chat.mode === 'script' ? fileResources.scriptForCard(chat.cardPath) : null,
      cardScripts.version(chat.cardPath)
    ])
    const paths = new Set([chat.cardPath])
    for (const source of binding.sources || [binding]) if (source.path || source.cardPath) paths.add(source.path || source.cardPath)
    if (scriptPath) paths.add(scriptPath)
    const versions = await Promise.all([...paths].map(file => profileData.version('resources/' + file)))
    return [binding, [...paths], versions, scriptsVersion, stageRuntime.status(), cardUpdates.revision(chat.sessionId)]
  }
  const sessionProjection = createSessionViewProjection({
    readChanges: (id, revision) => chatPersistence.readChangedSlice(id, revision, 'settlement'),
    scheduleTemplateSync,
    warmCandidates: sessionId => candidateWorldbookPreparation?.warm(sessionId),
    requestPerformance,
    readTavernSettings,
    readSettingsVersion: () => profileData.version(TAVERN_SETTINGS_PATH),
    readScript,
    scriptContinuity,
    groupOfMode,
    tavernExtensionSettings,
    readCardExtensions: (cardPath, chat, settings) => readCardExtensions(cardPath, chat, false, settings),
    readLiveCardStage, stageReadScope, readStageChat,
    readCardStageMode: cardPath => stageRuntime.assets.cardStageMode(cardPath),
    readCardResourceVersions,
    tavernRemoteAssets,
    liveCardUpdate,
    activityOf: chat => backgroundTasks.activity(chat),
    cardUpdateStatus: cardUpdates.status,
    agentRegistry,
    str,
    sessionResources,
    worldBooks,
    sessionDebugEvidence,
    cardViewOf,
    projectLedgerTask: chat => manualLedger.project(chat),
    projectCharacterDesignTask: chat => manualCharacterDesign.project(chat),

    readPromptTemplateGlobalVariables,
    readGlobalVariablesVersion: promptTemplateGlobalVariables.version,
    sessionStore,
    readChatCard,
    workspaceViewOf,
    helperHistoryAccess,
  })
  function view(...args) { return sessionProjection.view(...args) }
  function projectOpeningWindow(...args) { return sessionProjection.project.opening(...args) }
  const STORY_OPENING_WINDOW = 10
  // `historyFrom`: the oldest floor the browser has scrolled to; the window grows
  // to cover it instead of switching the whole session to a complete view.
  //
  // A regular short game (at most one cold window of floors) used to be refused here:
  // with nothing above the window the bounded read is refused as "no partial history",
  // so the opening read fell back to the complete reader — every floor materialized
  // with its full MVU variable snapshot, ~0.8 s on a phone for a hundred-floor save.
  // The first read of a game (historyFrom absent) has no floor to honour yet, so the
  // same bounded read is accepted when it already holds the whole history: no hole is
  // left to fill, and the projected window is the complete view without that cost.
  // Scrolling back to the first floor still asks for the complete view: the page then
  // needs the floors the window never carried, and only that reader can grow from there.
  async function readOpeningWindow(sessionId, historyFrom, limit = STORY_OPENING_WINDOW) {
    const chatId = (await readSessionMap())[str(sessionId)]
    if (!chatId) return null
    // Scrolled back to the first floor: the window would be the whole history, read page by
    // page only to be refused. The complete view refreshes from changed floors instead.
    if (historyFrom === 0) return null
    const scrolled = Number.isSafeInteger(historyFrom) && historyFrom > 0
    const window = await readRecentWindow(chatPersistence.readWindow,chatId,{limit,from:historyFrom,requirePartial:scrolled,messageFields:sessionViewMessageFields})
    if (!window || window.chat.sessionId!==sessionId
      || window.chat.backgroundConfigVersion!==1 || window.chat.conversationFeaturesVersion!==1
      || !['story','script'].includes(window.chat.mode || 'story')
      || window.chat.messages.some(message=>message.role==='assistant' && !Number.isSafeInteger(message.turn))) return null
    // `from === 0` is only usable when this window is the whole history (every floor is a
    // real row, nothing outside it): otherwise the page would lose the floors above it.
    if (window.from === 0) {
      const complete = windowCoversHistory(window) && window.messageCount <= limit
      if (!complete) return null
    }
    return window
  }
  const readStoryTranscriptWindow = createStoryTranscriptReader({
    readSessionMap,
    readWindow: chatPersistence.readWindow,
    readRecentSummaries: chatPersistence.readRecentSummaries,
    readChat,
    readToolEvents: async id => {
      try { return await readNativeEvents(id) }
      catch (error) {
        console.warn('dsh-tavern: 读取故事工具调用记录失败', str(error?.message || error))
        return []
      }
    },
    messageFields: storyTranscriptMessageFields,
    limit: STORY_OPENING_WINDOW
  })
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
    readStoryWindow: readStoryTranscriptWindow,
    readStoryVersion: async (sessionId, chatId) => (await readSessionMap())[str(sessionId)] === chatId ? chatPersistence.version(chatId) : '',
    resourceVersion: async chat => {
      if (!chat.cardPath || chat.mode === 'card') return ''
      // machine-local mute changes invalidate the cached helper-script view.
      return JSON.stringify(await Promise.all([readCardResourceVersions(chat), tavernExtensionSettings.version(), promptTemplateGlobalVariables.version()]))
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
  let pluginApi = null
  const contextPlanner = createContextPlanner({ prompt: runtimePrompt, callModel: callModel, now: Date.now, logger: console,
    guideSections: gameId => pluginApi?.guideSections(gameId) })
  const foregroundCapabilities = stageRuntime.foreground({
    session: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
    // A card that declares one of a mod's tools stands for that mod: the stage leaves out that mod's prompts.
    cardGoverns,
    readConfig: cardPath => dialogueBubbles.read(cardPath, {requireAvailable:true}),
    // The tools the model may call in this game, one of the foreground capabilities a turn's update reports.
    tools: chat => turnOrchestrator.callableTools(chat.sessionId),
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
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, write: writeChat, update: updateChat,
      openingSwitchState: async sessionId => (await chatSliceForSession(sessionId, [], ['nativeOpeningSwitch', 'openingText', 'id', 'sessionId']))?.chat,
      writeHeader: chat => updateChatHeader(chat.id, ['nativeOpeningAppended', 'updatedAt', '_storageRevision'],
        () => ({ nativeOpeningAppended: true }), { source: 'opening.native-append' }) },
    trace: requestPerformance,
    timeline: storyTimeline,
    snapshots: playCardSnapshots,
    pluginDataStore,
    userPreferenceProfile,
    presets: runtimePresets,
    settings: readTavernSettings,
    emptyCardWorkspace,
    id: uid,
    native: {
      assertReplacementAllowed() {
        if (!sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
      },
      wait: function (sessionId) { return waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }) },
      ensurePrefix: function (session, text) { return ensureSessionStablePrefix(session, text, stablePrefixStorage) },
      ensureCardWorkspace: ensureNativeCardWorkspace,
      flush: function (session) { return sessionStore.flush(session) },
      selection: modelSelection,
      async selectModel(target, selection) {
        const resolved = await llm.resolveCallConfig(selection)
        const controller = ctx.get('sessionController')
        if (!target.agent) throw new Error('无法设置新游戏默认前台模型')
        selectSessionModel({ agent: target.agent, controller, unsupported: '无法设置新游戏默认前台模型',
          selection: { provider: resolved.provider, model: resolved.model, ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}) } })
        await sessionStore.flush(target.session)
      }
    },
    present: async function (chat, card, options) {
      const result = await view(chat, card, false, options)
      if (chat.mode === 'card') result.workspace = workspaceViewOf(chat)
      return result
    }
  })
  // 叙事阻尼器设置的唯一实例：宿主 RPC 与内置插件面板（tavern.damperSettings）都读它。
  // 阻尼器引擎晚于 pluginApi 构造，所以插件面按调用时取，不在构造期抓快照。
  let damperSettingsService = null
  const requireDamperSettings = () => {
    if (!damperSettingsService) throw Object.assign(new Error('叙事阻尼器服务未就绪'), { code: 'DAMPER_NOT_READY' })
    return damperSettingsService
  }
  const projectBuiltinWorldbook = createForegroundWorldbook({
    bound: (cardPath, card, chat) => playWorldBook(chat, card),
    runtime: promptTemplateRuntime,
    globalVariables: readPromptTemplateGlobalVariables,
    scanText: async chat => {
      const extras = typeof pluginApi?.worldbookScanTexts === 'function'
        ? await pluginApi.worldbookScanTexts({ gameId: chat.sessionId }).catch(() => [])
        : []
      return [scriptPromptScanText(chat), ...extras].filter(Boolean).join('\n')
    }
  })
  ctx.effect(() => () => projectBuiltinWorldbook.dispose())
  const worldbookStrategies = createWorldbookStrategies({
    nativeSkills: projectBuiltinWorldbook
  })
  const projectForegroundWorldbook = async input => {
    const agent = input.purpose === 'history-import' ? null : agentRegistry.get(input.chat.sessionId)
    const lookups = recentWorldbookLookups(agent?.session, input.chat.messages)
    return await worldbookStrategies.project({ ...input, recentlyReadRefs: worldbookSkillProvider.refsForLookups(agent, lookups) })
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
  const cardLeftovers = createCardLeftovers({ dataRoot, profileData, castAssets, worldbookFiles: worldbookSkillProvider, presentationObservers })
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
    let published = false
    try {
      const workspace = await ctx.get('workspaceRegistry')?.resolveByPath(cwd)
      if (workspace) await workspace.attachSession(sessionId)
      const imported = await chatHistoryImporter.import({ operationId: randomUUID(), sessionId, cardPath, text: args.text,
        fileName: str(args.fileName) || 'import.jsonl', textOnly: args.textOnly === true, ...(args.userName ? { userName: str(args.userName) } : {}),
        // 迁移包导入把内容指纹交给 plan，省掉导入完成后再整档读写的补写；没有它时行为不变。
        ...(args.saveHash ? { saveHash: str(args.saveHash), saveFormat: str(args.saveFormat) } : {}) })
      published = true
      const chat = await chatForSession(sessionId).catch(() => null)
      return { ...imported, ...(chat?.id ? { chatId: str(chat.id) } : {}), ...(chat?.title ? { title: str(chat.title) } : {}) }
    } finally {
      await handle.dispose()
      if (!published) {
        await (await ctx.get('workspaceRegistry')?.resolveByPath(cwd))?.detachSession(sessionId).catch(() => {})
        try {
          const located = ctx.get('sessionPersistence')?.locate?.({ id: sessionId, cwd })
          if (located?.path) await rm(path.dirname(located.path), { recursive: true, force: true }).catch(() => {})
        } catch {}
      }
    }
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
  async function prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn, requestedMessageIndex, requestedRevision, requestedMessageUid) {
    const source = str(sourceChatId) === '' ? await chatForSession(str(sourceSessionId)) : await readChat(str(sourceChatId))
    if (!source) throw new Error('找不到要分叉的源对话')
    assertConversationForkable(source, { agentRunning: agentRegistry.get(source.sessionId)?.phase?.kind === 'running' })
    if (requestedMessageIndex !== undefined && requestedMessageIndex !== null) {
      if (!Number.isSafeInteger(requestedMessageIndex) || requestedMessageIndex < 0) throw new Error('分叉消息位置无效')
      const messageUid = requestedMessageUid === undefined || requestedMessageUid === null ? '' : str(requestedMessageUid)
      if (requestedMessageUid !== undefined && requestedMessageUid !== null && messageUid === '') throw new Error('分叉消息身份无效')
      let requestedIndex = requestedMessageIndex
      if (messageUid) {
        const matches = []
        for (let index = 0; index < (source.messages || []).length; index++) {
          if (legacyMessageUid(source.messages[index], index) === messageUid) matches.push(index)
        }
        if (matches.length !== 1) throw new Error('分叉消息已经变化，请重新选择')
        requestedIndex = matches[0]
      } else if (requestedRevision !== source._storageRevision) throw new Error('剧情已变化，请重新选择分叉消息')
      const { state, turn, messageIndex } = await conversationStateAtMessage(source, requestedIndex, readChatRevision)
      // A story fork starts a blank native Session. The committed Chat prefix is
      // bound first; native repair then projects that prefix into model context.
      return { source, state, turn, messageIndex, atSeq: null, storyDirect: true, ...(messageUid ? { messageUid } : {}) }
    }
    const { state, turn, messageIndex } = await conversationStateAtTurn(source, requestedTurn, readChatRevision)
    return withHostSession(foregroundSessionHost, source.sessionId, session => {
      const references = upgradeReferences(sessionEvents(session))
      const mapped = structuredClone(state)
      for (const message of mapped.messages || []) {
        if (message.nativeAnchor) message.nativeAnchor = upgradedAnchor(message.nativeAnchor, references)
        if (message.bodyEdit) message.bodyEdit = { ...message.bodyEdit, seq: references.sequence(message.bodyEdit.seq, message.bodyEdit.formatVersion), formatVersion: 4 }
      }
      // A turn whose body was rewritten after its own turn/end (an edit, a polish
      // write-back, a rescued stream) no longer has a native boundary that carries that
      // text. A story fork rebuilds native context from the message prefix, so take that
      // path instead of refusing a branch the save can still cut.
      let atSeq = null
      try {
        atSeq = conversationForkBoundary(session, state, turn)
      } catch (error) {
        if (error?.code !== FORK_BOUNDARY_MISSING && error?.code !== FORK_BOUNDARY_UNSAFE) throw error
      }
      if (atSeq === null) {
        const messageUid = legacyMessageUid(source.messages?.[messageIndex], messageIndex)
        return { source, state: mapped, turn, messageIndex, atSeq: null, storyDirect: true, ...(messageUid ? { messageUid } : {}) }
      }
      return { source, state: mapped, turn, atSeq, storyDirect: false }
    })
  }
  // Plugin data and media are bound to text versions, whose keys hash the game id:
  // map the fork's visible turns to the new game's keys. A failure never undoes the fork.
  async function forkPluginState(source, state, fork, lastTurn, includedTurns) {
    try {
      const keyMap = new Map()
      for (const turn of await pluginApi.forkTurns(source.id)) {
        // The selected message prefix, not a numeric upper bound, defines the
        // branch. Legacy saves may contain missing, duplicate or reordered turns.
        if (!includedTurns.has(Number(turn))) continue
        try { keyMap.set(turn + '\u0000' + computeSceneTarget({ ...state, id: source.id }, turn).key, computeSceneTarget(fork, turn).key) } catch {}
      }
      await pluginApi.gameForked({ sourceChatId: source.id, targetChatId: fork.id, targetSessionId: fork.sessionId, keyMap })
      pluginApi.timelineChanged(fork.sessionId, { kind: 'fork', turn: lastTurn, fromGameId: source.sessionId })
    } catch (error) { console.warn('dsh-tavern: 分叉时处理插件数据失败:', str(error?.message || error)) }
  }

  async function forkCardWorkbench(sessionId, messageId) {
    const source = await chatForSession(str(sessionId))
    if (source?.mode !== 'card' || source.requestMode === 'sillytavern') throw new Error('找不到当前卡片工作台对话')
    if (typeof messageId !== 'string' || !messageId) throw new Error('请选择一条已完成的回复')
    const controller = ctx.get('sessionController')
    if (typeof controller?.fork !== 'function') throw new Error('当前 DSH 版本不支持对话分支')
    const { atSeq, turn, messages } = cardWorkbenchForkPoint(await readNativeEvents(source.sessionId), messageId)
    const { sessionId: targetId } = await controller.fork({ sessionId: source.sessionId, atSeq })
    const fork = forkConversationChat({ ...source, messages }, { chatId: uid('chat'), sessionId: targetId, id: uid, lastNativeTurn: turn })
    Object.assign(fork.forkedFrom, { turn, atSeq })
    fork.title = (source.title || source.cardName || '卡片工作台') + ' · 分支'
    fork.pendingCardChanges = {}
    if (fork.workspace) fork.workspace.prepared = null
    if (Number(fork.lastCardSave?.turn) > turn) delete fork.lastCardSave
    delete fork.lastOpenedAt
    delete fork.contextCompaction
    try {
      await conversationRegistry.publish(fork)
    } catch (error) {
      try { await ctx.get('workspaceRegistry')?.archiveSession(targetId) }
      catch (archiveError) { ctx.logger.warn('dsh-tavern: 清理工作台分支失败', archiveError) }
      throw error
    }
    try { await controller.rename?.({ sessionId: targetId, title: fork.title }) }
    catch (error) { ctx.logger.warn('dsh-tavern: 工作台分支已创建，但自动命名失败', error) }
    return conversationForkReceipt(fork, { lastTurn: turn, messageCount: messages.length })
  }

  async function forkChat(sourceChatId, sourceSessionId, targetSessionId, requestedTurn, expectedRevision, expectedAtSeq, requestedMessageIndex, requestedMessageUid) {
    const { source, state, turn, atSeq, messageIndex, storyDirect, messageUid } = await prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn, requestedMessageIndex, expectedRevision, requestedMessageUid)
    // Stable story identity covers unrelated writes between prepare and execute.
    // Legacy story requests and native atSeq forks retain their original fences.
    const sourceChanged = !(storyDirect && messageUid) && expectedRevision !== source._storageRevision
    if (sourceChanged || (!storyDirect && expectedAtSeq !== atSeq)) throw new Error('源对话已变化，请重新选择分叉位置')
    const targetId = str(targetSessionId)
    if (targetId === '' || await chatForSession(targetId) !== undefined) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
    let targetHandle
    let target = sessionStore.get(targetId) || agentRegistry.get(targetId)?.session
    try {
      if (!target) { targetHandle = await agentRegistry.resume({ resumeSessionId: targetId }); target = targetHandle.agent.session }
      if (!target) throw new Error('分叉目标原生会话尚未就绪')
      if (storyDirect) assertBlankStoryForkTarget(targetId, target)
      else {
        const targetEnd = sessionEvents(target).findLast(event => event.type === 'turn/end')
        if (!targetEnd || targetEnd.seq !== atSeq) throw new Error('原生分叉没有停在指定回合，已拒绝绑定游戏状态')
      }
      const lastNativeTurn = storyDirect ? 0 : Number(sessionEvents(target).findLast(event => event.type === 'turn/start')?.data?.turn) || 0
      const includedTurns = new Set((state.messages || []).filter(message => message?.role === 'assistant')
        .map(message => Number(message.turn)).filter(turn => Number.isSafeInteger(turn) && turn >= 0))
      const lastStoryTurn = [...includedTurns].reduce((highest, turn) => Math.max(highest, turn), 0)
      // Imported rows may contain arbitrary turn labels. Bound how many synthetic
      // events a blank Session can write before publishing a new Chat for it.
      if (storyDirect && lastStoryTurn > 100_000) throw new Error('分叉前缀的轮号超过原生上下文可重建范围')
      const fork = forkConversationChat(state, { chatId: uid('chat'), sessionId: targetId, id: uid, now: Date.now, lastNativeTurn })
      fork.forkedFrom = { ...fork.forkedFrom, chatId: source.id, sessionId: source.sessionId, storageRevision: source._storageRevision,
        stateChatId: state.id, stateRevision: state._storageRevision, turn, ...(storyDirect ? { messageIndex, atSeq: null } : { atSeq }) }
      if (storyDirect) {
        fork.nativeSync = { status: 'stale', reason: '故事分叉等待原生上下文同步', at: Date.now() }
        // Do not suppress opening recovery until the native prefix really exists.
        fork.nativeOpeningAppended = false
      }
      await conversationRegistry.publish(fork, storyDirect ? {
        assertUnboundSession: () => assertBlankStoryForkTarget(targetId, target)
      } : undefined)
      await saveMaintenance.recordFork(fork).catch(error => console.warn('dsh-tavern: 记录分叉来源失败', str(error?.message || error)))
      await sceneWorldbookArchive.copyRefs(state.id, fork.id, includedTurns).catch(() => {})
      await forkPluginState(source, state, fork, turn, includedTurns)
      if (storyDirect) {
        const repaired = await seedNativeStory(targetId, target, lastStoryTurn, '故事分叉后按消息历史建立原生上下文')
          .catch(error => { console.warn('dsh-tavern: 故事分叉原生上下文修复失败:', str(error?.message || error)); return null })
        if (repaired?.applied) {
          fork.nativeOpeningAppended = true
          await updateChatHeader(fork.id, ['nativeOpeningAppended'], () => ({ nativeOpeningAppended: true }), { source: 'conversation.story-fork-native-ready' })
            .catch(error => console.warn('dsh-tavern: 保存故事分叉开场白状态失败:', str(error?.message || error)))
        }
      }
      const receiptTurn = turn > 0 ? turn : lastStoryTurn
      return conversationForkReceipt(fork, { lastTurn: receiptTurn, messageCount: fork.messages.length })
    } finally {
      if (targetHandle) await targetHandle.dispose().catch(error => console.warn('dsh-tavern: 释放分叉目标 Session 句柄失败:', str(error?.message || error)))
    }
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
  // Stage-director children an earlier release wrote with a descriptor the host rejects.
  const directorDescriptors = createDirectorDescriptorRepair({
    dataRoot: resolveTavernDataRoot(),
    loadCatalog: sessionPatch.loadSessionCatalog,
    listSessions: async () => (await ctx.get('sessionQuery')?.listSessions?.()) ?? [],
    hostIdentity: header => {
      const values = ctx.get('sessionProjectionCache')?.cachedSnapshot(header, ['subagent'])?.values
      return values && Object.hasOwn(values, 'subagent') ? values.subagent : undefined
    },
    // The cache would otherwise keep serving the empty identity folded from the old descriptor.
    forgetProjections: id => ctx.get('sessionProjectionCache')?.table?.delete(id),
    isLive: id => Boolean(sessionStore.get(id) || agentRegistry.get(id))
  })
  void directorDescriptors.sweep().catch(error => console.warn('dsh-tavern: 修复舞台导演会话描述失败', error?.message || error))
  const runtimePresetSnapshots = new Map()
  const backgroundPresetSeeds = new Map()
  // The stage director runs beside the game's background work: a game-wide stop or progress read leaves it alone.
  const parallelBackgroundTasks = ['stage-director']
  // The background catalogue is fixed (a stable prefix); a task is allowed only its own. The mod tools that backfill in the
  // variable settlement (lib/mod-tools.js) join it with their backfill definitions.
  const BACKGROUND_TOOLS = [POSTURE_SUBMIT_TOOL, CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_REUSE_TOOL, MVU_SUBMIT_UPDATE_TOOL, CANDIDATE_SUBMIT_TOOL, SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL, LEDGER_SUBMIT_TOOL,
    ...modTools.filter(tool => tool.backfill).map(tool => tool.backfill.definition)]
  // What a background task asks of the runner beyond the game's background defaults, declared by the task's owner:
  // ownModel (keep the selection it brings), webSearch: false, cardContext: false (no card/worldbook injection),
  // frozenContext(input) → a frozen shared context {worldbook, stablePrefix, stablePrefixRevision} or null.
  // The stage module declares its director's; 精修 brings its own model.
  const backgroundTaskPolicies = new Map([['polish', { ownModel: true }]])
  const taskPolicy = input => backgroundTaskPolicies.get(input?.task) || {}
  const frozenContext = input => taskPolicy(input).frozenContext?.(input) || null
  const contextHost = createContextHost({ pluginApi: { resolveReadCapability: input => pluginApi.resolveReadCapability(input) }, chatForSession, recallHistoryForSession, callModel, runner: () => backgroundAgentRunner })
  ctx.effect(() => () => contextHost.dispose())
  // The trusted shared-context surface a stage mod reaches through ctx (no mod ids here).
  ctx.provide('tavernContextHost', Object.freeze({ registerSharedProvider: contextHost.registerSharedProvider, bind: contextHost.bind, estimate: estimateStoryTokens,
    runSharedTask: input => backgroundAgentRunner.runSharedTask(input),
    // A round with no shared background task: wait for the session's background queue, then one plain background call.
    afterBackground: sessionId => backgroundAgentRunner.idle(sessionId), sharedAnchor: sessionId => backgroundAgentRunner.sharedAnchor(sessionId),
    callBackground: ({ sessionId, system, text, signal }) => callModel({ sessionId, background: true, system, signal, returnUsage: true,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }] }) }))
  const backgroundAgentRunner = createBackgroundAgentRunner({
    prepareSharedContext: contextHost.prepareSharedContext,
    resolveSharedTaskAnchor: contextHost.resolveSharedTaskAnchor,
    resolveSharedReadTools: contextHost.resolveSharedReadTools,
    parallelTasks: parallelBackgroundTasks,
    allowRun: async input => (await pluginApi.hostBehavior.forGame(input.sessionId)).backgroundAgents,
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
      const recent = await readOpeningWindow(input.sessionId, undefined, HELPER_MESSAGE_COLD_WINDOW)
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
    compactAgent: async (agent, signal) => {
      await configureAgentCompaction(agent)
      return executeBackgroundCompaction(agent, signal)
    },
    flushSession: async function (session) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) throw new Error('dsh-tavern: 缺少 sessions 服务')
      await sessions.flush(session)
    },
    resolveRuntimePresetSnapshot: async function (input) {
      const parentSessionId = str(input && input.sessionId)
      const agentSessionId = str(input && input.agentSessionId) || parentSessionId
      if (!parentSessionId) return null
      const config = await backgroundConfigForSession(parentSessionId)
      if (config?.backgroundTasks?.preset !== true) {
        backgroundPresetSeeds.delete(agentSessionId)
        return null
      }
      const chat = await chatForSession(parentSessionId)
      const rawSnapshot = chat ? await resolveChatRuntimePreset(chat) : null
      if (!rawSnapshot) return null
      const turn = Math.max(0, Number(input && input.turn) || 0)
      const step = Math.max(1, Number(input && input.step) || 1)
      const currentSeed = backgroundPresetSeeds.get(agentSessionId)
      const randomSeed = step > 1 && currentSeed && currentSeed.turn === turn
        ? currentSeed.seed
        : randomUUID()
      if (step === 1 || !currentSeed || currentSeed.turn !== turn) {
        backgroundPresetSeeds.set(agentSessionId, { turn, seed: randomSeed })
      }
      return resolveRuntimePresetMacros(rawSnapshot, {
        charName: chat.cardName,
        macroState: chat.macroState,
        randomSeed
      }).snapshot
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
    if (!foregroundStyleReferenceEnabled(chat)) throw Error('请先开启本局文风联想')
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
    withForegroundAgent: withForegroundTaskAgent,
    replaceLedger: input => pluginApi.replaceLedger(input),
    // Reads of the session are what show a running task's status; announce the
    // transitions so an open panel does not need a two-second full-view poll.
    onStatus: sessionId => { if (sessionId) sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'manual-task:' + Date.now() }) }
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
    withForegroundAgent: withForegroundTaskAgent,
    onStatus: sessionId => { if (sessionId) sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'manual-task:' + Date.now() }) }
  })
  // Work other modules report as busy to the deployment gate (getDeploymentActivity).
  const deploymentWork = []
  await stageRuntime.start({hostLibrary, contextHost, dataRoot, uploads, activeStageSkin, workbenchAuthority,
    // the one reader of variable conditions (an asset's recall.when, revealWhen), for the stage's recall.
    variableConditionHolds: mvuConditionHolds,
    presentationObservers, settlementParticipants, workflow, modelSlots, chatHeaderForSession, dialogueBubbles, activeRoundBodies, voiceBackfillLines, voiceBackfillKept,
    // No background task starts while the game is compacted (ADR 0003); the coordinator's own guard.
    backgroundBlocked: chat => Boolean(autoCompaction?.blocked(chat)),
    readReplyPrefix:(sessionId,turn) => assistantResultForTurn(sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session,turn)?.text || '',
 worldBooks, containStage, cardsActive: () => assetCardsActive, llm, requestPerformance, sessionSignals, coordinationEvents, fileResources, cardPreparation, cardStorage, cardPlugins, bumpCardProjectionRevision, syncCardName, readChat, readChatCard, readStageChat, stageReads, readRoundView, storyEvents, deploymentWork, backgroundTaskPolicies, chatForSession, chatPersistence, chatJournalStore, rawUpdateChat, updateChat, updateChatMessage, patchChat, storyTimeline, replyDisplayForChat, sessionActivity, modelSelection, resolveSlot, readTavernSettings, callModel, modelRequestLog, backgroundAgentRunner, tavernScriptHostAdapter, tavernScriptDispatch})
  const mvuSettlement = createMvuSettlementModule({
    model: backgroundAgentRunner,
    runtime: tavernScriptHostAdapter,
    diagnostics: mvuDiagnostics,
    characterDesign: characterDesignDocuments
  })
  ctx.effect(() => () => backgroundAgentRunner.dispose(), 'dsh-tavern: dispose resident background agents')
  // Asset pictures come from an image plugin (tavern.imageProvider); Tavern keeps no image channels.
  const assetGeneration = createAssetGeneration({store:profileData, imageProvider:() => pluginApi.imageProviders()[0], getLibrary:() => ctx.get('assetLibrary'),
    // a figure linked to the 配图 人物库 takes its 外貌 from there (the one store); unlinked figures keep the pack text.
    linkedAppearance: async ({packId, figureId, outfitKey}) => {
      const linked = await findFigureImageCharacter(pluginApi, {packId, figureId})
      return linked.status === 'linked' ? appearanceFromImageCharacter(linked.character, outfitKey) : null
    }})
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
    readChatCard,
    regexScripts: pluginTurnRegexScripts
  })
  const pluginSettlementProgress = createPluginSettlementProgress()
  // What each 精修 changed, shown on the 精修对比 page.
  const polishRecords = createPolishRecords({
    data: pluginData, turns: pluginTurns,
    onSaved: (sessionId, requestId) => sessionSignals.publish(sessionId, { kind: 'polish-saved', version: requestId || randomUUID() })
  })
  const polishReviewer = createPolishReviewer({ latestFloors: (sessionId, count) => chatHeaderWithLatestFloors(sessionId, count, { includePosition: true }), readCard, prompt: runtimePrompt, runAgent: input => backgroundAgentRunner.run(input), withForegroundAgent: withForegroundTaskAgent, selection: async sessionId => {
    // 精修模型 (setting polishModel): one model for every game's 精修; unset, or a model no longer
    // offered, follows the game's own story model.
    const chosen = (await readTavernSettings()).polishModel
    if (chosen && (await tavernModelCatalog()).some(group => group.provider === chosen.provider && group.models.some(model => model.id === chosen.model))) return chosen
    const selected = modelSelection(sessionId)
    if (!selected) throw new Error('没有可用的模型配置，请先选择模型')
    return selected
  }, data: pluginData })
  // 自动精修 (setting polishPrereview, off by default): each reply is reviewed as soon as it is
  // written, beside settlement, and the review is written back into the reply in place.
  const autoPolishEnabled = async () => (await readTavernSettings()).polishPrereview === true
  const polishPrereview = createPolishPrereview({
    enabled: autoPolishEnabled,
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
    return withForegroundTaskAgent(sessionId, async () => {
      signal.throwIfAborted()
      const edit = await bodyEditor.read(sessionId)
      const current = edit.parts.filter(part => part.kind === 'text').map(part => part.text)
      // The reply changed meanwhile (an edit, a regeneration, a 精修): this review is not for it.
      if (JSON.stringify(current) !== JSON.stringify(texts)) return
      if (!await autoPolishEnabled()) return
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
    })
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
  // One line in its voice through the voice service (domain/speech.js): { url, mediaType, loudness }, { browser, voice, text }
  // or { skip, reason } (TTS_UNAVAILABLE without a voice service). A figure voice needs the stage's card speech, which only
  // a page's authenticated origin opens; without it the line uses the 台词朗读 voice.
  async function speakLine(sessionId, { speaker, text, emotion, narration } = {}, origin) {
    const card = await castCardOf(str(sessionId)).catch(() => null)
    const figures = card && origin ? await stageRuntime.assets.cardSpeech({ sessionId: str(sessionId), cardPath: card.path }, origin) : null
    const extension = card && !figures && narration === true ? await cardStageExtension(card.path).catch(() => null) : null
    return speech.speak({ text, speaker: str(speaker), emotion: str(emotion) || 'neutral', narration: narration === true, figures, extension: extension || undefined })
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
    const selected = await chatSliceForSession(sessionId, indices, ['macroState', 'mode', 'cardPath', 'cardId', 'runtimePresetSnapshot', 'regexOverrides'])
    const fallbackChat = selected?.chat?.messages ? null : await chatForSession(sessionId)
    const header = selected?.chat || fallbackChat
    const byIndex = selected?.chat?.messages ? new Map(indices.map((index, at) => [index, selected.chat.messages[at]]))
      : new Map((fallbackChat?.messages || []).map((row, index) => [index, row]))
    const macroState = header?.macroState
    const regexScripts = header ? await pluginTurnRegexScripts(sessionId, header) : []
    return picks.map(pick => {
      const row = byIndex.get(pick.index), source = pluginSource(row)
      return { turn: pick.turn, input: pick.input >= 0 ? str(byIndex.get(pick.input)?.sourceText ?? byIndex.get(pick.input)?.text) : '',
        text: projectedSceneText(source, macroState, { regexScripts }), rawText: source }
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
  async function runPluginTask({ gameId, owner, prompt, tools, call, signal, member = '', system, selection: customSelection, temperature, maxToolCalls, stopToolsWhen, acceptWithoutText, id = '', rewindTo, rewindFormatVersion, resolvePersistentSessionId, onPersistentSessionReady, writingPreparation }) {
    const selection = customSelection || (writingPreparation ? modelSelection(gameId) : backgroundModelSelection(await backgroundConfigForSession(gameId)))
    if (!selection) throw new Error(writingPreparation ? '这局没有可用的前台模型' : '这局没有可用的后台模型')
    const chat = await storyContext({ sessionId: gameId })
    const recent = (chat?.messages || []).filter(message => message && !message.greeting && ['user', 'assistant'].includes(message.role)).slice(-2)
      .map(message => ({ role: message.role, content: [{ type: 'text', text: pluginSource(message).slice(-2400) }] }))
    // With a plugin member, its resident Session (one per game) instead of a fresh one.
    const ownSystem = writingPreparation?.system ?? system
    const own = ownSystem !== undefined ? { ownPrefix: true, system: ownSystem, taskText: prompt, messages: [] } : { system: prompt, messages: recent }
    if (writingPreparation) {
      const file = writingPreparationBindingPath(gameId)
      let boundId = ''
      resolvePersistentSessionId = async () => {
        boundId = str((await profileData.readJson(file))?.sessionId)
        return boundId
      }
      onPersistentSessionReady = async sessionId => {
        if (boundId !== sessionId) await profileData.writeJson(file, { sessionId })
      }
    }
    return await backgroundAgentRunner.run({
      task: 'plugin',
      pluginName: id ? owner + '/' + id : owner,
      writingPreparation,
      member,
      persistent: Boolean(member || writingPreparation),
      sessionId: gameId,
      selection,
      signal,
      rewindTo,
      rewindFormatVersion,
      resolvePersistentSessionId,
      onPersistentSessionReady,
      turn: Number(chat?.messages?.at(-1)?.turn) || 0,
      ...own,
      tools,
      maxToolCalls: Number.isSafeInteger(Number(maxToolCalls)) ? Math.max(1, Math.min(32, Number(maxToolCalls))) : 16,
      ...(typeof temperature === 'number' && Number.isFinite(temperature) ? { temperature } : {}),
      ...(typeof stopToolsWhen === 'function' ? { stopToolsWhen } : {}),
      ...(typeof acceptWithoutText === 'function' ? { acceptWithoutText } : acceptWithoutText === true ? { acceptWithoutText: () => true } : {}),
      onToolCall: request => call(request.name, typeof request.arguments === 'string' ? JSON.parse(request.arguments || '{}') : request.arguments)
    })
  }
  const resolveGalleryContext = async sessionId => {
    const id = str(sessionId)
    if (!id) return null
    const header = await chatHeaderForSession(id, ['cardPath'])
    return header ? { sessionId: id, cardPath: str(header.cardPath) } : null
  }
  const gameForegroundQueues = new Map()
  let figureRecords = null
  const figurePictures = createFigurePictures(() => ctx.get('assetLibrary'))
  pluginApi = createTavernPluginApi({
    ctx,get modHost() {return ctx.get('tavernManagedModules')},
    // A new turn sees the plugin manager's switch as soon as it is written,
    // even when the host has not disposed the old plugin fiber yet.
    writingPluginEnabled: folder => !existsSync(path.join(dataRoot, 'plugins', folder, DISABLED_FILE)),
    writingSources: createWritingPreparationSources({
      tavernSkills, chatForSession, historyRecall,
      worldbookForChat: async chat => playWorldBook(chat, await readChatCard(chat))
    }),
    replyStreamRewriters,
    logger: console,
    // The asset packs a card plays with: its own and the ones every card uses.
    async cardAssetPacks(cardPath) {
      const own = (await cardStageExtension(cardPath))?.assetBindings.boundPackIds || []
      const global = ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []
      return [...new Set([...own, ...global])]
    },
    // A 人物库 came or went: figures shown from its records read again.
    // Back: what was stored whole while it was away moves into the records (image-character-records.js foldWhole).
    imageLibrariesChanged() {
      const library = ctx.get('assetLibrary')
      library?.figureRecordsChanged?.({}).then(() => figureRecords?.foldWhole(library)).catch(error => console.warn('dsh-tavern: 素材库人物刷新失败', str(error?.message || error)))
    },
    writingFigureRecords: () => figureRecords?.writing() === true,
    // A figure's 设定图 and borrowed 立绘, which 配图 reads by a record's link from the pack, their one store (ADR 0012).
    figurePictures: figures => figurePictures.list(figures),
    readFigurePicture: input => figurePictures.read(input),
    async imagePackCharacters(packIds, selections, includeReferences) {
      const library = ctx.get('assetLibrary')
      if (!library) return []
      const packs = await Promise.all(packIds.map(packId => library.getPackSnapshot({ packId, readOnly: true })))
      return (await Promise.all(packs.filter(Boolean).flatMap(pack => Object.values(pack.figures)
        .filter(figure => figure.enabled !== false)
        .map(async figure => {
          const character = imageCharacterFromFigure(figure, pack.manifest.id)
          const id = `pack:${pack.manifest.id}:${figure.id}`
          const selection = selections?.find(item => item.characterId === id)
          if (selections && !selection) return null
          const outfits = figure.outfits.filter(outfit => outfit.enabled !== false)
          const outfit = selection && (selection.outfitId ? outfits.find(item => item.key === selection.outfitId) : outfits[0])
          const hash = includeReferences && outfit && figurePackPictures(pack, figure).outfits[outfit.key]?.hash
          const reference = hash ? await library.readMedia({ packId: pack.manifest.id, expectedRevision: pack.revision, hash }) : null
          return { ...character, id, consistencyText: figure.description, outfits: character.outfits.filter(item => outfits.some(outfit => outfit.key === item.id)),
            ...(outfit && { outfitId: outfit.key }), ...(reference && { reference: { data: Buffer.from(reference.bytes).toString('base64'), mediaType: reference.descriptor.mime, name: character.name + ' · ' + outfit.label } }) }
        })))).filter(Boolean)
    },
    // A save of 人物库 records linked to figures (ADR 0011: the record is the figure's identity, so only a link that ends writes
    // the pack, giving the figure its identity back in the same save). Then the library reads the changed figures again.
    saveLinkedRecords: (changes, receipt, save) => figureRecords.saveLinked(ctx.get('assetLibrary'), changes, receipt, save),
    storyEvents,
    workflow,
    // A plugin's settings changed in a game: its page side re-reads them (tavernUi.watchGameSettings).
    settingsChanged: (gameId, plugin) => sessionSignals.publish(gameId, { kind: 'plugin-settings', version: plugin + ':' + Date.now() + ':' + Math.random().toString(36).slice(2) }),
    // A plugin published new state for its page side (tavernUi.watchState re-reads it).
    publishState: (gameId, plugin, name) => sessionSignals.publish(gameId, { kind: 'plugin-state:' + plugin + ':' + name, version: Date.now() + ':' + Math.random().toString(36).slice(2) }),
    reservedToolNames: [...BACKGROUND_TOOLS, HISTORY_RECALL_TOOL].map(tool => tool?.name).concat([STYLE_REFERENCE_TOOL_NAME, STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME, STORY_GENERATE_TOOL_NAME, 'character_design_finish', 'worldbook_search', ...WORLDBOOK_ACCESS_TOOLS.filter(name => name !== 'read'), WORKBENCH_READ_LOREBOOK_TOOL, WORKBENCH_UPDATE_LOREBOOK_TOOL, 'web_search', 'web_fetch', 'skill']).filter(Boolean),
    media: pluginMedia,
    data: pluginData,
    projectGameForeground(gameId, projection) {
      const prior = gameForegroundQueues.get(gameId) || Promise.resolve()
      const work = prior.catch(() => {}).then(async () => {
        const chat = await chatHeaderForSession(gameId, [])
        const latest = chat && await pluginData.readMode(chat.id)
        if (!latest || latest.revision !== projection.revision) return
        if (!sessionPatch.serverReady) throw new Error('玩法前台记录需要会话兼容模块，请重启酒馆后重试')
        await restoreGameModeForeground(foregroundSessionHost, gameId, projection)
      })
      gameForegroundQueues.set(gameId, work)
      void work.finally(() => { if (gameForegroundQueues.get(gameId) === work) gameForegroundQueues.delete(gameId) }).catch(() => {})
      return work
    },
    pluginData: pluginDataStore,
    generationPresets: {
      list: presetLibrary.listForGeneration,
      read: presetLibrary.readForGeneration,
      async currentId(sessionId) {
        const chat = await chatHeaderForSession(sessionId, ['runtimePresetSnapshot.presetPath'])
        return chat?.runtimePresetSnapshot?.presetPath
      }
    },
    ...pluginTurns,
    resolveGalleryContext,
    backgroundModel: async sessionId => backgroundModelSelection(await backgroundConfigForSession(sessionId)),
    modelCatalog: tavernModelCatalog,
    foregroundModel: async sessionId => {
      const id = str(sessionId)
      if (!id) return null
      if (agentRegistry.get(id)?.session) return modelSelection(id)
      try { return await withForegroundTaskAgent(id, () => modelSelection(id)) }
      catch { return modelSelection(id) }
    },
    async readPlayMaterial(sessionId) {
      const chat = await chatForSession(str(sessionId))
      if (!chat) return null
      const cardPath = str(chat.cardPath || chat.cardId)
      const card = await readChatCard(chat).catch(() => null)
      let worldbookEntries = []
      let constantWorldbookText = ''
      try {
        const bound = card ? await playWorldBook(chat, card) : null
        worldbookEntries = Array.isArray(bound?.view?.entries)
          ? bound.view.entries.map(entry => ({
              title: str(entry?.title || entry?.comment).trim(),
              keys: Array.isArray(entry?.primaryKeys) ? entry.primaryKeys : (Array.isArray(entry?.keys) ? entry.keys : []),
              constant: entry?.constant === true,
              enabled: entry?.enabled !== false,
              channel: entry?.channel,
              content: str(entry?.content)
            }))
          : []
        constantWorldbookText = str((await candidateWorldbookPreparation?.get(str(chat.sessionId)))?.context || '')
      } catch {}
      const activatedTitles = new Set()
      for (const item of Array.isArray(chat?.lastWorldBookRecall?.activated) ? chat.lastWorldBookRecall.activated : []) {
        const title = str(typeof item === 'string' ? item : item?.title || item?.comment || item?.uid).trim()
        if (title) activatedTitles.add(title)
      }
      for (const item of Array.isArray(chat?.preparedWorldBook?.activated) ? chat.preparedWorldBook.activated : []) {
        const title = str(typeof item === 'string' ? item : item?.title || item?.comment || item?.uid).trim()
        if (title) activatedTitles.add(title)
      }
      if (chat?.worldBookReads && typeof chat.worldBookReads === 'object') {
        for (const key of Object.keys(chat.worldBookReads)) activatedTitles.add(str(key).trim())
      }
      let scriptWindow = null
      if ((chat.mode || 'story') === 'script' && cardPath) {
        try {
          const rawScript = await readScript(cardPath)
          const script = scriptForState(rawScript, chat.scriptState)
          if (script && Array.isArray(script.chunks) && script.chunks.length > 0) {
            scriptWindow = scriptContinuity.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } })
          }
        } catch {}
      }
      return {
        posture: postureForContext(chat),
        guides: Array.isArray(chat.guides) ? chat.guides.map(g => str(g?.text ?? g).trim()).filter(Boolean) : [],
        ledger: playFeatures.storyLedger && chat.ledger && typeof chat.ledger === 'object' ? chat.ledger : null,
        constantWorldbookText,
        worldbookEntries,
        activatedWorldbookTitles: Array.from(activatedTitles).filter(Boolean),
        scriptWindow
      }
    },
    decisionJudge: {
      status: () => narrativeDamper.judgeStatus(),
      judge: input => narrativeDamper.judge(input)
    },
    narrativeDamper: {
      turnContextForPlugin: (...a) => narrativeDamper.turnContextForPlugin(...a),
      applyDiceOutcomeShift: (...a) => narrativeDamper.applyDiceOutcomeShift(...a)
    },
    // 内置插件 dsh-tavern-narrative-damper 的面板在这里读写阻尼器设置；设置页本身不在宿主设置里。
    damperSettings: {
      read: () => requireDamperSettings().read(),
      update: patch => requireDamperSettings().update(patch),
      setKey: input => requireDamperSettings().setKey(input),
      test: config => requireDamperSettings().test(config)
    },
    readTavernSettings,
    updateTavernSettings,
    readDefaultPlayerName: async () => (await readTavernSettings()).defaultPlaySettings.playerName,
    readPlayerName: async sessionId => (await chatHeaderForSession(sessionId, ['macroState']))?.macroState?.userName,
    writeDefaultPlayerName: async playerName => (await updateTavernSettings({ defaultPlaySettings: { playerName } })).defaultPlaySettings.playerName,
    writePlayerName: setPlayerName,
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
    runningUserPlugins,
    loaderOrigin: fiber => loaderOrigin(ctx.get('loader'), fiber),
    cardScope: () => cardPlugins.scope(),
    cardPathOf: async sessionId => str((await chatHeaderForSession(str(sessionId), ['cardPath']))?.cardPath) || null,
    readCardPackFile: async (sessionId, packId, file) => {
      const pack = (await cardPacksOf(sessionId)).find(item => item.id === packId)
      const found = pack ? await assetPacks.file(pack.id, pack.contentHash, file) : undefined
      if (!found) throw Object.assign(new Error('素材包里没有这个文件：' + file), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      return { data: await readFile(found.path), mediaType: found.mediaType, size: found.size }
    },
    synthesizeSpeech: (sessionId, line) => speakLine(sessionId, line),
    speechProvidersChanged: () => speechBridge.sync(),
    generateImage: (input, source) => assetGeneration.image(input, source),
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
    editText: async (material, text, options) => {
      await bodyEditor.replaceText(material.sessionId, text, { polish: options?.polish === true })
      notifyPluginTimeline(material.sessionId, 'edit', { settled: true })
    },
    regenerateLatest: async (sessionId, guidance, target) => {
      const { view } = await dispatchMethod('regenBody', { sessionId, guidance, [PLUGIN_REGENERATION_TARGET]: target })
      return view?.aborted ? { aborted: true } : view.pluginRegeneration
    },
    runTask: runPluginTask,
    startManualTask: ({ gameId, key, input }) => startPluginTask(gameId, key, input),
    publish: sessionId => sessionSignals.publish(sessionId, { kind: 'plugin-media', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
  })
  const pluginBodyGeneration = createPluginBodyGeneration({ chatForSession, routeChatForSession: sessionId => chatHeaderForSession(sessionId, ['mode', 'foregroundFrames', 'timeline']), readRevision: readChatRevision,
    updateChat, settings: readTavernSettings, providers: pluginApi.bodyGenerators,
    writingPreparationFor: pluginApi.writingPreparation.forGame,
    isWorldbookPath: filePath => worldbookSkillProvider.ownsPath(filePath),
    isBackground: sessionId => backgroundAgentRunner.owns(sessionId),
    regenerateWithProvider: input => regenerateWithProvider(input) })
  ctx.provide('tavern', pluginApi.service)
  // A figure's name, 触发词 and outfit names: in its 配图 人物库 record, the one place (image-character-records.js, ADR 0011).
  figureRecords = createFigureRecords({ api: pluginApi, recordFile: path.join(dataRoot, 'plugins', 'dsh-tavern-image', 'definitions.json'), log: text => console.warn('dsh-tavern: ' + text) })
  ctx.provide('tavernFigureRecords', figureRecords)
  // A pack leaving this library (export, copy) takes its figures' 配图 外貌 and 参考图 along as dsh.image-character; the
  // asset library asks here, the figure records (image-character-records.js) move it back into a record where the pack lands.
  ctx.provide('tavernFigureImageExtras', { async forFigures({ packId, figureIds }) {
    const extras = {}
    for (const figureId of figureIds) {
      const state = await findFigureImageCharacter(pluginApi, { packId, figureId })
      if (state.status === 'unavailable') return {}
      const extension = state.status === 'linked' && imageCharacterExtension(state.character)
      if (extension) extras[figureId] = extension
    }
    return extras
  },
  // the bytes of a 参考图 an extension above names that the pack does not hold (one uploaded in the 配图 人物库)
  async media({ packId, figureId, media }) {
    const { providerId, character } = await findFigureImageCharacter(pluginApi, { packId, figureId })
    const referenceImage = [character.referenceImage, ...character.outfits.map(outfit => outfit.characterOutfitImage)].find(image => image?.id === media)
    const { data } = await pluginApi.imageCharacters('readReferenceImage', { providerId, referenceImage })
    return { bytes: data }
  },
  // an update confirmed with 「用导入的外貌」 for these figures (asset library applyImport adoptLooks), before it is written
  adopt(input) { figureRecords.adopt(input) } })
  ctx.provide('tavernStContract', tavernStContract)
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
  const { readPluginMediaFile, readPluginGalleryImage, removePluginMediaVersion, removePluginPicture, pluginMediaTurns, pluginMediaForTurn, pluginGalleryItems, removePluginGalleryItems } =
    createPluginMediaViews({ pluginMedia, pluginTurns, sessionSignals, attachments: () => ctx.get('attachments'), mediaRemoved: pluginApi.mediaRemoved,
      resolveGalleryContext,
      listGalleryProviderItems: pluginApi.listGalleryProviderItems, readGalleryProviderImage: pluginApi.readGalleryProviderImage,
      removeGalleryProviderItems: pluginApi.removeGalleryProviderItems })
  const backgroundTasks = createBackgroundTaskCoordinator({
    presentationActivity: chat => presentationObservers.activity(chat),
    store: { readChat, writeChat, updateChat, patchChat, readState: chatPersistence.readSessionState, readRecoveryState: taskStateReader.read, readSlice: chatPersistence.readSlice, readSettlementCheckpoint: chatPersistence.readSettlementCheckpoint },
    timeline: storyTimeline,
    blocked: function (chat) { return Boolean(autoCompaction?.blocked(chat)) },
    discarded: target => backgroundAgentRunner.discardRun(target),
    lockEvent: event => backgroundAgentRunner.noteLock(event)
  })
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
  function withCompactionSession(id, work) {
    return withHostAgent(foregroundSessionHost, id, work)
  }
  autoCompaction = createAutoCompaction({
    readChat: chatForSession, readState: sessionStateForSession, readMetadata: taskStateReader.forSession, updateChat,
    onState: (id, chat) => { const sessionId = String(chat?.sessionId || ''); if (sessionId) sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'compaction:' + Date.now() }) },
    onForegroundCompacted: sessionId => { if (sessionId) storyEvents.emit('context-compacted', { sessionId }) },
    policy: async () => (await readTavernSettings()).contextCompaction,
    activity: chat => backgroundTasks.activity(chat),
    exclusive: backgroundTasks.exclusive,
    settle: chat => queueSettlement(chat.id),
    pressure: (agent, signal, pendingMessages = [], sessionId) => {
      const measure = target => measureForegroundPressure({
        agent: target, signal, pendingMessages, projections: ctx.get('sessionProjections'),
        defaultModel: agentDefaultModel, llm: ctx.llm, meter: ctx.get('tokenMeter'), logger: ctx.logger
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
      const compactForeground = async agent => {
        const retained = await covered(agent.session)
        if (retained) return { message: `最近 ${retained} 轮剧情保留原文，暂无更早的历史需要压缩` }
        if (options.openTurnCompact) return options.openTurnCompact()
        return (await configureAgentCompaction(agent)).compactNow(agent, signal)
      }
      return options.agent ? compactForeground(options.agent) : withCompactionSession(id, compactForeground)
    }
  })
  async function configureAgentCompaction(agent) {
    const engine = await agentCompaction(agent)
    const dispose = installCompactionPolicy(engine, async (target, trigger, signal, fallback, forced) => {
      if (trigger !== 'context-overflow') return compactionPolicyFor(target, trigger, signal, fallback, forced)
      overflowingCompactions.add(target.session.id)
      try { return await compactionPolicyFor(target, trigger, signal, fallback, forced) }
      finally { overflowingCompactions.delete(target.session.id) }
    }, { compactNow: async (native, target, signal, sourceCommandId) => {
      const chat = backgroundAgentRunner.owns(target.session.id) ? null : await sessionStateForSession(target.session.id)
      return backgroundAgentRunner.owns(target.session.id) || chat && ['story', 'script', 'card'].includes(chat.mode)
        ? compactWholeTurnsNow(engine, native, target, signal, sourceCommandId) : native.call(engine, target, signal, sourceCommandId)
    }, selectRegion: async (target, range) => {
      if (backgroundAgentRunner.owns(target.session.id)) return wholeTurnCompactionRange(target.session, range.start, range.end)
      const chat = await sessionStateForSession(target.session.id)
      return chat && ['story', 'script', 'card'].includes(chat.mode)
        ? wholeTurnCompactionRange(target.session, range.start, range.end) : range
    }, beforeRegion: compactionRegionGuard })
    async function compactionPolicyFor(target, trigger, signal, fallback, forced) {
      // Our early pre-step and the host hook share one pressure attempt. Overflow
      // recovery remains independent and retains the host request retry budget.
      if (trigger === 'pressure' && pendingCompactionMessages.has(target)) {
        if (checkedCompactionPressure.has(target)) return null
        checkedCompactionPressure.add(target)
      }
      // The manual policy also governs the native capacity check: one story must
      // not keep summarizing at a threshold the player never set. Only Tavern
      // sessions read it; every other agent keeps the host policy untouched.
      const manualPolicy = async () => (await readTavernSettings()).contextCompaction.mode === 'manual'
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (background) {
        return compactBackgroundIfNeeded({
          trigger, forced, native: fallback, automatic: !(await manualPolicy()),
          pressure: () => measureBackgroundBudget({
            agent: target, background, signal, llm: ctx.llm, meter: ctx.get('tokenMeter'), logger: ctx.logger,
            pending: pendingCompactionMessages.get(target) || []
          })
        })
      }
      const chat = await chatHeaderForSession(target.session.id, ['mode'])
      if (!chat || !['story', 'script'].includes(chat.mode)) return fallback()
      const pendingMessages = pendingCompactionMessages.get(target) || []
      return compactForegroundIfNeeded({
        trigger, automatic: !(await manualPolicy()),
        native: () => compactNativePlayIfNeeded(engine, target, trigger, signal, fallback), forced,
        pressure: () => measureForegroundPressure({
          agent: target, signal, pendingMessages, projections: ctx.get('sessionProjections'),
          defaultModel: agentDefaultModel, llm: ctx.llm, meter: ctx.get('tokenMeter'), logger: ctx.logger
        }),
        record: () => autoCompaction.recordForeground(target.session.id),
        scheduled: () => autoCompaction.run(target.session.id, { agent: target, signal, openTurnCompact: forced, pendingMessages })
      })
    }
    async function compactionRegionGuard(target) {
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (!background) return
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
    if (dispose) {
      compactionDisposers.add(dispose)
      collectedCompactionEngines.register(engine, dispose, dispose)
    }
    return engine
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    const id = payload.agent.session.id, background = backgroundAgentRunner.requestContext(id)
    const chat = background ? null : await chatHeaderForSession(id, ['contextCompaction'])
    // old frames stay model-visible until a whole-turn compaction consumes them.
    // ephemeral director corrections must not acquire/prune a story compaction surface.
    if (background?.task === 'stage-director') return next()
    if (chat?.mode === 'card') {
      await configureAgentCompaction(payload.agent)
      return next()
    }
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
          warnCompactionPressureOnce(payload.agent.session, ctx.logger, error)
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
    async version(sessionId){
      const [chat,globals,settings]=await Promise.all([
        chatHeaderForSession(sessionId,['id','sessionId','mode','requestMode','_storageRevision','settleStatus','regenInProgress',
          'cardDefinitionSnapshot.name','openingWorldbookSnapshot.version']),
        profileData.version('prompt-template-variables.json'),profileData.version('tavern-extension-settings.json')
      ])
      if(!chat || !['story','script'].includes(chat.mode) || chat.requestMode==='sillytavern' || chat.regenInProgress || ['pending','running'].includes(chat.settleStatus)
        || !chat.cardDefinitionSnapshot || chat.openingWorldbookSnapshot?.version!==1)return null
      // The prepared value is the bound book's request prefix plus its constant
      // entries. Nothing in it reads the model, so the selected model stays out
      // of the dependency key: switching models must not throw the work away.
      return {revision:chat._storageRevision,resources:JSON.stringify([globals,settings])}
    },
    async prepare(sessionId){
      const chat=await candidateContextReader.worldbookForSession(sessionId)
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
    requestAnchor: contextHost.requestAnchor,
    expandedCandidates: readExpandedCandidates,
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
    canRun: async () => (await readTavernSettings()).candidateAutoGenerate === true,
    enabled: async chat => !!chat && (await pluginApi.hostBehavior.forGame(chat.sessionId)).backgroundAgents && (await readTavernSettings()).candidateAutoGenerate === true,
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
    updateSettings: updateTavernSettings,
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
    const name = await conversationInitialization.setPlayerName(sessionId, userName)
    sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'player-name:' + Date.now() + ':' + Math.random().toString(36).slice(2) })
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
    if (chat?.cardPath && groupOfMode(chat.mode) === 'play' && stageRuntime.status() !== 'ready') {
      await stageRuntime.assets.cardStageMode(chat.cardPath)
    }
    return chat
  }
  async function storyContext({ sessionId, chatId }) {
    const need = { storyRows: async header => (await worldBookScanDepth(header)) + 1, lastAssistant: true, lastVariables: true, messageFields: storyContextMessageFields }
    const selected = chatId === undefined ? await boundedHistory.forSession(sessionId, need) : await boundedHistory.read(chatId, undefined, need)
    if (selected && ['story', 'script'].includes(selected.chat.mode || 'story') && selected.chat.requestMode !== 'sillytavern') return normalizeChat(selected.chat)
    return chatId === undefined ? chatForSession(sessionId) : readChat(chatId)
  }
  const narrativeDamper = createNarrativeDamper({
    getConfig: async () => (await readTavernSettings()).narrativeDamper,
    credentials: () => ctx.get('credentials')
  })
  damperSettingsService = createDamperSettings({ readTavernSettings, updateTavernSettings, damper: narrativeDamper })
  const mvuSettlementEngine = createMvuSettlementEngine({ mvuSettlement, mvuUpdateRules, backgroundModelSelection, postureItem, tavernScriptDispatch, settlementParticipants,
    postureSummaryEnabled: playFeatures.postureSummary,
    narrativeDamper, pluginApi, readPendingTurn: gameId => pluginTurns.readPendingTurn(gameId),
    // What the reply's mod tools settled for its variables (their settlement(results) in tools.js), over the given turns.
    turnToolResults: async (chat, turns) => toolSettlementContext(await readSessionLog(chat.sessionId), modTools, turns),
    // The mod tools its background model may also use to backfill (their backfill in tools.js), for the card this game plays
    // with: each with this reply's results so far and run/settle over them.
    turnBackfillTools: async (chat, { variables, ...turns }) => {
      const card = await readChatCard(chat)
      const offered = modTools.filter(tool => tool.backfill?.offered(card))
      if (!offered.length) return []
      const texts = toolResultTexts(await readSessionLog(chat.sessionId), offered.map(tool => tool.name), turns)
      return offered.map(tool => ({ definition: tool.backfill.definition, owns: tool.backfill.owns(card), results: texts.get(tool.name) || [],
        run: (args, results) => tool.backfill.run(args, { card, results, variables, turn: turns.upTo }), settle: results => settleToolResults(tool, results) }))
    } })
  const plainSettlementEngine = createPlainSettlementEngine({ requestAnchor: contextHost.requestAnchor, pluginApi, pluginSettlementProgress, settlementItems, backgroundModelSelection, postureItem, backgroundAgentRunner, agentRegistry, sessionStore })
  const settlementRun = createSettlementRun({
    backgroundAgentRunner,
    backgroundTasks, chatPersistence, readChat, writeChat, readChatCard, taskStateReader, worldBookScanDepth,
    mvuSettlementEngine, plainSettlementEngine, pluginApi, pluginSettlementProgress, agentRegistry, storyEvents, settlementParticipants
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
  const { stopBackground, stopSettlementAgent, retrySettlement, pullBackgroundCycle } = createSettlementControls({
    chatForSession, readOpeningWindow, projectOpeningWindow, view, readChatCard, backgroundTasks, storyTimeline,
    readSlice: chatPersistence.readSlice,
    patchChat, writeChat, queueSettlement, cancelSettlement, cancelSettlementOperation: settlementJobs.cancelOperation,
    readChat, mvuSettlementEngine, pluginApi, backgroundAgentRunner,
    // 停止后台 stops the game's director too, through the stage's presentation observer.
    stageDirector: { cancel: chat => { void presentationObservers.cancelled(chat.sessionId) } }
  })
  ctx.inject(['subagents'], scope => {
    scope.effect(() => installSettlementSubagentStop(scope.get('subagents'), stopSettlementAgent), 'dsh-tavern: stop settlement from the native composer')
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
  let damperSignalSeq = 0
  function publishLiveDamperState(sessionId, payload) {
    const id = str(sessionId)
    if (!id) return
    damperSignalSeq += 1
    sessionSignals.publish(id, {
      kind: 'narrative-damper',
      version: String(damperSignalSeq),
      snapshot: payload
    })
  }
  function clearLiveDamperState(sessionId) {
    publishLiveDamperState(sessionId, { active: false })
  }
  async function projectPluginTurnContext(input) {
    const header = await chatHeaderForSession(str(input.gameId), ['mode', 'backgroundTasks', 'disabledForegroundTools']).catch(() => null)
    const mode = header?.mode || 'story'
    const excludeAssistantIndex = Number.isInteger(input.excludeAssistantIndex) ? input.excludeAssistantIndex : -1
    let damperRan = false
    let damperChatId = ''
    let damperEvaluated = null
    if ((mode === 'story' || mode === 'script') && await narrativeDamper.enabled()) {
      damperRan = true
      const chat = await storyContext({ sessionId: str(input.gameId) }).catch(() => null)
      damperChatId = str(chat?.id)
      const card = chat ? await readChatCard(chat).catch(() => null) : null
      // 插件附加题与阻尼器自身题目合并成同一趟请求：先问清协议能力，再收集附加题
      let extraQuestions = []
      if (chat) {
        try {
          const prep = await narrativeDamper.turnPrepStatus()
          const stateSnapshot = readDamperStateSnapshot(chat, { excludeAssistantIndex, fallbackForPlain: true })
          extraQuestions = await pluginApi.collectDamperQuestions({
            gameId: str(input.gameId),
            turn: Number(input.turn) || 0,
            input: str(input.input),
            protocol: prep?.protocol || '',
            capabilities: prep?.capabilities || {},
            stateSnapshot,
            posture: postureForContext(chat)
          }) || []
        } catch { extraQuestions = [] }
      }
      damperEvaluated = chat ? await narrativeDamper.evaluateTurn({
        chat: { ...chat, posture: postureForContext(chat) },
        card,
        turn: input.turn,
        userText: input.input,
        excludeAssistantIndex,
        extraQuestions
      }).catch(() => null) : null
    } else {
      narrativeDamper.clearActive?.()
      clearLiveDamperState(input.gameId)
    }
    // 插件 turnSection 在这里才跑：它们可以零延迟读取合并后的附加题答案，并把真骰结果回灌配额
    const sections = [...(await Promise.resolve(pluginApi.turnContext(input)).catch(() => []) || [])]
    if (mode !== 'story' && mode !== 'script') return sections
    if (damperRan) {
      // 取真骰联动修正后的最新裁定（可能已被插件 applyDamperDiceShift 改写）
      const finalDamper = damperChatId ? narrativeDamper.activeRuling(damperChatId, input.turn) : null
      const outcome = finalDamper?.outcome || damperEvaluated?.outcome || null
      if (outcome) {
        publishLiveDamperState(input.gameId, {
          active: true,
          turn: Number(input.turn) || null,
          storyTurn: Number(input.storyTurn ?? input.turn) || null,
          targetMessageUid: typeof input.targetMessageUid === 'string' && input.targetMessageUid !== '' ? input.targetMessageUid : null,
          regeneration: input.regeneration === true,
          outcome: structuredClone(outcome)
        })
      } else {
        clearLiveDamperState(input.gameId)
      }
      const rulingText = finalDamper?.rulingText || damperEvaluated?.rulingText || ''
      if (rulingText) {
        sections.push({ owner: 'dsh-tavern', name: 'narrative-damper', position: 'last', text: rulingText })
      }
    }
    if (mode !== 'story') return sections
    const styleReference = foregroundStyleReferenceTurnSection(header)
    if (styleReference) sections.push(styleReference)
    if (header?.backgroundTasks?.foregroundCandidates === true) {
      const candidateExtras = await Promise.resolve(pluginApi.candidate?.sections?.({ gameId: str(input.gameId), turn: input.turn })).catch(() => []) || []
      for (const extra of candidateExtras) {
        if (str(extra?.text).trim()) {
          sections.push({ owner: str(extra.owner || 'dsh-tavern'), name: str(extra.name || 'candidate'), position: 'after', text: str(extra.text).trim() })
        }
      }
      sections.push({ owner: 'dsh-tavern', name: 'foreground-candidates', position: 'after',
        text: promptSection('story_choices_reminder', '正文全部写完后，在最末尾另起一行附上 `<story_choices>{"actors":[{"name":"...","actions":["..."]}],"event":"...","scene":"..."}</story_choices>`（按焦点角色优先排列的在场角色行动分组 + 1 条当前场景突发互动/事件 + 1 条场景切换，每条约 40 字）。') })
    }
    return sections
  }
  const resolveActiveHistoryLayout = async () =>
    readHistoryLayoutOverrideFile(process.env.DSH_TAVERN_HISTORY_LAYOUT_FILE || historyLayoutFile())
    ?? ((await readTavernSettings()).storyToolHistoryMode || 'story')

  const turnOrchestrator = createTurnOrchestrator({
    // Either direction needs submit_story declared: output to submit this turn,
    // input because the replayed history calls name that tool.
    prepareBodyGeneration: sessionId => pluginBodyGeneration.prepare(sessionId),
    extractForegroundChoices: extractConfiguredForegroundChoices,
    bodyGeneration: sessionId => pluginBodyGeneration.route(sessionId),
    activeDamperRuling: (chatId, turn) => narrativeDamper.activeRuling(chatId, turn),
    storyToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
    storyInputToolCall: async () => (await readTavernSettings()).storyInputToolCall,
    historyLayout: resolveActiveHistoryLayout,
    modEnabled: (modId, cardPath) => cardPath ? ctx.get('tavernManagedModules')?.enabled({modId,cardPath}) ?? false : false,
    cardOffer: async chat => { const card = await readChatCard(chat); return tool => cardOffer(tool, card) },
    modTools,
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
      readChangedSlice: chatPersistence.readChangedSlice,
      readWindow: chatPersistence.readWindow,
      writersSince: chatPersistence.writersSince,
      patchChat,
      updateCard,
      createCard: createWorkspaceCard
    },
    planner: contextPlanner,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    frameBuilder: foregroundFrameBuilder,
    resolvePreset: resolveChatRuntimePreset,
    cards: cardPreparation,
    workspace: {
      prepare: prepareWorkspace,
      commit: commitWorkspace
    },
    renderMacros: function (text, chat) {
      return renderCardText(text, { name: chat.cardName }, chat.macroState)
    },
    pluginTurnContext: projectPluginTurnContext,
    projectUserTemplate: async ({chat,text,preview}) => {
      const global = await readPromptTemplateGlobalVariables()
      const result = await fullTemplateRuntime.forSession(chat.sessionId).renderInput(text, {userName:chat.macroState?.userName || '你',scopes:{global,local:chat.variables || {},initial:chat.promptTemplateInitialVariables || {},message:lastTavernHelperVariables(chat.messages) || {}}})
      const row = result.message
      // A regeneration preview builds the same request but owns no story write:
      // template globals advance only when the real turn is prepared.
      if (!preview) await tavernScriptHostAdapter.saveFullPromptTemplateGlobals(chat.sessionId, result.scopes.global, global)
      return {scopes:result.scopes,message:{role:'user',text:row.mes,sourceText:row.mes,swipeId:row.swipe_id,swipes:row.swipes,variables:row.variables,tavernPluginData:Object.fromEntries(['is_ejs_processed','variables_initialized','template_display'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))}}
    },
    projectReply: projectRuntimeReply,
    projectWorldBookTemplates: input => nativeWorldBookTemplateContext(input.chat, input.card),
    projectForegroundWorldbook,
    foregroundCapabilityUpdate: ({chat,userText}) => foregroundCapabilities.update(chat,{userText}),
    recordWorldbookRecall: worldbookRecallLog.record,
    resolvePresetRegexScripts: async chat => presetRegexScripts(chat),
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  const storyReconciliation = createStoryReconciliation({
    agentRegistry, sessionStore, chatForSession, chatSliceForSession, readWindow: chatPersistence.readWindow, updateChat, turns: turnOrchestrator
  })
  const { reconcileStory, reconcileWhenIdle, assertBlankStoryForkTarget, seedNativeStory } = storyReconciliation
  // 任务表 (domain/background-tasks.js): every background task is declared there once; this
  // hands it the services its tasks run on.
  registerBackgroundTasks(workflow, { readTavernSettings, polishPrereview, announceCast,
    gameTitles, saveMaintenance, pluginApi, candidateWorldbookPreparation, backgroundTasks, queueSettlement, settlementJobs, settlementRun })
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    scriptDispatch: tavernScriptDispatch,
    store: { chatForSession, readChat, readState: taskStateReader.read, stateForSession: taskStateReader.forSession, openingStateForSession },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    replyCommitted: sessionId => { clearLiveDamperState(sessionId); storyEvents.emit('reply-committed', { sessionId }) },
    turnDiscarded: (sessionId, turn) => { clearLiveDamperState(sessionId); storyEvents.emit('turn-discarded', { sessionId, turn }) },
    cancelPresentation: sessionId => {void presentationObservers.cancelled(sessionId)},
    beforeNextTurn: chat => workflow.beforeNextTurn(chat),
    syncCandidateMessageId: async (sessionId, requestId, messageId) => {
      const chat = await chatHeaderForSession(sessionId, ['candidates'])
      if (!chat?.id || !chat.candidates || chat.candidates.requestId !== requestId || chat.candidates.messageId === messageId) return
      await updateChatHeader(chat.id, ['candidates'], current => {
        if (!current.candidates || current.candidates.requestId !== requestId) return current
        return { ...current, candidates: { ...current.candidates, messageId } }
      }, { source: 'foreground.candidate-message-id' })
    },
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
    clearFailedTurns: async function (sessionId, turnInput) {
      const mode = await turnOrchestrator.modeFor(sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
      // A failed tail sits after the save's latest round, and the walk stops there: the
      // header and the latest floors (that round's input and reply) are all it reads.
      const chat = session && await chatHeaderWithLatestFloors(sessionId, 8)
      if (!chat) return 0
      const availability = rollbackAvailability(chat, { events: sessionEvents(session), nodes: session.surface?.nodes || [] })
      let cleared = 0
      // A turn the server stopped in the middle never ended, so nothing cleaned it up.
      const turns = new Set([...(availability.unclearedTurns || []), ...interruptedSurfaceTurns({ events: sessionEvents(session), nodes: session.surface?.nodes || [] })])
      for (const turn of turns) cleared += clearFailedTurnSurface({ session, turn })
      if (cleared) await sessionStore.flush(session)
      const currentRequestId = str(turnInput?.requestId).trim()
      const staleInputs = supersededTailPlayerInputIndices(chat.messages, {
        events: sessionEvents(session),
        nodes: session.surface?.nodes || [],
        currentRequestId
      })
      if (cleared || staleInputs.length > 0 || chat.foregroundError) {
        const clearedTurns = [...turns]
        await updateChat(chat.id, current => {
          if (!current) return undefined
          let changed = false
          if (pruneSupersededTailPlayerInputs(current, {
            events: sessionEvents(session),
            nodes: session.surface?.nodes || [],
            currentRequestId
          }) > 0) changed = true
          if (current.foregroundError) {
            current.foregroundError = null
            changed = true
          }
          if (clearedTurns.length && current.userInputEdits && typeof current.userInputEdits === 'object') {
            const next = { ...current.userInputEdits }
            let editsChanged = false
            for (const turn of clearedTurns) {
              if (!Object.hasOwn(next, String(turn))) continue
              delete next[String(turn)]
              editsChanged = true
            }
            if (editsChanged) {
              current.userInputEdits = next
              changed = true
            }
          }
          return changed ? current : undefined
        }, { source: 'failed-turn.cleanup' })
      }
      else if (!availability.canRollback && availability.reason && /失败回合/.test(availability.reason)) console.warn('dsh-tavern: 上一次失败回合的残留无法清理，本轮请求可能带上它:', availability.reason)
      return cleared + staleInputs.length
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
  function recoverRuntimeHistory(recoveredIndex, startedBefore) {
    return recoverHistory(recoveredIndex, {
      recoverRegeneration:id=>requestPerformance.stage('recovery.regeneration', () => recoverRegeneration(id)),
      readSlice:(...args)=>requestPerformance.stage('recovery.page-store', () => chatPersistence.readSlice(...args)),readChat,
      restoreChat:chat=>presetLibrary.restoreChat(chat),writeChat,
      syncSummary:async chat=>{
        try { await requestPerformance.stage('recovery.registry-sync', () => conversationRegistry.sync(chat, { metadataOnly: true })) }
        catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:',str(error?.message || error)) }
      },
      // Runs after the service is ready: work started since startup belongs to this process and is left alone.
      recoverHandoff:ids=>requestPerformance.stage('recovery.handoff', () => foregroundHandoff.recover(ids, { startedBefore })),
      recoverCandidates:ids=>requestPerformance.stage('recovery.candidates', () => candidateTasks.recover(ids, { startedBefore })),
      scanSettlement:()=>mvuSettlementReconciler.scan()
    })
  }
  // ---------- 重新生成正文（生成即替换，无确认） ----------
  const { regenerate: nativeRegenBody, regenerateWithProvider, recover: recoverRegeneration, rollback: rollbackTurn, rollbackTo: rollbackToTurn, interrupt: interruptTurn, undoRollback: undoRollbackTurn } = createRoundHistory({
    diagnostics: mvuDiagnostics,
    extractForegroundChoices: extractConfiguredForegroundChoices,
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
      acquire: (sessionId, options) => acquireHostSession(foregroundSessionHost, sessionId, options),
      acquireBackground: sessionId => acquireHostSession(sessionHost, sessionId),
      flush: session => sessionStore.flush(session) },
    scripts: { read: readScript, continuity: scriptContinuity,
      dispatchEvent: function (event) { return tavernScriptHostAdapter.dispatchEvent(event) } },
    timeline: storyTimeline,
    queueSettlement,
    replyCommitted: (sessionId, revision) => {
      // The native agent and the HTTP request can both finish before the new story is readable.
      sessionSignals.publish(sessionId, { kind: 'story-regenerated', version: String(revision) })
      storyEvents.emit('reply-committed', { sessionId })
    },
    cancelSettlement,
    readRegenerationMaterials: buildBodyRegenerationMaterials,
    // Build the replacement request from the save as it is now. This is the same
    // preparation a normal send runs, without writing a candidate story row.
    prepareRegenerationFrame: input => turnOrchestrator.preview(input),
    // Same current materials as the preview above, hashed without the reply being
    // replaced. A matching frame can be reused; a changed material returns a new
    // key and the preview rebuilds it.
    prepareRegenerationFrameCache: async ({ chat, card, turn, userText, target, targetAssistantIndex }) => {
      if (!chat || !card || !['story', 'script'].includes(chat.mode || 'story')) return null
      const settings = await readTavernSettings()
      if (str(configuredBodyGeneration(settings).mode).startsWith('plugin-') && !await pluginApi.writingPreparation.forGame(chat.sessionId)) return null
      const preset = await resolveChatRuntimePreset({ ...chat }, { preview: true })
      const worldBook = await playWorldBook(chat, card)
      const targetRow = targetAssistantIndex >= 0 ? chat.messages?.[targetAssistantIndex] : null
      const targetStoryTurn = Number(targetRow?.turn) > 0 ? Number(targetRow.turn) : (Number(target) > 0 ? Number(target) : Number(turn) || null)
      const pluginSections = await projectPluginTurnContext({
        gameId: chat.sessionId,
        turn,
        storyTurn: targetStoryTurn,
        targetMessageUid: typeof targetRow?.messageUid === 'string' && targetRow.messageUid !== '' ? targetRow.messageUid : null,
        regeneration: true,
        input: userText,
        excludeAssistantIndex: targetAssistantIndex
      })
      const globals = await readPromptTemplateGlobalVariables()
      const extensions = await readCardExtensions(chat.cardPath || chat.cardId, chat)
      const prompts = ['story', 'script-story'].map(name => runtimePrompt(name))
      const history = (Array.isArray(chat.messages) ? chat.messages : []).filter((_, index) => index !== targetAssistantIndex)
      const key = regenerationFrameKey({ chat, card, preset, worldBook, pluginSections, globals, settings, extensions, prompts,
        userText, target, turn, branchId: chat.timeline?.branchId, targetAssistantIndex })
      if (key === null) return null
      const argumentsForPreview = {}
      if (preset !== undefined) argumentsForPreview.runtimePresetSnapshot = preset
      if (Array.isArray(pluginSections)) argumentsForPreview.pluginSections = pluginSections
      if (extensions !== undefined) argumentsForPreview.cardExtensions = extensions
      return { key, arguments: argumentsForPreview }
    },
    prepareRegenerationReply: async ({ text, hostRegex, regexChat, pluginRegexScripts, projectionWarning }) =>
      projectPluginBody(text, { hostRegex, pluginRegexScripts, projectionWarning, regexScripts: hostRegex ? await replyRegexScripts(regexChat) : undefined }),
    notifyRegeneration: (sessionId, { turn }) => { clearLiveDamperState(sessionId); notifyPluginTimeline(sessionId, 'regenerate', { turn }) },
    present: presentStory,
    trace: requestPerformance,
    sessionPatch,
  })

  async function regenBody(chatId, guidance, sessionId, options = {}) {
    const id = sessionId || (await requestPerformance.stage('regen.resolve', () => readChat(chatId)))?.sessionId
    // A fresh request (长按发送键 1 秒重新生成) is a new sample of the round, not a
    // revision of the body the player is looking at. The plugin provider builds its
    // prompt from guidance only (the old body is never in its materials), so the
    // flag only has to reach the native path.
    const { expectedReply } = options
    const generated = await requestPerformance.stage('regen.plugin-generate', () => pluginBodyGeneration.regenerate(id, str(guidance), expectedReply))
    if (generated !== null) {
      if (generated.aborted) return { aborted: true }
      if (expectedReply) return { pluginRegeneration: { turn: generated.turn, textVersion: generated.textVersion } }
      return requestPerformance.stage('regen.plugin-present', async () => presentStory(await chatForSession(id)))
    }
    try { return await nativeRegenBody(chatId, guidance, sessionId, options) }
    finally { clearLiveDamperState(id) }
  }
  const bodyEditor = createBodyEditor({
    // Story editing resolves an absolute row/UID and must not read a sparse
    // request-hook window that can omit the selected floor.
    chats: { forSession: chatForSession, update: updateChat, patch: patchChat },
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
    // A queued edit lands between turns: wake the page so the row shows its new text.
    queuedEditApplied: sessionId => {
      notifyPluginTimeline(sessionId, 'edit', { settled: true })
      sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'body-edit-queued:' + Date.now() })
    },
  })

  const messageDeletion = createMessageDeletion({
    // Deletion resolves absolute story indices and may follow a persisted UID
    // across the whole history; request-hook bounded projections are not writable
    // Chat reads and can omit the selected row.
    chats: { forSession: chatForSession, update: updateChat },
    sessions: { get: id => ctx.get('agents')?.get(id), flush: session => sessionStore.flush(session) },
    activity: chat => backgroundTasks.activity(chat),
    view: sessionView,
    sessionPatch,
  })

  // 小组件变量、CG 图鉴、舞台计时器（stage-module.js）。
  stageRuntime.services({profileData, sessionSignals, conversationRegistry, tavernScriptDispatch, tavernScriptHostAdapter, readSessionMap, chatForSession, readRoundView, chatPersistence, storyTimeline, patchChat, cardStorage, presentationObservers, cardPageOpening:projectCardPageOpening})

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args, authority) {
    performanceDiagnostics.browser(args?._performance)
    const started = performance.now()
    // A deleted game's card frames may still call in; do not recreate its diagnostics.
    try {
      return await sessionPatch.runForPage(args?._sessionPatchPage, () =>
        requestPerformance.run(method, args?._traceId || args?.sessionId, () =>
          deletedSessionIds.has(args?.sessionId)
            ? dispatchMethod(method, args, authority, false)
            : apiDiagnostics.observe(method, args, () => dispatchMethod(method, args, authority, false))))
    }
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
    native: readNativeEvents,
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
    expandedCandidates: readExpandedCandidates,
    modelCatalog: tavernModelCatalog, modelReasoning: selection => readBackgroundModelReasoning(llm, selection),
    isPlayMode: mode => groupOfMode(mode) === 'play',
    presentExtras: chat => ({ modModels: chat.modModels || {} }),
    readExtras: async chat => {
      const header = await chatHeaderForSession(chat.sessionId, ['cardPath'])
      return { modModelSlots: await slotDeclarations({ sessionId: chat.sessionId, cardPath: header?.cardPath }), scoringCatalog: scoringCatalog() }
    },
    validatePatch: async (args, chat) => {
      if (args.modModelSelection) await checkSlotSelection(args.modModelSelection, { sessionId: chat.sessionId, cardPath: chat.cardPath })
      if (Object.hasOwn(args, 'candidateTabs') && ((await sessionActivity(chat.sessionId))?.busy || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running')) {
        throw new Error('请等待当前生成完成后再修改候选项数量')
      }
    },
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

  // Speech recognition is the host's shared service (ctx 'asr'); the phone's calls are one of its users.
  const speechRecognition = await createSpeechRecognitionHost({store:profileData,credentials:() => ctx.get('credentials'),providers:() => pluginApi.speechProviders('recognize')})
  ctx.provide('asr', speechRecognition.service)
  ctx.effect(() => () => speechRecognition.service.dispose())
  // Voiced lines still being synthesized and background work any game still holds keep a deployment waiting.
  deploymentWork.push(() => ({voice: speech.pendingCount() + (voiceService()?.pendingCount() || 0), background: {busy: backgroundTasks.pendingCount() > 0}}))

  // Request handlers by area live in rpc/; bindings assigned later are read through getters.
  // paragraphSpeech: a paragraph's spoken line, the core's voice selection (the stage's clip export reads it).
  const rpcDeps = { readCardAssetExtension, frameStorage, worldbookSkillProvider, sessionDebugEvidence, TAVERN_PACKAGE_VERSION, agentCompaction, agentRegistry, appendStoryRounds, paragraphSpeech,
    applicationUpdater, autoChoices, attachPlayChatDebug, backgroundAgentRunner, backgroundCatalog, storyEvents, workflow,
    backgroundConfigForSession, bindScript, bodyEditor, branchOrigin, callModel, candidateGenerator, candidateTasks, polishPrereview, polishRecords, polishReviewer, chatHeaderWithLatestFloors, cardUpdates, messageDeletion,
    cardArchiveUploads, cardMemory, cardOrganization, cardPacksOf, cardPlugins, cardPluginUpdates, cardPluginUploads, cardPreparation, cardSummaries, cardTaskPrompts, castAssets,
    castCardOf, castEdit, castStage, castView, chatForSession, chatHeaderForSession,
    chatHistoryImporter, chatPersistence, commands, compactionAbort, compatibilityDiagnostics,
    conversationBackgroundSettings, conversationGuides, ctx, dataRoot, deleteCard, deleteChat, deleteChats,
    deletePreset, deleteResource, deleteScript, displayRuntimeCaptures, ensureNativeCardWorkspace,
    ensureNativeOpening, exportConversation, exportGameSave, exportSettingsBundle, exportTavernLogs,
    fileResources, forkCardWorkbench, forkChat, fullTemplateRuntime, generationStreamModes, getCardOpenings, groupOfMode, guideLibrary,
    helperGenerationPreset, helperGenerationTasks, helperHistoryAccess, hostCompatibility, importCard, exportCardFile, listCardExportPacks, listCardReleases, addCardReleaseFromFile, estimateCardUpdate,
    replaceCard, presentCardText, revertCardUpdate, importCardArchiveFile, importPackArchiveFile, previewCardArchiveFile, discardCardArchivePreview, importChatHistoryText, importGameSave, importPluginCardFile, importPreset,
    importScript, importSettingsBundle, importSource, ledgerEditor, listCards, listTavernResources,
    listTavernSessions, liveCardUpdate, llm, manualCharacterDesign, manualLedger, mobileCardImport,
    modelRequestLog, mvuDiagnostics, narrativeDamper, damperSettings: damperSettingsService, notifyPluginTimeline, openingPreparation, pagesInFront,
    playCardSnapshots, pluginApi, pluginBodyGeneration, pluginDataStore, pluginGalleryItems, pluginMediaForTurn, pluginMediaTurns,
    pluginSettlementProgress, prepareConversationFork, preparedSaveSessions, presentSystemPrompts, promptDocuments, transferExports,
    presentUserPreferenceProfile, presetLibrary, previewPreset, profileData, projectOpeningWindow,
    readBackgroundSuppression, readCard, readCardExtensions, readCardExtensionSources, readCardWorkspace, readChat, readChatCard,
    readOpeningWindow, readRawTavernSettings, readScript, readSessionMap, readTavernSettings, reconcileStory, reconcileWhenIdle,
    regenBody, regexLibrary, regexManager, removePluginGalleryItems, removePluginMediaVersion, removePluginPicture, renameResource,
    requestPerformance, retrySettlement, retryStyleReference, rollbackTurn, rollbackToTurn,
    runtimeGeneration, runtimePresets, runtimePrompt, saveUpgrade, scriptContinuity,
    scriptNavigation, sessionActivity, sessionInventory, sessionOperation, sessionPatch, sessionSignals,
    sessionStateForSession, sessionStore, sessionView, sessionViews, setCardPlugins, setPlayerName,
    skillImportFiles, sleep, speakLine, speech, startChat, switchSessionOpening: conversationInitialization.switchOpening, startPluginTask, stopBackground, str,
    tavernModelCatalog, tavernScriptHostAdapter, tavernSkills, templateHistoryFrom, turnOrchestrator, undoRollbackTurn,
    updateCard, updateChat, updateTavernSettings, uploads, userPluginInstaller, userPreferenceProfile, view,
    withCompactionSession, withForegroundTaskAgent, worldBooks, worldbookRecallLog,
    get autoCompaction() { return autoCompaction },
    get conversationRegistry() { return conversationRegistry },
    get invalidateTavernSkills() { return invalidateTavernSkills },
    get serverScripts() { return serverScripts } }
  Object.defineProperties(rpcDeps, {
    DEFAULT_BUBBLE_TEMPLATE: { get: () => DEFAULT_BUBBLE_TEMPLATE },
    activeRoundBodies: { get: () => activeRoundBodies },
    activeTurnOf: { get: () => activeTurnOf },
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
    dialogueBubblePresets: { get: () => dialogueBubblePresets },
    dialogueBubbles: { get: () => dialogueBubbles },
    duplicateCard: { get: () => duplicateCard },
    fileResources: { get: () => fileResources },
    foregroundCapabilities: { get: () => foregroundCapabilities },
    autoChoices: { get: () => autoChoices },
    hasCardAssetBindings: { get: () => hasCardAssetBindings },
    importPreset: { get: () => importPreset },
    interruptTurn: { get: () => interruptTurn },
    listTavernSessions: { get: () => listTavernSessions },
    modelSelection: { get: () => modelSelection },
    normalizeBubbleConfig: { get: () => normalizeBubbleConfig },
    normalizeResourcePath: { get: () => normalizeResourcePath },
    notifyPluginTimeline: { get: () => notifyPluginTimeline },
    path: { get: () => path },
    pluginApi: { get: () => pluginApi },
    pluginSettlementProgress: { get: () => pluginSettlementProgress },
    rawUpdateChat: { get: () => rawUpdateChat },
    readCardExtensions: { get: () => readCardExtensions },
    readCardWorkspace: { get: () => readCardWorkspace },
    readChatCard: { get: () => readChatCard },
    readDialogueBubblePlacement: { get: () => readDialogueBubblePlacement },
    readStageChat: { get: () => readStageChat },
    readRoundView: { get: () => readRoundView },
    readRoundOps: { get: () => readRoundOps },
    readTavernSettings: { get: () => readTavernSettings },
    reconcileStory: { get: () => reconcileStory },
    regenBody: { get: () => regenBody },
    replyDisplayForChat: { get: () => replyDisplayForChat },
    requestPerformance: { get: () => requestPerformance },
    resolveCredentialValue: { get: () => async (ref) => { const entry = await ctx.get('credentials')?.resolve?.(ref); return typeof entry?.value === 'string' ? entry.value : '' } },
    retryStyleReference: { get: () => retryStyleReference },
    rollbackTurn: { get: () => rollbackTurn },
    slotDeclarations: { get: () => slotDeclarations },
    scoringCatalog: { get: () => scoringCatalog },
    modelSelectionChanged: { get: () => () => presentationObservers.modelChanged() },
    speech: { get: () => speech },
    speechRecognition: { get: () => speechRecognition },
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
    createGenerationStreamModeHandlers(rpcDeps),
    createPluginHandlers(rpcDeps),
    createConversationHandlers(rpcDeps),
    createPlayHandlers(rpcDeps),
    createTransferHandlers(rpcDeps),
    createImageCharacterHandlers(rpcDeps))
  const stageSwitch = createStageSwitch(stageRuntime)
  // A card update the program stopped in the middle of (killed, power lost) is put back as it was before.
  void commitCardPluginTransaction(() => recoverCardUpdates(), async restored => {
    for (const cardPath of restored) {
      const {plugins = []} = await castAssets.read(cardPath)
      await syncCommittedCardPlugins(plugins.filter(plugin => plugin.enabled === true).map(plugin => plugin.name))
    }
    if (restored.length) console.warn('dsh-tavern: 恢复了中断的人物卡更新：' + restored.join('、'))
    return restored
  }).catch(error => console.warn('dsh-tavern: 恢复中断的人物卡更新失败', error?.message || error))
  // The reading voice of tavernUi.playReading (story-reading.js): a library figure, or the one 旁白声音 points at when none is given.
  rpcHandlers.openReadingVoice = async args => speech.openReading(args && Object.hasOwn(args, 'figure') ? args.figure : undefined)
  rpcHandlers.getStageRuntimeStatus = async () => stageSwitch.read()
  rpcHandlers.prepareStageWorkbench = () => stageSwitch.ensure()
  rpcHandlers.prepareCardStage = args => stageRuntime.assets.cardStageMode(args?.path)
  rpcHandlers.setStageEnabled = async args => {
    if (typeof args?.enabled !== 'boolean') throw new TypeError('舞台启用状态必须是布尔值')
    if (args.enabled && !stageSwitch.read().installed) throw new Error('舞台插件未安装，无法启用')
    await (args.enabled ? stageSwitch.enable() : stageSwitch.disable())
    return stageSwitch.read()
  }
  rpcHandlers.getCardScripts = rpcHandlers.setCardScriptMuted
  const extensionRequests = createExtensionRequests({reserved:Object.keys(rpcHandlers)})
  stageRuntime.requests(rpcDeps, extensionRequests)
  ctx.provide('tavernStageControl',Object.freeze({
    enable:stageSwitch.enable,disable:stageSwitch.disable,status:stageRuntime.status,install:stageSwitch.install,uninstall:stageSwitch.uninstall,
    workbench: { deps:rpcDeps, ensure:stageSwitch.ensure, call:(method,args) => extensionRequests.call(method,args,workbenchAuthority) }
  }))
  ctx.effect(() => () => stageRuntime.dispose(), 'dsh-tavern: optional stage controller')

  async function dispatchMethod(method, args, authority, serverTemplate = false) {
    // Read-aloud and card frames ask for speaker metadata even in a plain game.
    if (method === 'getDialogueBubbles' && !extensionRequests.handles(method)) {
      const chat = await chatHeaderForSession(args?.sessionId, ['cardPath','cardName','mode'])
      if (chat?.cardPath && groupOfMode(chat.mode) === 'play') await stageRuntime.assets.cardStageMode(chat.cardPath)
      if (!extensionRequests.handles(method)) {
        return {cardPath: str(chat?.cardPath), cardName: str(chat?.cardName), config: await dialogueBubbles.read()}
      }
    }
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

  coordinationEvents = createCoordinationEventPublisher({
    readVersion: async function (sessionId) { return await coordinationVersion(sessionId) },
    onTick: cardUpdates.notice,
    load: async function (sessionId) { return await candidateTasks.sync(sessionId, { kind: 'candidate' }) },
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    fallbackIntervalMs: 5000,
    onError(error) { console.warn('dsh-tavern: 协调文件读取失败，将继续重试:', str(error && error.message || error)) }
  })

  ctx.provide('tavernSessionSignals', Object.freeze({
    async control(method, args, signal) {
      const multiplexedRead = extensionRequests.remoteRead(method, args)
        || ['getStoryTranscript', 'syncSession', 'pluginTurnState', 'pluginState', 'getDialogueBubbles'].includes(method)
      if (!multiplexedRead && !['claimTavernScriptWork', 'startTavernScriptWork', 'getTavernScriptWorkState',
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
        if (!multiplexedRead) throw error
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
    clientAssets,
    castAssets,
    exportCardFile,
    assetPacks,
    uploads: { receive(req) {
      const params = new URL(req.url, 'http://localhost').searchParams
      if (params.get('purpose') === 'card-plugin-update') return cardPluginUploads.receive(req)
      if (params.get('purpose') === 'card-archive') return cardArchiveUploads.receive(req, params)
      return uploads.receive(req)
    } },
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
    readPluginGalleryImage: (...args) => readPluginGalleryImage(...args),
    sessionResources,
    str,
    tavernRemoteAssets,
    tavernStaticResources,
  })
  // 安卓浏览器默认只缩可视区，键盘动画期间页面追不上输入法；这里把宿主网页外壳的
  // viewport 补齐（interactive-widget 只在加载时读一次，页面里改不了）。失败不影响启动。
  try { installHostViewportPatch(message => console.log(message)) } catch (error) { console.warn('[dsh-tavern] 视口补丁未生效：', error) }
  // A desktop host's chat view sits in a read-only app.asar: patch its answer step in the page.
  installChatAnswerBootPatch(ctx)
  installGenerationStreamModeBootPatch(ctx)
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

  function replaceAssistantReply(session, result, bodyText, messageId) {
    if (result !== null && result.storyToolSubmission) return foldStorySubmission(session, result, bodyText, messageId)
    if (result === null || result.text === bodyText) return
    const previous = result.event && result.event.data && result.event.data.message
    if (previous === null || typeof previous !== 'object') return
    // The replacement contains the whole body. Keep tool evidence but do not repeat its prose in model context.
    for (const part of result.textEvents || []) {
      if (part.event === result.event) continue
      const data = part.event.data, seq = Number(part.event.seq ?? part.index)
      replaceSessionSurface(session, 'assistant/message', {...data, message:{...data.message,id:randomUUID(),
        source:{kind:'model',provider:'dsh-tavern',model:'reply-prefix-projection'},
        content:data.message.content.filter(block => block.type !== 'text')}}, {start:seq,end:seq,sourceEventSeqs:[seq]})
    }
    const reasoningBlocks = (Array.isArray(previous.content) ? previous.content : [])
      .filter(block => block?.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '')
      .map(block => ({ type: 'reasoning', text: block.text }))
    replaceSessionSurface(session, 'assistant/message', {
      turn: Number(result.event.data && result.event.data.turn) || 0,
      step: Number(result.event.data && result.event.data.step) || 1,
      message: Object.assign({}, previous, {
        id: typeof messageId === 'string' && messageId !== '' ? messageId : randomUUID(),
        source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' },
        content: [...reasoningBlocks, ...(Array.isArray(previous.content) ? previous.content : []).filter(block => block?.type !== 'text' && block?.type !== 'reasoning'), { type: 'text', text: bodyText }]
      })
    }, { start: result.index, end: result.index, sourceEventSeqs: [result.index] })
  }

  // 缓存预设文件的 stat 指纹与内容哈希，避免每轮对话重复读盘与全文 SHA-256。
  const presetRevisionCache = new Map()

  // A game keeps a snapshot of its preset, but edits to that preset apply from the
  // next request: a changed preset file rebuilds and stores the snapshot. A missing
  // or unreadable file keeps the saved snapshot, so the game never loses its preset.
  async function resolveChatRuntimePreset(chat, options = {}) {
    if (!chat || groupOfMode(chat.mode) !== 'play') return null
    const saved = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : null
    if (!saved?.presetPath || !chat.id) return saved
    const normalizedPath = normalizeResourcePath(saved.presetPath, 'preset')
    const expectedRevision = saved.presetRevision || saved.compatibilityPreset?.revision
    let fileStat = null
    try {
      fileStat = await stat(fileResources.absolute(normalizedPath))
      const cached = presetRevisionCache.get(normalizedPath)
      if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
        if (cached.revision === expectedRevision) return saved
      }
    } catch {
      presetRevisionCache.delete(normalizedPath)
    }
    let text
    try { text = await fileResources.readText(normalizedPath) } catch { return saved }
    if (text === undefined) return saved
    const revision = createHash('sha256').update(text).digest('hex')
    if (fileStat) {
      if (presetRevisionCache.size >= 64) presetRevisionCache.delete(presetRevisionCache.keys().next().value)
      presetRevisionCache.set(normalizedPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, revision })
    }
    // Snapshots keep only the preset text digest; older saves carry it inside the
    // compatibility document, which is no longer stored with the snapshot.
    if (revision === expectedRevision) return saved
    let fresh
    try { fresh = await runtimePresets.fullSnapshot(saved.presetPath) } catch { return saved }
    if (!fresh) return saved
    // Regeneration preview needs the live preset but owns no stored request yet.
    if (options.preview === true) {
      chat.runtimePresetSnapshot = fresh
      return fresh
    }
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
    },
    // 设置 › 高级 › 请求失败自动重试: read per request so the switch needs no restart.
    enabled: async function () { return (await readTavernSettings()).retryOnFailure !== false }
  })

  function clearRuntimePresetRequestState(agent) {
    const session = agent && agent.session
    if (session === undefined) return 0
    const sessionId = session.id
    requestCoordinates.delete(sessionId)
    foregroundStrategies.clearRequestState(sessionId)
  }

  const skillGatedTools = createSkillGatedTools({ pluginSkills: name => pluginApi.toolSkillsFor(name) })
  const controlledToolNames = new Set([...modTools.map(tool => tool.name), STYLE_REFERENCE_TOOL_NAME, STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME, STORY_GENERATE_TOOL_NAME, 'tavern_read_variables', ...WORLDBOOK_ACCESS_TOOLS, ...CARD_MEMORY_TOOLS, 'bash', 'pwsh', ...dshFileToolNames, 'skill', 'tavern_read_skill_reference', 'tavern_read_skill', 'web_search', 'web_fetch', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save', 'tavern_user_profile_confirm', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_search_card', 'tavern_replace_card_text', 'tavern_mvu_overview', 'tavern_apply_mvu', 'tavern_read_play_chat', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', WORKBENCH_READ_LOREBOOK_TOOL, WORKBENCH_UPDATE_LOREBOOK_TOOL, 'tavern_read_preset', 'tavern_update_preset', 'tavern_read_regex_library', 'tavern_copy_card', 'tavern_set_card_cover', 'tavern_export_card_png', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response'])
  const foregroundStrategies = createForegroundOrchestrationStrategies({
    nativePlay: {
      writingPreparation: pluginApi.writingPreparation,
      // Input side: replay past bodies as calls of the submission tool.
      styleReferencePrompt: chat => foregroundStyleReferencePrompt(chat, runtimePrompt('style-reference-recall'), runtimePrompt('style-reference')),
      foregroundCandidatePrompt: async chat => chat?.backgroundTasks?.foregroundCandidates === true
        ? foregroundCandidatePrompt(chat, await readExpandedCandidates(chat)) : '',
      bodyGeneration: sessionId => pluginBodyGeneration.route(sessionId),
      historyToolCall: async () => (await readTavernSettings()).storyInputToolCall,
      // Output side: whether a new body must be submitted through the tool.
      storyOutputToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
      storyToolThinking: async () => (await readTavernSettings()).storyToolThinking === true,
      // Experiment file overrides UI setting when present; otherwise use UI history mode.
      historyLayout: resolveActiveHistoryLayout,
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
      pluginToolsUnlocked: function (sessionId, names) {
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
      cardPersonaText: function () { return activeCardPersonaText(tavernSettingsDocument) },
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
    openingRequest: conversationInitialization.openingRequest,
    gameModes: pluginApi.gameModes,
    projectWorldbookRecovery: async (chat, options) => nativeWorldBookTemplateContext(chat, await readChatCard(chat), options),
    backgroundAgentRunner,
    cardMemory,
    chatForSession: hookChatForSession,
    ctx,
    foregroundStrategies,
    persistClearedBodyEdits,
    requestCoordinates,
    requestIdForMessages,
    requestPerformance,
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
    pluginBodyGeneration,
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
    replyStreamRewriters,
    storyRetention,
    compactionModel: async () => (await readTavernSettings()).defaultCompactionModel,
  })
  registerTurnLifecycleHooks({
    pluginBodyGeneration,
    turnStarted: (sessionId, turn) => storyEvents.emit('turn-started', { sessionId, turn }),
    flushQueuedBodyEdits: sessionId => bodyEditor.flushQueued(sessionId),
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
    requestPerformance,
    runtimePrompt,
    sessionStore,
    storyOutputToolCall: async () => (await readTavernSettings()).storyOutputToolCall,
    writingPreparation: pluginApi.writingPreparation,
    turnOrchestrator,
    userMessageForTurn,
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    tools.register(defineTool(pluginBodyGeneration.tool))
    tools.register(defineTool(createStorySubmissionTool({
      chatForSession,
      pluginGeneration: async sessionId => (await pluginBodyGeneration.route(sessionId)).mode?.startsWith('plugin-'),
      // Input-only requests still declare the tool for their replayed history;
      // accepting a real submission there is harmless.
      enabled: async sessionId => {
        if (foregroundStrategies.pureWritingTurn(sessionId)) return true
        const settings = await readTavernSettings()
        return settings.storyInputToolCall === true || settings.storyOutputToolCall === true
      },
      isBackground: function (sessionId) { return backgroundAgentRunner.owns(sessionId) }
    })))
    tools.register(defineTool(createStoryContextTool()))
    tools.register(defineTool(createForegroundStyleReferenceTool({
      chatForSession,
      isBackground: sessionId => backgroundAgentRunner.owns(sessionId),
      save: (chat, reference, turn) => updateChatHeader(chat.id, ['styleReferences'], current => ({ ...current, styleReferences: rememberStyleReference(current.styleReferences, reference, turn) }), { source: 'foreground.style-reference' })
    })))
    registerGameplayTools({
      modTools,
      authorizeMod: (modId,chat)=>ctx.get('tavernManagedModules')?.enabled({modId,cardPath:chat.cardPath}) ?? false,
      markModToolUsed: (chat, name) => updateChatHeader(chat.id, ['usedModTools'], current => ({ ...current, usedModTools: [...new Set([...(current.usedModTools || []), name])] })),
      activeTurnOf,
      chatForSession,
      isBackground: sessionId => backgroundAgentRunner.owns(sessionId),
      readChatCard,
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

    const checkCard = createCardValidationCheck({ cardMemory, fileResources, cardChecks: modTools.filter(tool => tool.checkCard).map(tool => tool.checkCard) })
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
    await conversationDeletion.resumePending(pendingChatDeletions)
    const recoveredIndex = await initializeRuntimeState()
    settleRuntimeReadiness({ ok: true })
    setImmediate(function () {
      requestPerformance.run('startup-history', '', () =>
        withConversationReadLane('background', () => recoverRuntimeHistory(recoveredIndex, startedAt))).catch(function (error) {
        console.error('dsh-tavern: 后台恢复历史对话失败', error && error.message || error)
      })
    })
  } catch (error) {
    settleRuntimeReadiness({ ok: false, error })
    throw error
  }
}
