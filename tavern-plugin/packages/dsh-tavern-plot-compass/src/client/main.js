/* ------------------------------------------------------------------ *
 * main.js —— 浏览器端挂载点注册（面板 / 输入栏提示条 / 状态卡）与导出
 * ------------------------------------------------------------------ */

function pcRegisterSafely(ctx, label, factory) {
  try {
    const disposable = factory()
    if (typeof disposable === 'function' && ctx && typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => disposable, label)
      } catch {}
    }
    return disposable
  } catch (error) {
    try { console.warn('[dsh-tavern-plot-compass] 挂载点注册失败：' + label, error && error.message) } catch {}
    return null
  }
}

function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui) return
  pcEnsureStyleInjected()

  // 1) 右侧栏「插件」卡片区 / 标签页：剧情罗盘完整工作台
  pcRegisterSafely(ctx, 'plot-compass: panel', () => ui.registerPanel({
    id: PC_PANEL_ID,
    title: '剧情罗盘',
    render: ({ gameId } = {}) => h(PlotCompassPanel, { ui, gameId })
  }))

  // 2) 输入栏动作区：开启本局剧情罗盘时展示当前锚定/推演入口按钮
  if (typeof ui.registerComposerSlot === 'function') {
    pcRegisterSafely(ctx, 'plot-compass: composer slot', () => ui.registerComposerSlot({
      id: PC_PANEL_ID,
      modes: ['play'],
      render: ({ sessionId, gameId } = {}) => h(PlotCompassComposerDock, { ui, sessionId, gameId })
    }))
  }

  // 3) 酒馆状态页：当前锚定路线概览
  if (typeof ui.registerStatusSection === 'function') {
    pcRegisterSafely(ctx, 'plot-compass: status section', () => ui.registerStatusSection({
      id: 'plot-compass-status',
      title: '剧情罗盘',
      render: ({ gameId } = {}) => h(PlotCompassStatusSection, { ui, gameId })
    }))
  }
}

exports.name = PC_PLUGIN_ID
exports.inject = ['tavernUi']
exports.apply = apply
exports.PlotCompassPanel = PlotCompassPanel
exports.PlotCompassComposerDock = PlotCompassComposerDock
exports.PlotCompassStatusSection = PlotCompassStatusSection
exports.__test = {
  PC_PANEL_ID,
  PC_PLUGIN_ID,
  PC_PRESET_ARCHETYPES,
  PC_HORIZON_META,
  PC_PACE_OPTIONS,
  PC_MODEL_OPTIONS,
  PC_AUTO_UPDATE_PRESETS,
  pcEmptyCompass,
  pcMidPhaseLabel,
  pcActiveCompassSummary
}
