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

function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui) return
  fdEnsureStyleInjected()

  // 0) 会话活跃感知 + 楼层顶栏（与叙事阻尼器胶囊并排）常驻渲染桥
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
  fdRegisterSafely(ctx, 'fate-dice: floor header pill', () => fdMountImperativeFloorHeaders(ui))

  // 0.5) 发前暂停闸门：失败 / 大失败时先按住正文请求，弹窗让玩家决定命运点重投或接受
  fdRegisterSafely(ctx, 'fate-dice: pre-send reroll gate', () => fdMountPreSendGate(ui))

  // 1) 右侧栏「插件」卡片区：常驻双页签极简工作台（桌面与手机竖屏单列自适应）
  fdRegisterSafely(ctx, 'fate-dice: workbench panel', () => ui.registerPanel({
    id: FD_PANEL_ID,
    title: '命运之骰',
    render: ({ gameId } = {}) => h(FateDicePanel, { ui, gameId })
  }))

  // 2) 胶囊不再停在输入栏上方：fdMountImperativeFloorHeaders 把它挂到每轮对话的尾部
  //    （story 视图的 .dsh-tavern-story-row-actions，没有操作栏时回退楼层顶栏）。

  // 3) 楼层自动挂载胶囊（默认「内置」正文样式无需手切即可在每层正文下方看到检定与重投按钮）
  if (typeof ui.registerMediaRenderer === 'function') {
    fdRegisterSafely(ctx, 'fate-dice: roll capsule media', () => ui.registerMediaRenderer(
      'dsh-tavern-fate-dice/roll-capsule',
      ({ gameId, turn, item } = {}) => h(MediaTurnRollCapsule, { ui, gameId, turn, item })
    ))
  }

  // 4) 楼层可选视图胶囊：无检定时原样返回 children（与自动媒体胶囊互斥防重）
  fdRegisterSafely(ctx, 'fate-dice: turn view', () => ui.registerTurnView({
    id: 'fate-dice-turn',
    label: '检定胶囊',
    render: ({ gameId, turn, settled, greeting, children } = {}) => {
      if (!settled || greeting || !turn) return children || null
      return h(TurnRollCapsule, { ui, gameId, turn, children, fromTurnView: true })
    }
  }))

  // 4) 酒馆状态页精简状态卡
  fdRegisterSafely(ctx, 'fate-dice: status section', () => ui.registerStatusSection({
    id: 'fate-dice-status',
    title: '命运之骰检定',
    render: ({ gameId } = {}) => h(StatusDiceSection, { ui, gameId })
  }))
}

exports.name = FD_PLUGIN_ID
exports.inject = ['tavernUi']
exports.apply = apply
exports.WorkbenchPanel = WorkbenchPanel
exports.__test = { fdMountPreSendGate, fdProbePreSendGate, fdSchedulePreSendGateProbes, fdRenderPreSendGate, fdClearPreSendGate, fdGateSecondsLeft, fdGateDiceText, fdSyncPreSendGateLayout, fdIsPreSendGateHoldingOverlay, fdReadTurnBatched, fdInvalidateTurnCache, fdNoteRuntimeFlags, fdIsEnabledForGame, fdMayNeedPreSendGate, fdLoadWorkbench, DieGlyph, formatRollSummary, LiveRollBanner, ComposerLiveDock, ComposerDicePopover, fdResolveFloorToneAndLabel, fdComputePopoverStyle, TurnRollCapsule, FdRerollActionBox, StoryFloorDiceItem, fdExtractFloorTurn, fdMountImperativeFloorHeaders, fdNoteActiveGameId, fdGetActiveGameId, WorkbenchPanel, ChecksTab, DecisionModelGuideBanner, FdHelp, SettingsTab, FD3D, Fd3DDiceStage, useFdHoldCharge, fdAttachHoldChargeToDomBtn, fdPlayFloorRollAnim, fdDisposeFloorRollOverlay, fdFloorRollAnimKey, fdGetPrimaryFloorRollOverlay }
