/* ------------------------------------------------------------------ *
 * main.js —— 挂载点注册（工作台面板 / 输入栏揭晓条 / 楼层胶囊 / 状态分节）与导出
 * 所有 register* 均包在 try/catch 内：任一宿主版本缺失接口都不会阻断页面加载
 * ------------------------------------------------------------------ */

function FateDicePanel(props) {
  const { ui, gameId } = props || {}
  if (gameId) fdNoteActiveGameId(gameId)
  return h(WorkbenchPanel, { ui, gameId })
}

function fdRegisterSafely(ctx, label, factory) {
  try {
    const disposable = factory()
    if (typeof disposable === 'function' && ctx && typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => disposable, label)
      } catch {}
    }
    return disposable
  } catch (error) {
    fdSafe(() => console.warn('[dsh-tavern-fate-dice] 挂载点注册失败：' + label, error && error.message))
    return null
  }
}

function fdMountEnabledViews(ui) {
  const stops = []
  const register = (name, factory) => {
    const stop = fdRegisterSafely(null, name, factory)
    if (typeof stop === 'function') stops.push(stop)
  }
  register('fate-dice: floor header pill', () => fdMountImperativeFloorHeaders(ui))
  register('fate-dice: pre-send reroll gate', () => fdMountPreSendGate(ui))

  // 3) 楼层自动挂载胶囊（默认「内置」正文样式无需手切即可在每层正文下方看到检定与重投按钮）
  if (typeof ui.registerMediaRenderer === 'function') {
    register('fate-dice: roll capsule media', () => ui.registerMediaRenderer(
      'dsh-tavern-fate-dice/roll-capsule',
      ({ gameId, turn, item } = {}) => h(MediaTurnRollCapsule, { ui, gameId, turn, item })
    ))
  }

  // 4) 楼层可选视图胶囊：无检定时原样返回 children（与自动媒体胶囊互斥防重）
  register('fate-dice: turn view', () => ui.registerTurnView({
    id: 'fate-dice-turn',
    label: '检定胶囊',
    render: ({ gameId, turn, settled, greeting, children } = {}) => {
      if (!settled || greeting || !turn) return children || null
      return h(TurnRollCapsule, { ui, gameId, turn, children, fromTurnView: true })
    }
  }))

  // 4) 酒馆状态页精简状态卡
  register('fate-dice: status section', () => ui.registerStatusSection({
    id: 'fate-dice-status',
    title: '命运之骰检定',
    render: ({ gameId } = {}) => h(StatusDiceSection, { ui, gameId })
  }))
  return () => stops.forEach(stop => fdSafe(stop))
}

function fdWatchEnabledViews(ui) {
  let stopViews = null
  let stopGameWatch = fdNoop
  let disposed = false
  let revision = 0

  const applySettings = settings => {
    if (disposed || typeof settings?.enabled !== 'boolean') return
    revision += 1
    fdNoteRuntimeFlags('', { settings })
    if (settings.enabled && !stopViews) stopViews = fdMountEnabledViews(ui)
    if (!settings.enabled && stopViews) {
      stopViews()
      stopViews = null
    }
  }
  const refresh = () => {
    const request = ++revision
    void fdCall(ui, FD_RPC.status, {}).then(res => {
      if (disposed || request !== revision || !res.ok || !res.data) return
      applySettings(res.data.globalSettings || res.data.settings)
    })
  }
  const watchGame = gameId => {
    stopGameWatch()
    stopGameWatch = fdWatch(ui, gameId, 'workbench-sync', data => {
      if (typeof data?.settings?.enabled === 'boolean') refresh()
    })
  }
  fdSavedSettingsListeners.add(applySettings)
  const activeGame = fdGetActiveGameId()
  const stopActiveGame = fdSubscribeActiveGameId(watchGame)
  if (activeGame) watchGame(activeGame)
  refresh()
  return () => {
    disposed = true
    fdSavedSettingsListeners.delete(applySettings)
    stopActiveGame()
    stopGameWatch()
    if (stopViews) stopViews()
  }
}

function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui) return
  fdEnsureStyleInjected()

  if (typeof ui.onPlayEvent === 'function') {
    fdRegisterSafely(ctx, 'fate-dice: play event tracker', () => ui.onPlayEvent(ev => {
      if (ev && ev.gameId) fdNoteActiveGameId(ev.gameId)
    }))
  }
  if (typeof ui.registerMessageAction === 'function') {
    fdRegisterSafely(ctx, 'fate-dice: session probe', () => ui.registerMessageAction({
      id: 'fate-dice-session-probe',
      label: '检定状态',
      when: ({ gameId } = {}) => {
        if (gameId) fdNoteActiveGameId(gameId)
        return false
      },
      run: () => {}
    }))
  }
  fdRegisterSafely(ctx, 'fate-dice: workbench panel', () => ui.registerPanel({
    id: FD_PANEL_ID,
    title: '命运之骰',
    render: ({ gameId } = {}) => h(FateDicePanel, { ui, gameId })
  }))
  fdRegisterSafely(ctx, 'fate-dice: enabled views', () => fdWatchEnabledViews(ui))
}

exports.name = FD_PLUGIN_ID
exports.inject = ['tavernUi']
exports.apply = apply
exports.WorkbenchPanel = WorkbenchPanel
exports.__test = { fdMountPreSendGate, fdProbePreSendGate, fdSchedulePreSendGateProbes, fdRenderPreSendGate, fdClearPreSendGate, fdGateSecondsLeft, fdGateDiceText, fdSyncPreSendGateLayout, fdIsPreSendGateHoldingOverlay, fdReadTurnBatched, fdInvalidateTurnCache, fdNoteRuntimeFlags, fdIsEnabledForGame, fdMayNeedPreSendGate, fdLoadWorkbench, fdPersistSettings, DieGlyph, formatRollSummary, LiveRollBanner, ComposerLiveDock, ComposerDicePopover, fdResolveFloorToneAndLabel, fdComputePopoverStyle, TurnRollCapsule, FdRerollActionBox, StoryFloorDiceItem, fdExtractFloorTurn, fdMountImperativeFloorHeaders, fdNoteActiveGameId, fdGetActiveGameId, WorkbenchPanel, ChecksTab, DecisionModelGuideBanner, FdHelp, SettingsTab, FD3D, Fd3DDiceStage, useFdHoldCharge, fdAttachHoldChargeToDomBtn, fdPlayFloorRollAnim, fdDisposeFloorRollOverlay, fdFloorRollAnimKey, fdGetPrimaryFloorRollOverlay }
