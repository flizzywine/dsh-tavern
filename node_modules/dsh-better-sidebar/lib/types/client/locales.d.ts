/**
 * Minimal zh/en/ja copy for the sidebar. The copy follows the DSH i18n system:
 * the client apply attaches the locale service (`ctx.locale`, provided by
 * `@deepseek-ai/dsh-client-locale`) through {@link attachLocale}, and
 * `t()`/`isZh()` resolve the active locale from it — the Host-backed
 * `locale.preference` wins over the raw browser language and switches live.
 * Without an attached service (standalone/test compositions) the browser
 * language is used, matching the previous behavior. The dictionaries are
 * also registered into the DSH locale registry under {@link LOCALE_NS}.
 *
 * ja (Japanese) is opt-in through `@huanlin/dsh-plugin-better-locale`: when
 * that plugin is installed, the client apply also calls
 * {@link attachBetterLocale} with the override store. `t()` then consults
 * the store's active override id first; if it is `'ja'` (or any id whose
 * dict has the requested key) the ja text wins, otherwise the existing
 * zh/en chain runs unchanged. better-locale itself patches
 * `LocaleRuntime.prototype.lookup` so DSH's own translate chain also
 * returns ja where the `betterSidebar` namespace has a ja entry — that
 * path covers external callers of `ctx.locale.bind('betterSidebar')`,
 * while the override-aware `t()` here covers better-sidebar's own
 * components (which bypass `ctx.locale` and call `t()` directly).
 */
/** The zh dictionary (also registered into the DSH locale registry under {@link LOCALE_NS}). */
export declare const zh: {
    files: string;
    guideDescFiles: string;
    guideDescGit: string;
    guideDescSubagent: string;
    guideDescSidechat: string;
    guideDescTerminal: string;
    guideDescBrowser: string;
    changesSessionEmpty: string;
    changesRead: string;
    changesMdReading: string;
    changesMdRaw: string;
    changesHtmlRender: string;
    changesHtmlRaw: string;
    changesWrite: string;
    changesEdit: string;
    changesRunning: string;
    changesError: string;
    changesRedactOn: string;
    changesRedactOff: string;
    changesRedactOnLabel: string;
    changesRedactOffLabel: string;
    changesRedactBanner: string;
    changesFold: string;
    changesFoldLoading: string;
    changesFoldUnavailable: string;
    changesContext: string;
    changesPriorUnknown: string;
    explorer: string;
    terminal: string;
    editor: string;
    editorExplorer: string;
    editorExplorerDesc: string;
    editorExplorerMerged: string;
    editorExplorerMergedDesc: string;
    editorExplorerSplit: string;
    editorExplorerSplitDesc: string;
    explorerExclude: string;
    explorerExcludeDesc: string;
    explorerExcludePlaceholder: string;
    explorerExcludeAdd: string;
    explorerExcludeRemove: string;
    editorTreeToggle: string;
    editorPathPlaceholder: string;
    editorSearchPlaceholder: string;
    editorSearchNoResults: string;
    editorSearchTruncated: string;
    editorEmptyHint: string;
    openFileNewTab: string;
    openFileSide: string;
    settingsOpenWithPluginTitle: string;
    settingsOpenWithPluginDesc: string;
    zipDownload: string;
    zipDownloadCount: string;
    zipFailed: string;
    archiveToolMissing: string;
    openWithMenu: string;
    openWithSshSuffix: string;
    pinOpenWith: string;
    unpinOpenWith: string;
    openWithExplorer: string;
    openWithVscode: string;
    openWithCursor: string;
    openWithZed: string;
    openWithSettingsSshTitle: string;
    openWithSettingsSshDesc: string;
    openWithSettingsSshPlaceholder: string;
    openWithSettingsCustomTitle: string;
    openWithSettingsCustomDesc: string;
    openWithSettingsAdd: string;
    openWithSettingsName: string;
    openWithSettingsTemplate: string;
    openWithSettingsFamily: string;
    openWithSettingsFamilyDesc: string;
    openWithSettingsRemove: string;
    openWithSettingsInvalidHint: string;
    openInAppDefault: string;
    openInAppEmpty: string;
    openInAppFailed: string;
    revealInFileManager: string;
    filesSelected: string;
    clearSelection: string;
    copyPaths: string;
    deleteSelected: string;
    deleteSelectedTitle: string;
    deleteSelectedDesc: string;
    newFolder: string;
    newFolderPlaceholder: string;
    newFolderInvalid: string;
    newFile: string;
    newFilePlaceholder: string;
    newFileInvalid: string;
    newFileExists: string;
    sort: string;
    sortByName: string;
    sortByType: string;
    sortFoldersFirst: string;
    filesTruncated: string;
    gitStatusModified: string;
    gitStatusAdded: string;
    gitStatusDeleted: string;
    gitStatusUntracked: string;
    gitStatusRenamed: string;
    gitStatusConflict: string;
    changesClean: string;
    changesNewFile: string;
    changesStageFailed: string;
    changesOpGone: string;
    newTab: string;
    brokenSymlink: string;
    close: string;
    closeOtherTabs: string;
    tabUnread: string;
    closeLeftTabs: string;
    closeRightTabs: string;
    closeAllTabs: string;
    revealTabInFileManager: string;
    pinTerminal: string;
    pinAgentTerminal: string;
    pinToWorkspace: string;
    pinToGlobal: string;
    unpinTerminal: string;
    collapseBottomPanel: string;
    expandBottomPanel: string;
    terminalError: string;
    terminalConnectFailed: string;
    terminalRetry: string;
    terminalWaitBanner: string;
    terminalSkipWait: string;
    terminalDepsFailed: string;
    terminalDepsHint: string;
    terminalDepsProfile: string;
    terminalShellNotFound: string;
    terminalUnavailable: string;
    terminalGone: string;
    terminalNew: string;
    preview: string;
    toc: string;
    edit: string;
    mermaidError: string;
    mermaidZoomIn: string;
    mermaidZoomOut: string;
    mermaidZoomReset: string;
    mermaidZoomHint: string;
    refresh: string;
    refreshUnsavedConfirm: string;
    closeUnsavedConfirm: string;
    save: string;
    saved: string;
    unsaved: string;
    saveFailed: string;
    saveConflict: string;
    saveConflictReload: string;
    previewOnlyNotice: string;
    largeFileEmpty: string;
    pagedLineRange: string;
    loadAll: string;
    loadAllProgress: string;
    previewRowLimit: string;
    jsonlRecordRange: string;
    jsonlInvalidRecord: string;
    jsonCopyPath: string;
    jsonCopyPrettyJson: string;
    jsonCopyCompactJson: string;
    jsonCopyFailed: string;
    jsonCollapseNode: string;
    jsonExpandNode: string;
    jsonCopyButtonTitle: string;
    searchFind: string;
    searchReplace: string;
    searchNext: string;
    searchPrevious: string;
    searchAll: string;
    searchMatchCase: string;
    searchWholeWord: string;
    searchRegexp: string;
    searchReplaceAll: string;
    searchCurrentMatch: string;
    searchOnLine: string;
    searchReplacedMatches: string;
    searchReplacedMatchOnLine: string;
    searchGoToLine: string;
    searchGo: string;
    binary: string;
    loading: string;
    error: string;
    retry: string;
    notRepo: string;
    statusTruncated: string;
    stage: string;
    unstage: string;
    stageAll: string;
    unstageAll: string;
    gitChanges: string;
    gitGraph: string;
    gitMergeChanges: string;
    gitStagedChanges: string;
    gitMoreActions: string;
    gitRepository: string;
    gitDetached: string;
    gitBranchesUnavailable: string;
    gitNoUpstream: string;
    gitSyncUnavailable: string;
    gitSync: string;
    commitPlaceholder: string;
    commit: string;
    generateCommitMessage: string;
    generateCommitMessageWith: string;
    generatingCommitMessage: string;
    committingMessage: string;
    suggestCommitError: string;
    suggestCommitEmpty: string;
    commitModelTitle: string;
    commitModelDesc: string;
    commitModelFollow: string;
    commitModelSearchPlaceholder: string;
    commitModelCurrent: string;
    commitModelInvalid: string;
    commitModelUnavailable: string;
    commitModelEmpty: string;
    commitModelDefaultNote: string;
    commitModelRecentNote: string;
    push: string;
    pull: string;
    pushError: string;
    pullError: string;
    branch: string;
    worktree: string;
    checkoutError: string;
    history: string;
    changes: string;
    changesGitLens: string;
    graphAllBranches: string;
    graphBranchFilter: string;
    graphEmpty: string;
    graphLoadError: string;
    graphStale: string;
    graphDetails: string;
    graphParents: string;
    graphLoadMore: string;
    changesSessionLens: string;
    changesFilterAll: string;
    changesFilterEmpty: string;
    changesOpenDiffTab: string;
    changesDiffTab: string;
    changesContentTab: string;
    changesNoCommit: string;
    changesNoContent: string;
    changesReadNoDiff: string;
    changesClosePreview: string;
    changesResizePreview: string;
    changesLoadError: string;
    staged: string;
    unstaged: string;
    cancel: string;
    diffEmpty: string;
    diffLoadError: string;
    diffBinary: string;
    diffAdded: string;
    diffDeleted: string;
    diffRenamed: string;
    diffExpand: string;
    discard: string;
    discardTitle: string;
    discardDesc: string;
    viewCommitDiff: string;
    copyShortHash: string;
    copyFullHash: string;
    copySubject: string;
    revertCommit: string;
    revertTitle: string;
    revertDesc: string;
    cherryPickCommit: string;
    cherryPickTitle: string;
    cherryPickDesc: string;
    timeJustNow: string;
    timeMinutesAgo: string;
    timeHoursAgo: string;
    timeYesterday: string;
    loadMore: string;
    produced: string;
    showInFolder: string;
    disconnected: string;
    exited: string;
    noSession: string;
    pluginNotLoaded: string;
    parent: string;
    copied: string;
    copy: string;
    openEditor: string;
    referenceFile: string;
    addToConversation: string;
    copyRelative: string;
    copyAbsolute: string;
    rename: string;
    renameInvalid: string;
    delete: string;
    deleteTitle: string;
    deleteDescFile: string;
    deleteDescDir: string;
    dismiss: string;
    download: string;
    uploadFiles: string;
    uploadFolder: string;
    uploadHere: string;
    uploadDropHint: string;
    uploadDropChat: string;
    uploadTo: string;
    uploadingTo: string;
    uploadProgress: string;
    uploadDone: string;
    uploadFailed: string;
    uploadFailedUnknown: string;
    uploadTooLarge: string;
    uploadCancelled: string;
    settingsNav: string;
    settingsIntro: string;
    settingsPopupDesc: string;
    settingsDone: string;
    settingsOpenToolsTitle: string;
    settingsOpenToolsDesc: string;
    settingsCustomCssTitle: string;
    settingsCustomCssPlaceholder: string;
    settingsSaveFailed: string;
    settingsConflict: string;
    binaryNoPreview: string;
    downloadToView: string;
    settingsSubagentTitle: string;
    settingsSubagentDesc: string;
    settingsJobsTitle: string;
    settingsJobsDesc: string;
    settingsToolsTitle: string;
    settingsToolsDesc: string;
    settingsBottomTerminalTitle: string;
    settingsBottomTerminalDesc: string;
    settingsFontFamilyTitle: string;
    settingsFontFamilyDesc: string;
    settingsFontFamilyPlaceholder: string;
    settingsFontSizeTitle: string;
    settingsFontSizeDesc: string;
    settingsShellTitle: string;
    settingsShellDesc: string;
    settingsShellPlaceholder: string;
    settingsShellArgsTitle: string;
    settingsShellArgsDesc: string;
    settingsShellArgsPlaceholder: string;
    settingsTabsTitle: string;
    settingsViewersTitle: string;
    settingsMobileTitle: string;
    settingsMobileNoAutoOpenTitle: string;
    settingsMobileNoAutoOpenDesc: string;
    settingsMobileTreeTitle: string;
    settingsMobileTreeDesc: string;
    settingsGeneralTitle: string;
    settingsPopup: string;
    settingsViewerCatchAll: string;
    viewerMarkdown: string;
    viewerCode: string;
    viewerHtml: string;
    viewerJsonl: string;
    browser: string;
    browserPlaceholder: string;
    browserGo: string;
    browserBack: string;
    browserForward: string;
    browserStart: string;
    browserBlockedScheme: string;
    browserBlockedLoopback: string;
    browserInvalid: string;
    htmlNoSandboxWarning: string;
    sandboxStatusOn: string;
    sandboxUnlock: string;
    sandboxRestore: string;
    settingsHtmlDefaultUnsafeTitle: string;
    settingsHtmlDefaultUnsafeDesc: string;
    settingsHtmlSandboxTitle: string;
    settingsHtmlSandboxDesc: string;
    settingsEditorGitGutterTitle: string;
    settingsEditorGitGutterDesc: string;
    settingsBrowserSandboxTitle: string;
    settingsBrowserSandboxDesc: string;
    settingsBrowserLoopbackTitle: string;
    settingsBrowserLoopbackDesc: string;
    settingsBrowserLoopbackPlaceholder: string;
    browserOpenExternal: string;
    browserEmbedBlocked: string;
    browserEmbedBlockedDesc: string;
    browserEmbedAnyway: string;
    subagent: string;
    subagentMainAgent: string;
    subagentEmpty: string;
    subagentEmptyDesc: string;
    subagentInactive: string;
    subagentModeOneShot: string;
    subagentModeContinuable: string;
    subagentCount: string;
    subagentCountRunning: string;
    subagentThinking: string;
    sideChat: string;
    sideChatNew: string;
    sideChatUntitled: string;
    sideChatEmpty: string;
    sideChatEmptyDesc: string;
    sideChatCreating: string;
    sideChatRetry: string;
    sideChatThreads: string;
    sideChatSave: string;
    sideChatSaveTitle: string;
    sideChatArchive: string;
    sideChatArchiveRunning: string;
    sideChatSaved: string;
    sideChatNoTurn: string;
    sideChatPendingDrop: string;
    sideChatQueued: string;
    sideChatSending: string;
    sideChatDequeue: string;
    sideChatRunError: string;
    sideChatModel: string;
    sideChatModelInherit: string;
    sideChatReasoning: string;
    sideChatFirstPlaceholder: string;
    sideChatComposerPlaceholder: string;
    sideChatThinking: string;
    sideChatThink: string;
    sideChatInjection: string;
    sideChatSend: string;
    sideChatCancelTitle: string;
    sideChatError: string;
    sideChatTurnUsage: string;
    sideChatBlockCollapse: string;
    sideChatBlockCollapseAria: string;
    sideChatBlockExpand: string;
    sideChatBlockExpandAria: string;
    sideChatBlockSignal: string;
    sideChatBlockExitCode: string;
    sideChatBlockNoExitCode: string;
    sideChatBlockRunning: string;
    sideChatBlockFailed: string;
    sideChatBlockDone: string;
    sideChatBlockNoOutput: string;
    sideChatBlockCommandLine: string;
    codeBlockTitle: string;
    codeBlockWrap: string;
    codeBlockUnwrap: string;
    sideChatBlockWindow: string;
    sideChatConnDisconnected: string;
    sideChatConnConnecting: string;
    sideChatConnRecovered: string;
    sideChatConnReconnectAction: string;
    sideChatConnRestartAction: string;
    jobs: string;
    jobsCount: string;
    jobsCountRunning: string;
    jobStatusRunning: string;
    jobStatusStopping: string;
    jobStatusCompleted: string;
    jobStatusKilled: string;
    jobStatusFailed: string;
    jobDurationSeconds: string;
    jobDurationMinutes: string;
    jobDurationHours: string;
    jobViewOutput: string;
    jobNoOutput: string;
    jobNotReadYet: string;
    jobOutputTruncated: string;
    jobOutputError: string;
    jobKill: string;
    jobKillConfirm: string;
    jobKillError: string;
    tasksViewGraph: string;
    tasksViewTree: string;
    tasksViewSwitchToGraph: string;
    tasksViewSwitchToTree: string;
    settingsViewModeTitle: string;
    settingsViewModeDesc: string;
    settingsViewModeGraph: string;
    settingsViewModeGraphDesc: string;
    settingsViewModeTree: string;
    settingsViewModeTreeDesc: string;
    tasksFoldIdleGroup: string;
    tasksFoldIdle: string;
    tasksFoldCompleted: string;
    tasksFoldOne: string;
    tasksFoldExpand: string;
    tasksFoldCollapse: string;
    tasksZoomIn: string;
    tasksZoomOut: string;
    tasksZoomFit: string;
    tasksNodeJump: string;
    tasksNodeDetail: string;
    workflowRun: string;
    tasksNodeState: string;
    tasksFoldExpandShort: string;
    tasksTreeCollapseAll: string;
    tasksTreeExpandAll: string;
    tasksTreeCollapseRow: string;
    tasksTreeExpandRow: string;
    tasksNodeTokens: string;
    tasksNodeDuration: string;
    tasksNodeOpenMain: string;
    tasksNodeMode: string;
    tasksNodeModel: string;
    tasksNodeTeamRole: string;
    tasksStateRunning: string;
    tasksStateIdle: string;
    tasksStateProvisioning: string;
    tasksStateDone: string;
    tasksStateError: string;
    tasksKindSubagent: string;
    tasksKindTeammate: string;
    tasksKindWorkflow: string;
    taskWindowCreate: string;
    taskWindowDetail: string;
    teamBoard: string;
    teamChip: string;
    teamTasksEmpty: string;
    teamTaskCreate: string;
    teamTaskSubject: string;
    teamTaskDescription: string;
    teamTaskOwner: string;
    teamTaskUnowned: string;
    teamTaskPending: string;
    teamTaskInProgress: string;
    teamTaskCompleted: string;
    teamTaskBlocked: string;
    teamTaskClaim: string;
    teamTaskComplete: string;
    teamTaskReopen: string;
    teamTaskDelete: string;
    teamTaskDeleteConfirm: string;
    teamTaskEdit: string;
    teamTaskSave: string;
    teamTaskCancel: string;
    teamTaskConflict: string;
    teamTaskError: string;
    teamTaskDeleted: string;
    teamTaskActions: string;
    teamTaskDetail: string;
    teamTaskNoDescription: string;
    teamTaskBlockedBy: string;
    teamTaskSubjectPlaceholder: string;
    teamTaskDescriptionPlaceholder: string;
    teamFilterAll: string;
    tasksNodeTasks: string;
    jobCopyOutput: string;
    jobCopied: string;
    jobFollowTail: string;
    jobDragHint: string;
    workflowRunning: string;
    workflowCompleted: string;
    workflowCancelled: string;
    workflowFailed: string;
    workflowPhaseUnnamed: string;
    workflowMembers: string;
    jobsAutoCollapsed: string;
    contextDiagnostics: string;
    contextDiagnosticsTarget: string;
    contextDiagnosticsFailed: string;
    contextDiagnosticsUnavailable: string;
    contextDiagnosticsNavigation: string;
    contextDiagnosticsTimeout: string;
    contextDiagnosticsOpenFailed: string;
    contextDiagnosticsDismiss: string;
    catalogLoadFailed: string;
    addPluginsTabCard: string;
    addPluginsTabCardDesc: string;
    addPluginsViewerCard: string;
    addPluginsViewerCardDesc: string;
    addPluginsTabDesc: string;
    addPluginsViewerDesc: string;
    addPluginsBrowseMore: string;
    addPluginsSearch: string;
    addPluginsNoMatch: string;
    addPluginsRecommended: string;
    addPluginsEmpty: string;
    openPlugin: string;
    copyInstall: string;
    pluginMdExportDesc: string;
    pluginAgentPersonaDesc: string;
    pluginOfficeDesc: string;
    pluginFlowglassDesc: string;
    pluginGitForgeDesc: string;
    pluginGithubWorkbenchDesc: string;
    pluginIdeGitDesc: string;
    pluginSuhuangScrollDesc: string;
    pluginBetterOverleafDesc: string;
    pluginSentinelDesc: string;
    pluginServerDeckDesc: string;
    pluginSidebarQaDesc: string;
    pluginSidenoteDesc: string;
    pluginSshTunnelDesc: string;
    pluginVideoPreviewDesc: string;
    pluginAudioDesc: string;
    pluginCodeNavDesc: string;
    pluginDevGitGraphDesc: string;
    pluginDocsPanelDesc: string;
    pluginTylinaDesc: string;
    pluginEgoBrowserDesc: string;
    pluginBilingualReaderDesc: string;
    pluginDshMemoryDeltaDesc: string;
    pluginAgentPersonaName: string;
    pluginSentinelName: string;
    pluginFileTraceName: string;
    pluginFileTraceDesc: string;
    pluginMnemeName: string;
    pluginMnemeDesc: string;
    pluginEgoBrowserName: string;
    pluginBetterOverleafName: string;
    pluginDocsPanelName: string;
    pluginTylinaName: string;
    pluginFlowglassName: string;
    pluginGitForgeName: string;
    pluginGithubWorkbenchName: string;
    pluginIdeGitName: string;
    pluginSidebarQaName: string;
    pluginSidenoteName: string;
    pluginServerDeckName: string;
    pluginSuhuangScrollName: string;
    pluginSshTunnelName: string;
    pluginBilingualReaderName: string;
    pluginOfficeName: string;
    pluginMdExportName: string;
    pluginCodeNavName: string;
    pluginVideoPreviewName: string;
    pluginAudioName: string;
    pluginTurnOutlineName: string;
    pluginTurnOutlineDesc: string;
    pluginDshMemoryDeltaName: string;
};
/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export declare const en: Record<keyof typeof zh, string>;
/**
 * The dictionary namespace this plugin owns in the DSH locale registry
 * (`'sidebar'` is taken by DSH's own ui-sidebar, hence this distinct name).
 */
export declare const LOCALE_NS = "betterSidebar";
/**
 * The better-locale override store attached by the client apply
 * (absent → no override; the zh/en chain runs). The store's `active`
 * field holds the user's chosen override id (e.g. `'ja'`); `undefined`
 * means "no override, use DSH native zh/en".
 *
 * The override only takes effect when DSH's active locale is `'en'`
 * (it borrows DSH's English slot to render a third language). While
 * DSH is on `'zh'` the override is inert — `getOverride` returns
 * `undefined` and `isOverrideActive` returns `false` — so `t()` and
 * `isZh()` fall through to the native zh/en chain unchanged.
 */
declare let betterLocaleStore: {
    readonly active: string | undefined;
    getOverride(dshActive: string, ns: string, key: string): string | undefined;
    isOverrideActive(dshActive: string): boolean;
} | undefined;
/**
 * Attach (or detach, with undefined) the DSH locale service. The sidebar
 * mounts its own React root outside the slot system's locale seat, so the
 * service rides this module-level holder: components keep calling the plain
 * `t()` function, and the Sidebar root's locale subscription re-renders the
 * whole tree on switches.
 */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
    /** Optional namespace binding ({@link chatT} needs it; a bare snapshot face is still valid). */
    bind?(ns: string): (key: string, params?: Record<string, string | number>) => string;
} | undefined): void;
/**
 * Translate a key in the HOST's own `chat` namespace — the wording the main
 * conversation's merged "process" header uses (`message.stepProcess.*`,
 * registered by `@deepseek-ai/dsh-client-ui-chat`). The Tasks page reads it so
 * a running node reads exactly like the main agent's own activity line instead
 * of inventing a second vocabulary (and without adding ~40 keys to 20 plugin
 * dictionaries).
 *
 * Deliberately untyped: these keys are NOT a documented host contract. A host
 * that renames one, or a deployment where the chat target never mounted,
 * returns the key unchanged — the caller then falls back to its own wording
 * ({@link chatT} answers undefined) rather than printing `message.…`.
 *
 * @param key - full `chat`-namespace key.
 * @param params - `{name}` placeholders to interpolate (the host does this).
 * @returns the translated text, or undefined when unavailable.
 */
export declare function chatT(key: string, params?: Record<string, string | number>): string | undefined;
/**
 * Translate a key in one of the HOST's own locale namespaces. Same contract
 * and same deliberately-untyped seam as {@link chatT} — the plugin reads host
 * wording it would otherwise have to duplicate across 20 dictionaries (the
 * chat activity line, the open-in-app application names).
 *
 * @param ns - host namespace (e.g. `'open-in-app'`).
 * @param key - full namespace key (e.g. `'app.vscode'`).
 * @param params - `{name}` placeholders to interpolate (the host does this).
 * @returns the translated text, or undefined when unavailable.
 */
export declare function hostT(ns: string, key: string, params?: Record<string, string | number>): string | undefined;
/**
 * Attach (or detach, with undefined) the better-locale override store.
 * When attached with an active override, `t()` consults the store's
 * `getOverride(active, LOCALE_NS, key)` first; if it returns a string,
 * that text wins over the zh/en chain. Detaching (or the store's active
 * being `undefined`) restores the zh/en chain unchanged.
 *
 * The Sidebar root subscribes to the store separately (see Sidebar.tsx)
 * so an override change re-renders the whole tree — the locale service's
 * own revision bump (which better-locale triggers via `publish(active, true)`)
 * does NOT fire the existing `localeRevision` uSES because that snapshot
 * reads `getSnapshot().active` (unchanged) rather than `revision`.
 */
export declare function attachBetterLocale(store: typeof betterLocaleStore): void;
/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh;
/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
/** Whether the active locale is Chinese (used for selectors). */
export declare function isZh(): boolean;
/**
 * A signature of the effective UI language: the DSH locale service's active
 * id plus the better-locale override id when one is actually in force (the
 * override only borrows DSH's `en` slot, so it is inert while DSH is on
 * `zh`). `t()` resolves copy from exactly these two inputs, so a component
 * that caches localized text OUTSIDE React state — e.g. CodeMirror's
 * `phrases` facet, which is baked into an EditorState — can use this string
 * as an effect dependency to know when to re-resolve it.
 */
export declare function localeSignature(): string;
/** Format an ISO 8601 author date relative to now (刚刚 / N 分钟前 / N 小时前 / 昨天 / date). */
export declare function relativeTime(iso: string): string;
export {};
